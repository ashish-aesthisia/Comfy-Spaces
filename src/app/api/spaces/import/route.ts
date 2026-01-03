import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { spawn } from 'child_process';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

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
    const { nodes, dependencies, metadata } = body;

    // Validate structure
    if (!metadata || !metadata.visibleName || !metadata.spaceId || !metadata.pythonVersion || !metadata.githubUrl) {
      return NextResponse.json(
        { error: 'Invalid JSON structure: missing required metadata fields' },
        { status: 400 }
      );
    }

    if (!Array.isArray(nodes)) {
      return NextResponse.json(
        { error: 'Invalid JSON structure: "nodes" must be an array' },
        { status: 400 }
      );
    }

    if (!Array.isArray(dependencies)) {
      return NextResponse.json(
        { error: 'Invalid JSON structure: "dependencies" must be an array' },
        { status: 400 }
      );
    }

    // Validate space ID
    const finalSpaceId = metadata.spaceId;
    if (!finalSpaceId || finalSpaceId.length < 2) {
      return NextResponse.json(
        { error: 'Space ID must be at least 2 characters' },
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
    const { githubUrl, branch, commitId, releaseTag } = metadata;
    
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

    // Read requirements.txt from cloned ComfyUI (if it exists)
    const requirementsPath = join(comfyUIPath, 'requirements.txt');
    let requirementsContent = '';
    if (existsSync(requirementsPath)) {
      requirementsContent = await readFile(requirementsPath, 'utf-8');
    } else {
      // If no requirements.txt, create one from dependencies
      requirementsContent = dependencies.join('\n');
    }

    // Write requirements.txt to space
    const spaceRequirementsPath = join(spacePath, 'requirements.txt');
    await writeFile(spaceRequirementsPath, requirementsContent, 'utf-8');

    // Create space.json with imported data
    const spaceJson = {
      nodes: nodes || [],
      dependencies: dependencies || [],
      metadata: {
        visibleName: metadata.visibleName,
        spaceId: finalSpaceId,
        pythonVersion: metadata.pythonVersion,
        githubUrl: metadata.githubUrl,
        branch: metadata.branch || null,
        commitId: metadata.commitId || null,
        releaseTag: metadata.releaseTag || null,
        createdAt: metadata.createdAt || new Date().toISOString(),
        comfyUISource: metadata.comfyUISource || (metadata.releaseTag ? 'release' : (metadata.branch || metadata.commitId ? 'custom' : 'default')),
      },
    };
    const spaceJsonPath = join(spacePath, 'space.json');
    await writeFile(spaceJsonPath, JSON.stringify(spaceJson, null, 2), 'utf-8');

    // Create venv with specified Python version
    const venvPath = join(spacePath, 'venv');
    const pythonVersionToUse = metadata.pythonVersion || '3.11';
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

    // Note: We do NOT update selected_version.txt or automatically activate
    // The user will need to manually activate the imported space

    return NextResponse.json({
      success: true,
      message: `Space "${metadata.visibleName}" imported successfully`,
      spaceId: finalSpaceId,
      visibleName: metadata.visibleName,
    });
  } catch (error) {
    console.error('Error importing space:', error);
    return NextResponse.json(
      { error: `Failed to import space: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}




