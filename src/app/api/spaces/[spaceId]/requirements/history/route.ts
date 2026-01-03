import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { readdir, readFile } from 'fs/promises';
import { existsSync, statSync } from 'fs';

interface HistoryEntry {
  id: string;
  timestamp: string;
  type: 'activation' | 'node_install';
  nodeName?: string;
}

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
    const historyPath = join(spacePath, 'requirements_history');

    // Check if space exists
    if (!existsSync(spacePath)) {
      return NextResponse.json(
        { error: 'Space not found' },
        { status: 404 }
      );
    }

    // Check if history directory exists
    if (!existsSync(historyPath)) {
      return NextResponse.json({
        history: [],
      });
    }

    // Read all history entries
    const files = await readdir(historyPath);
    const historyFiles = files.filter(f => f.endsWith('.json'));

    const history: HistoryEntry[] = [];

    for (const file of historyFiles) {
      try {
        const filePath = join(historyPath, file);
        const content = await readFile(filePath, 'utf-8');
        const entry = JSON.parse(content);
        
        // Get file modification time as fallback
        const stats = statSync(filePath);
        
        history.push({
          id: entry.id,
          timestamp: entry.timestamp || stats.mtime.toISOString(),
          type: entry.type,
          nodeName: entry.nodeName,
        });
      } catch (error) {
        // Skip invalid entries
        console.error(`Error reading history file ${file}:`, error);
      }
    }

    // Sort by timestamp (newest first)
    history.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return NextResponse.json({
      history,
    });
  } catch (error: any) {
    console.error('Error fetching requirements history:', error);
    return NextResponse.json(
      { error: 'Failed to fetch requirements history' },
      { status: 500 }
    );
  }
}

