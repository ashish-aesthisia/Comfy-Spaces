export interface SpaceConfig {
  nodes: SpaceNode[];
  dependencies: string[];
  metadata: SpaceMetadata;
}

export interface SpaceNode {
  name: string;
  githubUrl: string | null;
  commitId: string | null;
  branch: string | null;
  installedAt?: string;
  disabled?: boolean;
}

export interface SpaceMetadata {
  visibleName: string;
  spaceId: string;
  pythonVersion: string;
  githubUrl: string;
  branch: string | null;
  commitId: string | null;
  releaseTag: string | null;
  createdAt?: string;
  comfyUISource?: string;
  comfyUIArgs?: string;
  installManager?: boolean;
  model_dir?: string;
}
