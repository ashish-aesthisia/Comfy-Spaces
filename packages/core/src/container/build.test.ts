import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { buildImage } from './build.js';
import type { SpaceConfig } from '../types.js';
import * as generator from './generator.js';

vi.mock('child_process');
vi.mock('fs/promises');

describe('buildImage', () => {
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

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should build image successfully and return imageId', async () => {
    const { spawn } = await import('child_process');
    const { mkdtemp, writeFile, rm } = await import('fs/promises');

    const mockProcess = new EventEmitter() as any;
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();

    vi.mocked(mkdtemp).mockResolvedValue('/tmp/comfy-spaces-build-abc123');
    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(rm).mockResolvedValue(undefined);
    vi.mocked(spawn).mockReturnValue(mockProcess);

    const generateDockerfileSpy = vi.spyOn(generator, 'generateDockerfile');

    const buildPromise = buildImage(minimalConfig, {
      tag: 'test-image',
      gpu: 'nvidia',
    });

    // Simulate successful build output
    setImmediate(() => {
      mockProcess.stdout.emit('data', Buffer.from('Step 1/5 : FROM nvidia/cuda\n'));
      mockProcess.stdout.emit('data', Buffer.from('Successfully built abc123def456\n'));
      mockProcess.emit('close', 0);
    });

    const result = await buildPromise;

    expect(result.success).toBe(true);
    expect(result.tag).toBe('test-image');
    expect(result.imageId).toBe('abc123def456');
    expect(result.error).toBeUndefined();

    expect(generateDockerfileSpy).toHaveBeenCalledWith(minimalConfig, { gpu: 'nvidia' });
    expect(mkdtemp).toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledWith('docker', ['build', '-t', 'test-image', '.'], {
      cwd: '/tmp/comfy-spaces-build-abc123',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(rm).toHaveBeenCalledWith('/tmp/comfy-spaces-build-abc123', {
      recursive: true,
      force: true,
    });
  });

  it('should extract imageId from sha256 format', async () => {
    const { spawn } = await import('child_process');
    const { mkdtemp, writeFile, rm } = await import('fs/promises');

    const mockProcess = new EventEmitter() as any;
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();

    vi.mocked(mkdtemp).mockResolvedValue('/tmp/comfy-spaces-build-xyz');
    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(rm).mockResolvedValue(undefined);
    vi.mocked(spawn).mockReturnValue(mockProcess);

    const buildPromise = buildImage(minimalConfig);

    setImmediate(() => {
      mockProcess.stdout.emit('data', Buffer.from('writing image sha256:fedcba987654321\n'));
      mockProcess.emit('close', 0);
    });

    const result = await buildPromise;

    expect(result.success).toBe(true);
    expect(result.imageId).toBe('fedcba987654321');
  });

  it('should handle build failure with non-zero exit code', async () => {
    const { spawn } = await import('child_process');
    const { mkdtemp, writeFile, rm } = await import('fs/promises');

    const mockProcess = new EventEmitter() as any;
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();

    vi.mocked(mkdtemp).mockResolvedValue('/tmp/comfy-spaces-build-fail');
    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(rm).mockResolvedValue(undefined);
    vi.mocked(spawn).mockReturnValue(mockProcess);

    const buildPromise = buildImage(minimalConfig);

    setImmediate(() => {
      mockProcess.stderr.emit('data', Buffer.from('ERROR: failed to build\n'));
      mockProcess.emit('close', 1);
    });

    const result = await buildPromise;

    expect(result.success).toBe(false);
    expect(result.error).toContain('ERROR: failed to build');
    expect(rm).toHaveBeenCalled();
  });

  it('should handle docker process error', async () => {
    const { spawn } = await import('child_process');
    const { mkdtemp, writeFile, rm } = await import('fs/promises');

    const mockProcess = new EventEmitter() as any;
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();

    vi.mocked(mkdtemp).mockResolvedValue('/tmp/comfy-spaces-build-error');
    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(rm).mockResolvedValue(undefined);
    vi.mocked(spawn).mockReturnValue(mockProcess);

    const buildPromise = buildImage(minimalConfig);

    setImmediate(() => {
      mockProcess.emit('error', new Error('docker command not found'));
    });

    const result = await buildPromise;

    expect(result.success).toBe(false);
    expect(result.error).toBe('docker command not found');
    expect(rm).toHaveBeenCalled();
  });

  it('should call logger with build output', async () => {
    const { spawn } = await import('child_process');
    const { mkdtemp, writeFile, rm } = await import('fs/promises');

    const mockProcess = new EventEmitter() as any;
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();

    vi.mocked(mkdtemp).mockResolvedValue('/tmp/comfy-spaces-build-log');
    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(rm).mockResolvedValue(undefined);
    vi.mocked(spawn).mockReturnValue(mockProcess);

    const logger = vi.fn();

    const buildPromise = buildImage(minimalConfig, { logger });

    setImmediate(() => {
      mockProcess.stdout.emit('data', Buffer.from('Step 1/5\n'));
      mockProcess.stdout.emit('data', Buffer.from('Step 2/5\n'));
      mockProcess.emit('close', 0);
    });

    await buildPromise;

    expect(logger).toHaveBeenCalledWith(expect.stringContaining('Generated Dockerfile'));
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('Building image'));
    expect(logger).toHaveBeenCalledWith('Step 1/5');
    expect(logger).toHaveBeenCalledWith('Step 2/5');
    expect(logger).toHaveBeenCalledWith('Build completed successfully');
  });

  it('should use spaceId as default tag', async () => {
    const { spawn } = await import('child_process');
    const { mkdtemp, writeFile, rm } = await import('fs/promises');

    const mockProcess = new EventEmitter() as any;
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();

    vi.mocked(mkdtemp).mockResolvedValue('/tmp/comfy-spaces-build-default');
    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(rm).mockResolvedValue(undefined);
    vi.mocked(spawn).mockReturnValue(mockProcess);

    const buildPromise = buildImage(minimalConfig);

    setImmediate(() => {
      mockProcess.emit('close', 0);
    });

    const result = await buildPromise;

    expect(result.tag).toBe('test-space');
    expect(spawn).toHaveBeenCalledWith(
      'docker',
      ['build', '-t', 'test-space', '.'],
      expect.any(Object)
    );
  });

  it('should cleanup temp directory on error', async () => {
    const { spawn } = await import('child_process');
    const { mkdtemp, writeFile, rm } = await import('fs/promises');

    vi.mocked(mkdtemp).mockResolvedValue('/tmp/comfy-spaces-build-cleanup');
    vi.mocked(writeFile).mockRejectedValue(new Error('write failed'));
    vi.mocked(rm).mockResolvedValue(undefined);

    const result = await buildImage(minimalConfig);

    expect(result.success).toBe(false);
    expect(result.error).toBe('write failed');
    expect(rm).toHaveBeenCalledWith('/tmp/comfy-spaces-build-cleanup', {
      recursive: true,
      force: true,
    });
  });

  it('should handle cleanup errors gracefully', async () => {
    const { spawn } = await import('child_process');
    const { mkdtemp, writeFile, rm } = await import('fs/promises');

    vi.mocked(mkdtemp).mockResolvedValue('/tmp/comfy-spaces-build-cleanup-fail');
    vi.mocked(writeFile).mockRejectedValue(new Error('write failed'));
    vi.mocked(rm).mockRejectedValue(new Error('cleanup failed'));

    const result = await buildImage(minimalConfig);

    expect(result.success).toBe(false);
    expect(result.error).toBe('write failed');
  });

  it('should pass dockerfile options to generateDockerfile', async () => {
    const { spawn } = await import('child_process');
    const { mkdtemp, writeFile, rm } = await import('fs/promises');

    const mockProcess = new EventEmitter() as any;
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();

    vi.mocked(mkdtemp).mockResolvedValue('/tmp/comfy-spaces-build-options');
    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(rm).mockResolvedValue(undefined);
    vi.mocked(spawn).mockReturnValue(mockProcess);

    const generateDockerfileSpy = vi.spyOn(generator, 'generateDockerfile');

    const buildPromise = buildImage(minimalConfig, {
      gpu: 'nvidia',
      cudaVersion: '12.1',
      port: 9000,
      extraPackages: ['wget'],
      modelDir: '/models',
    });

    setImmediate(() => {
      mockProcess.emit('close', 0);
    });

    await buildPromise;

    expect(generateDockerfileSpy).toHaveBeenCalledWith(minimalConfig, {
      gpu: 'nvidia',
      cudaVersion: '12.1',
      port: 9000,
      extraPackages: ['wget'],
      modelDir: '/models',
    });
  });
});
