import { NextRequest } from 'next/server';
import { join } from 'path';
import { spawn, exec, execFile } from 'child_process';
import { existsSync, appendFileSync, mkdirSync, writeFileSync, createWriteStream, readFileSync, statSync } from 'fs';
import { readdir, readFile, writeFile, mkdir } from 'fs/promises';
import { promisify } from 'util';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// Helper function to check if requirements have changed
async function hasRequirementsChanged(
  spacePath: string,
  currentContent: string
): Promise<boolean> {
  try {
    const historyPath = join(spacePath, 'requirements_history');
    
    // If no history exists, this is the first entry
    if (!existsSync(historyPath)) {
      return true;
    }

    // Get the most recent history entry
    const files = await readdir(historyPath);
    const historyFiles = files
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse();

    if (historyFiles.length === 0) {
      return true;
    }

    // Read the most recent entry
    const latestFile = historyFiles[0];
    const latestPath = join(historyPath, latestFile);
    const latestContent = await readFile(latestPath, 'utf-8');
    const latestEntry = JSON.parse(latestContent);

    // Compare with current content
    const latestSnapshotPath = join(historyPath, `${latestEntry.id}_requirements.txt`);
    if (!existsSync(latestSnapshotPath)) {
      return true;
    }

    const latestSnapshot = await readFile(latestSnapshotPath, 'utf-8');
    
    // Normalize both contents for comparison (trim, sort lines)
    const normalize = (content: string) => 
      content.trim().split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).sort().join('\n');
    
    return normalize(currentContent) !== normalize(latestSnapshot);
  } catch (error) {
    // If we can't check, assume there's a change to be safe
    console.error('Error checking requirements changes:', error);
    return true;
  }
}

// Helper function to save requirements history snapshot
async function saveRequirementsHistory(
  spacePath: string,
  type: 'activation' | 'node_install',
  nodeName?: string
): Promise<void> {
  try {
    const requirementsPath = join(spacePath, 'requirements.txt');
    if (!existsSync(requirementsPath)) {
      return;
    }

    const requirementsContent = await readFile(requirementsPath, 'utf-8');

    // For activation, only save if there are changes
    if (type === 'activation') {
      const hasChanged = await hasRequirementsChanged(spacePath, requirementsContent);
      if (!hasChanged) {
        return; // No changes, don't save
      }
    }

    const historyPath = join(spacePath, 'requirements_history');
    if (!existsSync(historyPath)) {
      await mkdir(historyPath, { recursive: true });
    }

    const timestamp = new Date().toISOString();
    const id = `${Date.now()}_${Math.random().toString(36).substring(7)}`;

    const historyEntry = {
      id,
      timestamp,
      type,
      nodeName: nodeName || undefined,
      requirementsContent,
    };

    const entryPath = join(historyPath, `${id}.json`);
    await writeFile(entryPath, JSON.stringify(historyEntry, null, 2), 'utf-8');

    const snapshotPath = join(historyPath, `${id}_requirements.txt`);
    await writeFile(snapshotPath, requirementsContent, 'utf-8');
  } catch (error) {
    // Silently fail - history tracking shouldn't break the main flow
    console.error('Error saving requirements history:', error);
  }
}

// Helper function to add timeout to promises
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => 
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
    )
  ]);
}

// Helper function to detect default branch (main/master) from git repository URL
async function getDefaultBranch(cloneUrl: string): Promise<string> {
  try {
    // Use git ls-remote to detect the default branch
    const { stdout } = await withTimeout(
      execFileAsync('git', ['ls-remote', '--symref', cloneUrl, 'HEAD']),
      10000,
      'Timeout detecting default branch'
    );
    const match = stdout.match(/ref: refs\/heads\/(\S+)\s+HEAD/);
    if (match && match[1]) {
      return match[1];
    }
  } catch (error) {
    // If ls-remote fails, try common default branches
  }
  
  // Fallback: return 'main' as the most common default
  return 'main';
}

// Helper function to checkout default branch (main/master) after clone
async function checkoutDefaultBranch(
  nodePath: string,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  logFile: string
): Promise<void> {
  try {
    // Try to get current branch
    let currentBranch: string;
    try {
      const { stdout } = await withTimeout(
        execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: nodePath }),
        5000,
        'Timeout getting current branch'
      );
      currentBranch = stdout.trim();
    } catch (error) {
      currentBranch = '';
    }

    // Try main first, then master
    const defaultBranches = ['main', 'master'];
    let checkedOut = false;

    for (const branch of defaultBranches) {
      // Skip if already on this branch
      if (currentBranch === branch) {
        sendLog(controller, encoder, `[APP] Already on default branch: ${branch}`, logFile);
        checkedOut = true;
        break;
      }

      // Try to checkout the branch
      try {
        await withTimeout(
          execFileAsync('git', ['checkout', branch], { cwd: nodePath }),
          60000,
          'Timeout checking out branch'
        );
        sendLog(controller, encoder, `[APP] Checked out default branch: ${branch}`, logFile);
        checkedOut = true;
        break;
      } catch (error) {
        // Branch doesn't exist, try next one
        continue;
      }
    }

    if (!checkedOut) {
      // If neither main nor master exists, stay on current branch
      sendLog(controller, encoder, `[WARN] Could not find main or master branch, staying on current branch: ${currentBranch}`, logFile);
    }
  } catch (error: any) {
    sendLog(controller, encoder, `[WARN] Error checking out default branch: ${error.message}`, logFile);
  }
}

function sendLog(controller: ReadableStreamDefaultController, encoder: TextEncoder, message: string, logFile?: string) {
  const timestamp = new Date().toISOString();
  const logEntry = { message, timestamp };
  const data = JSON.stringify(logEntry) + '\n\n';
  controller.enqueue(encoder.encode(`data: ${data}`));
  
  // Save to log file if provided
  if (logFile) {
    try {
      // Ensure the directory exists
      const logDir = join(logFile, '..');
      if (!existsSync(logDir)) {
        mkdirSync(logDir, { recursive: true });
      }
      appendFileSync(logFile, `[${timestamp}] ${message}\n`);
    } catch (error) {
      console.error('Error writing to log file:', error);
    }
  }
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  logFile: string
): Promise<number> {
  return new Promise((resolve, reject) => {
    const childProcess = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      shell: false,
    });

    childProcess.stdout?.on('data', (data) => {
      const output = data.toString();
      sendLog(controller, encoder, output.trim(), logFile);
    });

    childProcess.stderr?.on('data', (data) => {
      const output = data.toString();
      sendLog(controller, encoder, output.trim(), logFile);
    });

    childProcess.on('close', (code) => {
      resolve(code || 0);
    });

    childProcess.on('error', (error) => {
      sendLog(controller, encoder, `Error: ${error.message}`, logFile);
      reject(error);
    });
  });
}

