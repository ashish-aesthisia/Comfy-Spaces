import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ spaceId: string; entryId: string }> | { spaceId: string; entryId: string } }
) {
  try {
    const resolvedParams = params instanceof Promise ? await params : params;
    const spaceId = decodeURIComponent(resolvedParams.spaceId);
    const entryId = decodeURIComponent(resolvedParams.entryId);
    
    if (!spaceId || !entryId) {
      return NextResponse.json(
        { error: 'Space ID and Entry ID are required' },
        { status: 400 }
      );
    }

    const spacesPath = join(process.cwd(), 'spaces');
    const spacePath = join(spacesPath, spaceId);
    const requirementsPath = join(spacePath, 'requirements.txt');
    const historyPath = join(spacePath, 'requirements_history');
    const historySnapshotPath = join(historyPath, `${entryId}_requirements.txt`);

    // Check if space exists
    if (!existsSync(spacePath)) {
      return NextResponse.json(
        { error: 'Space not found' },
        { status: 404 }
      );
    }

    // Check if history snapshot exists
    if (!existsSync(historySnapshotPath)) {
      return NextResponse.json(
        { error: 'History entry not found' },
        { status: 404 }
      );
    }

    // Read history snapshot
    const historyContent = await readFile(historySnapshotPath, 'utf-8');

    // Restore requirements.txt
    await writeFile(requirementsPath, historyContent, 'utf-8');

    // Also update requirements.bkp to match
    const backupPath = join(spacePath, 'requirements.bkp');
    await writeFile(backupPath, historyContent, 'utf-8');

    // Also update space.json dependencies if it exists
    const spaceJsonPath = join(spacePath, 'space.json');
    if (existsSync(spaceJsonPath)) {
      try {
        const spaceJsonContent = await readFile(spaceJsonPath, 'utf-8');
        const spaceJson = JSON.parse(spaceJsonContent);
        
        // Parse requirements into dependencies array
        const dependencies = historyContent
          .trim()
          .split('\n')
          .filter(line => line.trim().length > 0 && !line.trim().startsWith('#'))
          .map(line => line.trim());
        
        // Update dependencies in space.json
        spaceJson.dependencies = dependencies;
        
        // Write updated space.json
        await writeFile(spaceJsonPath, JSON.stringify(spaceJson, null, 2), 'utf-8');
      } catch (error: any) {
        console.error('Error updating space.json:', error);
        // Continue even if space.json update fails
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Requirements restored successfully',
    });
  } catch (error: any) {
    console.error('Error restoring requirements:', error);
    return NextResponse.json(
      { error: 'Failed to restore requirements' },
      { status: 500 }
    );
  }
}

