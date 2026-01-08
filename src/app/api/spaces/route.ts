import { NextResponse } from 'next/server';
import { readdir, readFile, stat } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { ensureSpacesDir } from '../utils/ensureSpacesDir';

interface SpaceInfo {
  name: string; // spaceId (directory name)
  visibleName: string; // visible name from space.json
  pythonVersion: string;
  cmdArgs?: string | null;
  lastUpdated: string;
  path: string;
  comfyUIVersion: string;
}

export async function GET() {
  try {
    // Ensure spaces directory exists
    await ensureSpacesDir();
    
    const spacesPath = join(process.cwd(), 'spaces');
    const entries = await readdir(spacesPath, { withFileTypes: true });
    
    // Filter to only include directories (skip files like selected_version.txt)
    const spaceDirs = entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort();
    
    // Get detailed info for each space
    const spaces: SpaceInfo[] = await Promise.all(
      spaceDirs.map(async (spaceId) => {
        const spacePath = join(spacesPath, spaceId);
        const spaceJsonPath = join(spacePath, 'space.json');
        const comfyUIPath = join(spacePath, 'ComfyUI');
        const venvConfigPath = join(spacePath, 'venv', 'pyvenv.cfg');
        
        // Get visible name and Python version from space.json
        let visibleName = spaceId; // Fallback to spaceId if space.json doesn't exist
        let pythonVersion = 'Unknown';
        let cmdArgs: string | null = null;
        try {
          if (existsSync(spaceJsonPath)) {
            const spaceJsonContent = await readFile(spaceJsonPath, 'utf-8');
            const spaceJson = JSON.parse(spaceJsonContent);
            if (spaceJson.metadata?.visibleName) {
              visibleName = spaceJson.metadata.visibleName;
            }
            if (spaceJson.metadata?.pythonVersion) {
              pythonVersion = spaceJson.metadata.pythonVersion;
            }
            if (spaceJson.metadata?.cmdArgs) {
              cmdArgs = spaceJson.metadata.cmdArgs;
            }
          }
        } catch (error) {
          console.error(`Error reading space.json for ${spaceId}:`, error);
        }
        
        // If Python version not in space.json, try to get from pyvenv.cfg
        if (pythonVersion === 'Unknown') {
          try {
            if (existsSync(venvConfigPath)) {
              const configContent = await readFile(venvConfigPath, 'utf-8');
              const versionMatch = configContent.match(/^version\s*=\s*(.+)$/m);
              if (versionMatch) {
                pythonVersion = versionMatch[1].trim();
              }
            }
          } catch (error) {
            console.error(`Error reading Python version for ${spaceId}:`, error);
          }
        }
        
        // Get last updated timestamp
        let lastUpdated = 'Unknown';
        try {
          const stats = await stat(spacePath);
          lastUpdated = new Date(stats.mtime).toISOString();
        } catch (error) {
          console.error(`Error getting stats for ${spaceId}:`, error);
        }
        
        // Get relative path from project root
        const path = `spaces/${spaceId}`;
        
        // Get ComfyUI version from space's ComfyUI pyproject.toml
        let comfyUIVersion = 'Unknown';
        try {
          const pyprojectPath = join(comfyUIPath, 'pyproject.toml');
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
          name: spaceId, // spaceId (directory name)
          visibleName: visibleName, // visible name from space.json
          pythonVersion,
          cmdArgs,
          lastUpdated,
          path,
          comfyUIVersion,
        };
      })
    );
    
    // Read selected version
    const selectedVersionPath = join(spacesPath, 'selected_version.txt');
    let selectedVersion = '';
    try {
      const selectedContent = await readFile(selectedVersionPath, 'utf-8');
      selectedVersion = selectedContent.trim();
    } catch (error) {
      // If file doesn't exist, use first space as default
      selectedVersion = spaceDirs[0] || '';
    }
    
    return NextResponse.json({
      spaces,
      selectedVersion,
    });
  } catch (error) {
    console.error('Error reading spaces:', error);
    return NextResponse.json(
      { error: 'Failed to read spaces' },
      { status: 500 }
    );
  }
}
