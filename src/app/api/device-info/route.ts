import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { join } from 'path';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';

interface DeviceInfo {
  device: string; // CPU or GPU
  gpuName: string; // GPU name or "NA"
  cudaVersion: string; // CUDA version or "NA"
}

function getDeviceInfo(
  pythonExec: string,
  cwd: string
): Promise<DeviceInfo> {
  return new Promise((resolve, reject) => {
    // Python script to detect device info using torch
    const pythonScript = `
import sys
try:
    import torch
    if torch.cuda.is_available():
        device = "GPU"
        gpu_name = torch.cuda.get_device_name(0) if torch.cuda.device_count() > 0 else "NA"
        cuda_version = torch.version.cuda if torch.version.cuda else "NA"
    else:
        device = "CPU"
        gpu_name = "NA"
        cuda_version = "NA"
    print(f"{device}|{gpu_name}|{cuda_version}")
except ImportError:
    # torch not installed, default to CPU
    print("CPU|NA|NA")
except Exception as e:
    print(f"CPU|NA|NA", file=sys.stderr)
    sys.exit(1)
`;

    const childProcess = spawn(pythonExec, ['-c', pythonScript], {
      cwd,
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
      if (code === 0 || output.trim()) {
        try {
          const result = output.trim().split('|');
          if (result.length === 3) {
            resolve({
              device: result[0],
              gpuName: result[1],
              cudaVersion: result[2],
            });
          } else {
            // Fallback to CPU if parsing fails
            resolve({
              device: 'CPU',
              gpuName: 'NA',
              cudaVersion: 'NA',
            });
          }
        } catch (error) {
          // Fallback to CPU on error
          resolve({
            device: 'CPU',
            gpuName: 'NA',
            cudaVersion: 'NA',
          });
        }
      } else {
        // Fallback to CPU on error
        resolve({
          device: 'CPU',
          gpuName: 'NA',
          cudaVersion: 'NA',
        });
      }
    });

    childProcess.on('error', (error) => {
      // Fallback to CPU on error
      resolve({
        device: 'CPU',
        gpuName: 'NA',
        cudaVersion: 'NA',
      });
    });
  });
}

export async function GET() {
  try {
    // Get selected space to determine Python executable
    const spacesPath = join(process.cwd(), 'spaces');
    const selectedVersionPath = join(spacesPath, 'selected_version.txt');
    let selectedVersion = 'v1';
    try {
      const selectedContent = await readFile(selectedVersionPath, 'utf-8');
      selectedVersion = selectedContent.trim() || 'v1';
    } catch (error) {
      // Default to v1 if file doesn't exist
    }

    // Determine Python executable - use venv Python from selected space if available
    const isWindows = process.platform === 'win32';
    const venvPath = join(spacesPath, selectedVersion, 'venv');
    let pythonExec = isWindows ? 'python' : 'python3';
    
    if (existsSync(venvPath)) {
      pythonExec = isWindows
        ? join(venvPath, 'Scripts', 'python.exe')
        : join(venvPath, 'bin', 'python3');
    }

    const spacePath = join(spacesPath, selectedVersion);
    const deviceInfo = await getDeviceInfo(pythonExec, spacePath);

    return NextResponse.json(deviceInfo);
  } catch (error) {
    console.error('Error getting device info:', error);
    // Return default CPU info on error
    return NextResponse.json({
      device: 'CPU',
      gpuName: 'NA',
      cudaVersion: 'NA',
    });
  }
}

