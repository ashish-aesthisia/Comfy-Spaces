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

// Normalize package name (convert hyphens to underscores for consistent comparison)
// Python packages can use hyphens or underscores interchangeably
function normalizePackageName(name: string): string {
  return name.toLowerCase().replace(/-/g, '_');
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
        const normalizedName = normalizePackageName(depName);
        if (depName && !subdependenciesMap.has(normalizedName)) {
          subdependenciesMap.set(normalizedName, version);
        }
      } else {
        // Match without version: "Collecting package"
        const match = trimmed.match(/Collecting\s+([a-zA-Z0-9_.-]+(?:\[[^\]]+\])?)/);
        if (match && match[1]) {
          let depName = match[1].split('[')[0];
          depName = depName.split('==')[0].split('>=')[0].split('<=')[0].split('~=')[0].split('!=')[0].trim();
          const normalizedName = normalizePackageName(depName);
          if (depName && !subdependenciesMap.has(normalizedName)) {
            // No version found yet, add with undefined (we'll get it from "Would install" if available)
            subdependenciesMap.set(normalizedName, undefined);
          }
        }
      }
    }
    // Skip "Using cached" lines - they're redundant and cause incorrect parsing
    // The package info is already captured from "Collecting" lines
    // Look for "Requirement already satisfied: package==version" lines
    // Format: "Requirement already satisfied: package==version in ... (from parent->subdep) (version)"
    else if (trimmed.startsWith('Requirement already satisfied: ')) {
      // Try to match with version in == format first
      const matchWithVersion = trimmed.match(/Requirement already satisfied:\s+([a-zA-Z0-9_.-]+)\s*==\s*([^\s\(]+)/);
      if (matchWithVersion && matchWithVersion[1] && matchWithVersion[2]) {
        const depName = matchWithVersion[1].trim();
        const version = matchWithVersion[2].trim();
        const normalizedName = normalizePackageName(depName);
        if (depName && !subdependenciesMap.has(normalizedName)) {
          subdependenciesMap.set(normalizedName, version);
        }
      } else {
        // Try to extract version from parentheses at the end: "(version)"
        const matchWithParens = trimmed.match(/Requirement already satisfied:\s+([a-zA-Z0-9_.-]+).*\(([^)]+)\)\s*$/);
        if (matchWithParens && matchWithParens[1] && matchWithParens[2]) {
          const depName = matchWithParens[1].trim();
          const version = matchWithParens[2].trim();
          // Check if the version looks valid (contains digits or dots)
          if (/[\d.]/.test(version) && !version.includes('from')) {
            const normalizedName = normalizePackageName(depName);
            if (depName && !subdependenciesMap.has(normalizedName)) {
              subdependenciesMap.set(normalizedName, version);
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
        // Wheel format: package-name-version-cp311-cp311-platform.whl
        // We need to find where the version starts (first part that starts with digit)
        // and where it ends (before platform identifiers like cp311, py3, macosx, etc.)
        let depName = pkg;
        let version: string | undefined = undefined;
        
        // Check for == format first
        if (pkg.includes('==')) {
          const parts = pkg.split('==');
          depName = parts[0].trim();
          version = parts[1]?.trim();
        } else if (pkg.includes('-')) {
          const parts = pkg.split('-');
          
          // Find the first part that looks like a version (starts with digit)
          let versionStartIdx = -1;
          for (let i = 0; i < parts.length; i++) {
            if (/^\d/.test(parts[i])) {
              versionStartIdx = i;
              break;
            }
          }
          
          if (versionStartIdx > 0) {
            // Extract package name (everything before version)
            depName = parts.slice(0, versionStartIdx).join('-');
            
            // Extract version (everything from version start until we hit platform identifiers)
            // Platform identifiers: cp311, py3, macosx, linux, win, any, etc.
            let versionEndIdx = versionStartIdx + 1;
            for (let i = versionStartIdx + 1; i < parts.length; i++) {
              // Check if this part is a platform identifier
              if (/^(cp|py|macosx|linux|win|any|none)$/i.test(parts[i]) || 
                  /^cp\d+$/i.test(parts[i]) || 
                  /^py\d+$/i.test(parts[i])) {
                versionEndIdx = i;
                break;
              }
              // Also stop if we hit a file extension
              if (parts[i].includes('.whl') || parts[i].includes('.tar')) {
                versionEndIdx = i;
                break;
              }
            }
            
            version = parts.slice(versionStartIdx, versionEndIdx).join('-');
            // Clean up any trailing file extensions
            version = version.replace(/\.(whl|tar|gz|zip)$/i, '');
          }
        }
        
        if (depName) {
          const normalizedName = normalizePackageName(depName);
          // Only accept version if it looks valid (contains digits and dots, not platform identifiers)
          if (version && /^[\d.]+/.test(version) && !/^(cp|py|macosx|linux|win)/i.test(version)) {
            // "Would install" has the most accurate version info, so always overwrite
            subdependenciesMap.set(normalizedName, version);
          } else if (!subdependenciesMap.has(normalizedName)) {
            // If no version found and package not already in map, add it without version
            subdependenciesMap.set(normalizedName, undefined);
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

async function fetchRequirementsFromGit(githubUrl: string, commitId?: string, branch?: string): Promise<string | null> {
  // Extract repo info from URL
  const urlMatch = githubUrl.match(/github\.com\/([^\/]+)\/([^\/\.]+)/);
  if (!urlMatch) {
    throw new Error('Invalid GitHub URL format');
  }
  
  const [, owner, repo] = urlMatch;
  const repoName = repo.replace('.git', '');
  
  // Method 1: Try GitHub Raw API directly (fastest, no cloning needed)
  // Format: https://raw.githubusercontent.com/{owner}/{repo}/{ref}/requirements.txt
  let ref = branch || commitId;
  
  if (ref) {
    // For branches, try both direct branch name and refs/heads/{branch} format
    let rawUrls: string[] = [];
    if (branch) {
      rawUrls = [
        `https://raw.githubusercontent.com/${owner}/${repoName}/${branch}/requirements.txt`,
        `https://raw.githubusercontent.com/${owner}/${repoName}/refs/heads/${branch}/requirements.txt`,
      ];
    } else {
      // For commits, use commit SHA directly
      rawUrls = [`https://raw.githubusercontent.com/${owner}/${repoName}/${commitId}/requirements.txt`];
    }
    
    // Try each URL (usually first one works)
    for (const rawUrl of rawUrls) {
      try {
        const response = await fetch(rawUrl, {
          signal: AbortSignal.timeout(8000),
        });
        if (response.ok) {
          return await response.text();
        } else if (response.status === 404) {
          // Try next URL format
          continue;
        }
      } catch (error) {
        // Try next URL format
        continue;
      }
    }
  } else {
    // No branch/commit specified, try common default branches in parallel
    const defaultBranches = ['main', 'master', 'develop'];
    const rawUrls = defaultBranches.map(b => 
      `https://raw.githubusercontent.com/${owner}/${repoName}/${b}/requirements.txt`
    );
    
    // Try all branches, return first successful one
    for (const rawUrl of rawUrls) {
      try {
        const response = await fetch(rawUrl, {
          signal: AbortSignal.timeout(8000),
        });
        if (response.ok) {
          return await response.text();
        }
        // If 404, continue to next branch
      } catch (error) {
        // Continue to next branch
        continue;
      }
    }
  }
  
  // Method 2: Try GitHub API (works with commits and branches, no cloning needed)
  try {
    let apiUrl = `https://api.github.com/repos/${owner}/${repoName}/contents/requirements.txt`;
    
    if (commitId) {
      // For specific commits, get the commit tree and find requirements.txt
      const commitResponse = await fetch(`https://api.github.com/repos/${owner}/${repoName}/commits/${commitId}`, {
        signal: AbortSignal.timeout(10000),
      });
      if (commitResponse.ok) {
        const commitData = await commitResponse.json();
        const treeSha = commitData.commit.tree.sha;
        
        // Get the recursive tree to find requirements.txt
        const treeResponse = await fetch(`https://api.github.com/repos/${owner}/${repoName}/git/trees/${treeSha}?recursive=1`, {
          signal: AbortSignal.timeout(10000),
        });
        if (treeResponse.ok) {
          const treeData = await treeResponse.json();
          const requirementsFile = treeData.tree?.find((file: any) => file.path === 'requirements.txt');
          if (requirementsFile && requirementsFile.sha) {
            // Fetch the blob content
            const blobResponse = await fetch(`https://api.github.com/repos/${owner}/${repoName}/git/blobs/${requirementsFile.sha}`, {
              signal: AbortSignal.timeout(10000),
            });
            if (blobResponse.ok) {
              const blobData = await blobResponse.json();
              if (blobData.content) {
                return Buffer.from(blobData.content, 'base64').toString('utf-8');
              }
            }
          } else {
            // requirements.txt not found in tree
            return null;
          }
        }
      }
    } else {
      // For branches or default branch, use the contents API
      if (branch) {
        apiUrl = `https://api.github.com/repos/${owner}/${repoName}/contents/requirements.txt?ref=${encodeURIComponent(branch)}`;
      }
      
      const response = await fetch(apiUrl, {
        signal: AbortSignal.timeout(10000),
      });
      if (response.ok) {
        const data = await response.json();
        if (data.content) {
          return Buffer.from(data.content, 'base64').toString('utf-8');
        }
      } else if (response.status === 404) {
        // File doesn't exist
        return null;
      }
    }
  } catch (error) {
    // Fall through to git archive method
  }
  
  // Method 3: Last resort - shallow clone (only if all API methods fail)
  const tempDir = join(process.cwd(), 'data', 'temp');
  if (!existsSync(tempDir)) {
    await mkdir(tempDir, { recursive: true });
  }
  
  const tempRepoPath = join(tempDir, `temp_repo_${Date.now()}`);
  
  try {
    let cloneUrl = githubUrl.trim();
    if (!cloneUrl.endsWith('.git')) {
      cloneUrl = `${cloneUrl}.git`;
    }
    
    // Shallow clone as last resort
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
      // Cleanup and return null if requirements.txt doesn't exist
      await execAsync(`rm -rf ${tempRepoPath}`);
      return null;
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
    
    // Check if error is about file not found - return null instead of throwing
    if (error.message && error.message.includes('not found')) {
      return null;
    }
    
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
    // If requirements.txt doesn't exist, return success with empty dependencies
    let requirementsContent: string | null = null;
    try {
      requirementsContent = await fetchRequirementsFromGit(githubUrl, commitId, branch);
    } catch (error: any) {
      // If fetching fails and it's because file doesn't exist, continue with empty
      if (error.message && error.message.includes('not found')) {
        requirementsContent = null;
      } else {
        throw error;
      }
    }
    
    // If requirements.txt doesn't exist, return success with empty dependencies
    if (requirementsContent === null) {
      return NextResponse.json({
        success: true,
        requirements: null,
        dependencies: [],
        noRequirementsFile: true,
      });
    }
    
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

