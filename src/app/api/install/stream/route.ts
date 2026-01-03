import { NextRequest } from 'next/server';
import { join } from 'path';
import { spawn } from 'child_process';
import { existsSync, mkdirSync, appendFileSync } from 'fs';
import { readFile } from 'fs/promises';

function sendLog(controller: ReadableStreamDefaultController, encoder: TextEncoder, message: string) {
  const timestamp = new Date().toISOString();
  const logEntry = { message, timestamp };
  const data = JSON.stringify(logEntry) + '\n\n';
  controller.enqueue(encoder.encode(`data: ${data}`));
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder
): Promise<number> {
  return new Promise((resolve, reject) => {
    const childProcess = spawn(command, args, {
      cwd,
      env: { ...process.env },
      shell: true,
    });

    childProcess.stdout?.on('data', (data) => {
      const output = data.toString();
      sendLog(controller, encoder, output.trim());
    });

    childProcess.stderr?.on('data', (data) => {
      const output = data.toString();
      sendLog(controller, encoder, output.trim());
    });

    childProcess.on('close', (code) => {
      resolve(code || 0);
    });

    childProcess.on('error', (error) => {
      sendLog(controller, encoder, `[APP] Error: ${error.message}`);
      reject(error);
    });
  });
}

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();
  const searchParams = request.nextUrl.searchParams;
  const nodeName = searchParams.get('nodeName');

  if (!nodeName) {
    return new Response('nodeName parameter is required', { status: 400 });
  }

  // Get parameters from request body or query params
  // We'll need to get them from the initial POST request, but for now we'll reconstruct
  // In a real implementation, you might want to store this in a temporary file or session
  const githubUrl = searchParams.get('githubUrl') || '';
  const commitId = searchParams.get('commitId') || '';
  const branch = searchParams.get('branch') || '';

  const stream = new ReadableStream({
    async start(controller) {
      // Get selected space
      const spacesPath = join(process.cwd(), 'spaces');
      const selectedVersionPath = join(spacesPath, 'selected_version.txt');
      let selectedVersion = 'v1';
      try {
        const selectedContent = await readFile(selectedVersionPath, 'utf-8');
        selectedVersion = selectedContent.trim() || 'v1';
      } catch (error) {
        // Default to v1 if file doesn't exist
      }

      const nodesPath = join(spacesPath, selectedVersion, 'ComfyUI', 'custom_nodes');
      const nodePath = join(nodesPath, nodeName);

      // Ensure nodes directory exists
      if (!existsSync(nodesPath)) {
        mkdirSync(nodesPath, { recursive: true });
      }

      // Track running processes for cancellation
      const runningProcesses: Array<{ process: any; kill: () => void }> = [];
      let isCancelled = false;

      // Handle cancellation
      request.signal.addEventListener('abort', () => {
        isCancelled = true;
        sendLog(controller, encoder, `[APP] Clone cancelled by user`);
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
        const isUpdate = existsSync(nodePath) && existsSync(join(nodePath, '.git'));
        
        if (!isUpdate) {
          sendLog(controller, encoder, `[ERROR] Node ${nodeName} does not exist. New installations are not supported.`);
          controller.close();
          return;
        }

        sendLog(controller, encoder, `[APP] Updating existing node ${nodeName}...`);

        if (isCancelled) {
          controller.close();
          return;
        }

        // Update existing repository
        // First, fetch latest changes
        sendLog(controller, encoder, `[APP] Fetching latest changes...`);
          const fetchProcess = spawn('git', ['fetch', 'origin'], {
            cwd: nodePath,
            env: { 
              ...process.env,
              GIT_TERMINAL_PROMPT: '0',
            },
            shell: true,
          });

          const fetchProcessKill = () => {
            if (!fetchProcess.killed) {
              fetchProcess.kill('SIGTERM');
            }
          };
          runningProcesses.push({ process: fetchProcess, kill: fetchProcessKill });

          fetchProcess.stdout?.on('data', (data) => {
            sendLog(controller, encoder, data.toString().trim());
          });

          fetchProcess.stderr?.on('data', (data) => {
            sendLog(controller, encoder, data.toString().trim());
          });

          const fetchCode = await new Promise<number>((resolve) => {
            fetchProcess.on('close', (code) => {
              const index = runningProcesses.findIndex(p => p.process === fetchProcess);
              if (index !== -1) {
                runningProcesses.splice(index, 1);
              }
              resolve(code || 0);
            });
            fetchProcess.on('error', () => {
              const index = runningProcesses.findIndex(p => p.process === fetchProcess);
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

          if (fetchCode !== 0) {
            sendLog(controller, encoder, `[ERROR] Failed to fetch updates`);
            controller.close();
            return;
          }

          // Checkout specific commit or branch
          if (commitId) {
            sendLog(controller, encoder, `[APP] Checking out commit ${commitId}...`);
            const checkoutArgs = ['checkout', commitId];
            const checkoutProcess = spawn('git', checkoutArgs, {
              cwd: nodePath,
              env: { ...process.env },
              shell: true,
            });

            const checkoutProcessKill = () => {
              if (!checkoutProcess.killed) {
                checkoutProcess.kill('SIGTERM');
              }
            };
            runningProcesses.push({ process: checkoutProcess, kill: checkoutProcessKill });

            checkoutProcess.stdout?.on('data', (data) => {
              sendLog(controller, encoder, data.toString().trim());
            });

            checkoutProcess.stderr?.on('data', (data) => {
              sendLog(controller, encoder, data.toString().trim());
            });

            const checkoutCode = await new Promise<number>((resolve) => {
              checkoutProcess.on('close', (code) => {
                const index = runningProcesses.findIndex(p => p.process === checkoutProcess);
                if (index !== -1) {
                  runningProcesses.splice(index, 1);
                }
                resolve(code || 0);
              });
              checkoutProcess.on('error', () => {
                const index = runningProcesses.findIndex(p => p.process === checkoutProcess);
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

            if (checkoutCode !== 0) {
              sendLog(controller, encoder, `[ERROR] Failed to checkout commit ${commitId}`);
              controller.close();
              return;
            }

            sendLog(controller, encoder, `[APP] Checked out commit ${commitId} successfully`);
          } else if (branch) {
            sendLog(controller, encoder, `[APP] Checking out branch ${branch}...`);
            const checkoutArgs = ['checkout', branch];
            const checkoutProcess = spawn('git', checkoutArgs, {
              cwd: nodePath,
              env: { ...process.env },
              shell: true,
            });

            const checkoutProcessKill = () => {
              if (!checkoutProcess.killed) {
                checkoutProcess.kill('SIGTERM');
              }
            };
            runningProcesses.push({ process: checkoutProcess, kill: checkoutProcessKill });

            checkoutProcess.stdout?.on('data', (data) => {
              sendLog(controller, encoder, data.toString().trim());
            });

            checkoutProcess.stderr?.on('data', (data) => {
              sendLog(controller, encoder, data.toString().trim());
            });

            const checkoutCode = await new Promise<number>((resolve) => {
              checkoutProcess.on('close', (code) => {
                const index = runningProcesses.findIndex(p => p.process === checkoutProcess);
                if (index !== -1) {
                  runningProcesses.splice(index, 1);
                }
                resolve(code || 0);
              });
              checkoutProcess.on('error', () => {
                const index = runningProcesses.findIndex(p => p.process === checkoutProcess);
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

            if (checkoutCode !== 0) {
              sendLog(controller, encoder, `[ERROR] Failed to checkout branch ${branch}`);
              controller.close();
              return;
            }

            // Pull latest changes for the branch
            sendLog(controller, encoder, `[APP] Pulling latest changes...`);
            const pullProcess = spawn('git', ['pull', 'origin', branch], {
              cwd: nodePath,
              env: { ...process.env },
              shell: true,
            });

            const pullProcessKill = () => {
              if (!pullProcess.killed) {
                pullProcess.kill('SIGTERM');
              }
            };
            runningProcesses.push({ process: pullProcess, kill: pullProcessKill });

            pullProcess.stdout?.on('data', (data) => {
              sendLog(controller, encoder, data.toString().trim());
            });

            pullProcess.stderr?.on('data', (data) => {
              sendLog(controller, encoder, data.toString().trim());
            });

            const pullCode = await new Promise<number>((resolve) => {
              pullProcess.on('close', (code) => {
                const index = runningProcesses.findIndex(p => p.process === pullProcess);
                if (index !== -1) {
                  runningProcesses.splice(index, 1);
                }
                resolve(code || 0);
              });
              pullProcess.on('error', () => {
                const index = runningProcesses.findIndex(p => p.process === pullProcess);
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

            if (pullCode !== 0) {
              sendLog(controller, encoder, `[ERROR] Failed to pull latest changes`);
              controller.close();
              return;
            }

            sendLog(controller, encoder, `[APP] Pulled latest changes successfully`);
          } else {
            // No commit or branch specified, pull current branch
            sendLog(controller, encoder, `[APP] Pulling latest changes...`);
            const pullProcess = spawn('git', ['pull'], {
              cwd: nodePath,
              env: { ...process.env },
              shell: true,
            });

            const pullProcessKill = () => {
              if (!pullProcess.killed) {
                pullProcess.kill('SIGTERM');
              }
            };
            runningProcesses.push({ process: pullProcess, kill: pullProcessKill });

            pullProcess.stdout?.on('data', (data) => {
              sendLog(controller, encoder, data.toString().trim());
            });

            pullProcess.stderr?.on('data', (data) => {
              sendLog(controller, encoder, data.toString().trim());
            });

            const pullCode = await new Promise<number>((resolve) => {
              pullProcess.on('close', (code) => {
                const index = runningProcesses.findIndex(p => p.process === pullProcess);
                if (index !== -1) {
                  runningProcesses.splice(index, 1);
                }
                resolve(code || 0);
              });
              pullProcess.on('error', () => {
                const index = runningProcesses.findIndex(p => p.process === pullProcess);
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

            if (pullCode !== 0) {
              sendLog(controller, encoder, `[ERROR] Failed to pull latest changes`);
              controller.close();
              return;
            }

            sendLog(controller, encoder, `[APP] Pulled latest changes successfully`);
          }

          sendLog(controller, encoder, `[APP] Update completed successfully`);
          controller.close();
          return;
      } catch (error: any) {
        sendLog(controller, encoder, `[ERROR] Update failed: ${error.message}`);
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