function getVersion(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv
): Promise<string> {
  return new Promise((resolve, reject) => {
    const childProcess = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
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

    childProcess.on('close', (code) => {
      if (code === 0) {
        resolve(output.trim() || errorOutput.trim());
      } else {
        reject(new Error(`Command failed with code ${code}: ${errorOutput || output}`));
      }
    });

    childProcess.on('error', (error) => {
      reject(error);
    });
  });
}

function splitCommandArgs(command: string): string[] {
  const args: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;

  for (const char of command.trim()) {
    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (/\s/.test(char) && !inSingle && !inDouble) {
      if (current) {
        args.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }

  if (current) {
    args.push(current);
  }

  return args;
}

function isPythonCommand(commandPart: string): boolean {
  return /(^|[\\/])python(?:\d+)?(?:\.exe)?$/i.test(commandPart.trim());
}

type PipCommand = { command: string; args: string[]; display: string };

function resolvePipCommand(pythonExec: string, venvPath: string): PipCommand {
  const isWindows = process.platform === 'win32';
  const pipPath = isWindows
    ? join(venvPath, 'Scripts', 'pip.exe')
    : join(venvPath, 'bin', 'pip');

  if (existsSync(pipPath)) {
    return { command: pipPath, args: [], display: pipPath };
  }

  return { command: pythonExec, args: ['-m', 'pip'], display: `${pythonExec} -m pip` };
}

async function ensurePip(
  pythonExec: string,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  logFile: string
): Promise<void> {
  try {
    sendLog(controller, encoder, `[APP] pip not found, attempting ensurepip...`, logFile);
    await withTimeout(
      execFileAsync(pythonExec, ['-m', 'ensurepip', '--upgrade']),
      60000,
      'Timeout running ensurepip'
    );
  } catch (error: any) {
    sendLog(controller, encoder, `[WARN] Failed to run ensurepip: ${error.message}`, logFile);
  }
}

async function updateRequirementsTxt(
  pipCommand: string,
  pipArgs: string[],
  spacePath: string,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  logFile: string
): Promise<void> {
  try {
    sendLog(controller, encoder, `[APP] Updating requirements.txt with installed packages...`, logFile);
    
    const pipListProcess = spawn(pipCommand, [...pipArgs, 'list', '--format=freeze'], {
      cwd: spacePath,
      env: { ...process.env },
      shell: false,
    });

    let pipListOutput = '';
    let pipListError = '';

    pipListProcess.stdout?.on('data', (data) => {
      pipListOutput += data.toString();
    });

    pipListProcess.stderr?.on('data', (data) => {
      pipListError += data.toString();
    });

    const pipListCode = await new Promise<number>((resolve) => {
      pipListProcess.on('close', (code) => {
        resolve(code || 0);
      });
      pipListProcess.on('error', () => {
        resolve(1);
      });
    });

    if (pipListCode === 0 && pipListOutput.trim()) {
      const requirementsFilePath = join(spacePath, 'requirements.txt');
      writeFileSync(requirementsFilePath, pipListOutput, 'utf-8');
      sendLog(controller, encoder, `[APP] requirements.txt updated successfully`, logFile);

      // Also update space.json dependencies
      const spaceJsonPath = join(spacePath, 'space.json');
      if (existsSync(spaceJsonPath)) {
        try {
          const spaceJsonContent = readFileSync(spaceJsonPath, 'utf-8');
          const spaceJson = JSON.parse(spaceJsonContent);
          
          // Parse pip list output into dependencies array
          const dependencies = pipListOutput
            .trim()
            .split('\n')
            .filter(line => line.trim().length > 0)
            .map(line => line.trim());
          
          // Update dependencies in space.json
          spaceJson.dependencies = dependencies;
          
          // Write updated space.json
          writeFileSync(spaceJsonPath, JSON.stringify(spaceJson, null, 2), 'utf-8');
          sendLog(controller, encoder, `[APP] space.json dependencies updated successfully`, logFile);
        } catch (error: any) {
          sendLog(controller, encoder, `[WARN] Error updating space.json: ${error.message}`, logFile);
        }
      } else {
        sendLog(controller, encoder, `[INFO] space.json not found, skipping dependencies update`, logFile);
      }
    } else {
      sendLog(controller, encoder, `[WARN] Failed to update requirements.txt: ${pipListError || 'Unknown error'}`, logFile);
    }
  } catch (error: any) {
    sendLog(controller, encoder, `[WARN] Error updating requirements.txt: ${error.message}`, logFile);
  }
}

async function createRequirementsBkpIfMissing(
  pipCommand: string,
  pipArgs: string[],
  spacePath: string,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  logFile: string
): Promise<void> {
  try {
    const backupPath = join(spacePath, 'requirements.bkp');
    
    // Check if requirements.bkp already exists
    if (existsSync(backupPath)) {
      sendLog(controller, encoder, `[APP] requirements.bkp already exists, skipping creation`, logFile);
      return;
    }

    sendLog(controller, encoder, `[APP] requirements.bkp not found. Creating from pip list...`, logFile);
    
    const pipListProcess = spawn(pipCommand, [...pipArgs, 'list', '--format=freeze'], {
      cwd: spacePath,
      env: { ...process.env },
      shell: false,
    });

    let pipListOutput = '';
    let pipListError = '';

    pipListProcess.stdout?.on('data', (data) => {
      pipListOutput += data.toString();
    });

    pipListProcess.stderr?.on('data', (data) => {
      pipListError += data.toString();
    });

    const pipListCode = await new Promise<number>((resolve) => {
      pipListProcess.on('close', (code) => {
        resolve(code || 0);
      });
      pipListProcess.on('error', () => {
        resolve(1);
      });
    });

    if (pipListCode === 0 && pipListOutput.trim()) {
      writeFileSync(backupPath, pipListOutput, 'utf-8');
      sendLog(controller, encoder, `[APP] requirements.bkp created successfully`, logFile);
    } else {
      sendLog(controller, encoder, `[WARN] Failed to create requirements.bkp: ${pipListError || 'Unknown error'}`, logFile);
    }
  } catch (error: any) {
    sendLog(controller, encoder, `[WARN] Error creating requirements.bkp: ${error.message}`, logFile);
  }
}

async function getGitBranchAndCommit(nodePath: string): Promise<{ branch: string | null; commitId: string | null }> {
  try {
    // Check if .git directory exists
    const gitPath = join(nodePath, '.git');
    if (!existsSync(gitPath)) {
      return { branch: null, commitId: null };
    }

    // Get current branch
    let branch: string | null = null;
    try {
      const { stdout: branchOutput } = await withTimeout(
        execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: nodePath }),
        5000,
        'Timeout getting git branch'
      );
      branch = branchOutput.trim() || null;
    } catch (error) {
      // Branch might not be available, continue
    }

    // Get current commit ID
    let commitId: string | null = null;
    try {
      const { stdout: commitOutput } = await withTimeout(
        execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: nodePath }),
        5000,
        'Timeout getting git commit'
      );
      commitId = commitOutput.trim() || null;
    } catch (error) {
      // Commit might not be available, continue
    }

    return { branch, commitId };
  } catch (error) {
    return { branch: null, commitId: null };
  }
}

