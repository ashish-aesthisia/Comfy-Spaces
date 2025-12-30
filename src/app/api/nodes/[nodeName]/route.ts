import { NextResponse } from 'next/server';
import { join } from 'path';
import { existsSync, rmSync } from 'fs';
import { readFile } from 'fs/promises';

export async function DELETE(
  request: Request,
  { params }: { params: { nodeName: string } }
) {
  try {
    const nodeName = decodeURIComponent(params.nodeName);
    
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
    
    const nodesPath = join(spacesPath, selectedVersion, 'ComfyUI', 'custom_nodes');
    const nodePath = join(nodesPath, nodeName);

    if (!existsSync(nodePath)) {
      return NextResponse.json(
        { error: `Node "${nodeName}" does not exist` },
        { status: 404 }
      );
    }

    // Remove the node directory
    rmSync(nodePath, { recursive: true, force: true });

    return NextResponse.json({ 
      success: true,
      message: `Node "${nodeName}" deleted successfully`
    });
  } catch (error) {
    console.error('Error deleting node:', error);
    return NextResponse.json(
      { error: 'Failed to delete node' },
      { status: 500 }
    );
  }
}

