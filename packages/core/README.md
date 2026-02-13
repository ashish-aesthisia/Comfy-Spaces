# @comfy-spaces/core

Core library for ComfyUI space management and containerization.

## Installation

```bash
npm install @comfy-spaces/core
```

For local development with Everscene:

```json
{
  "dependencies": {
    "@comfy-spaces/core": "file:../../Comfy-Spaces/packages/core"
  }
}
```

## Usage

### Generate Dockerfile

```typescript
import { generateDockerfile } from '@comfy-spaces/core/container';
import type { SpaceConfig } from '@comfy-spaces/core';
import { readFileSync } from 'fs';

const spaceConfig: SpaceConfig = JSON.parse(
  readFileSync('space.json', 'utf-8')
);

const dockerfile = generateDockerfile(spaceConfig, {
  gpu: 'nvidia',
  cudaVersion: '12.6',
  port: 8188,
});

console.log(dockerfile);
```

### Build Docker Image

```typescript
import { buildImage } from '@comfy-spaces/core/container';
import type { SpaceConfig } from '@comfy-spaces/core';
import { readFileSync } from 'fs';

const spaceConfig: SpaceConfig = JSON.parse(
  readFileSync('space.json', 'utf-8')
);

const result = await buildImage(spaceConfig, {
  tag: 'my-comfy-space',
  gpu: 'nvidia',
  cudaVersion: '12.6',
  logger: console.log,
});

if (result.success) {
  console.log(`Image built successfully: ${result.tag}`);
  console.log(`Image ID: ${result.imageId}`);
} else {
  console.error(`Build failed: ${result.error}`);
}
```

## API

### Types

#### `SpaceConfig`

The main configuration object representing a ComfyUI space.

```typescript
interface SpaceConfig {
  nodes: SpaceNode[];
  dependencies: string[];
  metadata: SpaceMetadata;
}
```

#### `SpaceNode`

Represents a custom ComfyUI node.

```typescript
interface SpaceNode {
  name: string;
  githubUrl: string | null;
  commitId: string | null;
  branch: string | null;
  installedAt?: string;
  disabled?: boolean;
}
```

#### `SpaceMetadata`

Metadata about the ComfyUI space.

```typescript
interface SpaceMetadata {
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
```

### Container Functions

#### `generateDockerfile(config, options?)`

Generates a Dockerfile string from a SpaceConfig.

**Parameters:**

- `config: SpaceConfig` - The space configuration
- `options?: DockerfileOptions` - Optional build options
  - `gpu?: 'nvidia' | false` - Enable NVIDIA GPU support (default: `false`)
  - `cudaVersion?: string` - CUDA version to use (default: `'12.6'`)
  - `port?: number` - Port to expose (default: `8188`)
  - `extraPackages?: string[]` - Additional apt packages to install
  - `modelDir?: string` - Override model directory from config

**Returns:** `string` - The generated Dockerfile content

#### `buildImage(config, options?)`

Builds a Docker image from a SpaceConfig.

**Parameters:**

- `config: SpaceConfig` - The space configuration
- `options?: BuildOptions` - Optional build options (extends `DockerfileOptions`)
  - `tag?: string` - Image tag (default: `config.metadata.spaceId`)
  - `logger?: (message: string) => void` - Logger callback for build output

**Returns:** `Promise<BuildResult>`

```typescript
interface BuildResult {
  success: boolean;
  imageId?: string;
  tag: string;
  error?: string;
}
```

## License

MIT
