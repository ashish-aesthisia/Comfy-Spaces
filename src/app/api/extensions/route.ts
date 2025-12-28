import { NextResponse } from 'next/server';
import { readdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { execSync } from 'child_process';

interface NodeStatus {
  name: string;
  status: 'active' | 'inactive' | 'failed';
  existsInApi: boolean;
  existsInDataNodes: boolean;
  extensionPaths?: string[];
  githubUrl?: string;
  branch?: string;
  commitId?: string;
  disabled?: boolean;
}

async function getGitMetadata(nodePath: string): Promise<{ githubUrl?: string; branch?: string; commitId?: string }> {
  const gitPath = join(nodePath, '.git');
  if (!existsSync(gitPath)) {
    return {};
  }

  try {
    const githubUrl = execSync('git remote get-url origin', { cwd: nodePath, encoding: 'utf-8' }).trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: nodePath, encoding: 'utf-8' }).trim();
    const commitId = execSync('git rev-parse HEAD', { cwd: nodePath, encoding: 'utf-8' }).trim();
    
    // Normalize GitHub URL to HTTPS format
    let normalizedUrl = githubUrl;
    if (githubUrl.startsWith('git@github.com:')) {
      normalizedUrl = githubUrl.replace('git@github.com:', 'https://github.com/').replace(/\.git$/, '');
    } else if (githubUrl.endsWith('.git')) {
      normalizedUrl = githubUrl.replace(/\.git$/, '');
    }

    return {
      githubUrl: normalizedUrl,
      branch: branch || undefined,
      commitId: commitId || undefined,
    };
  } catch (error) {
    // Git commands failed, return empty metadata
    return {};
  }
}

export async function GET() {
  try {
    // Fetch extensions from ComfyUI endpoint
    const comfyUrl = process.env.COMFYUI_URL || 'http://localhost:8188';
    const extensionsResponse = await fetch(`${comfyUrl}/extensions`, {
      cache: 'no-store',
    });

    if (!extensionsResponse.ok) {
      throw new Error(`Failed to fetch extensions: ${extensionsResponse.statusText}`);
    }

    const extensions: string[] = await extensionsResponse.json();

    // Group extensions by node name
    // Path format: /extensions/<node-name>/...
    const extensionsByNode = new Map<string, string[]>();
    const nodeNamesFromApi = new Set<string>();
    
    extensions.forEach((path) => {
      const match = path.match(/^\/extensions\/([^\/]+)/);
      if (match) {
        let nodeName = match[1];
        const originalNodeName = nodeName;
        // Handle "core" vs "ComfyUI-Core" naming
        if (nodeName === 'core') {
          nodeName = 'ComfyUI-Core';
        }
        nodeNamesFromApi.add(nodeName);
        
        // Store extension paths by normalized node name
        if (!extensionsByNode.has(nodeName)) {
          extensionsByNode.set(nodeName, []);
        }
        extensionsByNode.get(nodeName)!.push(path);
      }
    });

    // Get nodes from /data/nodes directory
    const nodesDataPath = join(process.cwd(), 'data', 'nodes');
    let nodesInDataDir: string[] = [];
    try {
      const entries = await readdir(nodesDataPath, { withFileTypes: true });
      nodesInDataDir = entries
        .filter(entry => entry.isDirectory())
        .map(entry => {
          // Normalize "core" to "ComfyUI-Core" for consistency
          const name = entry.name;
          return name === 'core' ? 'ComfyUI-Core' : name;
        });
    } catch (error) {
      // Directory might not exist or be empty, that's okay
      console.log('No nodes found in data/nodes directory');
    }

    // Create a set for quick lookup
    const nodesInDataDirSet = new Set(nodesInDataDir);

    // Determine status for each node
    const nodeStatuses: NodeStatus[] = [];

    // Check for disabled nodes (nodes with .disabled file)
    const disabledNodes = new Set<string>();
    for (const nodeName of nodesInDataDir) {
      const nodePath = join(nodesDataPath, nodeName === 'ComfyUI-Core' ? 'core' : nodeName);
      if (existsSync(join(nodePath, '.disabled'))) {
        disabledNodes.add(nodeName);
      }
    }

    // Process nodes from API
    for (const nodeName of nodeNamesFromApi) {
      const existsInDataNodes = nodesInDataDirSet.has(nodeName);
      // Core nodes don't exist in data/nodes (they're default), so they're always active if in API
      const isCoreNode = nodeName === 'ComfyUI-Core' || nodeName === 'core';
      
      // Success: exists in API AND exists in data/nodes (or is core node)
      // Active: exists in API (even if not in data/nodes, as it's working)
      const extensionPaths = extensionsByNode.get(nodeName) || [];
      
      // Get git metadata if node exists in data/nodes
      let gitMetadata = {};
      if (existsInDataNodes && !isCoreNode) {
        const actualNodeName = nodeName === 'ComfyUI-Core' ? 'core' : nodeName;
        const nodePath = join(nodesDataPath, actualNodeName);
        gitMetadata = await getGitMetadata(nodePath);
      }

      if (isCoreNode || existsInDataNodes) {
        nodeStatuses.push({
          name: nodeName,
          status: disabledNodes.has(nodeName) ? 'inactive' : 'active',
          existsInApi: true,
          existsInDataNodes: existsInDataNodes,
          extensionPaths,
          ...gitMetadata,
          disabled: disabledNodes.has(nodeName),
        });
      } else {
        // Node exists in API but not in data/nodes - still active (working)
        nodeStatuses.push({
          name: nodeName,
          status: 'active',
          existsInApi: true,
          existsInDataNodes: false,
          extensionPaths,
        });
      }
    }

    // Check for nodes in data/nodes that don't exist in API (failed)
    for (const nodeName of nodesInDataDir) {
      // Skip core nodes as they're special
      if (nodeName === 'ComfyUI-Core' || nodeName === 'core') {
        continue;
      }

      if (!nodeNamesFromApi.has(nodeName)) {
        const actualNodeName = nodeName === 'ComfyUI-Core' ? 'core' : nodeName;
        const nodePath = join(nodesDataPath, actualNodeName);
        const gitMetadata = await getGitMetadata(nodePath);
        
        nodeStatuses.push({
          name: nodeName,
          status: 'failed',
          existsInApi: false,
          existsInDataNodes: true,
          ...gitMetadata,
          disabled: disabledNodes.has(nodeName),
        });
      }
    }

    // Sort by name for consistent display
    nodeStatuses.sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({
      nodes: nodeStatuses,
      total: nodeStatuses.length,
      active: nodeStatuses.filter(n => n.status === 'active').length,
      failed: nodeStatuses.filter(n => n.status === 'failed').length,
    });
  } catch (error) {
    console.error('Error fetching extensions:', error);
    return NextResponse.json(
      { 
        error: 'Failed to fetch extensions',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

