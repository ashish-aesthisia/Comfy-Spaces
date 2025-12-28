import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { writeFile, copyFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';

export async function POST(request: NextRequest) {
  try {
    const { mergedDependencies } = await request.json();
    
    if (!Array.isArray(mergedDependencies)) {
      return NextResponse.json(
        { error: 'mergedDependencies must be an array' },
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

    const requirementsPath = join(revisionsPath, selectedVersion, 'requirements.txt');
    const backupPath = join(revisionsPath, selectedVersion, 'requirements.bkp');

    // Check if requirements.txt exists
    if (!existsSync(requirementsPath)) {
      return NextResponse.json(
        { error: `requirements.txt not found in ${selectedVersion}` },
        { status: 404 }
      );
    }

    // Create backup only if it doesn't exist - never update/overwrite existing backup
    if (!existsSync(backupPath)) {
      await copyFile(requirementsPath, backupPath);
    }

    // Write merged dependencies to requirements.txt
    const mergedContent = mergedDependencies.join('\n') + '\n';
    await writeFile(requirementsPath, mergedContent, 'utf-8');

    return NextResponse.json({ 
      success: true,
      message: 'Requirements merged successfully',
      backupPath: backupPath,
      revision: selectedVersion,
    });
  } catch (error) {
    console.error('Error merging requirements:', error);
    return NextResponse.json(
      { error: 'Failed to merge requirements' },
      { status: 500 }
    );
  }
}

