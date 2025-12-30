import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { writeFile, copyFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';

export async function POST(request: NextRequest) {
  try {
    const { mergedDependencies } = await request.json();
    
    if (!Array.isArray(mergedDependencies)) {
      return NextResponse.json(
        { error: 'mergedDependencies must be an array' },
        { status: 400 }
      );
    }

    // Get selected space
    const spacesPath = join(process.cwd(), 'spaces');
    const selectedVersionPath = join(spacesPath, 'selected_version.txt');
    let selectedVersion = 'v1';
    try {
      const selectedContent = await readFile(selectedVersionPath, 'utf-8');
      selectedVersion = selectedContent.trim() || 'v1';
    } catch (error) {
      // Default to v1 if file doesn't exist
    }

    const spaceJsonPath = join(spacesPath, selectedVersion, 'space.json');

    // Check if space.json exists
    if (!existsSync(spaceJsonPath)) {
      return NextResponse.json(
        { error: `space.json not found in ${selectedVersion}` },
        { status: 404 }
      );
    }

    // Read current space.json
    const spaceJsonContent = await readFile(spaceJsonPath, 'utf-8');
    const spaceJson = JSON.parse(spaceJsonContent);

    // Update dependencies in space.json
    spaceJson.dependencies = mergedDependencies;

    // Write updated space.json
    await writeFile(spaceJsonPath, JSON.stringify(spaceJson, null, 2), 'utf-8');

    return NextResponse.json({ 
      success: true,
      message: 'Dependencies merged successfully',
      space: selectedVersion,
    });
  } catch (error) {
    console.error('Error merging requirements:', error);
    return NextResponse.json(
      { error: 'Failed to merge requirements' },
      { status: 500 }
    );
  }
}

