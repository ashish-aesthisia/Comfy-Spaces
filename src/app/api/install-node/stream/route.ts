import { NextRequest } from 'next/server';
import { join } from 'path';
import { spawn } from 'child_process';
import { existsSync, appendFileSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

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

        // Check if node already exists
        if (existsSync(nodePath)) {
          sendLog(controller, encoder, `[ERROR] Node ${nodeName} already exists. Use the update feature instead.`, logFilePath);
          controller.close();
          return;
        }

        sendLog(controller, encoder, `[APP] Starting installation of node: ${nodeName}`, logFilePath);

        // Step 1: Clone the repository
        sendLog(controller, encoder, `[APP] Cloning repository...`, logFilePath);
        try {
          let cloneUrl = githubUrl.trim();
          if (!cloneUrl.endsWith('.git')) {
            cloneUrl = cloneUrl.endsWith('/') ? `${cloneUrl}.git` : `${cloneUrl}.git`;
          }

          if (branch) {
            await execAsync(`git clone --branch ${branch} --depth 1 ${cloneUrl} ${nodePath}`);
          } else {
            await execAsync(`git clone --depth 1 ${cloneUrl} ${nodePath}`);
          }

          if (commitId && !branch) {
            await execAsync(`git checkout ${commitId}`, { cwd: nodePath });
          }

          sendLog(controller, encoder, `[APP] Repository cloned successfully`, logFilePath);
        } catch (error: any) {
          sendLog(controller, encoder, `[ERROR] Failed to clone repository: ${error.message}`, logFilePath);
          controller.close();
          return;
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
        sendLog(controller, encoder, `[APP] Installing dependencies from requirements.txt...`, logFilePath);

        // Determine Python executable
        const isWindows = process.platform === 'win32';
        const venvPath = join(spacePath, 'venv');
        let pythonExec = 'python3';
        let pipExec = 'pip3';

        if (existsSync(venvPath)) {
          pythonExec = isWindows
            ? join(venvPath, 'Scripts', 'python.exe')
            : join(venvPath, 'bin', 'python3');
          pipExec = isWindows
            ? join(venvPath, 'Scripts', 'pip.exe')
            : join(venvPath, 'bin', 'pip3');
        }

        // Install from requirements.txt (which now includes all dependencies)
        if (existsSync(requirementsPath)) {
          const pipProcess = spawn(pipExec, ['install', '-r', requirementsPath], {
            cwd: spacePath,
            env: { ...process.env },
            shell: true,
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
          sendLog(controller, encoder, `[WARN] requirements.txt not found, skipping dependency installation`, logFilePath);
        }

        // Step 5: Activate ComfyUI
        sendLog(controller, encoder, `[APP] Starting ComfyUI activation...`, logFilePath);

        // Step 5: Activate ComfyUI (similar to activate/stream)
        sendLog(controller, encoder, `[APP] Starting ComfyUI activation...`, logFilePath);
        
        const comfyUIPath = join(spacePath, 'ComfyUI');
        const mainPyPath = join(comfyUIPath, 'main.py');
        const comfyLogFile = join(spacePath, 'comfy-logs.txt');

        if (!existsSync(mainPyPath)) {
          sendLog(controller, encoder, `[ERROR] ComfyUI main.py not found`, logFilePath);
          controller.close();
          return;
        }

        // Check for custom ComfyUI launch command
        let comfyUIArgs = ['main.py'];
        const comfyCmd = process.env.COMFY_CMD || process.env.COMFYUI_LAUNCH_ARGS;
        if (comfyCmd) {
          const parts = comfyCmd.trim().split(/\s+/);
          const args: string[] = [];
          for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (part === '>' || part.startsWith('>')) {
              i++; // Skip redirection
              continue;
            } else if (part === 'python3' || part === 'python') {
              continue;
            } else {
              args.push(part);
            }
          }
          if (args.length > 0) {
            comfyUIArgs = args;
          }
        }

        // Ensure log file directory exists
        const logFileDir = join(comfyLogFile, '..');
        if (!existsSync(logFileDir)) {
          mkdirSync(logFileDir, { recursive: true });
        }

        // Launch ComfyUI in detached mode
        const comfyProcess = spawn(pythonExec, comfyUIArgs, {
          cwd: comfyUIPath,
          env: { ...process.env },
          shell: false,
          detached: false,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        // Write to log file
        const { createWriteStream } = require('fs');
        const logStream = createWriteStream(comfyLogFile, { flags: 'a' });

        comfyProcess.stdout?.on('data', (data) => {
          logStream.write(data);
        });

        comfyProcess.stderr?.on('data', (data) => {
          logStream.write(data);
        });

        comfyProcess.on('error', (error) => {
          sendLog(controller, encoder, `[ERROR] Failed to launch ComfyUI: ${error.message}`, logFilePath);
          logStream.end();
        });

        // Wait a bit to see if ComfyUI starts successfully
        await new Promise(resolve => setTimeout(resolve, 3000));

        sendLog(controller, encoder, `[APP] ComfyUI server started successfully`, logFilePath);
        sendLog(controller, encoder, `[APP] Node installation and activation completed successfully`, logFilePath);
        sendLog(controller, encoder, `[APP] Redirecting to space page...`, logFilePath);
        
        // Send completion signal
        sendLog(controller, encoder, `[COMPLETE]`, logFilePath);
        
        logStream.end();
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

