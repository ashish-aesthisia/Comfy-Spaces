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

function generateSpaceId(visibleName: string): string {
  return visibleName
    .toLowerCase()
    .replace(/%20/g, '-') // Replace %20 with -
    .replace(/[^a-z0-9-]/g, '-') // Replace special chars with -
    .replace(/-+/g, '-') // Replace multiple dashes with single dash
    .replace(/^-|-$/g, ''); // Remove leading/trailing dashes
}

function overrideTorchPackages(
  dependencies: string[],
  torchVersion: string,
  torchIndexUrl?: string
): { dependencies: string[]; indexUrlComment?: string } {
  // Packages to override
  const torchPackages = ['torch', 'torchsde', 'torchvision', 'torchaudio'];
  
  // Remove existing torch packages
  const filteredDeps = dependencies.filter(dep => {
    const packageName = dep.split(/[=<>!~]/)[0].trim().toLowerCase();
    return !torchPackages.some(torchPkg => packageName === torchPkg);
  });
  
  // Add new torch packages with specified version
  const torchDeps: string[] = [];
  let indexUrlComment: string | undefined;
  
  // Determine version string
  const versionMatch = torchVersion.match(/^(\d+\.\d+\.\d+)/);
  const baseVersion = versionMatch ? versionMatch[1] : torchVersion;
  
  // For CUDA versions, add index URL comment
  if (torchIndexUrl) {
    // CUDA version format: torch==2.1.0+cu121
    // Add comment with index URL for pip install
    indexUrlComment = `# For CUDA torch packages, use: pip install --extra-index-url ${torchIndexUrl} torch==${torchVersion} torchvision torchaudio`;
    // Only pin torch version, let torchvision and torchaudio resolve compatible versions
    torchDeps.push(`torch==${torchVersion}`);
    torchDeps.push(`torchvision`); // No version constraint - pip will resolve compatible version
    torchDeps.push(`torchaudio`); // No version constraint - pip will resolve compatible version
    // torchsde doesn't have CUDA builds, use without version constraint
    torchDeps.push(`torchsde`);
  } else {
    // CPU version - only pin torch, let others resolve
    torchDeps.push(`torch==${baseVersion}`);
    torchDeps.push(`torchvision`); // No version constraint - pip will resolve compatible version
    torchDeps.push(`torchaudio`); // No version constraint - pip will resolve compatible version
    torchDeps.push(`torchsde`);
  }
  
  // Insert torch packages at the beginning
  filteredDeps.unshift(...torchDeps);
  
  return { dependencies: filteredDeps, indexUrlComment };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { visibleName, spaceId, githubUrl, pythonVersion, torchVersion, comfyUIArgs, branch, commitId, releaseTag } = body;
    
    // Handle torchVersion - can be string or object with version and indexUrl
    let torchVersionString: string | undefined;
    let torchIndexUrl: string | undefined;
    
    if (torchVersion) {
      if (typeof torchVersion === 'string') {
        torchVersionString = torchVersion;
      } else if (torchVersion.version) {
        torchVersionString = torchVersion.version;
        torchIndexUrl = torchVersion.indexUrl;
      }
    }

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

    let requirementsContent = await readFile(requirementsPath, 'utf-8');
    let dependencies = parseRequirements(requirementsContent);

    // Override torch packages if torchVersion is provided
    let indexUrlComment: string | undefined;
    if (torchVersionString) {
      // If indexUrl not provided, try to extract from version string
      if (!torchIndexUrl && torchVersionString.includes('+')) {
        const cudaMatch = torchVersionString.match(/cu(\d+)/);
        if (cudaMatch) {
          torchIndexUrl = `https://download.pytorch.org/whl/${cudaMatch[0]}`;
        }
      }
      
      const overrideResult = overrideTorchPackages(dependencies, torchVersionString, torchIndexUrl);
      dependencies = overrideResult.dependencies;
      indexUrlComment = overrideResult.indexUrlComment;
      
      // Rebuild requirements.txt content while preserving structure
      const lines = requirementsContent.split('\n');
      const newLines: string[] = [];
      const torchPackages = ['torch', 'torchsde', 'torchvision', 'torchaudio'];
      let torchPackagesAdded = false;
      
      // Add index URL comment for CUDA at the top if needed
      if (indexUrlComment) {
        newLines.push(indexUrlComment);
        newLines.push('');
      }
      
      // Process each line
      for (const line of lines) {
        const trimmed = line.trim();
        
        // Keep comments and empty lines as-is
        if (!trimmed || trimmed.startsWith('#')) {
          newLines.push(line);
          continue;
        }
        
        // Check if this is a torch package
        const packageName = trimmed.split(/[=<>!~#]/)[0].trim().toLowerCase();
        const isTorchPackage = torchPackages.some(torchPkg => packageName === torchPkg);
        
        if (isTorchPackage) {
          // Skip original torch packages - we'll add them at the end
          continue;
        } else {
          // Keep non-torch packages
          newLines.push(line);
        }
      }
      
      // Add torch packages at the end (or after first non-comment section)
      // Find a good insertion point (after first block of dependencies)
      let insertIndex = newLines.length;
      for (let i = 0; i < newLines.length; i++) {
        const line = newLines[i].trim();
        if (line && !line.startsWith('#')) {
          // Found first dependency, insert torch packages here
          insertIndex = i;
          break;
        }
      }
      
      // Insert torch packages
      const torchDeps = overrideResult.dependencies.filter(dep => {
        const packageName = dep.split(/[=<>!~]/)[0].trim().toLowerCase();
        return torchPackages.some(torchPkg => packageName === torchPkg);
      });
      
      newLines.splice(insertIndex, 0, ...torchDeps);
      
      requirementsContent = newLines.join('\n');
    }

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
        torchVersion: torchVersionString || null,
        torchIndexUrl: torchIndexUrl || null,
        comfyUIArgs: comfyUIArgs || null,
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
