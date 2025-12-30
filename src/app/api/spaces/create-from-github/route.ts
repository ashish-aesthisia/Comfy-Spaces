import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { readFile, writeFile, mkdir, readdir, cp } from 'fs/promises';
import { existsSync } from 'fs';
import { spawn } from 'child_process';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

function parseRequirements(content: string): string[] {
  const dependencies: string[] = [];
  const lines = content.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    
    // Handle inline comments
    const lineWithoutComment = trimmed.split('#')[0].trim();
    if (!lineWithoutComment) {
      continue;
    }
    
    dependencies.push(lineWithoutComment);
  }
  
  return dependencies;
}

function generateSpaceId(visibleName: string): string {
  return visibleName
    .toLowerCase()
    .replace(/%20/g, '-') // Replace %20 with -
    .replace(/[^a-z0-9-]/g, '-') // Replace special chars with -
    .replace(/-+/g, '-') // Replace multiple dashes with single dash
    .replace(/^-|-$/g, ''); // Remove leading/trailing dashes
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { visibleName, spaceId, githubUrl, pythonVersion, branch, commitId, releaseTag } = body;

    // Validate inputs
    if (!visibleName || visibleName.length < 2) {
      return NextResponse.json(
        { error: 'Space name must be at least 2 characters' },
        { status: 400 }
      );
    }

    if (!githubUrl) {
      return NextResponse.json(
        { error: 'GitHub URL is required' },
        { status: 400 }
      );
    }

    // Generate or validate space ID
    const finalSpaceId = spaceId || generateSpaceId(visibleName);
    if (!finalSpaceId || finalSpaceId.length < 2) {
      return NextResponse.json(
        { error: 'Space name must contain at least 2 valid characters' },
        { status: 400 }
      );
    }

    const spacesPath = join(process.cwd(), 'spaces');
    const spacePath = join(spacesPath, finalSpaceId);

    // Check if space already exists
    if (existsSync(spacePath)) {
      return NextResponse.json(
        { error: `Space "${finalSpaceId}" already exists` },
        { status: 400 }
      );
    }

    // Create space directory
    await mkdir(spacePath, { recursive: true });

    // Clone ComfyUI from GitHub
    const comfyUIPath = join(spacePath, 'ComfyUI');
    
    try {
      if (releaseTag) {
        // Clone specific release tag
        await execAsync(`git clone --branch ${releaseTag} --depth 1 ${githubUrl} ${comfyUIPath}`);
      } else if (branch) {
        // Clone specific branch
        await execAsync(`git clone --branch ${branch} --depth 1 ${githubUrl} ${comfyUIPath}`);
      } else {
        // Clone default branch
        await execAsync(`git clone --depth 1 ${githubUrl} ${comfyUIPath}`);
      }

      // Checkout specific commit if provided (and not using release tag)
      if (commitId && !releaseTag) {
        await execAsync(`git checkout ${commitId}`, { cwd: comfyUIPath });
      }
    } catch (error: any) {
      // Clean up on error
      try {
        const { rmSync } = require('fs');
        if (existsSync(spacePath)) {
          rmSync(spacePath, { recursive: true, force: true });
        }
      } catch {}
      
      return NextResponse.json(
        { error: `Failed to clone repository: ${error.message}` },
        { status: 500 }
      );
    }

    // custom_nodes directory will be created automatically by ComfyUI if needed
    // No need to create it manually

    // Read requirements.txt from cloned ComfyUI
    const requirementsPath = join(comfyUIPath, 'requirements.txt');
    if (!existsSync(requirementsPath)) {
      return NextResponse.json(
        { error: 'requirements.txt not found in cloned ComfyUI repository' },
        { status: 404 }
      );
    }

    const requirementsContent = await readFile(requirementsPath, 'utf-8');
    const dependencies = parseRequirements(requirementsContent);

    // Copy requirements.txt to space
    const spaceRequirementsPath = join(spacePath, 'requirements.txt');
    await writeFile(spaceRequirementsPath, requirementsContent, 'utf-8');

    // Copy requirements.bkp
    const spaceBackupPath = join(spacePath, 'requirements.bkp');
    await writeFile(spaceBackupPath, requirementsContent, 'utf-8');

    // Create space.json with nodes, dependencies, and metadata
    const spaceJson = {
      nodes: [],
      dependencies: dependencies,
      metadata: {
        visibleName: visibleName,
        spaceId: finalSpaceId,
        pythonVersion: pythonVersion || '3.11',
        githubUrl: githubUrl,
        branch: branch || null,
        commitId: commitId || null,
        releaseTag: releaseTag || null,
        createdAt: new Date().toISOString(),
        comfyUISource: releaseTag ? 'release' : (branch || commitId ? 'custom' : 'default'),
      },
    };
    const spaceJsonPath = join(spacePath, 'space.json');
    await writeFile(spaceJsonPath, JSON.stringify(spaceJson, null, 2), 'utf-8');

    // Create venv with specified Python version
    const venvPath = join(spacePath, 'venv');
    const pythonVersionToUse = pythonVersion || '3.11';
    // Try python3.x first, fallback to python3
    const pythonExecutable = `python${pythonVersionToUse}`;
    
    await new Promise<void>((resolve, reject) => {
      const venvProcess = spawn(pythonExecutable, ['-m', 'venv', venvPath], {
        cwd: spacePath,
        env: { ...process.env },
        shell: true,
      });

      venvProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          // If specific version fails, try python3 as fallback
          if (pythonExecutable !== 'python3') {
            console.warn(`Failed to create venv with ${pythonExecutable} (exit code ${code}), trying python3...`);
            const fallbackProcess = spawn('python3', ['-m', 'venv', venvPath], {
              cwd: spacePath,
              env: { ...process.env },
              shell: true,
            });
            
            fallbackProcess.on('close', (fallbackCode) => {
              if (fallbackCode === 0) {
                resolve();
              } else {
                reject(new Error(`Failed to create venv with ${pythonExecutable} (exit code ${code}) and fallback python3 (exit code ${fallbackCode})`));
              }
            });
            
            fallbackProcess.on('error', (fallbackError) => {
              reject(new Error(`Failed to create venv with ${pythonExecutable} (exit code ${code}) and fallback error: ${fallbackError.message}`));
            });
          } else {
            reject(new Error(`Failed to create venv with ${pythonExecutable}: exit code ${code}`));
          }
        }
      });

      venvProcess.on('error', (error) => {
        // If spawn fails (command not found), try python3 as fallback
        if (pythonExecutable !== 'python3') {
          console.warn(`Failed to spawn ${pythonExecutable}, trying python3...`);
          const fallbackProcess = spawn('python3', ['-m', 'venv', venvPath], {
            cwd: spacePath,
            env: { ...process.env },
            shell: true,
          });
          
          fallbackProcess.on('close', (code) => {
            if (code === 0) {
              resolve();
            } else {
              reject(new Error(`Failed to spawn ${pythonExecutable} and fallback python3 exited with code ${code}`));
            }
          });
          
          fallbackProcess.on('error', (fallbackError) => {
            reject(new Error(`Failed to spawn both ${pythonExecutable} and python3: ${error.message} / ${fallbackError.message}`));
          });
        } else {
          reject(error);
        }
      });
    });

    // Create log files
    const logsPath = join(spacePath, 'logs.txt');
    await writeFile(logsPath, '', 'utf-8');

    const comfyLogsPath = join(spacePath, 'comfy-logs.txt');
    await writeFile(comfyLogsPath, '', 'utf-8');

    // Update selected_version.txt
    const selectedVersionPath = join(spacesPath, 'selected_version.txt');
    await writeFile(selectedVersionPath, finalSpaceId, 'utf-8');

    return NextResponse.json({
      success: true,
      message: `Space "${visibleName}" created successfully`,
      spaceId: finalSpaceId,
      visibleName: visibleName,
    });
  } catch (error) {
    console.error('Error creating space from GitHub:', error);
    return NextResponse.json(
      { error: `Failed to create space: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}

