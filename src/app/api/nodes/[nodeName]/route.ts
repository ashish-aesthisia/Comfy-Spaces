import { NextResponse } from 'next/server';
import { join } from 'path';
import { existsSync, rmSync } from 'fs';

export async function DELETE(
  request: Request,
  { params }: { params: { nodeName: string } }
) {
  try {
    const nodeName = decodeURIComponent(params.nodeName);
    const nodesPath = join(process.cwd(), 'data', 'nodes');
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

