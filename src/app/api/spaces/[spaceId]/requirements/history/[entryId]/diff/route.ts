import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';

interface DiffLine {
  lineNumber: number;
  type: 'added' | 'removed' | 'updated' | 'downgraded' | 'unchanged';
  currentLine?: string;
  historyLine?: string;
}

// Parse version from requirement line
function parseVersion(line: string): string | null {
  const match = line.match(/==([0-9.]+)/);
  return match ? match[1] : null;
}

// Compare versions (simple string comparison, can be enhanced)
function compareVersions(v1: string | null, v2: string | null): 'newer' | 'older' | 'same' | 'unknown' {
  if (!v1 || !v2) return 'unknown';
  if (v1 === v2) return 'same';
  
  // Simple version comparison (can be enhanced with semver)
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 'newer';
    if (p1 < p2) return 'older';
  }
  
  return 'same';
}

export async function GET(
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
    const historyEntryPath = join(historyPath, `${entryId}.json`);
    const historySnapshotPath = join(historyPath, `${entryId}_requirements.txt`);

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

    // Check if history entry exists
    if (!existsSync(historyEntryPath) || !existsSync(historySnapshotPath)) {
      return NextResponse.json(
        { error: 'History entry not found' },
        { status: 404 }
      );
    }

    // Read current requirements.txt
    const currentContent = await readFile(requirementsPath, 'utf-8');
    
    // Read history snapshot
    const historyContent = await readFile(historySnapshotPath, 'utf-8');
    
    // Read history entry metadata
    const entryContent = await readFile(historyEntryPath, 'utf-8');
    const entry = JSON.parse(entryContent);

    // Parse requirements into maps for better comparison
    const currentLines = currentContent.split('\n');
    const historyLines = historyContent.split('\n');

    // Create maps of package name -> line
    const currentMap = new Map<string, { line: string; index: number }>();
    const historyMap = new Map<string, { line: string; index: number }>();

    currentLines.forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const pkgName = trimmed.split(/[=<>!~]/)[0].trim().toLowerCase();
        currentMap.set(pkgName, { line: trimmed, index });
      }
    });

    historyLines.forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const pkgName = trimmed.split(/[=<>!~]/)[0].trim().toLowerCase();
        historyMap.set(pkgName, { line: trimmed, index });
      }
    });

    // Build diff
    const diff: DiffLine[] = [];
    const allPackages = new Set([...currentMap.keys(), ...historyMap.keys()]);
    let lineNumber = 1;

    // Process packages in order (current first, then history-only)
    const sortedPackages = Array.from(allPackages).sort((a, b) => {
      const currentA = currentMap.get(a);
      const currentB = currentMap.get(b);
      const historyA = historyMap.get(a);
      const historyB = historyMap.get(b);
      
      const indexA = currentA?.index ?? historyA?.index ?? 9999;
      const indexB = currentB?.index ?? historyB?.index ?? 9999;
      return indexA - indexB;
    });

    for (const pkgName of sortedPackages) {
      const current = currentMap.get(pkgName);
      const history = historyMap.get(pkgName);

      if (current && history) {
        // Package exists in both - check if updated
        if (current.line !== history.line) {
          const currentVersion = parseVersion(current.line);
          const historyVersion = parseVersion(history.line);
          const versionCompare = compareVersions(currentVersion, historyVersion);
          
          if (versionCompare === 'older') {
            diff.push({
              lineNumber: lineNumber++,
              type: 'downgraded',
              currentLine: current.line,
              historyLine: history.line,
            });
          } else {
            diff.push({
              lineNumber: lineNumber++,
              type: 'updated',
              currentLine: current.line,
              historyLine: history.line,
            });
          }
        } else {
          diff.push({
            lineNumber: lineNumber++,
            type: 'unchanged',
            currentLine: current.line,
            historyLine: history.line,
          });
        }
      } else if (current && !history) {
        // Package added
        diff.push({
          lineNumber: lineNumber++,
          type: 'added',
          currentLine: current.line,
        });
      } else if (!current && history) {
        // Package removed
        diff.push({
          lineNumber: lineNumber++,
          type: 'removed',
          historyLine: history.line,
        });
      }
    }

    return NextResponse.json({
      entry,
      current: {
        content: currentContent,
        lineCount: currentLines.length,
      },
      history: {
        content: historyContent,
        lineCount: historyLines.length,
      },
      diff,
    });
  } catch (error: any) {
    console.error('Error comparing requirements:', error);
    return NextResponse.json(
      { error: 'Failed to compare requirements' },
      { status: 500 }
    );
  }
}

