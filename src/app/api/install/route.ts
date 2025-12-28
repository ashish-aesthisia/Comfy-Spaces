import { NextResponse } from 'next/server';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';

export async function POST(request: Request) {
  try {
    const { githubUrl, commitId, branch } = await request.json();
    
    if (!githubUrl) {
      return NextResponse.json(
        { error: 'Github URL is required' },
        { status: 400 }
      );
    }

    // Extract node name from GitHub URL
    // Format: https://github.com/user/repo or https://github.com/user/repo.git
    const urlMatch = githubUrl.match(/github\.com\/([^\/]+)\/([^\/\.]+)/);
    if (!urlMatch) {
      return NextResponse.json(
        { error: 'Invalid GitHub URL format' },
        { status: 400 }
      );
    }

    const nodeName = urlMatch[2];
    const nodesPath = join(process.cwd(), 'data', 'nodes');
    const nodePath = join(nodesPath, nodeName);

    // Ensure nodes directory exists
    if (!existsSync(nodesPath)) {
      mkdirSync(nodesPath, { recursive: true });
    }

    // Check if this is an update (node already exists)
    const isUpdate = existsSync(nodePath);

    return NextResponse.json({ 
      success: true, 
      nodeName,
      githubUrl,
      commitId: commitId || null,
      branch: branch || null,
    });
  } catch (error) {
    console.error('Error preparing install:', error);
    return NextResponse.json(
      { error: 'Failed to prepare install' },
      { status: 500 }
    );
  }
}

