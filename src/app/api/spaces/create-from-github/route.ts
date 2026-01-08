import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { readFile, writeFile, mkdir, readdir, cp } from 'fs/promises';
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

function normalizeTorchRequirement(torchVersion?: string): string | null {
  const trimmed = torchVersion?.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (['latest', 'torch', 'torch==latest'].includes(trimmed.toLowerCase())) {
    return 'torch';
  }
  return trimmed.includes('torch') ? trimmed : `torch==${trimmed}`;
}

function torchIndexUrl(torchRequirement: string | null): string | null {
  if (!torchRequirement || /^https?:\/\//i.test(torchRequirement) || /\s@\s/i.test(torchRequirement)) return null;
  const match = torchRequirement.match(/\+([a-z0-9]+)$/i);
  if (!match) return null;
  const tag = match[1].toLowerCase();
  if (tag.startsWith('cu') || tag === 'cpu') {
    return `https://download.pytorch.org/whl/${tag}`;
  }
  return null;
}

function applyTorchToRequirements(content: string, torchRequirement: string | null): string {
  if (!torchRequirement) return content;
  const extraIndexUrl = torchIndexUrl(torchRequirement);
  const lines = content.split('\n').filter((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return true;
    const clean = trimmed.split('#')[0].trim();
    if (/^torch($|[=<>!~])/i.test(clean)) return false;
    if (extraIndexUrl && /^--extra-index-url\b/i.test(clean) && clean.includes('download.pytorch.org/whl/')) {
      return false;
    }
    return true;
  });

  if (extraIndexUrl && !lines.some((line) => line.trim() === `--extra-index-url ${extraIndexUrl}`)) {
    lines.push(`--extra-index-url ${extraIndexUrl}`);
  }

  lines.push(torchRequirement);
  return `${lines.join('\n').trimEnd()}\n`;
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
    const { visibleName, spaceId, githubUrl, pythonVersion, branch, commitId, releaseTag, torchVersion, cmdArgs } = body;

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

    const rawRequirementsContent = await readFile(requirementsPath, 'utf-8');
    const torchRequirement = normalizeTorchRequirement(torchVersion);
    const requirementsContent = applyTorchToRequirements(rawRequirementsContent, torchRequirement);
    const dependencies = parseRequirements(requirementsContent);

    // Copy requirements.txt to space
    const spaceRequirementsPath = join(spacePath, 'requirements.txt');
    await writeFile(spaceRequirementsPath, requirementsContent, 'utf-8');

    // Create space.json with nodes, dependencies, and metadata
    const spaceJson = {
      nodes: [],
      dependencies: dependencies,
      metadata: {
        visibleName: visibleName,
        spaceId: finalSpaceId,
        pythonVersion: pythonVersion || '3.11',
        torchVersion: torchVersion?.trim() || null,
        githubUrl: githubUrl,
        branch: branch || null,
        commitId: commitId || null,
        releaseTag: releaseTag || null,
        cmdArgs: cmdArgs?.trim() || null,
        createdAt: new Date().toISOString(),
        comfyUISource: releaseTag ? 'release' : (branch || commitId ? 'custom' : 'default'),
      },
    };
    const spaceJsonPath = join(spacePath, 'space.json');
    await writeFile(spaceJsonPath, JSON.stringify(spaceJson, null, 2), 'utf-8');

    // Create venv with specified Python version
    const venvPath = join(spacePath, 'venv');
    const pythonVersionToUse = pythonVersion || '3.11';
    await createVenv(venvPath, spacePath, pythonVersionToUse);

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
