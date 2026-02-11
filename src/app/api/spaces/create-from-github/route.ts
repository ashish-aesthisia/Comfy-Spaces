import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { ensureSpacesDir } from '@/app/api/utils/ensureSpacesDir';
import { ensureDataDirs } from '@/app/api/utils/ensureDataDirs';

export async function POST(request: NextRequest) {
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
      installManager,
      useSharedModels = true,
    } = body;

    // Validate required fields
    if (!visibleName || !spaceId || !githubUrl) {
      return NextResponse.json(
        { error: 'visibleName, spaceId, and githubUrl are required' },
        { status: 400 }
      );
    }

    // Ensure directories exist
    await ensureSpacesDir();
    await ensureDataDirs();

    const spacesPath = join(process.cwd(), 'spaces');
    const spacePath = join(spacesPath, spaceId);
    const spaceJsonPath = join(spacePath, 'space.json');

    // Check if space already exists
    if (existsSync(spaceJsonPath)) {
      return NextResponse.json(
        { error: `Space "${spaceId}" already exists` },
        { status: 400 }
      );
    }

    // Create space directory
    if (!existsSync(spacePath)) {
      mkdirSync(spacePath, { recursive: true });
    }

    // Get Python version (default to system python3)
    let pythonVersion = '3.8+';
    try {
      const { execFileSync } = require('child_process');
      const pythonVersionOutput = execFileSync('python3', ['--version'], { encoding: 'utf-8' });
      const versionMatch = pythonVersionOutput.match(/Python\s+(\d+\.\d+)/);
      if (versionMatch) {
        pythonVersion = versionMatch[1];
      }
    } catch (error) {
      // Use default if python3 is not available
    }

    // Create space.json with metadata
    const spaceJson = {
      nodes: [],
      dependencies: [],
      metadata: {
        visibleName,
        spaceId,
        pythonVersion,
        githubUrl,
        branch: branch || null,
        commitId: commitId || null,
        releaseTag: releaseTag || null,
        comfyUIArgs: comfyUIArgs || null,
        installManager: installManager !== undefined ? installManager : true,
        createdAt: new Date().toISOString(),
        model_dir: useSharedModels ? '../../../data/models' : '',
      },
    };

    // Write space.json
    writeFileSync(spaceJsonPath, JSON.stringify(spaceJson, null, 2), 'utf-8');

    return NextResponse.json({
      success: true,
      spaceId,
      message: `Space "${visibleName}" created successfully`,
    });
  } catch (error: any) {
    console.error('Error creating space:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create space' },
      { status: 500 }
    );
  }
}