async function updateCustomNodesGitInfo(
  spacePath: string,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  logFile: string
): Promise<void> {
  try {
    sendLog(controller, encoder, `[APP] Scanning custom_nodes for git branch and commit information...`, logFile);
    
    const customNodesPath = join(spacePath, 'ComfyUI', 'custom_nodes');
    const spaceJsonPath = join(spacePath, 'space.json');

    // Check if custom_nodes directory exists
    if (!existsSync(customNodesPath)) {
      sendLog(controller, encoder, `[INFO] custom_nodes directory not found, skipping git info update`, logFile);
      return;
    }

    // Check if space.json exists
    if (!existsSync(spaceJsonPath)) {
      sendLog(controller, encoder, `[WARN] space.json not found, skipping git info update`, logFile);
      return;
    }

    // Read space.json
    const spaceJsonContent = readFileSync(spaceJsonPath, 'utf-8');
    const spaceJson = JSON.parse(spaceJsonContent);

    // Ensure nodes array exists
    if (!Array.isArray(spaceJson.nodes)) {
      spaceJson.nodes = [];
    }

    // Read all directories in custom_nodes
    const entries = await readdir(customNodesPath, { withFileTypes: true });
    const nodeDirectories = entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .filter(name => !name.startsWith('.') && name !== '__pycache__');

    sendLog(controller, encoder, `[APP] Found ${nodeDirectories.length} custom node directory(ies)`, logFile);

    // Create a map of existing nodes by name for quick lookup
    const nodesMap = new Map<string, any>();
    spaceJson.nodes.forEach((node: any) => {
      nodesMap.set(node.name, node);
    });

    // Update git info for each node directory
    for (const nodeName of nodeDirectories) {
      const nodePath = join(customNodesPath, nodeName);
      const { branch, commitId } = await getGitBranchAndCommit(nodePath);

      if (branch || commitId) {
        // Find or create node entry
        let node = nodesMap.get(nodeName);
        if (!node) {
          // Create new node entry
          node = {
            name: nodeName,
            githubUrl: null,
            commitId: null,
            branch: null,
            installedAt: new Date().toISOString(),
            disabled: false
          };
          spaceJson.nodes.push(node);
          nodesMap.set(nodeName, node);
        }

        // Update git info
        const updated = (node.branch !== branch) || (node.commitId !== commitId);
        node.branch = branch;
        node.commitId = commitId;

        if (updated) {
          sendLog(controller, encoder, `[APP] Updated ${nodeName}: branch=${branch || 'N/A'}, commit=${commitId ? commitId.substring(0, 7) : 'N/A'}`, logFile);
        }
      }
    }

    // Write updated space.json
    writeFileSync(spaceJsonPath, JSON.stringify(spaceJson, null, 2), 'utf-8');
    sendLog(controller, encoder, `[APP] space.json updated with custom_nodes git information`, logFile);
  } catch (error: any) {
    sendLog(controller, encoder, `[WARN] Error updating custom_nodes git info: ${error.message}`, logFile);
  }
}

async function cloneComfyUI(
  spacePath: string,
  githubUrl: string,
  releaseTag: string | null,
  branch: string | null,
  commitId: string | null,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  logFile: string
): Promise<boolean> {
  try {
    const comfyUIPath = join(spacePath, 'ComfyUI');
    
    // Check if ComfyUI already exists
    if (existsSync(comfyUIPath)) {
      sendLog(controller, encoder, `[APP] ComfyUI already exists, skipping clone`, logFile);
      return true;
    }

    if (!githubUrl) {
      sendLog(controller, encoder, `[WARN] No GitHub URL found in space.json, cannot clone ComfyUI`, logFile);
      return false;
    }

    sendLog(controller, encoder, `[APP] ComfyUI not found. Cloning from ${githubUrl}...`, logFile);

    // Ensure the URL ends with .git or add it
    let cloneUrl = githubUrl.trim();
    if (!cloneUrl.endsWith('.git')) {
      cloneUrl = cloneUrl.endsWith('/') ? `${cloneUrl}.git` : `${cloneUrl}.git`;
    }

    try {
      if (releaseTag) {
        // Clone specific release tag
        sendLog(controller, encoder, `[APP] Cloning release tag: ${releaseTag}`, logFile);
        await withTimeout(
          execFileAsync('git', ['clone', '--branch', releaseTag, '--depth', '1', cloneUrl, comfyUIPath]),
          300000, // 5 minutes timeout
          'Timeout cloning ComfyUI repository'
        );
      } else if (commitId) {
        // If we have a specific commit, clone without depth limit to ensure the commit is available
        if (branch) {
          // Clone specific branch (full history needed for specific commit)
          sendLog(controller, encoder, `[APP] Cloning branch ${branch} (full history for commit ${commitId.substring(0, 7)})...`, logFile);
          await withTimeout(
            execFileAsync('git', ['clone', '--branch', branch, cloneUrl, comfyUIPath]),
            300000,
            'Timeout cloning ComfyUI repository'
          );
        } else {
          // Clone default branch (full history needed for specific commit)
          sendLog(controller, encoder, `[APP] Cloning default branch (full history for commit ${commitId.substring(0, 7)})...`, logFile);
          await withTimeout(
            execFileAsync('git', ['clone', cloneUrl, comfyUIPath]),
            300000,
            'Timeout cloning ComfyUI repository'
          );
        }
        
        // Checkout specific commit
        sendLog(controller, encoder, `[APP] Checking out commit: ${commitId.substring(0, 7)}`, logFile);
        await withTimeout(
          execFileAsync('git', ['checkout', commitId], { cwd: comfyUIPath }),
          60000, // 1 minute timeout
          'Timeout checking out commit'
        );
      } else if (branch) {
        // Clone specific branch (shallow clone is fine if no specific commit)
        sendLog(controller, encoder, `[APP] Cloning branch: ${branch}`, logFile);
        await withTimeout(
          execFileAsync('git', ['clone', '--branch', branch, '--depth', '1', cloneUrl, comfyUIPath]),
          300000,
          'Timeout cloning ComfyUI repository'
        );
      } else {
        // Clone default branch (shallow clone is fine if no specific commit)
        sendLog(controller, encoder, `[APP] Cloning default branch`, logFile);
        await withTimeout(
          execFileAsync('git', ['clone', '--depth', '1', cloneUrl, comfyUIPath]),
          300000,
          'Timeout cloning ComfyUI repository'
        );
      }

      sendLog(controller, encoder, `[APP] ComfyUI cloned successfully`, logFile);
      return true;
    } catch (error: any) {
      sendLog(controller, encoder, `[ERROR] Failed to clone ComfyUI: ${error.message}`, logFile);
      return false;
    }
  } catch (error: any) {
    sendLog(controller, encoder, `[ERROR] Error cloning ComfyUI: ${error.message}`, logFile);
    return false;
  }
}

