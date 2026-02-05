import { NextResponse } from 'next/server';
import { join } from 'path';
import { mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { ensureSpacesDir } from '../../utils/ensureSpacesDir';

const TORCH_PACKAGES = ['torch', 'torchvision', 'torchaudio'];

function normalizeDepName(dep: string): string {
  return dep.split(/[=<>!~\[\]]/)[0].trim().toLowerCase();
}

function filterOutTorchDeps(dependencies: string[]): string[] {
  return dependencies.filter((dep) => {
    const name = normalizeDepName(dep);
    return !TORCH_PACKAGES.includes(name);
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      visibleName,
      spaceId,
      githubUrl,
      comfyUIArgs,
      branch,
      commitId,
      releaseTag,
      torchExtraIndexUrl,
    } = body;

    if (!visibleName || !spaceId || !githubUrl) {
      return NextResponse.json(
        { error: 'visibleName, spaceId, and githubUrl are required' },
        { status: 400 }
      );
    }

    await ensureSpacesDir();
    const spacePath = join(process.cwd(), 'spaces', spaceId);

    if (existsSync(spacePath)) {
      return NextResponse.json(
        { error: `Space "${spaceId}" already exists` },
        { status: 400 }
      );
    }

    await mkdir(spacePath, { recursive: true });

    // Initial dependencies: empty. When GPU and torchExtraIndexUrl is set,
    // torch/torchvision/torchaudio are never copied into space.json;
    // they are installed during activation with --extra-index-url.
    const initialDependencies: string[] = [];
    const dependencies = torchExtraIndexUrl
      ? filterOutTorchDeps(initialDependencies)
      : initialDependencies;

    const spaceJson = {
      nodes: [],
      dependencies,
      metadata: {
        visibleName,
        spaceId,
        githubUrl,
        branch: branch || null,
        commitId: commitId || null,
        releaseTag: releaseTag || null,
        comfyUIArgs: comfyUIArgs || null,
        ...(torchExtraIndexUrl ? { torchExtraIndexUrl } : {}),
      },
    };

    const spaceJsonPath = join(spacePath, 'space.json');
    await writeFile(spaceJsonPath, JSON.stringify(spaceJson, null, 2), 'utf-8');

    return NextResponse.json({
      success: true,
      spaceId,
      message: `Space ${spaceId} created successfully`,
    });
  } catch (error) {
    console.error('Error creating space from GitHub:', error);
    return NextResponse.json(
      {
        error: 'Failed to create space',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
