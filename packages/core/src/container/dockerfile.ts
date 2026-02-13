import type { SpaceConfig } from '../types';
import type { DockerfileOptions } from './types';

export function generateDockerfile(
  config: SpaceConfig,
  options: DockerfileOptions = {}
): string {
  const {
    gpu = false,
    cudaVersion = '12.6',
    port = 8188,
    extraPackages = [],
    modelDir = config.metadata.model_dir,
  } = options;

  const pythonVersion = config.metadata.pythonVersion;
  const lines: string[] = [];

  if (gpu === 'nvidia') {
    const cudaMajorMinor = cudaVersion.split('.').slice(0, 2).join('.');
    lines.push(`FROM nvidia/cuda:${cudaMajorMinor}.0-runtime-ubuntu22.04`);
    lines.push('');
    lines.push(`RUN apt-get update && apt-get install -y \\`);
    lines.push(`    python${pythonVersion} \\`);
    lines.push(`    python${pythonVersion}-venv \\`);
    lines.push(`    python3-pip \\`);
    lines.push(`    git \\`);
    lines.push(`    build-essential \\`);
    if (extraPackages.length > 0) {
      extraPackages.forEach((pkg) => lines.push(`    ${pkg} \\`));
    }
    lines.push(`    && rm -rf /var/lib/apt/lists/*`);
  } else {
    lines.push(`FROM python:${pythonVersion}-slim`);
    lines.push('');
    lines.push(`RUN apt-get update && apt-get install -y \\`);
    lines.push(`    git \\`);
    lines.push(`    build-essential \\`);
    if (extraPackages.length > 0) {
      extraPackages.forEach((pkg) => lines.push(`    ${pkg} \\`));
    }
    lines.push(`    && rm -rf /var/lib/apt/lists/*`);
  }

  lines.push('');
  lines.push('WORKDIR /app');
  lines.push('');

  const githubUrl = config.metadata.githubUrl;
  const { releaseTag, branch, commitId } = config.metadata;

  if (releaseTag) {
    lines.push(`RUN git clone --branch ${releaseTag} --depth 1 ${githubUrl} ComfyUI`);
  } else if (commitId) {
    if (branch) {
      lines.push(`RUN git clone --branch ${branch} ${githubUrl} ComfyUI \\`);
      lines.push(`    && cd ComfyUI \\`);
      lines.push(`    && git checkout ${commitId}`);
    } else {
      lines.push(`RUN git clone ${githubUrl} ComfyUI \\`);
      lines.push(`    && cd ComfyUI \\`);
      lines.push(`    && git checkout ${commitId}`);
    }
  } else if (branch) {
    lines.push(`RUN git clone --branch ${branch} --depth 1 ${githubUrl} ComfyUI`);
  } else {
    lines.push(`RUN git clone --depth 1 ${githubUrl} ComfyUI`);
  }

  lines.push('');
  lines.push('WORKDIR /app/ComfyUI');
  lines.push('');

  const enabledNodes = config.nodes.filter((node) => !node.disabled && node.githubUrl);
  if (enabledNodes.length > 0) {
    lines.push('RUN mkdir -p custom_nodes');
    lines.push('');

    enabledNodes.forEach((node, index) => {
      const nodeUrl = node.githubUrl!;
      const nodeName = node.name;

      if (node.commitId) {
        if (node.branch) {
          lines.push(`RUN git clone --branch ${node.branch} ${nodeUrl} custom_nodes/${nodeName} \\`);
          lines.push(`    && cd custom_nodes/${nodeName} \\`);
          lines.push(`    && git checkout ${node.commitId} \\`);
          lines.push(`    && cd ../..`);
        } else {
          lines.push(`RUN git clone ${nodeUrl} custom_nodes/${nodeName} \\`);
          lines.push(`    && cd custom_nodes/${nodeName} \\`);
          lines.push(`    && git checkout ${node.commitId} \\`);
          lines.push(`    && cd ../..`);
        }
      } else if (node.branch) {
        lines.push(`RUN git clone --branch ${node.branch} --depth 1 ${nodeUrl} custom_nodes/${nodeName}`);
      } else {
        lines.push(`RUN git clone --depth 1 ${nodeUrl} custom_nodes/${nodeName}`);
      }

      if (index < enabledNodes.length - 1) {
        lines.push('');
      }
    });

    lines.push('');
  }

  const installManager = config.metadata.installManager !== false;
  if (installManager) {
    lines.push('RUN git clone --depth 1 https://github.com/ashish-aesthisia/ComfyUI-Manager custom_nodes/comfyui-manager');
    lines.push('');
  }

  if (config.dependencies.length > 0) {
    lines.push('COPY <<EOF /app/ComfyUI/requirements.txt');
    config.dependencies.forEach((dep) => lines.push(dep));
    lines.push('EOF');
    lines.push('');
    lines.push('RUN pip install --no-cache-dir -r requirements.txt');
    lines.push('');
  }

  if (modelDir) {
    const extraModelPathsContent = generateExtraModelPathsYaml(modelDir);
    lines.push('COPY <<EOF /app/ComfyUI/extra_model_paths.yaml');
    lines.push(extraModelPathsContent);
    lines.push('EOF');
    lines.push('');
  }

  lines.push(`EXPOSE ${port}`);
  lines.push('');

  const comfyUIArgs = config.metadata.comfyUIArgs || '';
  const args = parseComfyUIArgs(comfyUIArgs);
  if (!args.includes('--listen')) {
    args.push('--listen', '0.0.0.0');
  }

  const cmdParts = ['python', 'main.py', ...args];
  const cmdString = cmdParts.map((part) => `"${part}"`).join(', ');
  lines.push(`CMD [${cmdString}]`);

  return lines.join('\n') + '\n';
}

function generateExtraModelPathsYaml(modelDir: string): string {
  const basePath = modelDir.endsWith('/') ? modelDir : `${modelDir}/`;
  return `comfyui:
  base_path: ${basePath}
  is_default: true
  checkpoints: checkpoints/
  text_encoders: |
    text_encoders/
    clip/
  clip_vision: clip_vision/
  configs: configs/
  controlnet: controlnet/
  diffusion_models: |
    diffusion_models
    unet
  embeddings: embeddings/
  loras: loras/
  upscale_models: upscale_models/
  vae: vae/
  audio_encoders: audio_encoders/
  model_patches: model_patches/`;
}

function parseComfyUIArgs(argsString: string): string[] {
  if (!argsString || !argsString.trim()) {
    return [];
  }

  const args: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;

  for (const char of argsString.trim()) {
    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (/\s/.test(char) && !inSingle && !inDouble) {
      if (current) {
        if (current !== '>' && !isPythonCommand(current)) {
          args.push(current);
        }
        current = '';
      }
      continue;
    }
    current += char;
  }

  if (current && current !== '>' && !isPythonCommand(current)) {
    args.push(current);
  }

  return args.filter((arg) => !arg.startsWith('>'));
}

function isPythonCommand(commandPart: string): boolean {
  return /(^|[\\/])python(?:\d+)?(?:\.exe)?$/i.test(commandPart.trim());
}
