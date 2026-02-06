import { NextRequest, NextResponse } from 'next/server';
import { join, resolve } from 'path';
import { readFile } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { readFile as readFileAsync } from 'fs/promises';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> | { path: string[] } }
) {
  try {
    // Handle params as Promise (Next.js 15+) or direct object
    const resolvedParams = params instanceof Promise ? await params : params;
    const pathArray = resolvedParams.path || [];
    
    if (!pathArray || pathArray.length === 0) {
      return NextResponse.json({ error: 'File path is required' }, { status: 400 });
    }
    
    const filePath = Array.isArray(pathArray) ? pathArray.join('/') : pathArray;
    
    // Get selected space
    const spacesPath = join(process.cwd(), 'spaces');
    const selectedVersionPath = join(spacesPath, 'selected_version.txt');
    let selectedVersion = 'v1';
    try {
      const selectedContent = await readFileAsync(selectedVersionPath, 'utf-8');
      selectedVersion = selectedContent.trim() || 'v1';
    } catch (error) {
      // Default to v1 if file doesn't exist
    }

    // Try to get outputs from the selected space's ComfyUI directory
    const comfyUIPath = join(spacesPath, selectedVersion, 'ComfyUI');
    
    // Try both 'output' and 'outputs' directories
    let outputsDir = join(comfyUIPath, 'output');
    if (!existsSync(outputsDir)) {
      outputsDir = join(comfyUIPath, 'outputs');
    }
    
    // Fallback to root ComfyUI if space doesn't exist
    let finalOutputsDir = outputsDir;
    if (!existsSync(outputsDir)) {
      const fallbackComfyUIPath = join(process.cwd(), 'ComfyUI');
      const fallbackOutputsDir = join(fallbackComfyUIPath, 'output');
      const fallbackOutputsDirAlt = join(fallbackComfyUIPath, 'outputs');
      
      if (existsSync(fallbackOutputsDir)) {
        finalOutputsDir = fallbackOutputsDir;
      } else if (existsSync(fallbackOutputsDirAlt)) {
        finalOutputsDir = fallbackOutputsDirAlt;
      } else {
        return NextResponse.json({ error: 'Outputs directory not found' }, { status: 404 });
      }
    }

    // Normalize the path to prevent directory traversal
    const normalizedPath = join(...pathArray.map(p => p.replace(/\.\./g, '')));
    const fullPath = join(finalOutputsDir, normalizedPath);
    
    // Security check: ensure the file is within the outputs directory
    // Use resolve to get absolute paths for comparison
    const resolvedOutputsDir = resolve(finalOutputsDir);
    const resolvedFullPath = resolve(fullPath);
    
    if (!resolvedFullPath.startsWith(resolvedOutputsDir)) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    if (!existsSync(fullPath)) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const fileBuffer = await readFileAsync(fullPath);
    const fileName = pathArray[pathArray.length - 1] || '';
    const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
    
    // Determine content type
    const contentTypeMap: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.svg': 'image/svg+xml',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mov': 'video/quicktime',
    };
    
    const contentType = contentTypeMap[ext] || 'application/octet-stream';

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    console.error('Error serving file:', error);
    return NextResponse.json({ error: 'Failed to serve file' }, { status: 500 });
  }
}
