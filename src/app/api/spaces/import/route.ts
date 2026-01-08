import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { spawn, execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

type PythonCandidate = { command: string; args: string[] };

function formatPythonCommand(candidate: PythonCandidate): string {
  return [candidate.command, ...candidate.args].join(' ').trim();
}

function buildPythonCandidates(pythonVersion?: string): PythonCandidate[] {
  const candidates: PythonCandidate[] = [];
  const isWindows = process.platform === 'win32';
  const versionMatch = pythonVersion?.trim().match(/^\d+(?:\.\d+)?/);
  const version = versionMatch?.[0];

  if (version) {
    if (isWindows) {
      candidates.push({ command: 'py', args: [`-${version}`] });
    } else {
      candidates.push({ command: `python${version}`, args: [] });
    }
  }

  if (isWindows) {
    candidates.push({ command: 'py', args: ['-3'] });
    candidates.push({ command: 'python', args: [] });
    candidates.push({ command: 'python3', args: [] });
  } else {
    candidates.push({ command: 'python3', args: [] });
    candidates.push({ command: 'python', args: [] });
  }

  return candidates;
}

async function createVenv(
  venvPath: string,
  spacePath: string,
  pythonVersion?: string
): Promise<void> {
  const candidates = buildPythonCandidates(pythonVersion);
  let lastError: Error | null = null;

  for (const candidate of candidates) {
    try {
      await new Promise<void>((resolve, reject) => {
        const venvProcess = spawn(
          candidate.command,
          [...candidate.args, '-m', 'venv', venvPath],
          {
            cwd: spacePath,
            env: { ...process.env },
            shell: false,
          }
        );

        venvProcess.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`exit code ${code}`));
          }
        });

        venvProcess.on('error', (error) => {
          reject(error);
        });
      });
      return;
    } catch (error) {
      lastError = error as Error;
      console.warn(`Failed to create venv with ${formatPythonCommand(candidate)}: ${lastError.message}`);
    }
  }

  const attempts = candidates.map(formatPythonCommand).join(', ');
  throw new Error(`Failed to create venv using: ${attempts}${lastError ? `. Last error: ${lastError.message}` : ''}`);
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
    const cloneUrl = githubUrl.trim();
    
    try {
      if (releaseTag) {
        // Clone specific release tag
        await execFileAsync('git', ['clone', '--branch', releaseTag, '--depth', '1', cloneUrl, comfyUIPath]);
      } else if (branch) {
        // Clone specific branch
        await execFileAsync('git', ['clone', '--branch', branch, '--depth', '1', cloneUrl, comfyUIPath]);
      } else {
        // Clone default branch
        await execFileAsync('git', ['clone', '--depth', '1', cloneUrl, comfyUIPath]);
      }

      // Checkout specific commit if provided (and not using release tag)
      if (commitId && !releaseTag) {
        await execFileAsync('git', ['checkout', commitId], { cwd: comfyUIPath });
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
        torchVersion: metadata.torchVersion || null,
        githubUrl: metadata.githubUrl,
        branch: metadata.branch || null,
        commitId: metadata.commitId || null,
        releaseTag: metadata.releaseTag || null,
        cmdArgs: metadata.cmdArgs || null,
        createdAt: metadata.createdAt || new Date().toISOString(),
        comfyUISource: metadata.comfyUISource || (metadata.releaseTag ? 'release' : (metadata.branch || metadata.commitId ? 'custom' : 'default')),
      },
    };
    const spaceJsonPath = join(spacePath, 'space.json');
    await writeFile(spaceJsonPath, JSON.stringify(spaceJson, null, 2), 'utf-8');

    // Create venv with specified Python version
    const venvPath = join(spacePath, 'venv');
    const pythonVersionToUse = metadata.pythonVersion || '3.11';
    await createVenv(venvPath, spacePath, pythonVersionToUse);

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

