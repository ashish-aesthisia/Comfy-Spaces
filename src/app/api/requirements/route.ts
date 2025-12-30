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

    const requirementsPath = join(revisionsPath, selectedVersion, 'requirements.txt');

    // Check if file exists
    if (!existsSync(requirementsPath)) {
      return NextResponse.json({
        dependencies: [],
        selectedVersion,
      });
    }

    // Read and parse requirements
    const content = await readFile(requirementsPath, 'utf-8');
    const dependencies = parseRequirements(content);

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

