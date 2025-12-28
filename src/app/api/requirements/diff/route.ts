import { NextResponse } from 'next/server';
import { join } from 'path';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';

export async function GET() {
  try {
    // Get selected revision
    const revisionsPath = join(process.cwd(), 'data', 'revisions');
    const selectedVersionPath = join(revisionsPath, 'selected_version.txt');
    let selectedVersion = 'v1';
    try {
      const selectedContent = await readFile(selectedVersionPath, 'utf-8');
      selectedVersion = selectedContent.trim() || 'v1';
    } catch (error) {
      // Default to v1 if file doesn't exist
    }

    const requirementsPath = join(revisionsPath, selectedVersion, 'requirements.txt');
    const backupPath = join(revisionsPath, selectedVersion, 'requirements.bkp');

    // Check if files exist
    if (!existsSync(requirementsPath)) {
      return NextResponse.json(
        { error: `requirements.txt not found in ${selectedVersion}` },
        { status: 404 }
      );
    }

    if (!existsSync(backupPath)) {
      return NextResponse.json(
        { 
          error: 'requirements.bkp not found',
          hasBackup: false,
        },
        { status: 200 }
      );
    }

    // Read both files
    const currentContent = await readFile(requirementsPath, 'utf-8');
    const backupContent = await readFile(backupPath, 'utf-8');

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

