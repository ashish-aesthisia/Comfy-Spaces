import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { ensureSpacesDir } from '../../utils/ensureSpacesDir';

export async function POST(request: Request) {
  try {
    // Ensure spaces directory exists
    await ensureSpacesDir();

    const {
      visibleName,
      spaceId,
      githubUrl,
      comfyUIArgs,
      branch,
      commitId,
      releaseTag,
      installManager = true, // Default to true if not provided
    } = await request.json();

    // Validate required fields
    if (!visibleName || !spaceId || !githubUrl) {
      return NextResponse.json(
        { error: 'visibleName, spaceId, and githubUrl are required' },
        { status: 400 }
      );
    }

    // Validate spaceId format
    if (spaceId.length < 2) {
      return NextResponse.json(
        { error: 'spaceId must be at least 2 characters' },
        { status: 400 }
      );
    }

    const spacesPath = join(process.cwd(), 'spaces');
    const spacePath = join(spacesPath, spaceId);
    const spaceJsonPath = join(spacePath, 'space.json');

    // Check if space already exists
    if (existsSync(spaceJsonPath)) {
      return NextResponse.json(
        { error: `Space "${spaceId}" already exists` },
        { status: 409 }
      );
    }

    // Create space directory
    await mkdir(spacePath, { recursive: true });

    // Create space.json with metadata
    const spaceJson = {
      metadata: {
        visibleName,
        spaceId,
        githubUrl,
        comfyUIArgs: comfyUIArgs || undefined,
        branch: branch || undefined,
        commitId: commitId || undefined,
        releaseTag: releaseTag || undefined,
        installManager: installManager !== undefined ? installManager : true,
        createdAt: new Date().toISOString(),
      },
      dependencies: [],
      nodes: [],
    };

    // Write space.json
    await writeFile(spaceJsonPath, JSON.stringify(spaceJson, null, 2), 'utf-8');

    return NextResponse.json({
      success: true,
      spaceId,
      message: 'Space created successfully',
    });
  } catch (error: any) {
    console.error('Error creating space:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create space' },
      { status: 500 }
    );
  }
}
