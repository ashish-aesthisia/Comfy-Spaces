import { NextResponse } from 'next/server';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';

export async function GET() {
  try {
    const revisionsPath = join(process.cwd(), 'data', 'revisions');
    const entries = await readdir(revisionsPath, { withFileTypes: true });
    
    // Filter to only include directories (version folders like v1, v2, etc.)
    const versions = entries
      .filter(entry => entry.isDirectory() && entry.name.startsWith('v'))
      .map(entry => entry.name)
      .sort();
    
    // Read selected version
    const selectedVersionPath = join(revisionsPath, 'selected_version.txt');
    let selectedVersion = '';
    try {
      const selectedContent = await readFile(selectedVersionPath, 'utf-8');
      selectedVersion = selectedContent.trim();
    } catch (error) {
      // If file doesn't exist, use first version as default
      selectedVersion = versions[0] || '';
    }
    
    return NextResponse.json({
      versions,
      selectedVersion,
    });
  } catch (error) {
    console.error('Error reading revisions:', error);
    return NextResponse.json(
      { error: 'Failed to read revisions' },
      { status: 500 }
    );
  }
}

