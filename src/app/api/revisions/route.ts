import { NextResponse } from 'next/server';
import { readdir, readFile, stat } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

interface RevisionInfo {
  name: string;
  pythonVersion: string;
  lastUpdated: string;
  path: string;
  comfyUIVersion: string;
}

export async function GET() {
  try {
    const revisionsPath = join(process.cwd(), 'data', 'revisions');
    const entries = await readdir(revisionsPath, { withFileTypes: true });
    
    // Filter to only include directories (version folders like v1, v2, etc.)
    const versionDirs = entries
      .filter(entry => entry.isDirectory() && entry.name.startsWith('v'))
      .map(entry => entry.name)
      .sort();
    
    // Get detailed info for each revision
    const revisions: RevisionInfo[] = await Promise.all(
      versionDirs.map(async (version) => {
        const versionPath = join(revisionsPath, version);
        const venvConfigPath = join(versionPath, 'venv', 'pyvenv.cfg');
        
        // Get Python version from pyvenv.cfg
        let pythonVersion = 'Unknown';
        try {
          if (existsSync(venvConfigPath)) {
            const configContent = await readFile(venvConfigPath, 'utf-8');
            const versionMatch = configContent.match(/^version\s*=\s*(.+)$/m);
            if (versionMatch) {
              pythonVersion = versionMatch[1].trim();
            }
          }
        } catch (error) {
          console.error(`Error reading Python version for ${version}:`, error);
        }
        
        // Get last updated timestamp
        let lastUpdated = 'Unknown';
        try {
          const stats = await stat(versionPath);
          lastUpdated = new Date(stats.mtime).toISOString();
        } catch (error) {
          console.error(`Error getting stats for ${version}:`, error);
        }
        
        // Get relative path from project root
        const path = `data/revisions/${version}`;
        
        // Get ComfyUI version from pyproject.toml
        let comfyUIVersion = 'Unknown';
        try {
          const pyprojectPath = join(process.cwd(), 'ComfyUI', 'pyproject.toml');
          if (existsSync(pyprojectPath)) {
            const tomlContent = await readFile(pyprojectPath, 'utf-8');
            // Match version = "0.6.0" in the [project] section
            const versionMatch = tomlContent.match(/\[project\][\s\S]*?version\s*=\s*["']([^"']+)["']/);
            if (versionMatch) {
              comfyUIVersion = versionMatch[1].trim();
            }
          }
        } catch (error) {
          console.error(`Error reading ComfyUI version:`, error);
        }
        
        return {
          name: version,
          pythonVersion,
          lastUpdated,
          path,
          comfyUIVersion,
        };
      })
    );
    
    // Read selected version
    const selectedVersionPath = join(revisionsPath, 'selected_version.txt');
    let selectedVersion = '';
    try {
      const selectedContent = await readFile(selectedVersionPath, 'utf-8');
      selectedVersion = selectedContent.trim();
    } catch (error) {
      // If file doesn't exist, use first version as default
      selectedVersion = versionDirs[0] || '';
    }
    
    return NextResponse.json({
      revisions,
      selectedVersion,
    });
  } catch (error) {
    console.error('Error reading revisions:', error);
    return NextResponse.json(
      { error: 'Failed to read revisions' },
      { status: 500 }
    );
  }
}




