import { NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { spawn } from 'child_process';
import { existsSync } from 'fs';

export async function POST(request: Request) {
  try {
    const { version } = await request.json();
    
    if (!version) {
      return NextResponse.json(
        { error: 'Version is required' },
        { status: 400 }
      );
    }
    
    const selectedVersionPath = join(process.cwd(), 'spaces', 'selected_version.txt');
    await writeFile(selectedVersionPath, version, 'utf-8');
    
    return NextResponse.json({ success: true, selectedVersion: version });
  } catch (error) {
    console.error('Error activating space:', error);
    return NextResponse.json(
      { error: 'Failed to activate space' },
      { status: 500 }
    );
  }
}
