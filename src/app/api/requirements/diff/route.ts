import { NextResponse } from 'next/server';
import { join } from 'path';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';

export async function GET() {
  try {
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

    // Read space.json
    const spaceJsonContent = await readFile(spaceJsonPath, 'utf-8');
    const spaceJson = JSON.parse(spaceJsonContent);
    const currentDependencies = spaceJson.dependencies || [];
    
    // For now, return empty diff since we don't have a backup mechanism yet
    // This can be enhanced later to compare with a previous version
    const currentContent = currentDependencies.join('\n');
    const backupContent = currentDependencies.join('\n'); // Same as current for now

    // Split into lines for comparison
    const currentLines = currentContent.split('\n');
    const backupLines = backupContent.split('\n');

    // Simple line-by-line diff
    const diff: Array<{
      lineNumber: number;
      type: 'added' | 'removed' | 'unchanged';
      currentLine?: string;
      backupLine?: string;
    }> = [];

    const maxLines = Math.max(currentLines.length, backupLines.length);

    for (let i = 0; i < maxLines; i++) {
      const currentLine = currentLines[i];
      const backupLine = backupLines[i];

      if (currentLine === undefined && backupLine !== undefined) {
        // Line removed
        diff.push({
          lineNumber: i + 1,
          type: 'removed',
          backupLine: backupLine,
        });
      } else if (currentLine !== undefined && backupLine === undefined) {
        // Line added
        diff.push({
          lineNumber: i + 1,
          type: 'added',
          currentLine: currentLine,
        });
      } else if (currentLine !== backupLine) {
        // Line changed
        diff.push({
          lineNumber: i + 1,
          type: 'removed',
          backupLine: backupLine,
        });
        diff.push({
          lineNumber: i + 1,
          type: 'added',
          currentLine: currentLine,
        });
      } else {
        // Line unchanged
        diff.push({
          lineNumber: i + 1,
          type: 'unchanged',
          currentLine: currentLine,
          backupLine: backupLine,
        });
      }
    }

    return NextResponse.json({
      hasBackup: true,
      current: {
        content: currentContent,
        lineCount: currentLines.length,
      },
      backup: {
        content: backupContent,
        lineCount: backupLines.length,
      },
      diff,
    });
  } catch (error) {
    console.error('Error comparing requirements:', error);
    return NextResponse.json(
      { error: 'Failed to compare requirements' },
      { status: 500 }
    );
  }
}

