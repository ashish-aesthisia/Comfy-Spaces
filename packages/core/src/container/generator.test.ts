import { describe, it, expect } from 'vitest';
import { generateDockerfile } from './generator';
import type { SpaceConfig } from '../types';

describe('generateDockerfile', () => {
  const minimalConfig: SpaceConfig = {
    nodes: [],
    dependencies: [],
    metadata: {
      visibleName: 'Test Space',
      spaceId: 'test-space',
      pythonVersion: '3.11',
      githubUrl: 'https://github.com/comfyanonymous/ComfyUI',
      branch: null,
      commitId: null,
      releaseTag: null,
    },
  };

  it('should throw error if githubUrl is missing', () => {
    const config = {
      ...minimalConfig,
      metadata: { ...minimalConfig.metadata, githubUrl: '' },
    };
    expect(() => generateDockerfile(config)).toThrow(
      'SpaceConfig.metadata.githubUrl is required'
    );
  });

  it('should throw error if pythonVersion is missing', () => {
    const config = {
      ...minimalConfig,
      metadata: { ...minimalConfig.metadata, pythonVersion: '' },
    };
    expect(() => generateDockerfile(config)).toThrow(
      'SpaceConfig.metadata.pythonVersion is required'
    );
  });

  it('should throw error if spaceId is missing', () => {
    const config = {
      ...minimalConfig,
      metadata: { ...minimalConfig.metadata, spaceId: '' },
    };
    expect(() => generateDockerfile(config)).toThrow(
      'SpaceConfig.metadata.spaceId is required'
    );
  });

  it('should generate basic CPU Dockerfile', () => {
    const dockerfile = generateDockerfile(minimalConfig);

    expect(dockerfile).toContain('# syntax=docker/dockerfile:1');
    expect(dockerfile).toContain('FROM python:3.11-slim');
    expect(dockerfile).toContain('WORKDIR /app');
    expect(dockerfile).toContain(
      'RUN git clone --depth 1 https://github.com/comfyanonymous/ComfyUI ComfyUI'
    );
    expect(dockerfile).toContain('EXPOSE 8188');
    expect(dockerfile).toContain('CMD ["python", "main.py", "--listen", "0.0.0.0"]');
  });

  it('should generate NVIDIA GPU Dockerfile', () => {
    const config: SpaceConfig = {
      ...minimalConfig,
      dependencies: ['numpy==1.24.0'],
    };
    const dockerfile = generateDockerfile(config, {
      gpu: 'nvidia',
      cudaVersion: '12.6',
    });

    expect(dockerfile).toContain('FROM nvidia/cuda:12.6.0-runtime-ubuntu22.04');
    expect(dockerfile).toContain('python3.11');
    expect(dockerfile).toContain('add-apt-repository ppa:deadsnakes/ppa');
    expect(dockerfile).toContain('python3.11 -m pip install');
    expect(dockerfile).toContain('CMD ["python3.11", "main.py", "--listen", "0.0.0.0"]');
  });

  it('should not add deadsnakes PPA for Python 3.10 on NVIDIA', () => {
    const config = {
      ...minimalConfig,
      metadata: { ...minimalConfig.metadata, pythonVersion: '3.10' },
    };
    const dockerfile = generateDockerfile(config, { gpu: 'nvidia' });

    expect(dockerfile).not.toContain('deadsnakes');
    expect(dockerfile).toContain('FROM nvidia/cuda');
  });

  it('should not add deadsnakes PPA for Python 3.10.x versions on NVIDIA', () => {
    const config = {
      ...minimalConfig,
      metadata: { ...minimalConfig.metadata, pythonVersion: '3.10.12' },
    };
    const dockerfile = generateDockerfile(config, { gpu: 'nvidia' });

    expect(dockerfile).not.toContain('deadsnakes');
    expect(dockerfile).toContain('FROM nvidia/cuda');
    expect(dockerfile).toContain('python3.10');
    expect(dockerfile).toContain('CMD ["python3.10", "main.py"');
  });

  it('should use major.minor version for apt packages and executables', () => {
    const config = {
      ...minimalConfig,
      dependencies: ['numpy==1.24.0'],
      metadata: { ...minimalConfig.metadata, pythonVersion: '3.11.5' },
    };
    const dockerfile = generateDockerfile(config, { gpu: 'nvidia' });

    // Should use python3.11, not python3.11.5
    expect(dockerfile).toContain('python3.11 \\');
    expect(dockerfile).toContain('python3.11-venv \\');
    expect(dockerfile).toContain('python3.11-dev \\');
    expect(dockerfile).toContain('python3.11 -m pip install');
    expect(dockerfile).toContain('CMD ["python3.11", "main.py"');
    
    // Should NOT contain full version string
    expect(dockerfile).not.toContain('python3.11.5');
  });

  it('should clone ComfyUI with specific branch', () => {
    const config = {
      ...minimalConfig,
      metadata: { ...minimalConfig.metadata, branch: 'develop' },
    };
    const dockerfile = generateDockerfile(config);

    expect(dockerfile).toContain(
      'RUN git clone --branch develop --depth 1 https://github.com/comfyanonymous/ComfyUI ComfyUI'
    );
  });

  it('should clone ComfyUI with specific release tag', () => {
    const config = {
      ...minimalConfig,
      metadata: { ...minimalConfig.metadata, releaseTag: 'v1.0.0' },
    };
    const dockerfile = generateDockerfile(config);

    expect(dockerfile).toContain(
      'RUN git clone --branch v1.0.0 --depth 1 https://github.com/comfyanonymous/ComfyUI ComfyUI'
    );
  });

  it('should clone ComfyUI with specific commit', () => {
    const config = {
      ...minimalConfig,
      metadata: { ...minimalConfig.metadata, commitId: 'abc123' },
    };
    const dockerfile = generateDockerfile(config);

    expect(dockerfile).toContain('git checkout abc123');
  });

  it('should include custom nodes', () => {
    const config: SpaceConfig = {
      ...minimalConfig,
      nodes: [
        {
          name: 'ComfyUI-Custom-Node',
          githubUrl: 'https://github.com/user/ComfyUI-Custom-Node',
          branch: null,
          commitId: null,
        },
      ],
    };
    const dockerfile = generateDockerfile(config);

    expect(dockerfile).toContain('RUN mkdir -p custom_nodes');
    expect(dockerfile).toContain(
      'RUN git clone --depth 1 https://github.com/user/ComfyUI-Custom-Node custom_nodes/ComfyUI-Custom-Node'
    );
  });

  it('should skip disabled nodes', () => {
    const config: SpaceConfig = {
      ...minimalConfig,
      nodes: [
        {
          name: 'DisabledNode',
          githubUrl: 'https://github.com/user/DisabledNode',
          branch: null,
          commitId: null,
          disabled: true,
        },
      ],
    };
    const dockerfile = generateDockerfile(config);

    expect(dockerfile).not.toContain('DisabledNode');
  });

  it('should include ComfyUI-Manager by default', () => {
    const dockerfile = generateDockerfile(minimalConfig);

    expect(dockerfile).toContain(
      'https://github.com/ashish-aesthisia/ComfyUI-Manager'
    );
  });

  it('should skip ComfyUI-Manager when installManager is false', () => {
    const config = {
      ...minimalConfig,
      metadata: { ...minimalConfig.metadata, installManager: false },
    };
    const dockerfile = generateDockerfile(config);

    expect(dockerfile).not.toContain('ComfyUI-Manager');
  });

  it('should include dependencies', () => {
    const config: SpaceConfig = {
      ...minimalConfig,
      dependencies: ['torch==2.0.0', 'transformers==4.30.0'],
    };
    const dockerfile = generateDockerfile(config);

    expect(dockerfile).toContain('COPY <<EOF /app/ComfyUI/requirements.txt');
    expect(dockerfile).toContain('torch==2.0.0');
    expect(dockerfile).toContain('transformers==4.30.0');
    expect(dockerfile).toContain('pip install --no-cache-dir --upgrade pip');
  });

  it('should include extra_model_paths.yaml when modelDir is set', () => {
    const config: SpaceConfig = {
      ...minimalConfig,
      metadata: { ...minimalConfig.metadata, model_dir: '/models' },
    };
    const dockerfile = generateDockerfile(config);

    expect(dockerfile).toContain('COPY <<EOF /app/ComfyUI/extra_model_paths.yaml');
    expect(dockerfile).toContain('base_path: "/models/"');
  });

  it('should quote modelDir with special YAML characters', () => {
    const config: SpaceConfig = {
      ...minimalConfig,
      metadata: { ...minimalConfig.metadata, model_dir: '/models:test#path' },
    };
    const dockerfile = generateDockerfile(config);

    expect(dockerfile).toContain('base_path: "/models:test#path/"');
  });

  it('should include custom comfyUIArgs', () => {
    const config: SpaceConfig = {
      ...minimalConfig,
      metadata: { ...minimalConfig.metadata, comfyUIArgs: '--preview-method auto' },
    };
    const dockerfile = generateDockerfile(config);

    expect(dockerfile).toContain('--preview-method');
    expect(dockerfile).toContain('auto');
    expect(dockerfile).toContain('--listen');
    expect(dockerfile).toContain('0.0.0.0');
  });

  it('should expose custom port', () => {
    const dockerfile = generateDockerfile(minimalConfig, { port: 9000 });

    expect(dockerfile).toContain('EXPOSE 9000');
  });

  it('should include extra packages', () => {
    const dockerfile = generateDockerfile(minimalConfig, {
      extraPackages: ['wget', 'curl'],
    });

    expect(dockerfile).toContain('wget \\');
    expect(dockerfile).toContain('curl \\');
  });

  it('should properly escape quotes and backslashes in CMD arguments', () => {
    const config: SpaceConfig = {
      ...minimalConfig,
      metadata: {
        ...minimalConfig.metadata,
        comfyUIArgs: '--message "hello world" --path /tmp\\test',
      },
    };
    const dockerfile = generateDockerfile(config);

    // The parser strips outer quotes but preserves the content
    // Backslashes should be escaped in the final JSON
    expect(dockerfile).toContain('CMD ["python", "main.py", "--message", "hello world", "--path", "/tmp\\\\test", "--listen", "0.0.0.0"]');
  });
});
