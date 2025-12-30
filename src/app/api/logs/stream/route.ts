import { NextRequest } from 'next/server';
import { readFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();
  const searchParams = request.nextUrl.searchParams;
  const version = searchParams.get('version');
  
  const stream = new ReadableStream({
    async start(controller) {
      const sendLog = (message: string, timestamp?: string) => {
        const logEntry = {
          message,
          timestamp: timestamp || new Date().toISOString()
        };
        const data = JSON.stringify(logEntry) + '\n\n';
        controller.enqueue(encoder.encode(`data: ${data}`));
      };

      // Send initial connection message
      sendLog('Log stream connected');

      // If version is provided, read from the activation log file
      if (version) {
        const spacePath = join(process.cwd(), 'spaces', version);
        const logFilePath = join(spacePath, 'logs.txt');
        const comfyLogFilePath = join(spacePath, 'comfy-logs.txt');

        try {
          // Helper function to watch a log file
          const watchLogFile = (
            filePath: string,
            fileLabel: string,
            parseTimestamp: boolean = true,
            addTag: string | null = null
          ) => {
            // Read existing logs from file
            let lastLineCount = 0;
            if (existsSync(filePath)) {
              const fileContent = readFileSync(filePath, 'utf-8');
              const lines = fileContent.split('\n').filter(line => line.trim());
              
              // Parse and send existing logs
              for (const line of lines) {
                let messageToSend = line;
                if (parseTimestamp) {
                  // Parse log format: [timestamp] message
                  const timestampMatch = line.match(/^\[([^\]]+)\]\s*(.+)$/);
                  if (timestampMatch) {
                    const [, timestamp, message] = timestampMatch;
                    messageToSend = message;
                    // If message already has the tag, keep it; otherwise add the tag if specified
                    if (addTag && !messageToSend.match(new RegExp(`^\\[${addTag}\\]`))) {
                      messageToSend = `[${addTag}] ${messageToSend}`;
                    }
                    sendLog(messageToSend, timestamp);
                  } else {
                    // If no timestamp, add tag if specified
                    if (addTag && !messageToSend.match(new RegExp(`^\\[${addTag}\\]`))) {
                      messageToSend = `[${addTag}] ${messageToSend}`;
                    }
                    sendLog(messageToSend);
                  }
                } else {
                  // For comfy-logs.txt, add [COMFY] tag if not already present
                  if (addTag && !messageToSend.match(new RegExp(`^\\[${addTag}\\]`))) {
                    messageToSend = `[${addTag}] ${messageToSend}`;
                  }
                  sendLog(messageToSend);
                }
              }
              lastLineCount = lines.length;
            }

            // Watch for file changes and stream new logs
            let lastModified = existsSync(filePath) ? statSync(filePath).mtimeMs : 0;
            
            const watchInterval = setInterval(async () => {
              try {
                if (existsSync(filePath)) {
                  const stats = statSync(filePath);
                  const currentModified = stats.mtimeMs;
                  const currentContent = readFileSync(filePath, 'utf-8');
                  const lines = currentContent.split('\n').filter(line => line.trim());
                  const currentLineCount = lines.length;
                  
                  // If file was modified
                  if (currentModified !== lastModified) {
                    if (currentLineCount < lastLineCount) {
                      // File was cleared, send a message and then all new content
                      const clearMessage = addTag 
                        ? `[${addTag}] ${fileLabel} cleared, showing new logs...`
                        : `[APP] ${fileLabel} cleared, showing new logs...`;
                      sendLog(clearMessage);
                      // Send all lines from the cleared file
                      for (const line of lines) {
                        let messageToSend = line;
                        if (parseTimestamp) {
                          const timestampMatch = line.match(/^\[([^\]]+)\]\s*(.+)$/);
                          if (timestampMatch) {
                            const [, timestamp, message] = timestampMatch;
                            messageToSend = message;
                            if (addTag && !messageToSend.match(new RegExp(`^\\[${addTag}\\]`))) {
                              messageToSend = `[${addTag}] ${messageToSend}`;
                            }
                            sendLog(messageToSend, timestamp);
                          } else if (line.trim()) {
                            if (addTag && !messageToSend.match(new RegExp(`^\\[${addTag}\\]`))) {
                              messageToSend = `[${addTag}] ${messageToSend}`;
                            }
                            sendLog(messageToSend);
                          }
                        } else {
                          if (line.trim()) {
                            if (addTag && !messageToSend.match(new RegExp(`^\\[${addTag}\\]`))) {
                              messageToSend = `[${addTag}] ${messageToSend}`;
                            }
                            sendLog(messageToSend);
                          }
                        }
                      }
                    } else if (currentLineCount > lastLineCount) {
                      // New lines added, send only the new ones
                      const newLines = lines.slice(lastLineCount);
                      for (const line of newLines) {
                        let messageToSend = line;
                        if (parseTimestamp) {
                          const timestampMatch = line.match(/^\[([^\]]+)\]\s*(.+)$/);
                          if (timestampMatch) {
                            const [, timestamp, message] = timestampMatch;
                            messageToSend = message;
                            if (addTag && !messageToSend.match(new RegExp(`^\\[${addTag}\\]`))) {
                              messageToSend = `[${addTag}] ${messageToSend}`;
                            }
                            sendLog(messageToSend, timestamp);
                          } else if (line.trim()) {
                            if (addTag && !messageToSend.match(new RegExp(`^\\[${addTag}\\]`))) {
                              messageToSend = `[${addTag}] ${messageToSend}`;
                            }
                            sendLog(messageToSend);
                          }
                        } else {
                          if (line.trim()) {
                            if (addTag && !messageToSend.match(new RegExp(`^\\[${addTag}\\]`))) {
                              messageToSend = `[${addTag}] ${messageToSend}`;
                            }
                            sendLog(messageToSend);
                          }
                        }
                      }
                    }
                    
                    lastLineCount = currentLineCount;
                    lastModified = currentModified;
                  }
                } else {
                  // File doesn't exist yet, reset tracking
                  lastLineCount = 0;
                  lastModified = 0;
                }
              } catch (error) {
                console.error(`Error reading ${fileLabel}:`, error);
              }
            }, 500); // Check every 500ms

            return watchInterval;
          };

          // Watch activation logs (with timestamp parsing, add [APP] tag)
          const activationWatchInterval = watchLogFile(logFilePath, 'Activation log file', true, 'APP');
          
          // Watch ComfyUI logs (without timestamp parsing, add [COMFY] tag)
          const comfyWatchInterval = watchLogFile(comfyLogFilePath, 'ComfyUI log file', false, 'COMFY');

          // Cleanup on client disconnect
          request.signal.addEventListener('abort', () => {
            clearInterval(activationWatchInterval);
            clearInterval(comfyWatchInterval);
            controller.close();
          });
        } catch (error) {
          sendLog(`Error reading log file: ${error instanceof Error ? error.message : 'Unknown error'}`);
          controller.close();
        }
      } else {
        // No version provided, just send a message
        sendLog('No space version specified. Please provide version parameter.');
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

