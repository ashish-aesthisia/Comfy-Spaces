import { NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

type GpuInfo = { gpuName: string | null; cudaVersion: string | null };

function parseCudaVersion(output: string): string | null {
  const match = output.match(/CUDA Version:\s*([\d.]+)/i);
  return match?.[1] || null;
}

function parseGpuName(output: string): string | null {
  const line = output.split('\n').map((item) => item.trim()).find(Boolean);
  if (!line) return null;
  const match = line.match(/GPU\s+\d+:\s*(.+?)\s*\(/i);
  return match?.[1]?.trim() || line;
}

function scoreGpuName(name: string): number {
  const lower = name.toLowerCase();
  let score = 0;
  if (/(nvidia|geforce|rtx|gtx|quadro|tesla)/i.test(lower)) score += 4;
  if (/(amd|radeon|ati)/i.test(lower)) score += 3;
  if (/(radeon rx|radeon pro)/i.test(lower)) score += 2;
  if (/\barc\b/i.test(lower)) score += 2;
  if (/(intel|uhd|iris|hd graphics|integrated|igpu|apple m|apple gpu|microsoft basic display adapter|radeon graphics|ryzen graphics|vega \d)/i.test(lower)) {
    score -= 3;
  }
  return score;
}

function pickGpuName(names: string[]): string | null {
  const cleaned = names.map((name) => name.trim()).filter(Boolean);
  if (!cleaned.length) return null;
  return cleaned.sort((a, b) => scoreGpuName(b) - scoreGpuName(a))[0];
}

function parseLspciNames(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .map((line) => line.match(/(?:VGA compatible controller|3D controller|Display controller):\s*(.+)$/i)?.[1])
    .filter((name): name is string => !!name);
}

async function getNvidiaInfo(): Promise<GpuInfo | null> {
  try {
    const [{ stdout: smiOutput }, { stdout: listOutput }] = await Promise.all([
      execFileAsync('nvidia-smi'),
      execFileAsync('nvidia-smi', ['-L']),
    ]);

    return {
      gpuName: parseGpuName(listOutput),
      cudaVersion: parseCudaVersion(smiOutput),
    };
  } catch (error) {
    return null;
  }
}

async function getMacGpuNames(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('system_profiler', ['SPDisplaysDataType', '-json']);
    const parsed = JSON.parse(stdout);
    const entries = Array.isArray(parsed?.SPDisplaysDataType) ? parsed.SPDisplaysDataType : [];
    return entries
      .map((entry: any) => entry?._name || entry?.sppci_model || entry?.spdisplays_model)
      .filter((name: string) => !!name);
  } catch (error) {
    try {
      const { stdout } = await execFileAsync('system_profiler', ['SPDisplaysDataType']);
      return stdout
        .split('\n')
        .map((line) => line.trim().match(/^Chipset Model:\s*(.+)$/i)?.[1])
        .filter((name): name is string => !!name);
    } catch (innerError) {
      return [];
    }
  }
}

async function getWindowsGpuNames(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('powershell', [
      '-NoProfile',
      '-Command',
      'Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name',
    ]);
    return stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  } catch (error) {
    try {
      const { stdout } = await execFileAsync('wmic', ['path', 'win32_videocontroller', 'get', 'name']);
      return stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && line.toLowerCase() !== 'name');
    } catch (innerError) {
      return [];
    }
  }
}

async function getLinuxGpuNames(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('lspci');
    return parseLspciNames(stdout);
  } catch (error) {
    return [];
  }
}

export async function GET() {
  try {
    const nvidiaInfo = await getNvidiaInfo();
    if (nvidiaInfo?.gpuName || nvidiaInfo?.cudaVersion) {
      return NextResponse.json(nvidiaInfo);
    }

    const gpuNames =
      process.platform === 'darwin'
        ? await getMacGpuNames()
        : process.platform === 'win32'
        ? await getWindowsGpuNames()
        : await getLinuxGpuNames();

    return NextResponse.json({
      gpuName: pickGpuName(gpuNames),
      cudaVersion: null,
    });
  } catch (error) {
    return NextResponse.json({ gpuName: null, cudaVersion: null });
  }
}
