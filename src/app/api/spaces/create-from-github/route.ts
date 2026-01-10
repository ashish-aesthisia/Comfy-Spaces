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

async function detectCudaFamily(): Promise<string | null> {
  return new Promise((resolve) => {
    const childProcess = spawn('nvidia-smi', [], {
      env: { ...process.env },
      shell: false,
    });

    let output = '';
    let errorOutput = '';

    childProcess.stdout?.on('data', (data) => {
      output += data.toString();
    });

    childProcess.stderr?.on('data', (data) => {
      errorOutput += data.toString();
    });

    childProcess.on('close', () => {
      // Match CUDA Version: X.Y pattern
      const match = output.match(/CUDA Version:\s+(\d+)\.(\d+)/);
      if (match) {
        const major = match[1];
        resolve(`${major}.x`);
      } else {
        resolve(null);
      }
    });

    childProcess.on('error', () => {
      resolve(null);
    });
  });
}

async function getTorchRequirements(): Promise<string> {
  const cudaFamily = await detectCudaFamily();

  if (cudaFamily === '11.x') {
    return `--index-url https://download.pytorch.org/whl/cu118
torch==2.9.1+cu118
torchvision==0.19.1+cu118
torchaudio==2.9.1+cu118`;
  }

  if (cudaFamily === '12.x') {
    return `--index-url https://download.pytorch.org/whl/cu121
torch==2.8.0+cu121
torchvision==0.18.0+cu121
torchaudio==2.8.0+cu121`;
  }

  // CPU fallback
  return `torch==2.9.1
torchvision==0.19.1
torchaudio==2.9.1`;
}

function overrideTorchPackages(
  dependencies: string[],
  torchRequirements: string
): string[] {
  // Packages to override
  const torchPackages = ['torch', 'torchsde', 'torchvision', 'torchaudio'];
  
  // Remove existing torch packages
  const filteredDeps = dependencies.filter(dep => {
    const packageName = dep.split(/[=<>!~]/)[0].trim().toLowerCase();
    return !torchPackages.some(torchPkg => packageName === torchPkg);
  });
  
  // Parse torch requirements
  const torchLines = torchRequirements.split('\n').map(line => line.trim()).filter(line => line);
  const torchDeps: string[] = [];
  let indexUrl: string | undefined;
  let isGpu = false;
  
  // First, check if there's an index-url (indicates GPU/CUDA)
  for (const line of torchLines) {
    if (line.startsWith('--index-url')) {
      const urlMatch = line.match(/--index-url\s+(.+)/);
      if (urlMatch) {
        indexUrl = urlMatch[1];
        isGpu = true;
      }
    }
  }
  
  // Now process packages
  for (const line of torchLines) {
    if (line.startsWith('--index-url')) {
      // Skip index-url line, we'll add it separately
      continue;
    } else {
      // It's a package requirement
      // For GPU (when indexUrl is present), remove version constraints
      if (isGpu) {
        // Remove version constraint (==, >=, <=, etc.) for GPU packages
        const packageName = line.split(/[=<>!~]/)[0].trim();
        torchDeps.push(packageName);
      } else {
        // For CPU, keep the version constraint
        torchDeps.push(line);
      }
    }
  }
  
  // Add torchsde (doesn't have CUDA builds, use without version constraint)
  torchDeps.push('torchsde');
  
  // Insert torch packages at the beginning
  filteredDeps.unshift(...torchDeps);
  
  return filteredDeps;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { visibleName, spaceId, githubUrl, comfyUIArgs, branch, commitId, releaseTag } = body;
    
    // Auto-detect Python version
    let pythonVersion = '3.11'; // Default fallback
    try {
      const { spawn } = require('child_process');
      const pythonCommands = ['python', 'python3'];
      
      for (const cmd of pythonCommands) {
        try {
          const version = await new Promise<string | null>((resolve) => {
            const childProcess = spawn(cmd, ['--version'], {
              env: { ...process.env },
              shell: false,
            });
            
            let output = '';
            let errorOutput = '';
            
            childProcess.stdout?.on('data', (data: Buffer) => {
              output += data.toString();
            });
            
            childProcess.stderr?.on('data', (data: Buffer) => {
              errorOutput += data.toString();
            });
            
            childProcess.on('close', (code: number | null) => {
              if (code === 0) {
                const versionMatch = (output || errorOutput).match(/Python\s+(\d+\.\d+)/);
                if (versionMatch) {
                  resolve(versionMatch[1]);
                } else {
                  resolve(null);
                }
              } else {
                resolve(null);
              }
            });
            
            childProcess.on('error', () => {
              resolve(null);
            });
          });
          
          if (version) {
            pythonVersion = version;
            break;
          }
        } catch {
          continue;
        }
      }
    } catch (error) {
      console.error('Error detecting Python version:', error);
      // Use default
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

    // Auto-detect and override torch packages based on CUDA version
    try {
      const torchRequirements = await getTorchRequirements();
      dependencies = overrideTorchPackages(dependencies, torchRequirements);
      
      // Rebuild requirements.txt content while preserving structure
      const lines = requirementsContent.split('\n');
      const newLines: string[] = [];
      const torchPackages = ['torch', 'torchsde', 'torchvision', 'torchaudio'];
      
      // Check if torch requirements include index-url
      const torchLines = torchRequirements.split('\n').map(line => line.trim());
      const indexUrlLine = torchLines.find(line => line.startsWith('--index-url'));
      
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
      
      // Add index-url if present (before torch packages)
      if (indexUrlLine) {
        // Find insertion point (after comments, before first dependency)
        let insertIndex = newLines.length;
        for (let i = 0; i < newLines.length; i++) {
          const line = newLines[i].trim();
          if (line && !line.startsWith('#')) {
            insertIndex = i;
            break;
          }
        }
        newLines.splice(insertIndex, 0, indexUrlLine);
      }
      
      // Add torch packages at the end (or after first non-comment section)
      let insertIndex = newLines.length;
      for (let i = 0; i < newLines.length; i++) {
        const line = newLines[i].trim();
        if (line && !line.startsWith('#') && !line.startsWith('--index-url')) {
          insertIndex = i;
          break;
        }
      }
      
      // Insert torch packages
      const torchDeps = dependencies.filter(dep => {
        const packageName = dep.split(/[=<>!~]/)[0].trim().toLowerCase();
        return torchPackages.some(torchPkg => packageName === torchPkg);
      });
      
      newLines.splice(insertIndex, 0, ...torchDeps);
      
      requirementsContent = newLines.join('\n');
    } catch (error) {
      console.error('Error auto-detecting torch requirements:', error);
      // Continue with original requirements if detection fails
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
