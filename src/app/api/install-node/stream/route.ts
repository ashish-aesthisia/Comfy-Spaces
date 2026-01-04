import { NextRequest } from 'next/server';
import { join } from 'path';
import { spawn, execFile } from 'child_process';
import { existsSync, appendFileSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);

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

    const historyPath = join(spacePath, 'requirements_history');
    if (!existsSync(historyPath)) {
      await mkdir(historyPath, { recursive: true });
    }

    const requirementsContent = await readFile(requirementsPath, 'utf-8');
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

function sendLog(controller: ReadableStreamDefaultController, encoder: TextEncoder, message: string, logFile?: string) {
  const timestamp = new Date().toISOString();
  const logEntry = { message, timestamp };
  const data = JSON.stringify(logEntry) + '\n\n';
  controller.enqueue(encoder.encode(`data: ${data}`));
  
  if (logFile) {
    try {
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

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();
  const searchParams = request.nextUrl.searchParams;
  const githubUrl = searchParams.get('githubUrl');
  const commitId = searchParams.get('commitId');
  const branch = searchParams.get('branch');
  const selectedDeps = searchParams.get('selectedDeps'); // JSON string of selected dependencies

  if (!githubUrl) {
    return new Response('githubUrl parameter is required', { status: 400 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const spacesPath = join(process.cwd(), 'spaces');
      const selectedVersionPath = join(spacesPath, 'selected_version.txt');
      let selectedVersion = 'v1';
      try {
        const selectedContent = await readFile(selectedVersionPath, 'utf-8');
        selectedVersion = selectedContent.trim() || 'v1';
      } catch (error) {
        // Default to v1 if file doesn't exist
      }

      const spacePath = join(spacesPath, selectedVersion);
      const spaceJsonPath = join(spacePath, 'space.json');
      const requirementsPath = join(spacePath, 'requirements.txt');
      const logFilePath = join(spacePath, 'comfy-logs.txt');

      try {
        // Parse selected dependencies
        let dependenciesToInstall: Array<{ name: string; version?: string }> = [];
        if (selectedDeps) {
          try {
            dependenciesToInstall = JSON.parse(selectedDeps);
          } catch (error) {
            sendLog(controller, encoder, `[WARN] Failed to parse selected dependencies`, logFilePath);
          }
        }

        // Extract node name from GitHub URL
        const urlMatch = githubUrl.match(/github\.com\/([^\/]+)\/([^\/\.]+)/);
        if (!urlMatch) {
          sendLog(controller, encoder, `[ERROR] Invalid GitHub URL format`, logFilePath);
          controller.close();
          return;
        }

        const nodeName = urlMatch[2];
        const nodesPath = join(spacePath, 'ComfyUI', 'custom_nodes');
        const nodePath = join(nodesPath, nodeName);

        // Ensure nodes directory exists
        if (!existsSync(nodesPath)) {
          mkdirSync(nodesPath, { recursive: true });
        }

        // Check if this is an update (node already exists and is a git repo)
        const isUpdate = existsSync(nodePath) && existsSync(join(nodePath, '.git'));

        if (isUpdate) {
          sendLog(controller, encoder, `[APP] Updating existing node: ${nodeName}`, logFilePath);
          
          // Step 1: Fetch latest changes
          sendLog(controller, encoder, `[APP] Fetching latest changes...`, logFilePath);
          try {
            await execFileAsync('git', ['fetch', 'origin'], { cwd: nodePath });
            sendLog(controller, encoder, `[APP] Fetched latest changes successfully`, logFilePath);
          } catch (error: any) {
            sendLog(controller, encoder, `[ERROR] Failed to fetch updates: ${error.message}`, logFilePath);
            controller.close();
            return;
          }

          // Step 2: Checkout specific commit or branch
          if (commitId) {
            sendLog(controller, encoder, `[APP] Checking out commit ${commitId}...`, logFilePath);
            try {
              await execFileAsync('git', ['checkout', commitId], { cwd: nodePath });
              sendLog(controller, encoder, `[APP] Checked out commit ${commitId} successfully`, logFilePath);
            } catch (error: any) {
              sendLog(controller, encoder, `[ERROR] Failed to checkout commit: ${error.message}`, logFilePath);
              controller.close();
              return;
            }
          } else if (branch) {
            sendLog(controller, encoder, `[APP] Checking out branch ${branch}...`, logFilePath);
            try {
              await execFileAsync('git', ['checkout', branch], { cwd: nodePath });
              sendLog(controller, encoder, `[APP] Checked out branch ${branch} successfully`, logFilePath);
              
              // Pull latest changes for the branch
              sendLog(controller, encoder, `[APP] Pulling latest changes...`, logFilePath);
              await execFileAsync('git', ['pull', 'origin', branch], { cwd: nodePath });
              sendLog(controller, encoder, `[APP] Pulled latest changes successfully`, logFilePath);
            } catch (error: any) {
              sendLog(controller, encoder, `[ERROR] Failed to checkout/pull branch: ${error.message}`, logFilePath);
              controller.close();
              return;
            }
          } else {
            // No commit or branch specified, pull current branch
            sendLog(controller, encoder, `[APP] Pulling latest changes...`, logFilePath);
            try {
              await execFileAsync('git', ['pull'], { cwd: nodePath });
              sendLog(controller, encoder, `[APP] Pulled latest changes successfully`, logFilePath);
            } catch (error: any) {
              sendLog(controller, encoder, `[ERROR] Failed to pull changes: ${error.message}`, logFilePath);
              controller.close();
              return;
            }
          }
        } else {
          // New installation
          sendLog(controller, encoder, `[APP] Starting installation of node: ${nodeName}`, logFilePath);

          // Step 1: Clone the repository
          sendLog(controller, encoder, `[APP] Cloning repository...`, logFilePath);
          try {
            let cloneUrl = githubUrl.trim();
            if (!cloneUrl.endsWith('.git')) {
              cloneUrl = cloneUrl.endsWith('/') ? `${cloneUrl}.git` : `${cloneUrl}.git`;
            }

            if (branch) {
              await execFileAsync('git', ['clone', '--branch', branch, '--depth', '1', cloneUrl, nodePath]);
            } else {
              await execFileAsync('git', ['clone', '--depth', '1', cloneUrl, nodePath]);
            }

            if (commitId && !branch) {
              await execFileAsync('git', ['checkout', commitId], { cwd: nodePath });
            }

            sendLog(controller, encoder, `[APP] Repository cloned successfully`, logFilePath);
          } catch (error: any) {
            sendLog(controller, encoder, `[ERROR] Failed to clone repository: ${error.message}`, logFilePath);
            controller.close();
            return;
          }
        }

        // Step 2: Update requirements.txt with selected dependencies FIRST
        sendLog(controller, encoder, `[APP] Updating requirements.txt with selected dependencies...`, logFilePath);
        
        let existingRequirements: string[] = [];
        if (existsSync(requirementsPath)) {
          const requirementsContent = await readFile(requirementsPath, 'utf-8');
          existingRequirements = requirementsContent
            .split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'));
        }

        // Add new dependencies
        const newDeps: string[] = [];
        if (dependenciesToInstall.length > 0) {
          dependenciesToInstall.forEach(dep => {
            const depString = dep.version ? `${dep.name}==${dep.version}` : dep.name;
            // Check if already exists (normalize package names for comparison)
            const normalizeName = (name: string) => name.toLowerCase().replace(/-/g, '_');
            const exists = existingRequirements.some(existing => {
              const existingName = normalizeName(existing.split(/[=<>!~]/)[0].trim());
              return existingName === normalizeName(dep.name);
            });
            if (!exists) {
              newDeps.push(depString);
              existingRequirements.push(depString);
            }
          });

          if (newDeps.length > 0) {
            const requirementsContent = existingRequirements.join('\n') + '\n';
            await writeFile(requirementsPath, requirementsContent, 'utf-8');
            sendLog(controller, encoder, `[APP] Added ${newDeps.length} dependencies to requirements.txt`, logFilePath);
          } else {
            sendLog(controller, encoder, `[APP] All selected dependencies already exist in requirements.txt`, logFilePath);
          }
        } else {
          sendLog(controller, encoder, `[APP] No dependencies to install`, logFilePath);
        }

        // Step 3: Update space.json with node details and dependencies
        sendLog(controller, encoder, `[APP] Updating space.json...`, logFilePath);
        if (existsSync(spaceJsonPath)) {
          try {
            const spaceJsonContent = await readFile(spaceJsonPath, 'utf-8');
            const spaceJson = JSON.parse(spaceJsonContent);

            // Update dependencies in space.json from requirements.txt
            if (existsSync(requirementsPath)) {
              const requirementsContent = await readFile(requirementsPath, 'utf-8');
              const allDeps = requirementsContent
                .split('\n')
                .map(line => line.trim())
                .filter(line => line && !line.startsWith('#'));
              spaceJson.dependencies = allDeps;
            }

            // Add node to nodes array
            if (!spaceJson.nodes) {
              spaceJson.nodes = [];
            }

            const nodeExists = spaceJson.nodes.some((node: any) => node.name === nodeName);
            if (!nodeExists) {
              spaceJson.nodes.push({
                name: nodeName,
                githubUrl: githubUrl,
                commitId: commitId || null,
                branch: branch || null,
                installedAt: new Date().toISOString(),
                disabled: false,
              });
            }

            await writeFile(spaceJsonPath, JSON.stringify(spaceJson, null, 2), 'utf-8');
            sendLog(controller, encoder, `[APP] space.json updated successfully`, logFilePath);
          } catch (error: any) {
            sendLog(controller, encoder, `[WARN] Error updating space.json: ${error.message}`, logFilePath);
          }
        }

        // Step 4: Install dependencies from requirements.txt
        // Determine Python executable (needed for ComfyUI launch later)
        const isWindows = process.platform === 'win32';
        const venvPath = join(spacePath, 'venv');
        let pythonExec = isWindows ? 'python' : 'python3';
        let pipExec = isWindows ? 'pip' : 'pip3';

        if (existsSync(venvPath)) {
          pythonExec = isWindows
            ? join(venvPath, 'Scripts', 'python.exe')
            : join(venvPath, 'bin', 'python3');
          pipExec = isWindows
            ? join(venvPath, 'Scripts', 'pip.exe')
            : join(venvPath, 'bin', 'pip3');
        }

        if (existsSync(requirementsPath)) {
          sendLog(controller, encoder, `[APP] Installing dependencies from requirements.txt...`, logFilePath);

          // Install from requirements.txt (which now includes all dependencies)
          const pipProcess = spawn(pipExec, ['install', '-r', requirementsPath], {
            cwd: spacePath,
            env: { ...process.env },
            shell: false,
          });

          pipProcess.stdout?.on('data', (data) => {
            const output = data.toString();
            sendLog(controller, encoder, output.trim(), logFilePath);
          });

          pipProcess.stderr?.on('data', (data) => {
            const output = data.toString();
            sendLog(controller, encoder, output.trim(), logFilePath);
          });

          const pipCode = await new Promise<number>((resolve) => {
            pipProcess.on('close', (code) => {
              resolve(code || 0);
            });
            pipProcess.on('error', () => {
              resolve(1);
            });
          });

          if (pipCode === 0) {
            sendLog(controller, encoder, `[APP] All dependencies from requirements.txt installed successfully`, logFilePath);
          } else {
            sendLog(controller, encoder, `[WARN] Some dependencies may have failed to install`, logFilePath);
          }
        } else {
          sendLog(controller, encoder, `[APP] No requirements.txt found, skipping dependency installation`, logFilePath);
        }

        // Step 5: Save requirements history snapshot
        await saveRequirementsHistory(spacePath, 'node_install', nodeName);

        // Step 6: Installation complete - signal frontend to restart ComfyUI
        sendLog(controller, encoder, `[APP] Node installation completed successfully`, logFilePath);
        sendLog(controller, encoder, `[APP] Restarting ComfyUI...`, logFilePath);
        
        // Send signal to frontend to restart ComfyUI
        sendLog(controller, encoder, `[INSTALL_COMPLETE]`, logFilePath);
        
        controller.close();
      } catch (error: any) {
        sendLog(controller, encoder, `[ERROR] ${error.message}`, logFilePath);
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
