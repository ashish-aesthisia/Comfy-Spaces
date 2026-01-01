import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

export async function POST() {
  try {
    // Get the currently selected version
    const selectedVersionPath = join(process.cwd(), 'spaces', 'selected_version.txt');
    
    if (!existsSync(selectedVersionPath)) {
      return NextResponse.json(
        { error: 'No space is currently active' },
        { status: 400 }
      );
    }
    
    const version = (await readFile(selectedVersionPath, 'utf-8')).trim();
    
    if (!version) {
      return NextResponse.json(
        { error: 'No space is currently active' },
        { status: 400 }
      );
    }
    
    // Return the version so the frontend can trigger reactivation
    return NextResponse.json({ 
      success: true, 
      version: version,
      message: 'Restart initiated'
    });
  } catch (error) {
    console.error('Error initiating restart:', error);
    return NextResponse.json(
      { error: 'Failed to initiate restart' },
      { status: 500 }
    );
  }
}


