import { NextResponse } from 'next/server';
import { join } from 'path';
import { readdir, stat, readFile } from 'fs/promises';
import { existsSync } from 'fs';

interface OutputFile {
  name: string;
  path: string;
  size: number;
  formattedSize: string;
  created: Date;
  createdDate: string; // YYYY-MM-DD format
  extension: string;
  isDirectory: boolean;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

async function scanOutputsDirectory(dirPath: string, relativePath: string = ''): Promise<OutputFile[]> {
  const files: OutputFile[] = [];
  
  if (!existsSync(dirPath)) {
    return files;
  }

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      const itemRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      
      try {
        const stats = await stat(fullPath);
        const created = stats.birthtime || stats.mtime;
        const createdDate = created.toISOString().split('T')[0]; // YYYY-MM-DD
        
        if (entry.isDirectory()) {
          // Recursively scan subdirectories
          const subFiles = await scanOutputsDirectory(fullPath, itemRelativePath);
          files.push(...subFiles);
        } else {
          // It's a file
          const ext = entry.name.substring(entry.name.lastIndexOf('.'));
          files.push({
            name: entry.name,
            path: itemRelativePath,
            size: stats.size,
            formattedSize: formatFileSize(stats.size),
            created,
            createdDate,
            extension: ext.toLowerCase(),
            isDirectory: false,
          });
        }
      } catch (error) {
        // Skip files we can't stat
        console.error(`Error statting ${fullPath}:`, error);
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${dirPath}:`, error);
  }

  return files;
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
        return NextResponse.json({
          files: [],
          groupedByDate: {},
        });
      }
    }

    // Scan the outputs directory recursively
    const allFiles = await scanOutputsDirectory(finalOutputsDir);
    
    // Sort by created date (most recent first)
    allFiles.sort((a, b) => b.created.getTime() - a.created.getTime());
    
    // Group files by date
    const groupedByDate: Record<string, OutputFile[]> = {};
    for (const file of allFiles) {
      if (!groupedByDate[file.createdDate]) {
        groupedByDate[file.createdDate] = [];
      }
      groupedByDate[file.createdDate].push(file);
    }

    return NextResponse.json({
      files: allFiles,
      groupedByDate,
    });
  } catch (error) {
    console.error('Error reading files:', error);
    return NextResponse.json(
      { error: 'Failed to read files' },
      { status: 500 }
    );
  }
}