async function cloneCustomNodes(
  spacePath: string,
  nodes: any[],
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  logFile: string
): Promise<void> {
  try {
    const comfyUIPath = join(spacePath, 'ComfyUI');
    const customNodesPath = join(comfyUIPath, 'custom_nodes');

    // Ensure ComfyUI exists first
    if (!existsSync(comfyUIPath)) {
      sendLog(controller, encoder, `[WARN] ComfyUI not found, cannot clone custom nodes`, logFile);
      return;
    }

    // Ensure custom_nodes directory exists
    if (!existsSync(customNodesPath)) {
      mkdirSync(customNodesPath, { recursive: true });
    }

    if (!Array.isArray(nodes) || nodes.length === 0) {
      sendLog(controller, encoder, `[INFO] No custom nodes found in space.json`, logFile);
      return;
    }

    sendLog(controller, encoder, `[APP] Checking and cloning ${nodes.length} custom node(s)...`, logFile);

    for (const node of nodes) {
      // Skip disabled nodes
      if (node.disabled) {
        sendLog(controller, encoder, `[INFO] Skipping disabled node: ${node.name}`, logFile);
        continue;
      }

      const nodeName = node.name;
      const nodePath = join(customNodesPath, nodeName);
      const githubUrl = node.githubUrl;
      const commitId = node.commitId;
      const branch = node.branch;

      // Check if node already exists
      if (existsSync(nodePath)) {
        sendLog(controller, encoder, `[INFO] Node ${nodeName} already exists, skipping`, logFile);
        continue;
      }

      // Skip if no GitHub URL
      if (!githubUrl) {
        sendLog(controller, encoder, `[WARN] Node ${nodeName} has no GitHub URL, skipping`, logFile);
        continue;
      }

      sendLog(controller, encoder, `[APP] Cloning node: ${nodeName}...`, logFile);

      try {
        // Ensure the URL ends with .git or add it
        let cloneUrl = githubUrl.trim();
        if (!cloneUrl.endsWith('.git')) {
          cloneUrl = cloneUrl.endsWith('/') ? `${cloneUrl}.git` : `${cloneUrl}.git`;
        }

        // If no branch specified, detect and use default branch
        let branchToUse = branch;
        if (!branchToUse) {
          sendLog(controller, encoder, `[APP] No branch specified for ${nodeName}, detecting default branch...`, logFile);
          branchToUse = await getDefaultBranch(cloneUrl);
          sendLog(controller, encoder, `[APP] Using default branch: ${branchToUse}`, logFile);
        }

        if (commitId) {
          // If we have a specific commit, clone without depth limit to ensure the commit is available
          if (branchToUse) {
            // Clone specific branch or default branch (full history needed for specific commit)
            sendLog(controller, encoder, `[APP] Cloning branch ${branchToUse} (full history for commit ${commitId.substring(0, 7)})...`, logFile);
            await withTimeout(
              execFileAsync('git', ['clone', '--branch', branchToUse, cloneUrl, nodePath]),
              300000, // 5 minutes timeout
              `Timeout cloning ${nodeName}`
            );
          } else {
            // Clone default branch (full history needed for specific commit)
            sendLog(controller, encoder, `[APP] Cloning default branch (full history for commit ${commitId.substring(0, 7)})...`, logFile);
            await withTimeout(
              execFileAsync('git', ['clone', cloneUrl, nodePath]),
              300000,
              `Timeout cloning ${nodeName}`
            );
          }
          
          // Checkout specific commit
          sendLog(controller, encoder, `[APP] Checking out commit ${commitId.substring(0, 7)} for ${nodeName}`, logFile);
          await withTimeout(
            execFileAsync('git', ['checkout', commitId], { cwd: nodePath }),
            60000, // 1 minute timeout
            `Timeout checking out commit for ${nodeName}`
          );
        } else if (branchToUse) {
          // Clone specific branch or default branch (shallow clone is fine if no specific commit)
          sendLog(controller, encoder, `[APP] Cloning branch ${branchToUse}...`, logFile);
          await withTimeout(
            execFileAsync('git', ['clone', '--branch', branchToUse, '--depth', '1', cloneUrl, nodePath]),
            300000, // 5 minutes timeout
            `Timeout cloning ${nodeName}`
          );
          
          // Always checkout default branch (main/master) after clone
          await checkoutDefaultBranch(nodePath, controller, encoder, logFile);
        } else {
          // Clone default branch (shallow clone is fine if no specific commit)
          sendLog(controller, encoder, `[APP] Cloning default branch...`, logFile);
          await withTimeout(
            execFileAsync('git', ['clone', '--depth', '1', cloneUrl, nodePath]),
            300000,
            `Timeout cloning ${nodeName}`
          );
          
          // Always checkout default branch (main/master) after clone
          await checkoutDefaultBranch(nodePath, controller, encoder, logFile);
        }

        sendLog(controller, encoder, `[APP] Node ${nodeName} cloned successfully`, logFile);
      } catch (error: any) {
        sendLog(controller, encoder, `[ERROR] Failed to clone node ${nodeName}: ${error.message}`, logFile);
        // Continue with other nodes even if one fails
      }
    }

    sendLog(controller, encoder, `[APP] Finished cloning custom nodes`, logFile);
  } catch (error: any) {
    sendLog(controller, encoder, `[WARN] Error cloning custom nodes: ${error.message}`, logFile);
  }
}

async function checkPortInUse(port: number): Promise<boolean> {
  try {
    const isWindows = process.platform === 'win32';
    const COMMAND_TIMEOUT = 3000; // 3 seconds timeout for port check
    if (isWindows) {
      const { stdout } = await withTimeout(
        execAsync(`netstat -ano | findstr :${port}`),
        COMMAND_TIMEOUT,
        `Timeout checking port ${port}`
      );
      return stdout.trim().length > 0;
    } else {
      const { stdout } = await withTimeout(
        execAsync(`lsof -nP -t -iTCP:${port} -sTCP:LISTEN`),
        COMMAND_TIMEOUT,
        `Timeout checking port ${port}`
      );
      return stdout.trim().length > 0;
    }
  } catch (error) {
    // Port is not in use if command fails or times out
    return false;
  }
}

