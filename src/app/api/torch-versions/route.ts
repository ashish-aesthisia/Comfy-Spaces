import { NextResponse } from 'next/server';

interface TorchVersion {
  version: string;
  label: string;
  type: 'cpu' | 'cuda';
  indexUrl?: string;
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
      .slice(0, 15); // Get top 15 versions to ensure we include 2.7 and 2.8

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

      // CUDA versions - check common CUDA versions
      for (const cudaVersion of cudaVersionsList) {
        // Format: torch==2.1.0+cu118 for CUDA 11.8
        const cudaSuffix = cudaVersion.replace('.', '');
        const cudaVersionString = `${version}+cu${cudaSuffix}`;
        
        torchVersions.push({
          version: cudaVersionString,
          label: `${version} (CUDA ${cudaVersion})`,
          type: 'cuda',
          indexUrl: `https://download.pytorch.org/whl/cu${cudaSuffix}`,
        });
      }
    }

    // Sort by version (newest first) and take top 5 CPU
    const cpuVersions = torchVersions
      .filter(v => v.type === 'cpu')
      .slice(0, 5);
    
    // For CUDA, ensure we have at least one version for 2.7 and 2.8
    const allCudaVersions = torchVersions.filter(v => v.type === 'cuda');
    
    // Find 2.7.x and 2.8.x versions (prefer CUDA 12.4)
    const version27 = allCudaVersions.find(v => v.version.startsWith('2.7.') && v.version.includes('cu124')) 
      || allCudaVersions.find(v => v.version.startsWith('2.7.'));
    const version28 = allCudaVersions.find(v => v.version.startsWith('2.8.') && v.version.includes('cu124'))
      || allCudaVersions.find(v => v.version.startsWith('2.8.'));
    
    // Get top 5 CUDA versions (newest first)
    const topCudaVersions = allCudaVersions.slice(0, 5);
    
    // Build final CUDA list ensuring 2.7 and 2.8 are included
    const finalCudaVersions: TorchVersion[] = [];
    const addedVersions = new Set<string>();
    
    // First, ensure 2.8 and 2.7 are included (add manually if not found)
    const version28ToAdd = version28 || {
      version: '2.8.0+cu124',
      label: '2.8.0 (CUDA 12.4)',
      type: 'cuda' as const,
      indexUrl: 'https://download.pytorch.org/whl/cu124',
    };
    
    const version27ToAdd = version27 || {
      version: '2.7.1+cu124',
      label: '2.7.1 (CUDA 12.4)',
      type: 'cuda' as const,
      indexUrl: 'https://download.pytorch.org/whl/cu124',
    };
    
    // Add 2.8 and 2.7 first (guaranteed to be included)
    finalCudaVersions.push(version28ToAdd);
    addedVersions.add(version28ToAdd.version);
    finalCudaVersions.push(version27ToAdd);
    addedVersions.add(version27ToAdd.version);
    
    // Then add top versions that aren't already added (up to 3 more to make 5 total)
    for (const version of topCudaVersions) {
      if (!addedVersions.has(version.version) && finalCudaVersions.length < 5) {
        finalCudaVersions.push(version);
        addedVersions.add(version.version);
      }
    }
    
    // Final sort (newest first)
    const sortedCudaVersions = finalCudaVersions
      .sort((a, b) => {
        // Extract base version (before +)
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
      .reverse(); // Newest first

    return NextResponse.json({
      cpu: cpuVersions,
      cuda: sortedCudaVersions,
    });
  } catch (error) {
    console.error('Error fetching torch versions:', error);
    
    // Fallback to hardcoded recent versions if API fails
    // Ensure 2.7 and 2.8 are included for CUDA
    const fallbackVersions = {
      cpu: [
        { version: '2.5.1', label: '2.5.1 (CPU)', type: 'cpu' },
        { version: '2.4.1', label: '2.4.1 (CPU)', type: 'cpu' },
        { version: '2.3.1', label: '2.3.1 (CPU)', type: 'cpu' },
        { version: '2.2.2', label: '2.2.2 (CPU)', type: 'cpu' },
        { version: '2.1.2', label: '2.1.2 (CPU)', type: 'cpu' },
      ],
      cuda: [
        { version: '2.8.0+cu124', label: '2.8.0 (CUDA 12.4)', type: 'cuda', indexUrl: 'https://download.pytorch.org/whl/cu124' },
        { version: '2.7.1+cu124', label: '2.7.1 (CUDA 12.4)', type: 'cuda', indexUrl: 'https://download.pytorch.org/whl/cu124' },
        { version: '2.5.1+cu124', label: '2.5.1 (CUDA 12.4)', type: 'cuda', indexUrl: 'https://download.pytorch.org/whl/cu124' },
        { version: '2.5.1+cu121', label: '2.5.1 (CUDA 12.1)', type: 'cuda', indexUrl: 'https://download.pytorch.org/whl/cu121' },
        { version: '2.4.1+cu124', label: '2.4.1 (CUDA 12.4)', type: 'cuda', indexUrl: 'https://download.pytorch.org/whl/cu124' },
      ],
    };

    return NextResponse.json(fallbackVersions);
  }
}

