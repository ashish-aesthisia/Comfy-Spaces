import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { spawn } from 'child_process';
import { promisify } from 'util';

interface Dependency {
  name: string;
  version: string;
}

function parseRequirements(content: string): Dependency[] {
  const dependencies: Dependency[] = [];
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
    
    // Parse dependency line
    // Format: package==version, package>=version, package~=version, package, etc.
    // Match package name (can include dots, hyphens, underscores) and optional version specifiers
    const match = lineWithoutComment.match(/^([a-zA-Z0-9_.-]+(?:\[[^\]]+\])?)(?:\s*([=<>!~]+)\s*(.+))?$/);
    if (match) {
      const fullName = match[1];
      const name = fullName.split('[')[0]; // Remove extras like package[extra]
      const version = match[3] ? match[3].trim() : '*'; // Use * for unspecified versions
      dependencies.push({ name, version });
    }
  }
  
  return dependencies;
}

function compareDependencies(
  oldDeps: Dependency[],
  newDeps: Dependency[]
): { added: string[]; removed: string[]; updated: Array<{ name: string; old: string; new: string }> } {
  const oldMap = new Map<string, string>();
  const newMap = new Map<string, string>();
  
  oldDeps.forEach(dep => oldMap.set(dep.name.toLowerCase(), dep.version));
  newDeps.forEach(dep => newMap.set(dep.name.toLowerCase(), dep.version));
  
  const added: string[] = [];
  const removed: string[] = []; // Always empty - current dependencies are never removed
  const updated: Array<{ name: string; old: string; new: string }> = [];
  
  // Find added and updated
  // Current dependencies are never removed, so we only check what's in incoming
  newMap.forEach((newVersion, name) => {
    const oldVersion = oldMap.get(name);
    if (!oldVersion) {
      // New dependency - not in current, so it's added
      const dep = newDeps.find(d => d.name.toLowerCase() === name);
      if (dep) {
        added.push(newVersion === '*' ? dep.name : `${dep.name}==${newVersion}`);
      }
    } else if (oldVersion !== newVersion) {
      // Updated dependency - exists in both but versions differ
      const dep = newDeps.find(d => d.name.toLowerCase() === name);
      if (dep) {
        updated.push({
          name: dep.name,
          old: oldVersion === '*' ? 'unspecified' : oldVersion,
          new: newVersion === '*' ? 'unspecified' : newVersion,
        });
      }
    }
  });
  
  // Note: We don't mark anything as removed because current dependencies are preserved
  // Dependencies that exist in current but not in incoming will remain unchanged
  
  return { added, removed, updated };
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const nodeName = searchParams.get('nodeName');
    
    if (!nodeName) {
      return NextResponse.json(
        { error: 'nodeName parameter is required' },
        { status: 400 }
      );
    }

    // Get selected revision
    const revisionsPath = join(process.cwd(), 'data', 'revisions');
    const selectedVersionPath = join(revisionsPath, 'selected_version.txt');
    let selectedVersion = 'v1';
    try {
      const selectedContent = await readFile(selectedVersionPath, 'utf-8');
      selectedVersion = selectedContent.trim() || 'v1';
    } catch (error) {
      // Default to v1 if file doesn't exist
    }

    const backupPath = join(revisionsPath, selectedVersion, 'requirements.bkp');
    const requirementsPath = join(revisionsPath, selectedVersion, 'requirements.txt');
    const nodeRequirementsPath = join(process.cwd(), 'data', 'nodes', nodeName, 'requirements.txt');

    // Use backup file as source if it exists, otherwise use requirements.txt
    const sourcePath = existsSync(backupPath) ? backupPath : requirementsPath;
    const sourceLabel = existsSync(backupPath) ? 'requirements.bkp' : 'requirements.txt';

    // Check if source file exists
    if (!existsSync(sourcePath)) {
      return NextResponse.json(
        { error: `${sourceLabel} not found in ${selectedVersion}` },
        { status: 404 }
      );
    }

    if (!existsSync(nodeRequirementsPath)) {
      return NextResponse.json(
        { 
          error: `requirements.txt not found in cloned node`,
          added: [],
          removed: [],
          updated: [],
        },
        { status: 200 } // Return empty diff if requirements.txt doesn't exist
      );
    }

    // Read both files
    const sourceContent = await readFile(sourcePath, 'utf-8');
    const nodeContent = await readFile(nodeRequirementsPath, 'utf-8');

    // Parse dependencies
    const sourceDeps = parseRequirements(sourceContent);
    const nodeDeps = parseRequirements(nodeContent);

    // Compare dependencies
    const diff = compareDependencies(sourceDeps, nodeDeps);

    // Create line-by-line comparison for side-by-side view
    const sourceLines = sourceContent.split('\n');
    const nodeLines = nodeContent.split('\n');
    
    // Create maps for dependency lookup by name
    const sourceDepMap = new Map<string, string>();
    const nodeDepMap = new Map<string, string>();
    
    sourceDeps.forEach((dep) => {
      sourceDepMap.set(dep.name.toLowerCase(), dep.version);
    });
    
    nodeDeps.forEach((dep) => {
      nodeDepMap.set(dep.name.toLowerCase(), dep.version);
    });

    // Helper function to extract dependency name from a line
    function getDepNameFromLine(line: string): string | null {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        return null;
      }
      const lineWithoutComment = trimmed.split('#')[0].trim();
      const match = lineWithoutComment.match(/^([a-zA-Z0-9_.-]+(?:\[[^\]]+\])?)/);
      if (match) {
        return match[1].split('[')[0].toLowerCase();
      }
      return null;
    }

    // Build line annotations for source (current)
    // Current dependencies are never removed, so they're either unchanged or updated
    const sourceLineAnnotations: Array<{ line: string; type: 'added' | 'removed' | 'updated' | 'unchanged' | 'none'; depName?: string }> = [];
    sourceLines.forEach((line) => {
      const depName = getDepNameFromLine(line);
      if (!depName) {
        sourceLineAnnotations.push({ line, type: 'none' });
        return;
      }
      
      const inNew = nodeDepMap.has(depName);
      const oldVersion = sourceDepMap.get(depName);
      const newVersion = nodeDepMap.get(depName);
      
      // Current dependencies are never removed - they stay unchanged or are marked as updated
      if (inNew && oldVersion && newVersion && oldVersion !== newVersion) {
        // Same dependency with different version - mark as updated
        sourceLineAnnotations.push({ line, type: 'updated', depName });
      } else {
        // Not in new or same version - mark as unchanged (current dependencies are preserved)
        sourceLineAnnotations.push({ line, type: 'unchanged', depName });
      }
    });

    // Build line annotations for node (incoming)
    const nodeLineAnnotations: Array<{ line: string; type: 'added' | 'removed' | 'updated' | 'unchanged' | 'none'; depName?: string }> = [];
    nodeLines.forEach((line) => {
      const depName = getDepNameFromLine(line);
      if (!depName) {
        nodeLineAnnotations.push({ line, type: 'none' });
        return;
      }
      
      const inOld = sourceDepMap.has(depName);
      const oldVersion = sourceDepMap.get(depName);
      const newVersion = nodeDepMap.get(depName);
      
      if (!inOld) {
        nodeLineAnnotations.push({ line, type: 'added', depName });
      } else if (oldVersion && newVersion && oldVersion !== newVersion) {
        nodeLineAnnotations.push({ line, type: 'updated', depName });
      } else {
        nodeLineAnnotations.push({ line, type: 'unchanged', depName });
      }
    });

    // Check for conflicts using pip-compile
    // Merge requirements: current (source) + incoming (node), keeping current as base
    // Current dependencies take priority - they are never removed or downgraded
    const mergedRequirements: string[] = [];
    const seenDeps = new Set<string>();
    
    // First, add all current dependencies (these take priority)
    sourceLines.forEach((line) => {
      const trimmed = line.trim();
      const depName = getDepNameFromLine(line);
      if (depName) {
        seenDeps.add(depName);
      }
      mergedRequirements.push(line);
    });
    
    // Then, add incoming dependencies that aren't in current
    // Skip any that conflict with current (current takes priority)
    nodeLines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        // Add comments and empty lines from incoming if they're meaningful
        return;
      }
      
      const depName = getDepNameFromLine(line);
      if (depName && !seenDeps.has(depName)) {
        // Only add if it's a new dependency not in current
        mergedRequirements.push(line);
        seenDeps.add(depName);
      }
    });
    
    const mergedContent = mergedRequirements.join('\n');
    
    // Create temporary file for merged requirements
    const tempDir = join(process.cwd(), 'data', 'temp');
    if (!existsSync(tempDir)) {
      await mkdir(tempDir, { recursive: true });
    }
    const tempMergedPath = join(tempDir, `merged_${nodeName}_requirements.txt`);
    await writeFile(tempMergedPath, mergedContent, 'utf-8');
    
    // Run pip-compile --dry-run to check for conflicts
    // Use the venv Python from v1 since pip-tools is installed there
    let conflicts: string[] = [];
    let conflictDetails = '';
    let hasConflicts = false;
    
    try {
      // Determine Python executable - use venv Python from v1 if available
      const isWindows = process.platform === 'win32';
      const venvPath = join(process.cwd(), 'data', 'revisions', 'v1', 'venv');
      let pythonExec = 'python3';
      
      if (existsSync(venvPath)) {
        pythonExec = isWindows
          ? join(venvPath, 'Scripts', 'python.exe')
          : join(venvPath, 'bin', 'python3');
      }
      
      const conflictCheck = await new Promise<{ hasConflicts: boolean; output: string }>((resolve) => {
        // Use python -m pip_tools.compile (pip-tools is the package name)
        const pythonProcess = spawn(pythonExec, ['-m', 'pip_tools.compile', '--dry-run', tempMergedPath], {
          env: { ...process.env },
          shell: true,
          cwd: process.cwd(),
        });
        
        let stdout = '';
        let stderr = '';
        
        pythonProcess.stdout?.on('data', (data) => {
          stdout += data.toString();
        });
        
        pythonProcess.stderr?.on('data', (data) => {
          stderr += data.toString();
        });
        
        pythonProcess.on('close', (code) => {
          const output = stdout + stderr;
          // pip-compile --dry-run returns non-zero if there are conflicts
          // or if it can't resolve dependencies
          if (code !== 0) {
            // Check if it's a "command not found" or module not found error
            if (output.includes('No module named') || output.includes('command not found')) {
              resolve({ hasConflicts: false, output: 'pip-tools not available' });
            } else {
              resolve({ hasConflicts: true, output });
            }
          } else {
            // Even with code 0, check for conflict indicators in output
            const hasConflictIndicators = output.includes('conflict') || 
                                        output.includes('Could not find a version') ||
                                        output.includes('ERROR') ||
                                        output.includes('Incompatible');
            resolve({ hasConflicts: hasConflictIndicators, output });
          }
        });
        
        pythonProcess.on('error', (error) => {
          // If Python process fails, assume no conflicts (pip-tools might not be installed)
          resolve({ hasConflicts: false, output: `pip-tools not available: ${error.message}` });
        });
      });
      
      hasConflicts = conflictCheck.hasConflicts;
      conflictDetails = conflictCheck.output;
      
      // Parse conflicts from output
      if (hasConflicts) {
        const conflictLines = conflictDetails.split('\n').filter(line => 
          line.includes('conflict') || 
          line.includes('ERROR') || 
          line.includes('Incompatible') ||
          line.includes('Could not find')
        );
        conflicts = conflictLines;
      }
    } catch (error) {
      console.error('Error checking conflicts:', error);
      // If conflict check fails, continue without conflict info
    }

    return NextResponse.json({
      ...diff,
      current: {
        content: sourceContent,
        lines: sourceLineAnnotations,
      },
      incoming: {
        content: nodeContent,
        lines: nodeLineAnnotations,
      },
      conflicts: {
        hasConflicts,
        details: conflictDetails,
        conflicts,
        mergedContent,
      },
    });
  } catch (error) {
    console.error('Error comparing requirements:', error);
    return NextResponse.json(
      { error: 'Failed to compare requirements' },
      { status: 500 }
    );
  }
}

