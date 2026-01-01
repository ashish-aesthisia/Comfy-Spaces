import { NextResponse } from 'next/server';
import { promisify } from 'util';
import { exec } from 'child_process';
import { join } from 'path';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';

const execAsync = promisify(exec);

type DependencyStatus = 'installed' | 'upgrade' | 'downgrade' | 'new';

interface SubDependency {
  name: string;
  version?: string;
  status?: DependencyStatus;
  currentVersion?: string;
  selected?: boolean;
}

interface Dependency {
  name: string;
  version?: string;
  status?: DependencyStatus;
  currentVersion?: string;
  subdependencies: SubDependency[];
  selected?: boolean;
}

function parseRequirements(content: string): string[] {
  const dependencies: string[] = [];
  const lines = content.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    
    // Handle inline comments
    const lineWithoutComment = trimmed.split('#')[0].trim();
    if (!lineWithoutComment) {
      continue;
    }
    
    dependencies.push(lineWithoutComment);
  }
  
  return dependencies;
}

function parseDryRunOutput(output: string): SubDependency[] {
  const subdependenciesMap = new Map<string, string | undefined>();
  const lines = output.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Look for "Collecting package==version" lines (including indented ones)
    // Format: "Collecting package==version" or "  Collecting package==version (from parent)"
    if (trimmed.includes('Collecting ') && !trimmed.includes('Using cached')) {
      // Try to match with version first: "Collecting package==version"
      const matchWithVersion = trimmed.match(/Collecting\s+([a-zA-Z0-9_.-]+(?:\[[^\]]+\])?)\s*==\s*([^\s\(]+)/);
      if (matchWithVersion && matchWithVersion[1] && matchWithVersion[2]) {
        let depName = matchWithVersion[1].split('[')[0].trim();
        const version = matchWithVersion[2].trim();
        if (depName && !subdependenciesMap.has(depName.toLowerCase())) {
          subdependenciesMap.set(depName.toLowerCase(), version);
        }
      } else {
        // Match without version: "Collecting package"
        const match = trimmed.match(/Collecting\s+([a-zA-Z0-9_.-]+(?:\[[^\]]+\])?)/);
        if (match && match[1]) {
          let depName = match[1].split('[')[0];
          depName = depName.split('==')[0].split('>=')[0].split('<=')[0].split('~=')[0].split('!=')[0].trim();
          if (depName && !subdependenciesMap.has(depName.toLowerCase())) {
            // No version found yet, add with undefined (we'll get it from "Would install" if available)
            subdependenciesMap.set(depName.toLowerCase(), undefined);
          }
        }
      }
    }
    // Look for "Using cached package-version" lines - these have version info
    // Format: "Using cached package-version-...whl.metadata"
    else if (trimmed.includes('Using cached ') && trimmed.includes('.whl')) {
      const match = trimmed.match(/Using cached\s+([a-zA-Z0-9_.-]+)-([a-zA-Z0-9_.-]+)-/);
      if (match && match[1] && match[2]) {
        const depName = match[1].trim();
        // The version might be in the second part, but could also have platform info
        // Try to extract just the version part (usually before cp, py, or platform identifiers)
        let version = match[2].trim();
        // Remove platform-specific suffixes like cp311, macosx, etc.
        version = version.split('-cp')[0].split('-py')[0].split('-macosx')[0].split('-linux')[0].split('-win')[0];
        if (depName && version && /[\d.]/.test(version)) {
          if (!subdependenciesMap.has(depName.toLowerCase())) {
            subdependenciesMap.set(depName.toLowerCase(), version);
          }
        }
      }
    }
    // Look for "Requirement already satisfied: package==version" lines
    // Format: "Requirement already satisfied: package==version in ... (from parent->subdep) (version)"
    else if (trimmed.startsWith('Requirement already satisfied: ')) {
      // Try to match with version in == format first
      const matchWithVersion = trimmed.match(/Requirement already satisfied:\s+([a-zA-Z0-9_.-]+)\s*==\s*([^\s\(]+)/);
      if (matchWithVersion && matchWithVersion[1] && matchWithVersion[2]) {
        const depName = matchWithVersion[1].trim();
        const version = matchWithVersion[2].trim();
        if (depName && !subdependenciesMap.has(depName.toLowerCase())) {
          subdependenciesMap.set(depName.toLowerCase(), version);
        }
      } else {
        // Try to extract version from parentheses at the end: "(version)"
        const matchWithParens = trimmed.match(/Requirement already satisfied:\s+([a-zA-Z0-9_.-]+).*\(([^)]+)\)\s*$/);
        if (matchWithParens && matchWithParens[1] && matchWithParens[2]) {
          const depName = matchWithParens[1].trim();
          const version = matchWithParens[2].trim();
          // Check if the version looks valid (contains digits or dots)
          if (/[\d.]/.test(version) && !version.includes('from')) {
            if (depName && !subdependenciesMap.has(depName.toLowerCase())) {
              subdependenciesMap.set(depName.toLowerCase(), version);
            }
          }
        }
      }
    }
    // Look for "Would install" line at the end - this has the most accurate version info
    // Format: "Would install package-version package2-version"
    else if (trimmed.startsWith('Would install ')) {
      const packagesStr = trimmed.replace('Would install ', '').trim();
      const packages = packagesStr.split(/\s+/);
      packages.forEach(pkg => {
        // Package format is usually "package-version" where version can have multiple dashes
        // Try to extract package name and version
        // Pattern: package-name-2.9.1 or package-name==2.9.1
        let depName = pkg;
        let version: string | undefined = undefined;
        
        // Check for == format first
        if (pkg.includes('==')) {
          const parts = pkg.split('==');
          depName = parts[0].trim();
          version = parts[1]?.trim();
        } else if (pkg.includes('-')) {
          // Try to extract version from package-version format
          // Find the last occurrence of a pattern that looks like a version (starts with digit)
          const parts = pkg.split('-');
          // Look backwards for version pattern (starts with digit)
          for (let i = parts.length - 1; i >= 0; i--) {
            if (/^\d/.test(parts[i])) {
              // Found version part
              depName = parts.slice(0, i).join('-');
              version = parts.slice(i).join('-');
              break;
            }
          }
        }
        
        if (depName) {
          if (version && /[\d.]/.test(version)) {
            // "Would install" has the most accurate version info, so always overwrite
            subdependenciesMap.set(depName.toLowerCase(), version);
          } else if (!subdependenciesMap.has(depName.toLowerCase())) {
            // If no version found and package not already in map, add it without version
            subdependenciesMap.set(depName.toLowerCase(), undefined);
          }
        }
      });
    }
  }
  
  // Convert map to array of SubDependency objects
  // Only include versions if they're known (not undefined)
  const subdependencies: SubDependency[] = [];
  subdependenciesMap.forEach((version, name) => {
    if (version) {
      subdependencies.push({ name, version });
    } else {
      subdependencies.push({ name });
    }
  });
  
  return subdependencies;
}

