import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { readFile, writeFile } from 'fs/promises';
import { existsSync, rmSync } from 'fs';

// DELETE endpoint for deleting a space
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> | { spaceId: string } }
) {
  try {
    const resolvedParams = params instanceof Promise ? await params : params;
    const spaceId = decodeURIComponent(resolvedParams.spaceId);
    
    if (!spaceId) {
      return NextResponse.json(
        { error: 'Space ID is required' },
        { status: 400 }
      );
    }

    const spacesPath = join(process.cwd(), 'spaces');
    const spacePath = join(spacesPath, spaceId);
    const selectedVersionPath = join(spacesPath, 'selected_version.txt');

    // Check if space exists
    if (!existsSync(spacePath)) {
      return NextResponse.json(
        { error: 'Space not found' },
        { status: 404 }
      );
    }

    // Check if this is the currently selected space
    let selectedVersion = '';
    try {
      const selectedContent = await readFile(selectedVersionPath, 'utf-8');
      selectedVersion = selectedContent.trim();
    } catch (error) {
      // File doesn't exist, that's okay
    }

    if (selectedVersion === spaceId) {
      return NextResponse.json(
        { error: 'Cannot delete the currently active space. Please activate another space first.' },
        { status: 400 }
      );
    }

    // Delete the space directory
    rmSync(spacePath, { recursive: true, force: true });

    return NextResponse.json({ 
      success: true,
      message: `Space "${spaceId}" deleted successfully`
    });
  } catch (error) {
    console.error('Error deleting space:', error);
    return NextResponse.json(
      { error: `Failed to delete space: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}

// PUT endpoint for renaming a space (updates visibleName in space.json)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> | { spaceId: string } }
) {
  try {
    const resolvedParams = params instanceof Promise ? await params : params;
    const spaceId = decodeURIComponent(resolvedParams.spaceId);
    
    if (!spaceId) {
      return NextResponse.json(
        { error: 'Space ID is required' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { visibleName } = body;

    if (!visibleName || typeof visibleName !== 'string' || visibleName.trim() === '') {
      return NextResponse.json(
        { error: 'visibleName is required and must be a non-empty string' },
        { status: 400 }
      );
    }

    const spacesPath = join(process.cwd(), 'spaces');
    const spaceJsonPath = join(spacesPath, spaceId, 'space.json');

    if (!existsSync(spaceJsonPath)) {
      return NextResponse.json(
        { error: 'space.json not found for this space' },
        { status: 404 }
      );
    }

    // Read existing space.json
    const spaceJsonContent = await readFile(spaceJsonPath, 'utf-8');
    const spaceJson = JSON.parse(spaceJsonContent);

    // Update visibleName in metadata
    if (!spaceJson.metadata) {
      spaceJson.metadata = {};
    }
    spaceJson.metadata.visibleName = visibleName.trim();

    // Write updated space.json
    await writeFile(spaceJsonPath, JSON.stringify(spaceJson, null, 2), 'utf-8');

    return NextResponse.json({ 
      success: true,
      message: `Space renamed to "${visibleName}" successfully`,
      visibleName: visibleName.trim()
    });
  } catch (error) {
    console.error('Error renaming space:', error);
    return NextResponse.json(
      { error: `Failed to rename space: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}

