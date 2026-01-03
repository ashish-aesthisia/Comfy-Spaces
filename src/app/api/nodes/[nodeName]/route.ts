import { NextResponse } from 'next/server';
import { join } from 'path';
import { existsSync, rmSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ nodeName: string }> | { nodeName: string } }
) {
  try {
    const resolvedParams = params instanceof Promise ? await params : params;
    const nodeName = decodeURIComponent(resolvedParams.nodeName);
    
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
    
    const spacePath = join(spacesPath, selectedVersion);
    const nodesPath = join(spacePath, 'ComfyUI', 'custom_nodes');
    const nodePath = join(nodesPath, nodeName);
    const spaceJsonPath = join(spacePath, 'space.json');

    if (!existsSync(nodePath)) {
      return NextResponse.json(
        { error: `Node "${nodeName}" does not exist` },
        { status: 404 }
      );
    }

    // Remove the node directory
    rmSync(nodePath, { recursive: true, force: true });

    // Update space.json to remove the node from the nodes array
    // It's okay if the node doesn't exist in space.json - we'll just filter it out if it does
    if (existsSync(spaceJsonPath)) {
      try {
        const spaceJsonContent = await readFile(spaceJsonPath, 'utf-8');
        const spaceJson = JSON.parse(spaceJsonContent);

        // Remove node from nodes array if it exists (it's okay if it doesn't exist)
        if (Array.isArray(spaceJson.nodes)) {
          spaceJson.nodes = spaceJson.nodes.filter((node: any) => node.name !== nodeName);
          
          // Write updated space.json
          await writeFile(spaceJsonPath, JSON.stringify(spaceJson, null, 2), 'utf-8');
        }
      } catch (error) {
        console.error('Error updating space.json:', error);
        // Don't fail the request if space.json update fails - it's okay if node doesn't exist in space.json
      }
    }

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

