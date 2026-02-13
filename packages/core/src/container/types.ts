export interface DockerfileOptions {
  gpu?: 'nvidia' | false;
  cudaVersion?: string;
  port?: number;
  extraPackages?: string[];
  modelDir?: string;
}

export interface BuildOptions extends DockerfileOptions {
  tag?: string;
  logger?: (message: string) => void;
}

export interface BuildResult {
  success: boolean;
  imageId?: string;
  tag: string;
  error?: string;
}
