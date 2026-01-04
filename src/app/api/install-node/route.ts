import { NextResponse } from 'next/server';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { readFile } from 'fs/promises';
import { promisify } from 'util';
import { execFile } from 'child_process';

const execFileAsync = promisify(execFile);

// Helper function to detect default branch (main/master) from git repository URL
async function getDefaultBranch(cloneUrl: string): Promise<string> {
  try {
    // Use git ls-remote to detect the default branch
    const { stdout } = await execFileAsync('git', ['ls-remote', '--symref', cloneUrl, 'HEAD']);
    const match = stdout.match(/ref: refs\/heads\/(\S+)\s+HEAD/);
    if (match && match[1]) {
      return match[1];
    }
  } catch (error) {
    // If ls-remote fails, try common default branches
  }
  
  // Fallback: return 'main' as the most common default
  return 'main';
}

// Helper function to checkout default branch (main/master) after clone
async function checkoutDefaultBranch(nodePath: string): Promise<void> {
  try {
    // Try to get current branch
    let currentBranch: string;
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: nodePath });
      currentBranch = stdout.trim();
    } catch (error) {
      currentBranch = '';
    }

    // Try main first, then master
    const defaultBranches = ['main', 'master'];
    for (const branch of defaultBranches) {
      // Skip if already on this branch
      if (currentBranch === branch) {
        return;
      }

      // Try to checkout the branch
      try {
        await execFileAsync('git', ['checkout', branch], { cwd: nodePath });
        return;
      } catch (error) {
        // Branch doesn't exist, try next one
        continue;
      }
    }
  } catch (error) {
    // Silently fail - if we can't checkout default branch, continue
  }
}

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

      // If no branch specified, detect and use default branch
      let branchToUse = branch;
      if (!branchToUse) {
        branchToUse = await getDefaultBranch(cloneUrl);
      }

      if (branchToUse) {
        // Clone specific branch or default branch
        await execFileAsync('git', ['clone', '--branch', branchToUse, '--depth', '1', cloneUrl, nodePath]);
      } else {
        // Clone default branch (fallback)
        await execFileAsync('git', ['clone', '--depth', '1', cloneUrl, nodePath]);
      }

      // Checkout specific commit if provided (and not using a specific branch)
      if (commitId && !branch) {
        await execFileAsync('git', ['checkout', commitId], { cwd: nodePath });
      } else if (!commitId) {
        // Always checkout default branch (main/master) after clone if no specific commit
        await checkoutDefaultBranch(nodePath);
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
