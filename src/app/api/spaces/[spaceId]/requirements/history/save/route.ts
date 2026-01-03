import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { existsSync } from 'fs';

interface HistoryEntry {
  id: string;
  timestamp: string;
  type: 'activation' | 'node_install';
  nodeName?: string;
  requirementsContent: string;
}

export async function POST(
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

    const { type, nodeName } = await request.json();

    if (!type || (type !== 'activation' && type !== 'node_install')) {
      return NextResponse.json(
        { error: 'Invalid type. Must be "activation" or "node_install"' },
        { status: 400 }
      );
    }

    const spacesPath = join(process.cwd(), 'spaces');
    const spacePath = join(spacesPath, spaceId);
    const requirementsPath = join(spacePath, 'requirements.txt');
    const historyPath = join(spacePath, 'requirements_history');

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

    // Read current requirements.txt
    const requirementsContent = await readFile(requirementsPath, 'utf-8');

    // Create history directory if it doesn't exist
    if (!existsSync(historyPath)) {
      await mkdir(historyPath, { recursive: true });
    }

    // Create history entry
    const timestamp = new Date().toISOString();
    const id = `${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const historyEntry: HistoryEntry = {
      id,
      timestamp,
      type,
      nodeName: nodeName || undefined,
      requirementsContent,
    };

    // Save history entry
    const entryPath = join(historyPath, `${id}.json`);
    await writeFile(entryPath, JSON.stringify(historyEntry, null, 2), 'utf-8');

    // Also save requirements.txt snapshot
    const snapshotPath = join(historyPath, `${id}_requirements.txt`);
    await writeFile(snapshotPath, requirementsContent, 'utf-8');

    return NextResponse.json({
      success: true,
      id,
      timestamp,
    });
  } catch (error: any) {
    console.error('Error saving requirements history:', error);
    return NextResponse.json(
      { error: 'Failed to save requirements history' },
      { status: 500 }
    );
  }
}

