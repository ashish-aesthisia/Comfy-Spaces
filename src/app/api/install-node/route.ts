import { NextResponse } from 'next/server';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { readFile } from 'fs/promises';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

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

    const nodeName = urlMatch[2];
    const nodesPath = join(spacesPath, selectedVersion, 'ComfyUI', 'custom_nodes');
    const nodePath = join(nodesPath, nodeName);

    // Ensure nodes directory exists
    if (!existsSync(nodesPath)) {
      mkdirSync(nodesPath, { recursive: true });
    }

    // Check if node already exists
    if (existsSync(nodePath)) {
      return NextResponse.json(
        { error: `Node ${nodeName} already exists. Use the update feature instead.` },
        { status: 400 }
      );
    }

    // Clone the repository
    try {
      // Ensure the URL ends with .git or add it
      let cloneUrl = githubUrl.trim();
      if (!cloneUrl.endsWith('.git')) {
        cloneUrl = cloneUrl.endsWith('/') ? `${cloneUrl}.git` : `${cloneUrl}.git`;
      }

      if (branch) {
        // Clone specific branch
        await execAsync(`git clone --branch ${branch} --depth 1 ${cloneUrl} ${nodePath}`);
      } else {
        // Clone default branch
        await execAsync(`git clone --depth 1 ${cloneUrl} ${nodePath}`);
      }

      // Checkout specific commit if provided (and not using branch)
      if (commitId && !branch) {
        await execAsync(`git checkout ${commitId}`, { cwd: nodePath });
      }
    } catch (error: any) {
      // Clean up on error
      try {
        const { rmSync } = require('fs');
        if (existsSync(nodePath)) {
          rmSync(nodePath, { recursive: true, force: true });
        }
      } catch {}
      
      return NextResponse.json(
        { error: `Failed to clone repository: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ 
      success: true, 
      nodeName,
      message: `Node ${nodeName} installed successfully`,
    });
  } catch (error) {
    console.error('Error installing node:', error);
    return NextResponse.json(
      { error: `Failed to install node: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}

