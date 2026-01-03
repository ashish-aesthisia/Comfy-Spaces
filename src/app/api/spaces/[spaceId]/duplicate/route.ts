import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { readFile, writeFile, mkdir, cp } from 'fs/promises';
import { existsSync } from 'fs';

function generateSpaceId(visibleName: string): string {
  return visibleName
    .toLowerCase()
    .replace(/%20/g, '-') // Replace %20 with -
    .replace(/[^a-z0-9-]/g, '-') // Replace special chars with -
    .replace(/-+/g, '-') // Replace multiple dashes with single dash
    .replace(/^-|-$/g, ''); // Remove leading/trailing dashes
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> | { spaceId: string } }
) {
  try {
    const resolvedParams = params instanceof Promise ? await params : params;
    const sourceSpaceId = decodeURIComponent(resolvedParams.spaceId);
    
    if (!sourceSpaceId) {
      return NextResponse.json(
        { error: 'Source space ID is required' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { newSpaceName } = body;

    if (!newSpaceName || typeof newSpaceName !== 'string' || newSpaceName.trim() === '') {
      return NextResponse.json(
        { error: 'New space name is required and must be a non-empty string' },
        { status: 400 }
      );
    }

    const spacesPath = join(process.cwd(), 'spaces');
    const sourceSpacePath = join(spacesPath, sourceSpaceId);
    const sourceSpaceJsonPath = join(sourceSpacePath, 'space.json');

    // Check if source space exists
    if (!existsSync(sourceSpacePath)) {
      return NextResponse.json(
        { error: 'Source space not found' },
        { status: 404 }
      );
    }

    // Check if source space.json exists
    if (!existsSync(sourceSpaceJsonPath)) {
      return NextResponse.json(
        { error: 'space.json not found in source space' },
        { status: 404 }
      );
    }

    // Generate new space ID from the name
    const newSpaceId = generateSpaceId(newSpaceName.trim());
    
    if (!newSpaceId || newSpaceId.length < 2) {
      return NextResponse.json(
        { error: 'Space name must contain at least 2 valid characters' },
        { status: 400 }
      );
    }

    const newSpacePath = join(spacesPath, newSpaceId);

    // Check if new space already exists
    if (existsSync(newSpacePath)) {
      return NextResponse.json(
        { error: `Space "${newSpaceId}" already exists` },
        { status: 400 }
      );
    }

    // Create new space directory
    await mkdir(newSpacePath, { recursive: true });

    // Read source space.json
    const sourceSpaceJsonContent = await readFile(sourceSpaceJsonPath, 'utf-8');
    const sourceSpaceJson = JSON.parse(sourceSpaceJsonContent);

    // Create new space.json with updated metadata
    const newSpaceJson = {
      ...sourceSpaceJson,
      metadata: {
        ...sourceSpaceJson.metadata,
        visibleName: newSpaceName.trim(),
        spaceId: newSpaceId,
      },
    };

    // Write new space.json
    const newSpaceJsonPath = join(newSpacePath, 'space.json');
    await writeFile(newSpaceJsonPath, JSON.stringify(newSpaceJson, null, 2), 'utf-8');

    return NextResponse.json({ 
      success: true,
      message: `Space cloned as "${newSpaceId}" successfully`,
      newSpaceId: newSpaceId,
      sourceSpaceId: sourceSpaceId,
    });
  } catch (error) {
    console.error('Error cloning space:', error);
    return NextResponse.json(
      { error: `Failed to clone space: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}

