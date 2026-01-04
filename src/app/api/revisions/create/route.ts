import { NextResponse } from 'next/server';
import { join } from 'path';
import { readFile, writeFile, copyFile, mkdir, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { spawn } from 'child_process';

export async function POST() {
  try {
    const revisionsPath = join(process.cwd(), 'data', 'revisions');
    const selectedVersionPath = join(revisionsPath, 'selected_version.txt');
    
    // Get current selected version
    let currentVersion = 'v1';
    try {
      const selectedContent = await readFile(selectedVersionPath, 'utf-8');
      currentVersion = selectedContent.trim() || 'v1';
    } catch (error) {
      // Default to v1 if file doesn't exist
    }

    const currentVersionPath = join(revisionsPath, currentVersion);
    const currentRequirementsPath = join(currentVersionPath, 'requirements.txt');
    const currentBackupPath = join(currentVersionPath, 'requirements.bkp');

    // Check if current requirements.txt exists
    if (!existsSync(currentRequirementsPath)) {
      return NextResponse.json(
        { error: `requirements.txt not found in ${currentVersion}` },
        { status: 404 }
      );
    }

    // Update current version's bkp file with requirements.txt content
    const currentRequirementsContent = await readFile(currentRequirementsPath, 'utf-8');
    await writeFile(currentBackupPath, currentRequirementsContent, 'utf-8');

    // Find next version number
    const entries = await readdir(revisionsPath, { withFileTypes: true });
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
    const nextVersionPath = join(revisionsPath, nextVersion);

    // Create new revision directory
    await mkdir(nextVersionPath, { recursive: true });

    // Copy requirements.txt to new revision
    const newRequirementsPath = join(nextVersionPath, 'requirements.txt');
    await copyFile(currentRequirementsPath, newRequirementsPath);

    // Create venv in new revision
    const venvPath = join(nextVersionPath, 'venv');
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    await new Promise<void>((resolve, reject) => {
      const venvProcess = spawn(pythonCmd, ['-m', 'venv', venvPath], {
        cwd: nextVersionPath,
        env: { ...process.env },
        shell: false,
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

    // Create logs.txt in new revision
    const logsPath = join(nextVersionPath, 'logs.txt');
    await writeFile(logsPath, '', 'utf-8');

    // Create nodes_status.json in new revision
    const nodesStatusPath = join(nextVersionPath, 'nodes_status.json');
    await writeFile(nodesStatusPath, '{}', 'utf-8');

    return NextResponse.json({
      success: true,
      message: `New revision ${nextVersion} created successfully`,
      newVersion: nextVersion,
      previousVersion: currentVersion,
    });
  } catch (error) {
    console.error('Error creating new revision:', error);
    return NextResponse.json(
      { error: `Failed to create new revision: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}
