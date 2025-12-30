import { NextResponse } from 'next/server';
import { join } from 'path';
import { readFile, writeFile, mkdir, readdir, cp } from 'fs/promises';
import { existsSync } from 'fs';
import { spawn } from 'child_process';

export async function POST() {
  try {
    const spacesPath = join(process.cwd(), 'spaces');
    const selectedVersionPath = join(spacesPath, 'selected_version.txt');
    
    // Get current selected version
    let currentVersion = 'v1';
    try {
      const selectedContent = await readFile(selectedVersionPath, 'utf-8');
      currentVersion = selectedContent.trim() || 'v1';
    } catch (error) {
      // Default to v1 if file doesn't exist
    }

    const currentVersionPath = join(spacesPath, currentVersion);
    const currentSpaceJsonPath = join(currentVersionPath, 'space.json');

    // Check if current space.json exists
    if (!existsSync(currentSpaceJsonPath)) {
      return NextResponse.json(
        { error: `space.json not found in ${currentVersion}` },
        { status: 404 }
      );
    }

    // Find next version number
    const entries = await readdir(spacesPath, { withFileTypes: true });
    const versions = entries
      .filter(entry => entry.isDirectory() && entry.name.startsWith('v'))
      .map(entry => {
        const match = entry.name.match(/^v(\d+)$/);
        return match ? parseInt(match[1], 10) : 0;
      })
      .filter(v => v > 0)
      .sort((a, b) => b - a);
    
    const nextVersionNumber = versions.length > 0 ? versions[0] + 1 : 2;
    const nextVersion = `v${nextVersionNumber}`;
    const nextVersionPath = join(spacesPath, nextVersion);

    // Create new space directory
    await mkdir(nextVersionPath, { recursive: true });

    // Copy ComfyUI directory to new space
    const currentComfyUIPath = join(currentVersionPath, 'ComfyUI');
    const newComfyUIPath = join(nextVersionPath, 'ComfyUI');
    if (existsSync(currentComfyUIPath)) {
      await cp(currentComfyUIPath, newComfyUIPath, { recursive: true });
    } else {
      // If no ComfyUI in current space, copy from root ComfyUI
      const rootComfyUIPath = join(process.cwd(), 'ComfyUI');
      if (existsSync(rootComfyUIPath)) {
        await cp(rootComfyUIPath, newComfyUIPath, { recursive: true });
      }
    }

    // custom_nodes directory is part of ComfyUI, so it's already copied with ComfyUI
    // No need to copy separately

    // Copy space.json to new space
    const newSpaceJsonPath = join(nextVersionPath, 'space.json');
    await cp(currentSpaceJsonPath, newSpaceJsonPath);

    // Create venv in new space
    const venvPath = join(nextVersionPath, 'venv');
    await new Promise<void>((resolve, reject) => {
      const venvProcess = spawn('python3', ['-m', 'venv', venvPath], {
        cwd: nextVersionPath,
        env: { ...process.env },
        shell: true,
      });

      venvProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Failed to create venv: exit code ${code}`));
        }
      });

      venvProcess.on('error', (error) => {
        reject(error);
      });
    });

    // Create logs.txt in new space
    const logsPath = join(nextVersionPath, 'logs.txt');
    await writeFile(logsPath, '', 'utf-8');

    // Create comfy-logs.txt in new space
    const comfyLogsPath = join(nextVersionPath, 'comfy-logs.txt');
    await writeFile(comfyLogsPath, '', 'utf-8');

    return NextResponse.json({
      success: true,
      message: `New space ${nextVersion} created successfully`,
      newVersion: nextVersion,
      previousVersion: currentVersion,
    });
  } catch (error) {
    console.error('Error creating new space:', error);
    return NextResponse.json(
      { error: `Failed to create new space: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}

