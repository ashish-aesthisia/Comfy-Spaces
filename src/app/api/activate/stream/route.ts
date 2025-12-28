import { NextRequest } from 'next/server';
import { join } from 'path';
import { spawn, exec } from 'child_process';
import { existsSync, appendFileSync, mkdirSync, writeFileSync, createWriteStream, readFileSync, statSync } from 'fs';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Helper function to add timeout to promises
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => 
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
    )
  ]);
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
      shell: true,
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
      shell: true,
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
        execAsync(`lsof -ti:${port}`),
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
          execAsync(`lsof -ti:${port}`),
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
      const revisionPath = join(process.cwd(), 'data', 'revisions', version);
      const venvPath = join(revisionPath, 'venv');
      const requirementsPath = join(revisionPath, 'requirements.txt');
      const logFilePath = join(revisionPath, 'logs.txt');
      const comfyUIPath = join(process.cwd(), 'ComfyUI');

      // Ensure log directory exists
      try {
        if (!existsSync(revisionPath)) {
          mkdirSync(revisionPath, { recursive: true });
        }
        // Clear or create log file
        writeFileSync(logFilePath, `=== Activation Log for ${version} - ${new Date().toISOString()} ===\n\n`);
      } catch (error) {
        console.error('Error setting up log file:', error);
      }

      // Clear ComfyUI log file at the start of activation
      const comfyLogFilePath = join(process.cwd(), 'data', 'comfy-logs.txt');
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
          const venvProcess = spawn('python3', ['-m', 'venv', venvPath], {
            cwd: revisionPath,
            env: { ...process.env },
            shell: true,
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
        const isWindows = process.platform === 'win32';
        const pythonExec = isWindows 
          ? join(venvPath, 'Scripts', 'python.exe')
          : join(venvPath, 'bin', 'python3');
        const pipExec = isWindows
          ? join(venvPath, 'Scripts', 'pip')
          : join(venvPath, 'bin', 'pip');

        // Display Python and pip versions
        sendLog(controller, encoder, `[APP] Python executable: ${pythonExec}`, logFilePath);
        try {
          const pythonVersion = await getVersion(pythonExec, ['--version'], revisionPath, process.env);
          sendLog(controller, encoder, `[APP] Python version: ${pythonVersion}`, logFilePath);
        } catch (error: any) {
          sendLog(controller, encoder, `[WARN] Could not get Python version: ${error.message}`, logFilePath);
        }

        sendLog(controller, encoder, `[APP] Pip executable: ${pipExec}`, logFilePath);
        try {
          const pipVersion = await getVersion(pipExec, ['--version'], revisionPath, process.env);
          sendLog(controller, encoder, `[APP] Pip version: ${pipVersion}`, logFilePath);
        } catch (error: any) {
          sendLog(controller, encoder, `[WARN] Could not get pip version: ${error.message}`, logFilePath);
        }

        if (isCancelled) {
          controller.close();
          return;
        }

        // Step 2: Install requirements
        if (existsSync(requirementsPath)) {
          sendLog(controller, encoder, `[APP] Installing requirements from requirements.txt...`, logFilePath);
          
          // Install requirements with process tracking
          const pipProcess = spawn(pipExec, ['install', '-r', requirementsPath], {
            cwd: revisionPath,
            env: { ...process.env },
            shell: true,
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
            sendLog(controller, encoder, `[ERROR] Failed to install requirements`, logFilePath);
            controller.close();
            return;
          }
          sendLog(controller, encoder, `[APP] Requirements installed successfully`, logFilePath);
        } else {
          sendLog(controller, encoder, `[WARN] requirements.txt not found, skipping installation`, logFilePath);
        }

        if (isCancelled) {
          controller.close();
          return;
        }

        // Step 3: Launch ComfyUI
        sendLog(controller, encoder, `[APP] Launching ComfyUI server...`, logFilePath);
        
        // Use the venv python to run ComfyUI
        // Check if there are environment variables for ComfyUI launch command
        let comfyUIArgs = ['main.py'];
        let comfyLogFile: string | null = null;
        let useSystemPython = false;
        
        // Check for COMFY_CMD first, then COMFYUI_LAUNCH_ARGS
        const comfyCmd = process.env.COMFY_CMD || process.env.COMFYUI_LAUNCH_ARGS;
        if (comfyCmd) {
          // Parse the command - handle shell redirection like "> ./data/comfy-logs.txt"
          const parts = comfyCmd.trim().split(/\s+/);
          const args: string[] = [];
          let foundRedirect = false;
          
          for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (part === '>' && i + 1 < parts.length) {
              // Found redirection operator, next part is the log file
              comfyLogFile = parts[i + 1];
              foundRedirect = true;
              break;
            } else if (part.startsWith('>')) {
              // Redirection without space: ">file.txt"
              comfyLogFile = part.substring(1);
              foundRedirect = true;
              break;
            } else if (part === 'python3' || part === 'python') {
              // If using system python, note it but we'll still use venv python
              useSystemPython = (part === 'python3');
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
          if (comfyLogFile) {
            sendLog(controller, encoder, `[APP] ComfyUI output will be logged to: ${comfyLogFile}`, logFilePath);
          }
        }
        
        // Default log file if not specified
        if (!comfyLogFile) {
          comfyLogFile = join(process.cwd(), 'data', 'comfy-logs.txt');
        } else {
          // Resolve relative paths (handle ./ and ../)
          if (!comfyLogFile.startsWith('/')) {
            // Remove leading ./ if present
            const cleanPath = comfyLogFile.startsWith('./') ? comfyLogFile.substring(2) : comfyLogFile;
            comfyLogFile = join(process.cwd(), cleanPath);
          }
        }
        
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
            shell: true,
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

