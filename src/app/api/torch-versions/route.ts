import { NextResponse } from 'next/server';

interface TorchVersion {
  version: string;
  label: string;
  type: 'cpu' | 'cuda';
}

// PyPI API endpoint for torch package
const TORCH_PYPI_URL = 'https://pypi.org/pypi/torch/json';

export async function GET() {
  try {
    // Fetch torch versions from PyPI
    const response = await fetch(TORCH_PYPI_URL, {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`PyPI API returned ${response.status}`);
    }

    const data = await response.json();
    const releases = data.releases || {};

    // Get all version numbers and sort them (newest first)
    const versions = Object.keys(releases)
      .filter(version => {
        // Filter out pre-releases and very old versions
        // Keep only stable releases from 2.0.0 onwards
        const versionMatch = version.match(/^(\d+)\.(\d+)\.(\d+)/);
        if (!versionMatch) return false;
        const major = parseInt(versionMatch[1]);
        const minor = parseInt(versionMatch[2]);
        // Include versions 2.0.0 and above, exclude pre-releases
        return major >= 2 && !version.includes('rc') && !version.includes('a') && !version.includes('b');
      })
      .sort((a, b) => {
        // Sort by version number (newest first)
        const aParts = a.split('.').map(Number);
        const bParts = b.split('.').map(Number);
        for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
          const aPart = aParts[i] || 0;
          const bPart = bParts[i] || 0;
          if (bPart !== aPart) {
            return bPart - aPart;
          }
        }
        return 0;
      })
      .slice(0, 15);

    const torchVersions: TorchVersion[] = [];
    const cudaVersionsList = ['11.8', '12.1', '12.4']; // Common CUDA versions

    // For each version, create CPU and CUDA entries
    for (const version of versions) {
      // CPU version - standard PyPI package
      torchVersions.push({
        version: version,
        label: `${version} (CPU)`,
        type: 'cpu',
      });

      // CUDA versions
      for (const cudaVersion of cudaVersionsList) {
        const cudaSuffix = cudaVersion.replace('.', '');
        const cudaVersionString = `${version}+cu${cudaSuffix}`;
        torchVersions.push({
          version: cudaVersionString,
          label: `${version} (CUDA ${cudaVersion})`,
          type: 'cuda',
        });
      }
    }

    // Take top 5 CPU and top 5 CUDA (newest first), no override logic
    const cpuVersions = torchVersions
      .filter(v => v.type === 'cpu')
      .slice(0, 5);

    const sortedCudaVersions = torchVersions
      .filter(v => v.type === 'cuda')
      .sort((a, b) => {
        const aBase = a.version.split('+')[0];
        const bBase = b.version.split('+')[0];
        const aParts = aBase.split('.').map(Number);
        const bParts = bBase.split('.').map(Number);
        for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
          const aPart = aParts[i] || 0;
          const bPart = bParts[i] || 0;
          if (bPart !== aPart) {
            return bPart - aPart;
          }
        }
        return 0;
      })
      .reverse()
      .slice(0, 5);

    return NextResponse.json({
      cpu: cpuVersions,
      cuda: sortedCudaVersions,
    });
  } catch (error) {
    console.error('Error fetching torch versions:', error);

    const fallbackVersions = {
      cpu: [
        { version: '2.5.1', label: '2.5.1 (CPU)', type: 'cpu' },
        { version: '2.4.1', label: '2.4.1 (CPU)', type: 'cpu' },
        { version: '2.3.1', label: '2.3.1 (CPU)', type: 'cpu' },
        { version: '2.2.2', label: '2.2.2 (CPU)', type: 'cpu' },
        { version: '2.1.2', label: '2.1.2 (CPU)', type: 'cpu' },
      ],
      cuda: [
        { version: '2.8.0+cu124', label: '2.8.0 (CUDA 12.4)', type: 'cuda' },
        { version: '2.7.1+cu124', label: '2.7.1 (CUDA 12.4)', type: 'cuda' },
        { version: '2.5.1+cu124', label: '2.5.1 (CUDA 12.4)', type: 'cuda' },
        { version: '2.5.1+cu121', label: '2.5.1 (CUDA 12.1)', type: 'cuda' },
        { version: '2.4.1+cu124', label: '2.4.1 (CUDA 12.4)', type: 'cuda' },
      ],
    };

    return NextResponse.json(fallbackVersions);
  }
}