async function killProcessOnPort(
  port: number,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  logFile: string
): Promise<void> {
  try {
    const isWindows = process.platform === 'win32';
    const COMMAND_TIMEOUT = 5000; // 5 seconds timeout for commands
    
    if (isWindows) {
      // Get PID from netstat
      sendLog(controller, encoder, `[APP] Finding processes on port ${port}...`, logFile);
      const { stdout } = await withTimeout(
        execAsync(`netstat -ano | findstr :${port}`),
        COMMAND_TIMEOUT,
        `Timeout finding processes on port ${port}`
      );
      const lines = stdout.trim().split('\n');
      const pids = new Set<string>();
      
      for (const line of lines) {
        const match = line.match(/\s+(\d+)\s*$/);
        if (match) {
          pids.add(match[1]);
        }
      }
      
      if (pids.size === 0) {
        sendLog(controller, encoder, `[APP] No processes found on port ${port}`, logFile);
        return;
      }
      
      sendLog(controller, encoder, `[APP] Found ${pids.size} process(es) on port ${port}`, logFile);
      
      // Kill all processes using the port
      for (const pid of pids) {
        try {
          sendLog(controller, encoder, `[APP] Attempting to kill process ${pid}...`, logFile);
          await withTimeout(
            execAsync(`taskkill /PID ${pid} /F`),
            COMMAND_TIMEOUT,
            `Timeout killing process ${pid}`
          );
          sendLog(controller, encoder, `[APP] Killed process ${pid} using port ${port}`, logFile);
        } catch (error) {
          sendLog(controller, encoder, `[WARN] Could not kill process ${pid}: ${error instanceof Error ? error.message : 'Unknown error'}`, logFile);
        }
      }
    } else {
      // macOS/Linux: Use lsof to find and kill
      sendLog(controller, encoder, `[APP] Finding processes on port ${port}...`, logFile);
      let stdout: string;
      try {
        const result = await withTimeout(
          execAsync(`lsof -nP -t -iTCP:${port} -sTCP:LISTEN`),
          COMMAND_TIMEOUT,
          `Timeout finding processes on port ${port}`
        );
        stdout = result.stdout;
      } catch (error) {
        // lsof returns non-zero exit code when no process is found, which is expected
        if (error instanceof Error && error.message.includes('Timeout')) {
          sendLog(controller, encoder, `[WARN] Timeout while checking for processes on port ${port}`, logFile);
          return;
        }
        // If lsof fails because no process is found, that's fine
        sendLog(controller, encoder, `[APP] No processes found on port ${port}`, logFile);
        return;
      }
      
      const pids = stdout.trim().split('\n').filter(pid => pid.length > 0);
      
      if (pids.length === 0) {
        sendLog(controller, encoder, `[APP] No processes found on port ${port}`, logFile);
        return;
      }
      
      sendLog(controller, encoder, `[APP] Found ${pids.length} process(es) on port ${port}`, logFile);
      
      for (const pid of pids) {
        try {
          sendLog(controller, encoder, `[APP] Attempting to kill process ${pid}...`, logFile);
          await withTimeout(
            execAsync(`kill -9 ${pid}`),
            COMMAND_TIMEOUT,
            `Timeout killing process ${pid}`
          );
          sendLog(controller, encoder, `[APP] Killed process ${pid} using port ${port}`, logFile);
        } catch (error) {
          sendLog(controller, encoder, `[WARN] Could not kill process ${pid}: ${error instanceof Error ? error.message : 'Unknown error'}`, logFile);
        }
      }
    }
    
    // Verify port is actually free - check up to 5 times with 5 second intervals
    const MAX_VERIFICATION_ATTEMPTS = 5;
    const VERIFICATION_INTERVAL = 5000; // 5 seconds
    
    sendLog(controller, encoder, `[APP] Verifying port ${port} is free...`, logFile);
    
    for (let attempt = 1; attempt <= MAX_VERIFICATION_ATTEMPTS; attempt++) {
      await new Promise(resolve => setTimeout(resolve, VERIFICATION_INTERVAL));
      
      const portStillInUse = await checkPortInUse(port);
      
      if (!portStillInUse) {
        sendLog(controller, encoder, `[APP] Port ${port} is now free (verified after ${attempt} attempt(s))`, logFile);
        return;
      }
      
      if (attempt < MAX_VERIFICATION_ATTEMPTS) {
        sendLog(controller, encoder, `[APP] Port ${port} still in use. Waiting 5 seconds before next check (attempt ${attempt}/${MAX_VERIFICATION_ATTEMPTS})...`, logFile);
      } else {
        sendLog(controller, encoder, `[WARN] Port ${port} is still in use after ${MAX_VERIFICATION_ATTEMPTS} verification attempts. Proceeding anyway...`, logFile);
      }
    }
  } catch (error) {
    sendLog(controller, encoder, `[WARN] Error killing process on port ${port}: ${error instanceof Error ? error.message : 'Unknown error'}`, logFile);
  }
}

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();
  const searchParams = request.nextUrl.searchParams;
  const version = searchParams.get('version');

  if (!version) {
    return new Response('Version parameter is required', { status: 400 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const spacePath = join(process.cwd(), 'spaces', version);
      const venvPath = join(spacePath, 'venv');
      const spaceJsonPath = join(spacePath, 'space.json');
      const logFilePath = join(spacePath, 'logs.txt');
      const comfyLogFilePath = join(spacePath, 'comfy-logs.txt');
      const comfyUIPath = join(spacePath, 'ComfyUI');

      // Ensure log directory exists
      try {
        if (!existsSync(spacePath)) {
          mkdirSync(spacePath, { recursive: true });
        }
        // Clear or create log file
        writeFileSync(logFilePath, `=== Activation Log for ${version} - ${new Date().toISOString()} ===\n\n`);
      } catch (error) {
        console.error('Error setting up log file:', error);
      }

      // Clear ComfyUI log file at the start of activation
      try {
        const comfyLogDir = join(comfyLogFilePath, '..');
        if (!existsSync(comfyLogDir)) {
          mkdirSync(comfyLogDir, { recursive: true });
        }
        writeFileSync(comfyLogFilePath, `=== ComfyUI Logs - ${new Date().toISOString()} ===\n\n`);
      } catch (error) {
        console.error('Error clearing ComfyUI log file:', error);
      }

      // Track running processes for cancellation
      const runningProcesses: Array<{ process: any; kill: () => void }> = [];
      let isCancelled = false;

      // Handle cancellation
      request.signal.addEventListener('abort', () => {
        isCancelled = true;
        sendLog(controller, encoder, `[APP] Activation cancelled by user`, logFilePath);
        // Kill all running processes
        runningProcesses.forEach(({ kill }) => {
          try {
            kill();
          } catch (error) {
            // Ignore errors when killing processes
          }
        });
        controller.close();
      });

      try {
        const isWindows = process.platform === 'win32';
        // Step 0: Check and kill existing ComfyUI process on port 8188
        const COMFYUI_PORT = 8188;
        sendLog(controller, encoder, `[APP] Checking if port ${COMFYUI_PORT} is in use...`, logFilePath);
        
        const portInUse = await checkPortInUse(COMFYUI_PORT);
        if (portInUse) {
          sendLog(controller, encoder, `[APP] Port ${COMFYUI_PORT} is in use. Killing existing process...`, logFilePath);
          await killProcessOnPort(COMFYUI_PORT, controller, encoder, logFilePath);
          sendLog(controller, encoder, `[APP] Port ${COMFYUI_PORT} cleared`, logFilePath);
        } else {
          sendLog(controller, encoder, `[APP] Port ${COMFYUI_PORT} is available`, logFilePath);
        }

        if (isCancelled) {
          controller.close();
          return;
        }

        // Step 1: Activate venv and check if it exists
        sendLog(controller, encoder, `[APP] Activating virtual environment for ${version}...`, logFilePath);
        
        if (isCancelled) {
          controller.close();
          return;
        }
        
        if (!existsSync(venvPath)) {
          sendLog(controller, encoder, `[APP] Virtual environment not found. Creating venv...`, logFilePath);
          
          // Create venv with process tracking
          const venvPython = isWindows ? 'python' : 'python3';
          const venvProcess = spawn(venvPython, ['-m', 'venv', venvPath], {
            cwd: spacePath,
            env: { ...process.env },
            shell: false,
          });

          const venvProcessKill = () => {
            if (!venvProcess.killed) {
              venvProcess.kill('SIGTERM');
            }
          };
          runningProcesses.push({ process: venvProcess, kill: venvProcessKill });

          let venvOutput = '';
          venvProcess.stdout?.on('data', (data) => {
            venvOutput += data.toString();
            sendLog(controller, encoder, data.toString().trim(), logFilePath);
          });

          venvProcess.stderr?.on('data', (data) => {
            venvOutput += data.toString();
            sendLog(controller, encoder, data.toString().trim(), logFilePath);
          });

          const venvCreateCode = await new Promise<number>((resolve) => {
            venvProcess.on('close', (code) => {
              const index = runningProcesses.findIndex(p => p.process === venvProcess);
              if (index !== -1) {
                runningProcesses.splice(index, 1);
              }
              resolve(code || 0);
            });
            venvProcess.on('error', () => {
              const index = runningProcesses.findIndex(p => p.process === venvProcess);
              if (index !== -1) {
                runningProcesses.splice(index, 1);
              }
              resolve(1);
            });
          });
          
          if (isCancelled) {
            controller.close();
            return;
          }
          
          if (venvCreateCode !== 0) {
            sendLog(controller, encoder, `[ERROR] Failed to create virtual environment`, logFilePath);
            controller.close();
            return;
          }
          sendLog(controller, encoder, `[APP] Virtual environment created successfully`, logFilePath);
        } else {
          sendLog(controller, encoder, `[APP] Virtual environment found. Using existing venv...`, logFilePath);
        }

        // Determine the python executable path based on OS
        const pythonExec = isWindows 
          ? join(venvPath, 'Scripts', 'python.exe')
          : join(venvPath, 'bin', 'python3');
        let pipInfo = resolvePipCommand(pythonExec, venvPath);
        if (pipInfo.command === pythonExec) {
          await ensurePip(pythonExec, controller, encoder, logFilePath);
          pipInfo = resolvePipCommand(pythonExec, venvPath);
        }

        // Display Python and pip versions
        sendLog(controller, encoder, `[APP] Python executable: ${pythonExec}`, logFilePath);
        try {
          const pythonVersion = await getVersion(pythonExec, ['--version'], spacePath, process.env);
          sendLog(controller, encoder, `[APP] Python version: ${pythonVersion}`, logFilePath);
        } catch (error: any) {
          sendLog(controller, encoder, `[WARN] Could not get Python version: ${error.message}`, logFilePath);
        }

        sendLog(controller, encoder, `[APP] Pip command: ${pipInfo.display}`, logFilePath);
        try {
          const pipVersion = await getVersion(pipInfo.command, [...pipInfo.args, '--version'], spacePath, process.env);
          sendLog(controller, encoder, `[APP] Pip version: ${pipVersion}`, logFilePath);
        } catch (error: any) {
          sendLog(
            controller,
            encoder,
            `[ERROR] Pip is not available. Install python3-venv (or python3-pip) and try again. Details: ${error.message}`,
            logFilePath
          );
          controller.close();
          return;
        }

        if (isCancelled) {
          controller.close();
          return;
        }

        // Step 2: Install dependencies from space.json
        let requirementsPath: string | null = null;
        if (existsSync(spaceJsonPath)) {
          try {
            const spaceJsonContent = readFileSync(spaceJsonPath, 'utf-8');
            const spaceJson = JSON.parse(spaceJsonContent);
            const dependencies = spaceJson.dependencies || [];
            
            if (dependencies.length > 0) {
              // Create temporary requirements.txt from space.json dependencies
              const tempRequirementsPath = join(spacePath, 'requirements_temp.txt');
              const requirementsContent = dependencies.map((dep: string) => dep).join('\n');
              writeFileSync(tempRequirementsPath, requirementsContent, 'utf-8');
              requirementsPath = tempRequirementsPath;
              
              sendLog(controller, encoder, `[APP] Installing dependencies from space.json...`, logFilePath);
              
              // Install requirements with process tracking
              // Use --upgrade-strategy=only-if-needed to allow pip to resolve conflicts
              // This will upgrade packages only if needed to satisfy dependencies
              const pipProcess = spawn(pipInfo.command, [...pipInfo.args, 'install', '-r', requirementsPath, '--upgrade-strategy', 'only-if-needed'], {
                cwd: spacePath,
                env: { ...process.env },
                shell: false,
              });

              const pipProcessKill = () => {
                if (!pipProcess.killed) {
                  pipProcess.kill('SIGTERM');
                }
              };
              runningProcesses.push({ process: pipProcess, kill: pipProcessKill });

              pipProcess.stdout?.on('data', (data) => {
                const output = data.toString();
                sendLog(controller, encoder, output.trim(), logFilePath);
              });

              pipProcess.stderr?.on('data', (data) => {
                const output = data.toString();
                sendLog(controller, encoder, output.trim(), logFilePath);
              });

              const pipInstallCode = await new Promise<number>((resolve) => {
                pipProcess.on('close', (code) => {
                  const index = runningProcesses.findIndex(p => p.process === pipProcess);
                  if (index !== -1) {
                    runningProcesses.splice(index, 1);
                  }
                  resolve(code || 0);
                });
                pipProcess.on('error', () => {
                  const index = runningProcesses.findIndex(p => p.process === pipProcess);
                  if (index !== -1) {
                    runningProcesses.splice(index, 1);
                  }
                  resolve(1);
                });
              });

              if (isCancelled) {
                controller.close();
                return;
              }

              if (pipInstallCode !== 0) {
                // If installation failed, try with conflict resolution
                // Remove strict version pins for known problematic packages and let pip resolve
                sendLog(controller, encoder, `[WARN] Initial installation failed, attempting conflict resolution...`, logFilePath);
                
                // Read the requirements file
                let requirementsContent = readFileSync(requirementsPath, 'utf-8');
                const lines = requirementsContent.split('\n');
                
                // Known packages that often have conflicts - remove strict pins to let pip resolve
                // For numpy specifically, we need to allow downgrades if needed
                const conflictPronePackages = ['numpy', 'scipy', 'pandas', 'matplotlib', 'pillow'];
                const adjustedLines = lines.map(line => {
                  const trimmed = line.trim();
                  if (!trimmed || trimmed.startsWith('#')) {
                    return line;
                  }
                  
                  for (const pkg of conflictPronePackages) {
                    // Match package==version and remove the strict pin to let pip resolve
                    const strictMatch = trimmed.match(new RegExp(`^(${pkg.replace('-', '[-_]')})\\s*==\\s*([^\\s#]+)`, 'i'));
                    if (strictMatch) {
                      const pkgName = strictMatch[1];
                      // Remove version pin entirely - let pip find compatible version
                      sendLog(controller, encoder, `[APP] Removing strict version pin for ${pkgName} to allow pip to resolve conflicts`, logFilePath);
                      return pkgName; // Just the package name, no version constraint
                    }
                  }
                  return line;
                });
                
                const adjustedContent = adjustedLines.join('\n');
                writeFileSync(requirementsPath, adjustedContent, 'utf-8');
                
                // Try installation again with relaxed constraints
                const retryPipProcess = spawn(pipInfo.command, [...pipInfo.args, 'install', '-r', requirementsPath, '--upgrade-strategy', 'only-if-needed'], {
                  cwd: spacePath,
                  env: { ...process.env },
                  shell: false,
                });

                const retryPipProcessKill = () => {
                  if (!retryPipProcess.killed) {
                    retryPipProcess.kill('SIGTERM');
                  }
                };
                runningProcesses.push({ process: retryPipProcess, kill: retryPipProcessKill });

                retryPipProcess.stdout?.on('data', (data) => {
                  const output = data.toString();
                  sendLog(controller, encoder, output.trim(), logFilePath);
                });

                retryPipProcess.stderr?.on('data', (data) => {
                  const output = data.toString();
                  sendLog(controller, encoder, output.trim(), logFilePath);
                });

                const retryPipCode = await new Promise<number>((resolve) => {
                  retryPipProcess.on('close', (code) => {
                    const index = runningProcesses.findIndex(p => p.process === retryPipProcess);
                    if (index !== -1) {
                      runningProcesses.splice(index, 1);
                    }
                    resolve(code || 0);
                  });
                  retryPipProcess.on('error', () => {
                    const index = runningProcesses.findIndex(p => p.process === retryPipProcess);
                    if (index !== -1) {
                      runningProcesses.splice(index, 1);
                    }
                    resolve(1);
                  });
                });

                if (isCancelled) {
                  controller.close();
                  return;
                }

                if (retryPipCode !== 0) {
                  sendLog(controller, encoder, `[ERROR] Failed to install dependencies even after conflict resolution`, logFilePath);
                  controller.close();
                  return;
                }
                
                sendLog(controller, encoder, `[APP] Dependencies installed successfully after conflict resolution`, logFilePath);
              } else {
                sendLog(controller, encoder, `[APP] Dependencies installed successfully`, logFilePath);
              }
              
              // Clean up temporary requirements file
              try {
                if (existsSync(requirementsPath)) {
                  const { unlinkSync } = require('fs');
                  unlinkSync(requirementsPath);
                }
              } catch (error) {
                // Ignore cleanup errors
              }

              // Update requirements.txt with pip list
              await updateRequirementsTxt(pipInfo.command, pipInfo.args, spacePath, controller, encoder, logFilePath);
            } else {
              sendLog(controller, encoder, `[INFO] No dependencies found in space.json`, logFilePath);
              
              // Still update requirements.txt with currently installed packages
              await updateRequirementsTxt(pipInfo.command, pipInfo.args, spacePath, controller, encoder, logFilePath);
            }
          } catch (error: any) {
            sendLog(controller, encoder, `[WARN] Error reading space.json: ${error.message}`, logFilePath);
          }
        } else {
          sendLog(controller, encoder, `[WARN] space.json not found, skipping dependency installation`, logFilePath);
        }

        // Create requirements.bkp if it doesn't exist
        await createRequirementsBkpIfMissing(pipInfo.command, pipInfo.args, spacePath, controller, encoder, logFilePath);

        // Save requirements history snapshot after activation
        await saveRequirementsHistory(spacePath, 'activation');

        if (isCancelled) {
          controller.close();
          return;
        }

        // Step 2.5: Clone ComfyUI if it doesn't exist
        if (existsSync(spaceJsonPath)) {
          try {
            const spaceJsonContent = readFileSync(spaceJsonPath, 'utf-8');
            const spaceJson = JSON.parse(spaceJsonContent);
            const metadata = spaceJson.metadata || {};
            const githubUrl = metadata.githubUrl;
            const releaseTag = metadata.releaseTag;
            const branch = metadata.branch;
            const commitId = metadata.commitId;

            if (githubUrl) {
              const comfyUICloned = await cloneComfyUI(
                spacePath,
                githubUrl,
                releaseTag,
                branch,
                commitId,
                controller,
                encoder,
                logFilePath
              );

              if (!comfyUICloned) {
                sendLog(controller, encoder, `[WARN] Failed to clone ComfyUI, but continuing...`, logFilePath);
              }
            } else {
              sendLog(controller, encoder, `[INFO] No GitHub URL found in space.json metadata, skipping ComfyUI clone`, logFilePath);
            }
          } catch (error: any) {
            sendLog(controller, encoder, `[WARN] Error reading space.json for ComfyUI clone: ${error.message}`, logFilePath);
          }
        }

        if (isCancelled) {
          controller.close();
          return;
        }

        // Step 2.6: Clone custom nodes if they don't exist
        if (existsSync(spaceJsonPath)) {
          try {
            const spaceJsonContent = readFileSync(spaceJsonPath, 'utf-8');
            const spaceJson = JSON.parse(spaceJsonContent);
            const nodes = spaceJson.nodes || [];

            if (nodes.length > 0) {
              await cloneCustomNodes(spacePath, nodes, controller, encoder, logFilePath);
            } else {
              sendLog(controller, encoder, `[INFO] No custom nodes found in space.json`, logFilePath);
            }
          } catch (error: any) {
            sendLog(controller, encoder, `[WARN] Error reading space.json for custom nodes clone: ${error.message}`, logFilePath);
          }
        }

        if (isCancelled) {
          controller.close();
          return;
        }

        // Step 2.7: Update custom_nodes git information in space.json
        await updateCustomNodesGitInfo(spacePath, controller, encoder, logFilePath);

        if (isCancelled) {
          controller.close();
          return;
        }

        // Step 3: Launch ComfyUI
        sendLog(controller, encoder, `[APP] Launching ComfyUI server...`, logFilePath);
        
        // Use the venv python to run ComfyUI
        // Check if there are environment variables for ComfyUI launch command
        let comfyUIArgs = ['main.py'];
        let useSystemPython = false;
        
        // Check for COMFY_CMD first, then COMFYUI_LAUNCH_ARGS
        const comfyCmd = process.env.COMFY_CMD || process.env.COMFYUI_LAUNCH_ARGS;
        if (comfyCmd) {
          // Parse the command - handle shell redirection like "> ./data/comfy-logs.txt"
          // Note: We ignore log file redirections and always use space/comfy-logs.txt
          const parts = splitCommandArgs(comfyCmd);
          const args: string[] = [];
          
          for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (part === '>' && i + 1 < parts.length) {
              // Found redirection operator, skip it and the log file path
              // We'll use our own log file path instead
              i++; // Skip the log file path
              continue;
            } else if (part.startsWith('>')) {
              // Redirection without space: ">file.txt", skip it
              continue;
            } else if (isPythonCommand(part)) {
              // If using system python, note it but we'll still use venv python
              useSystemPython = /python3/i.test(part);
              // Skip 'python3' - we'll use pythonExec instead
              continue;
            } else {
              args.push(part);
            }
          }
          
          if (args.length > 0) {
            comfyUIArgs = args;
          }
          
          sendLog(controller, encoder, `[APP] Using custom ComfyUI launch command from environment`, logFilePath);
        }
        
        // Always use the space directory's comfy-logs.txt
        const comfyLogFile = comfyLogFilePath;
        
        // Ensure log file directory exists
        const logFileDir = join(comfyLogFile, '..');
        if (!existsSync(logFileDir)) {
          mkdirSync(logFileDir, { recursive: true });
        }
        
        // Set up environment variables for ComfyUI
        const comfyEnv: NodeJS.ProcessEnv = { ...process.env };
        
        // Create write stream for log file (append mode since we just cleared it)
        const logStream = createWriteStream(comfyLogFile, { flags: 'a' }); // Append mode
        
        // Launch ComfyUI in the background (non-blocking)
        // Use detached mode so it runs independently and won't be killed when stream closes
        const comfyProcess = spawn(
          pythonExec,
          comfyUIArgs,
          {
            cwd: comfyUIPath,
            env: comfyEnv,
            shell: false,
            detached: true, // Run in detached mode so it continues after parent exits
            stdio: ['ignore', 'pipe', 'pipe'], // Keep stdout/stderr for logging
          }
        );

        // Unref the process so it doesn't keep the parent alive
        // This allows ComfyUI to run in the background independently
        comfyProcess.unref();

        // Don't add ComfyUI to runningProcesses - we want it to keep running
        // Only track it for logging purposes

        // Write stdout to log file only (not to activation logs)
        comfyProcess.stdout?.on('data', (data) => {
          logStream.write(data); // Write raw data to comfy-logs.txt only
        });

        // Write stderr to log file only (not to activation logs)
        comfyProcess.stderr?.on('data', (data) => {
          logStream.write(data); // Write raw data to comfy-logs.txt only
        });

        comfyProcess.on('error', (error) => {
          sendLog(controller, encoder, `[ERROR] Failed to launch ComfyUI: ${error.message}`, logFilePath);
          logStream.end();
        });

        comfyProcess.on('close', (code) => {
          // Don't remove from runningProcesses since it's not tracked there
          if (code !== 0 && code !== null && !isCancelled) {
            sendLog(controller, encoder, `[INFO] ComfyUI process exited with code ${code}`, logFilePath);
          }
          // Close the log stream when process exits
          logStream.end();
        });

        // Keep the stream open to continue receiving logs
        if (!isCancelled) {
          sendLog(controller, encoder, `[APP] ComfyUI server started successfully`, logFilePath);
          
          // Start watching comfy-logs.txt file and stream new lines
          let comfyLogLastLineCount = 0;
          let comfyLogLastModified = existsSync(comfyLogFile) ? statSync(comfyLogFile).mtimeMs : 0;
          
          // Read existing comfy logs
          if (existsSync(comfyLogFile)) {
            const fileContent = readFileSync(comfyLogFile, 'utf-8');
            const lines = fileContent.split('\n').filter(line => line.trim());
            for (const line of lines) {
              if (line.trim()) {
                // Add [COMFY] tag if not already present
                const messageToSend = line.match(/^\[COMFY\]/) ? line : `[COMFY] ${line}`;
                sendLog(controller, encoder, messageToSend, logFilePath);
              }
            }
            comfyLogLastLineCount = lines.length;
          }
          
          // Watch for new comfy logs
          const comfyLogWatchInterval = setInterval(() => {
            try {
              if (existsSync(comfyLogFile)) {
                const stats = statSync(comfyLogFile);
                const currentModified = stats.mtimeMs;
                const currentContent = readFileSync(comfyLogFile, 'utf-8');
                const lines = currentContent.split('\n').filter(line => line.trim());
                const currentLineCount = lines.length;
                
                // If file was modified
                if (currentModified !== comfyLogLastModified) {
                  if (currentLineCount < comfyLogLastLineCount) {
                    // File was cleared, reset
                    comfyLogLastLineCount = 0;
                  } else if (currentLineCount > comfyLogLastLineCount) {
                    // New lines added, send only the new ones
                    const newLines = lines.slice(comfyLogLastLineCount);
                    for (const line of newLines) {
                      if (line.trim()) {
                        // Add [COMFY] tag if not already present
                        const messageToSend = line.match(/^\[COMFY\]/) ? line : `[COMFY] ${line}`;
                        sendLog(controller, encoder, messageToSend, logFilePath);
                      }
                    }
                  }
                  
                  comfyLogLastLineCount = currentLineCount;
                  comfyLogLastModified = currentModified;
                }
              }
            } catch (error) {
              console.error('Error reading comfy log file:', error);
            }
          }, 500); // Check every 500ms
          
          // Cleanup comfy log watcher on stream close
          request.signal.addEventListener('abort', () => {
            clearInterval(comfyLogWatchInterval);
          });
        }

      } catch (error: any) {
        sendLog(controller, encoder, `[ERROR] Activation failed: ${error.message}`, logFilePath);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