function normalizePackageName(name: string): string {
  // Python packages can use hyphens or underscores interchangeably
  // Normalize by converting both to underscores for consistent comparison
  return name.toLowerCase().replace(/-/g, '_');
}

function parseExistingDependencies(requirementsContent: string): Map<string, string> {
  const depsMap = new Map<string, string>();
  const lines = requirementsContent.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    
    const lineWithoutComment = trimmed.split('#')[0].trim();
    if (!lineWithoutComment) {
      continue;
    }
    
    // Handle pip list format: "package version" (space-separated)
    const pipListMatch = lineWithoutComment.match(/^([a-zA-Z0-9_.-]+)\s+([^\s]+)$/);
    if (pipListMatch) {
      const name = normalizePackageName(pipListMatch[1]);
      const version = pipListMatch[2].trim();
      if (name && version) {
        depsMap.set(name, version);
      }
      continue;
    }
    
    // Handle requirements.txt format: package==version, package>=version, etc.
    const match = lineWithoutComment.match(/^([a-zA-Z0-9_.-]+(?:\[[^\]]+\])?)(?:\s*==\s*([^\s#]+))?/);
    if (match) {
      const fullName = match[1];
      const name = normalizePackageName(fullName.split('[')[0]);
      const version = match[2]?.trim();
      if (name && version) {
        depsMap.set(name, version);
      }
    }
  }
  
  return depsMap;
}

function compareVersions(version1: string, version2: string): number {
  // Normalize versions - remove any non-numeric suffixes for comparison
  const normalize = (v: string) => {
    // Remove common suffixes like -dev, -alpha, -beta, etc.
    return v.split('-')[0].split('+')[0];
  };
  
  const v1 = normalize(version1);
  const v2 = normalize(version2);
  
  // Split by dots and compare numerically
  const v1Parts = v1.split('.').map(part => {
    // Extract numeric part (handle cases like "2.9.1" or "2.9.1rc1")
    const numMatch = part.match(/^\d+/);
    return numMatch ? parseInt(numMatch[0], 10) : 0;
  });
  
  const v2Parts = v2.split('.').map(part => {
    const numMatch = part.match(/^\d+/);
    return numMatch ? parseInt(numMatch[0], 10) : 0;
  });
  
  const maxLength = Math.max(v1Parts.length, v2Parts.length);
  
  for (let i = 0; i < maxLength; i++) {
    const v1Part = v1Parts[i] || 0;
    const v2Part = v2Parts[i] || 0;
    
    if (v1Part > v2Part) return 1;
    if (v1Part < v2Part) return -1;
  }
  
  return 0;
}

function getDependencyStatus(
  name: string,
  newVersion: string | undefined,
  existingDeps: Map<string, string>
): { status: DependencyStatus; currentVersion?: string } {
  const normalizedName = normalizePackageName(name);
  
  // Try to find the dependency with normalized name
  let existingVersion: string | undefined;
  for (const [existingName, version] of existingDeps.entries()) {
    if (normalizePackageName(existingName) === normalizedName) {
      existingVersion = version;
      break;
    }
  }
  
  if (!existingVersion) {
    return { status: 'new' };
  }
  
  // If dependency exists but new version is not specified, mark as installed
  if (!newVersion) {
    return { status: 'installed', currentVersion: existingVersion };
  }
  
  // Compare versions
  const comparison = compareVersions(newVersion, existingVersion);
  
  if (comparison === 0) {
    return { status: 'installed', currentVersion: existingVersion };
  } else if (comparison > 0) {
    return { status: 'upgrade', currentVersion: existingVersion };
  } else {
    return { status: 'downgrade', currentVersion: existingVersion };
  }
}

async function fetchRequirementsFromGit(githubUrl: string, commitId?: string, branch?: string): Promise<string> {
  // Extract repo info from URL
  const urlMatch = githubUrl.match(/github\.com\/([^\/]+)\/([^\/\.]+)/);
  if (!urlMatch) {
    throw new Error('Invalid GitHub URL format');
  }
  
  const [, owner, repo] = urlMatch;
  const repoName = repo.replace('.git', '');
  
  // Try GitHub raw API first (simpler and faster)
  let ref = branch || commitId;
  if (!ref) {
    // Try common default branch names
    const defaultBranches = ['main', 'master', 'develop'];
    for (const defaultBranch of defaultBranches) {
      try {
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repoName}/${defaultBranch}/requirements.txt`;
        const response = await fetch(rawUrl, { 
          method: 'HEAD',
          signal: AbortSignal.timeout(5000),
        });
        if (response.ok) {
          const contentResponse = await fetch(rawUrl, {
            signal: AbortSignal.timeout(10000),
          });
          if (contentResponse.ok) {
            return await contentResponse.text();
          }
        }
      } catch (error) {
        // Continue to next branch
        continue;
      }
    }
  } else {
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repoName}/${ref}/requirements.txt`;
    try {
      const response = await fetch(rawUrl, {
        signal: AbortSignal.timeout(10000),
      });
      if (response.ok) {
        return await response.text();
      }
    } catch (error) {
      // Fall through to git archive method
    }
  }
  
  // Fallback: Use git archive in a temporary directory
  const tempDir = join(process.cwd(), 'data', 'temp');
  if (!existsSync(tempDir)) {
    await mkdir(tempDir, { recursive: true });
  }
  
  const tempRepoPath = join(tempDir, `temp_repo_${Date.now()}`);
  
  try {
    // Clone shallow to temp location
    let cloneUrl = githubUrl.trim();
    if (!cloneUrl.endsWith('.git')) {
      cloneUrl = `${cloneUrl}.git`;
    }
    
    if (branch) {
      await execAsync(`git clone --branch ${branch} --depth 1 ${cloneUrl} ${tempRepoPath}`, {
        timeout: 30000,
      });
    } else {
      await execAsync(`git clone --depth 1 ${cloneUrl} ${tempRepoPath}`, {
        timeout: 30000,
      });
    }
    
    // Checkout specific commit if provided
    if (commitId && !branch) {
      await execAsync(`git checkout ${commitId}`, { cwd: tempRepoPath });
    }
    
    // Read requirements.txt
    const requirementsPath = join(tempRepoPath, 'requirements.txt');
    if (!existsSync(requirementsPath)) {
      throw new Error('requirements.txt not found in repository');
    }
    
    const content = await readFile(requirementsPath, 'utf-8');
    
    // Cleanup
    await execAsync(`rm -rf ${tempRepoPath}`);
    
    return content;
  } catch (error: any) {
    // Cleanup on error
    try {
      if (existsSync(tempRepoPath)) {
        await execAsync(`rm -rf ${tempRepoPath}`);
      }
    } catch {}
    
    throw new Error(`Failed to fetch requirements.txt: ${error.message}`);
  }
}

export async function POST(request: Request) {
  try {
    const { githubUrl, commitId, branch } = await request.json();
    
    if (!githubUrl) {
      return NextResponse.json(
        { error: 'Github URL is required' },
        { status: 400 }
      );
    }

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
    let pythonExec = 'python3';
    
    if (existsSync(venvPath)) {
      pythonExec = isWindows
        ? join(venvPath, 'Scripts', 'python.exe')
        : join(venvPath, 'bin', 'python3');
    }

    // Read existing dependencies from space
    const spaceJsonPath = join(spacesPath, selectedVersion, 'space.json');
    let existingDeps = new Map<string, string>();
    
    if (existsSync(spaceJsonPath)) {
      try {
        const spaceJsonContent = await readFile(spaceJsonPath, 'utf-8');
        const spaceJson = JSON.parse(spaceJsonContent);
        const dependenciesList = spaceJson.dependencies || [];
        const requirementsContent = dependenciesList.join('\n');
        existingDeps = parseExistingDependencies(requirementsContent);
      } catch (error) {
        // If space.json doesn't exist or can't be parsed, try requirements.txt
        const requirementsPath = join(spacesPath, selectedVersion, 'requirements.txt');
        if (existsSync(requirementsPath)) {
          try {
            const requirementsContent = await readFile(requirementsPath, 'utf-8');
            existingDeps = parseExistingDependencies(requirementsContent);
          } catch (error) {
            // If both fail, continue with empty map
          }
        }
      }
    }

    // Fetch requirements.txt from git repo
    const requirementsContent = await fetchRequirementsFromGit(githubUrl, commitId, branch);
    const dependencies = parseRequirements(requirementsContent);

    // Analyze each dependency with pip install --dry-run
    const analyzedDependencies: Dependency[] = [];
    
    for (const dep of dependencies) {
      try {
        // Extract package name (remove version specifiers for dry-run)
        const depName = dep.split(/[=<>!~]/)[0].trim();
        
        // Run pip install --dry-run
        const { stdout, stderr } = await execAsync(
          `${pythonExec} -m pip install --dry-run ${dep}`,
          {
            timeout: 30000,
            env: { ...process.env },
          }
        );
        
        const output = stdout + stderr;
        const subdependencies = parseDryRunOutput(output);
        
        // Extract version from dependency string if present
        const versionMatch = dep.match(/[=<>!~]+(.+)/);
        const version = versionMatch ? versionMatch[1].trim() : undefined;
        
        // Get status for primary dependency
        const depStatus = getDependencyStatus(depName, version, existingDeps);
        
        // Get status for each subdependency
        const subdepsWithStatus = subdependencies
          .filter(sub => sub.name.toLowerCase() !== depName.toLowerCase())
          .map(sub => {
            const subStatus = getDependencyStatus(sub.name, sub.version, existingDeps);
            return {
              ...sub,
              status: subStatus.status,
              currentVersion: subStatus.currentVersion,
              selected: subStatus.status !== 'installed', // Deselect if already installed
            };
          });
        
        analyzedDependencies.push({
          name: depName,
          version,
          status: depStatus.status,
          currentVersion: depStatus.currentVersion,
          subdependencies: subdepsWithStatus,
          selected: depStatus.status !== 'installed', // Deselect if already installed
        });
      } catch (error: any) {
        // If dry-run fails, still add the dependency but with empty subdependencies
        const depName = dep.split(/[=<>!~]/)[0].trim();
        const versionMatch = dep.match(/[=<>!~]+(.+)/);
        const version = versionMatch ? versionMatch[1].trim() : undefined;
        
        const depStatus = getDependencyStatus(depName, version, existingDeps);
        
        analyzedDependencies.push({
          name: depName,
          version,
          status: depStatus.status,
          currentVersion: depStatus.currentVersion,
          subdependencies: [],
          selected: depStatus.status !== 'installed', // Deselect if already installed
        });
      }
    }

    return NextResponse.json({
      success: true,
      requirements: requirementsContent,
      dependencies: analyzedDependencies,
    });
  } catch (error) {
    console.error('Error analyzing dependencies:', error);
    return NextResponse.json(
      { error: `Failed to analyze dependencies: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}

