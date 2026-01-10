import { NextResponse } from 'next/server';
import { spawn } from 'child_process';

interface DeviceInfo {
  device: string; // CPU or GPU
  gpuName: string; // GPU name or "NA"
  cudaVersion: string; // CUDA version or "NA"
}

function runCommand(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const childProcess = spawn(command, args, {
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
        resolve(output.trim());
      } else {
        reject(new Error(errorOutput || `Command failed with code ${code}`));
      }
    });

    childProcess.on('error', (error) => {
      reject(error);
    });
  });
}

async function getDeviceInfo(): Promise<DeviceInfo> {
  let device = 'CPU';
  let gpuName = 'NA';
  let cudaVersion = 'NA';

  // Check for GPU using nvidia-smi
  try {
    const nvidiaSmiOutput = await runCommand('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader']);
    if (nvidiaSmiOutput && nvidiaSmiOutput.trim()) {
      device = 'GPU';
      // Get first GPU name (in case of multiple GPUs)
      const gpuNames = nvidiaSmiOutput.trim().split('\n');
      gpuName = gpuNames[0] || 'NA';
    }
  } catch (error) {
    // nvidia-smi not available or failed, assume CPU
    device = 'CPU';
    gpuName = 'NA';
  }

  // Get CUDA version using nvcc
  try {
    const nvccOutput = await runCommand('nvcc', ['--version']);
    // nvcc --version output format:
    // nvcc: NVIDIA (R) Cuda compiler driver
    // Copyright (c) 2005-2024 NVIDIA Corporation
    // Built on ...
    // Cuda compilation tools, release 12.4, V12.4.xxx
    const versionMatch = nvccOutput.match(/release\s+(\d+\.\d+)/i);
    if (versionMatch) {
      cudaVersion = versionMatch[1];
    }
  } catch (error) {
    // nvcc not available or failed
    cudaVersion = 'NA';
  }

  return {
    device,
    gpuName,
    cudaVersion,
  };
}

export async function GET() {
  try {
    const deviceInfo = await getDeviceInfo();
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

