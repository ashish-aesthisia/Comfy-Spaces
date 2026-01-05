import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';

export async function GET(
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
    const requirementsPath = join(spacePath, 'requirements.txt');
    const backupPath = join(spacePath, 'requirements.bkp');

    // Check if space exists
    if (!existsSync(spacePath)) {
      return NextResponse.json(
        { error: 'Space not found' },
        { status: 404 }
      );
    }

    // Check if requirements.txt exists
    if (!existsSync(requirementsPath)) {
      return NextResponse.json(
        { error: 'requirements.txt not found for this space' },
        { status: 404 }
      );
    }

    // Read requirements.txt
    const currentContent = await readFile(requirementsPath, 'utf-8');

    // Check if backup exists
    const hasBackup = existsSync(backupPath);
    let backupContent = '';
    if (hasBackup) {
      backupContent = await readFile(backupPath, 'utf-8');
    }

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
      hasBackup,
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


