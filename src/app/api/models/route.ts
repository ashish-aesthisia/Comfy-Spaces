import { NextResponse } from 'next/server';
import { join } from 'path';
import { readdir, stat, readFile } from 'fs/promises';
import { existsSync } from 'fs';

interface ModelFile {
  name: string;
  type: string;
  size: number;
  path: string;
  formattedSize?: string;
}

interface ModelFolder {
  name: string;
  type: 'folder';
  path: string;
  children: (ModelFile | ModelFolder)[];
  totalSize?: number;
}

type ModelItem = ModelFile | ModelFolder;

const supportedExtensions = ['.ckpt', '.pt', '.pt2', '.bin', '.pth', '.safetensors', '.pkl', '.sft'];

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

async function scanDirectory(dirPath: string, relativePath: string = ''): Promise<(ModelFile | ModelFolder)[]> {
  const items: (ModelFile | ModelFolder)[] = [];
  
  if (!existsSync(dirPath)) {
    return items;
  }

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      const itemRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      
      if (entry.isDirectory()) {
        // Recursively scan subdirectories
        const children = await scanDirectory(fullPath, itemRelativePath);
        // Calculate total size of folder (even if empty)
        let totalSize = 0;
        const calculateSize = (items: (ModelFile | ModelFolder)[]): number => {
          let size = 0;
          for (const item of items) {
            if ('type' in item && item.type === 'folder') {
              size += calculateSize(item.children);
            } else if ('size' in item) {
              size += item.size;
            }
          }
          return size;
        };
        totalSize = calculateSize(children);
        
        // Include folder even if empty
        items.push({
          name: entry.name,
          type: 'folder',
          path: itemRelativePath,
          children,
          totalSize,
        });
      } else if (entry.isFile()) {
        const ext = entry.name.substring(entry.name.lastIndexOf('.'));
        if (supportedExtensions.includes(ext.toLowerCase())) {
          try {
            const stats = await stat(fullPath);
            items.push({
              name: entry.name,
              type: relativePath.split('/')[0] || 'other',
              size: stats.size,
              path: itemRelativePath,
              formattedSize: formatFileSize(stats.size),
            });
          } catch (error) {
            // Skip files we can't stat
            console.error(`Error statting ${fullPath}:`, error);
          }
        }
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${dirPath}:`, error);
  }

  return items;
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

    // Try to get models from the selected space's ComfyUI directory
    const comfyUIPath = join(spacesPath, selectedVersion, 'ComfyUI');
    const modelsDir = join(comfyUIPath, 'models');
    
    // Fallback to root ComfyUI if space doesn't exist
    let finalModelsDir = modelsDir;
    if (!existsSync(modelsDir)) {
      const fallbackComfyUIPath = join(process.cwd(), 'ComfyUI');
      const fallbackModelsDir = join(fallbackComfyUIPath, 'models');
      if (existsSync(fallbackModelsDir)) {
        finalModelsDir = fallbackModelsDir;
      } else {
        return NextResponse.json({
          structure: [],
        });
      }
    }

    // Scan the models directory recursively
    const structure = await scanDirectory(finalModelsDir);

    return NextResponse.json({
      structure,
    });
  } catch (error) {
    console.error('Error reading models:', error);
    return NextResponse.json(
      { error: 'Failed to read models' },
      { status: 500 }
    );
  }
}

