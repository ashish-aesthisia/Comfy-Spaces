import { NextResponse } from 'next/server';
import { join } from 'path';
import { existsSync, writeFileSync, unlinkSync } from 'fs';
import { readFile } from 'fs/promises';

export async function POST(
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

    // Create .disabled file
    const disabledFile = join(nodePath, '.disabled');
    writeFileSync(disabledFile, '', 'utf-8');

    return NextResponse.json({ 
      success: true,
      message: `Node "${nodeName}" disabled successfully`
    });
  } catch (error) {
    console.error('Error disabling node:', error);
    return NextResponse.json(
      { error: 'Failed to disable node' },
      { status: 500 }
    );
  }
}

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
    const disabledFile = join(nodePath, '.disabled');

    if (!existsSync(nodePath)) {
      return NextResponse.json(
        { error: `Node "${nodeName}" does not exist` },
        { status: 404 }
      );
    }

    // Remove .disabled file
    if (existsSync(disabledFile)) {
      unlinkSync(disabledFile);
    }

    return NextResponse.json({ 
      success: true,
      message: `Node "${nodeName}" enabled successfully`
    });
  } catch (error) {
    console.error('Error enabling node:', error);
    return NextResponse.json(
      { error: 'Failed to enable node' },
      { status: 500 }
    );
  }
}

