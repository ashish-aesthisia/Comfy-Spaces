import { NextResponse } from 'next/server';
import { spawn } from 'child_process';

interface PythonVersion {
  version: string;
  command: string;
  path?: string;
}

function checkPythonVersion(command: string): Promise<PythonVersion | null> {
  return new Promise((resolve) => {
    const childProcess = spawn(command, ['--version'], {
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

    childProcess.on('close', (code) => {
      if (code === 0) {
        // Parse version from output (format: "Python 3.11.5" or "Python 3.11.5\n")
        const versionMatch = (output || errorOutput).match(/Python\s+(\d+\.\d+)/);
        if (versionMatch) {
          resolve({
            version: versionMatch[1],
            command: command,
          });
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
}

export async function GET() {
  try {
    const isWindows = process.platform === 'win32';
    const candidates: string[] = [];

    if (isWindows) {
      // Windows: try py launcher with different versions
      candidates.push('py -3.13', 'py -3.12', 'py -3.11', 'py -3.10', 'py -3.9', 'py -3.8', 'py -3');
      candidates.push('python3.13', 'python3.12', 'python3.11', 'python3.10', 'python3.9', 'python3.8');
      candidates.push('python');
    } else {
      // Unix-like: try python3.x versions
      candidates.push('python3.13', 'python3.12', 'python3.11', 'python3.10', 'python3.9', 'python3.8', 'python3');
    }

    const foundVersions = new Map<string, PythonVersion>();

    // Check all candidates
    for (const candidate of candidates) {
      const parts = candidate.split(' ');
      const command = parts[0];
      const args = parts.slice(1);
      
      // For 'py -3.x', we need to handle it differently
      if (command === 'py' && args.length > 0) {
        // Use spawn with command and args separately
        const version = await new Promise<PythonVersion | null>((resolve) => {
          const childProcess = spawn('py', args, {
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

          childProcess.on('close', (code) => {
            if (code === 0) {
              const versionMatch = (output || errorOutput).match(/Python\s+(\d+\.\d+)/);
              if (versionMatch) {
                // Extract version from py -3.11 -> 3.11
                const argVersionMatch = args[0].match(/(\d+\.\d+)/);
                const versionKey = argVersionMatch ? argVersionMatch[1] : versionMatch[1];
                resolve({
                  version: versionKey,
                  command: candidate,
                });
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
          if (!foundVersions.has(version.version)) {
            foundVersions.set(version.version, version);
          }
        }
      } else {
        const version = await checkPythonVersion(command);
        if (version) {
          if (!foundVersions.has(version.version)) {
            foundVersions.set(version.version, version);
          }
        }
      }
    }

    // Convert to array and sort by version (newest first)
    const versions = Array.from(foundVersions.values()).sort((a, b) => {
      const aParts = a.version.split('.').map(Number);
      const bParts = b.version.split('.').map(Number);
      for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
        const aPart = aParts[i] || 0;
        const bPart = bParts[i] || 0;
        if (bPart !== aPart) {
          return bPart - aPart;
        }
      }
      return 0;
    });

    return NextResponse.json({
      versions: versions.map(v => ({
        value: v.version,
        label: `Python ${v.version}`,
        command: v.command,
      })),
    });
  } catch (error) {
    console.error('Error detecting Python versions:', error);
    // Fallback to common versions if detection fails
    return NextResponse.json({
      versions: [
        { value: '3.13', label: 'Python 3.13', command: 'python3.13' },
        { value: '3.12', label: 'Python 3.12', command: 'python3.12' },
        { value: '3.11', label: 'Python 3.11', command: 'python3.11' },
        { value: '3.10', label: 'Python 3.10', command: 'python3.10' },
        { value: '3.9', label: 'Python 3.9', command: 'python3.9' },
        { value: '3.8', label: 'Python 3.8', command: 'python3.8' },
      ],
    });
  }
}

