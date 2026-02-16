import { spawn } from 'child_process';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { SpaceConfig } from '../types';
import type { BuildOptions, BuildResult } from './types';
import { generateDockerfile } from './generator';

export async function buildImage(
  config: SpaceConfig,
  options: BuildOptions = {}
): Promise<BuildResult> {
  const {
    tag = config.metadata.spaceId,
    logger = () => {},
    ...dockerfileOptions
  } = options;

  let tempDir: string | null = null;

  try {
    tempDir = await mkdtemp(join(tmpdir(), 'comfy-spaces-build-'));
    const dockerfilePath = join(tempDir, 'Dockerfile');

    const dockerfileContent = generateDockerfile(config, dockerfileOptions);
    await writeFile(dockerfilePath, dockerfileContent, 'utf-8');

    logger(`Generated Dockerfile at ${dockerfilePath}`);
    logger(`Building image with tag: ${tag}`);

    const result = await runDockerBuild(tempDir, tag, logger);

    await rm(tempDir, { recursive: true, force: true });

    return result;
  } catch (error) {
    if (tempDir) {
      try {
        await rm(tempDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    logger(`Build failed: ${errorMessage}`);

    return {
      success: false,
      tag,
      error: errorMessage,
    };
  }
}

function runDockerBuild(
  contextPath: string,
  tag: string,
  logger: (message: string) => void
): Promise<BuildResult> {
  return new Promise((resolve) => {
    const dockerProcess = spawn('docker', ['build', '-t', tag, '.'], {
      cwd: contextPath,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    dockerProcess.stdout?.on('data', (data: Buffer) => {
      const output = data.toString();
      stdout += output;
      output.split('\n').forEach((line: string) => {
        if (line.trim()) {
          logger(line.trim());
        }
      });
    });

    dockerProcess.stderr?.on('data', (data: Buffer) => {
      const output = data.toString();
      stderr += output;
      output.split('\n').forEach((line: string) => {
        if (line.trim()) {
          logger(line.trim());
        }
      });
    });

    dockerProcess.on('close', (code: number | null) => {
      if (code === 0) {
        const imageIdMatch = stdout.match(/Successfully built ([a-f0-9]+)/i) ||
                            stdout.match(/sha256:([a-f0-9]+)/i);
        const imageId = imageIdMatch ? imageIdMatch[1] : undefined;

        logger(`Build completed successfully`);
        resolve({
          success: true,
          imageId,
          tag,
        });
      } else {
        const errorMessage = stderr || stdout || `Docker build exited with code ${code}`;
        logger(`Build failed with code ${code}`);
        resolve({
          success: false,
          tag,
          error: errorMessage,
        });
      }
    });

    dockerProcess.on('error', (error: Error) => {
      logger(`Docker process error: ${error.message}`);
      resolve({
        success: false,
        tag,
        error: error.message,
      });
    });
  });
}
