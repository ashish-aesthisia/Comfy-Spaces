import { NextResponse } from 'next/server';
import { join } from 'path';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';

interface Dependency {
  name: string;
  version: string;
  fullLine: string;
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
    const match = lineWithoutComment.match(/^([a-zA-Z0-9_.-]+(?:\[[^\]]+\])?)(?:\s*([=<>!~]+)\s*(.+))?$/);
    if (match) {
      const fullName = match[1];
      const name = fullName.split('[')[0]; // Remove extras like package[extra]
      const version = match[3] ? match[3].trim() : '*'; // Use * for unspecified versions
      dependencies.push({ name, version, fullLine: trimmed });
    }
  }
  
  return dependencies;
}

export async function GET() {
  try {
    // Get selected space
    const spacesPath = join(process.cwd(), 'spaces');
    const selectedVersionPath = join(spacesPath, 'selected_version.txt');
    let selectedVersion = 'v1';
    try {
      const selectedContent = await readFile(selectedVersionPath, 'utf-8');
      selectedVersion = selectedContent.trim() || 'v1';
    } catch (error) {
      // Default to v1 if file doesn't exist
    }

    const spaceJsonPath = join(spacesPath, selectedVersion, 'space.json');

    // Check if space.json exists
    if (!existsSync(spaceJsonPath)) {
      return NextResponse.json({
        dependencies: [],
        selectedVersion,
      });
    }

    // Read and parse dependencies from space.json
    const spaceJsonContent = await readFile(spaceJsonPath, 'utf-8');
    const spaceJson = JSON.parse(spaceJsonContent);
    const dependenciesList = spaceJson.dependencies || [];
    
    // Convert to Dependency format
    const dependencies: Dependency[] = dependenciesList.map((dep: string) => {
      const match = dep.match(/^([a-zA-Z0-9_.-]+(?:\[[^\]]+\])?)(?:\s*([=<>!~]+)\s*(.+))?$/);
      if (match) {
        const fullName = match[1];
        const name = fullName.split('[')[0];
        const version = match[3] ? match[3].trim() : '*';
        return { name, version, fullLine: dep };
      }
      return { name: dep, version: '*', fullLine: dep };
    });

    return NextResponse.json({
      dependencies,
      selectedVersion,
    });
  } catch (error) {
    console.error('Error reading requirements:', error);
    return NextResponse.json(
      { error: 'Failed to read requirements' },
      { status: 500 }
    );
  }
}

