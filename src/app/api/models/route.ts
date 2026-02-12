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

const COMFYUI_URL = process.env.COMFYUI_URL || 'http://localhost:8188';

/** Build folder/file tree from ComfyUI model paths (e.g. ["SDXL-Lightning/sdxl_lightning_2step_lora.safetensors"]) */
function buildTreeFromPaths(paths: string[], folderType: string): (ModelFile | ModelFolder)[] {
  const root: (ModelFile | ModelFolder)[] = [];
  for (const p of paths) {
    const segments = p.split('/').filter(Boolean);
    if (segments.length === 0) continue;
    let parent: (ModelFile | ModelFolder)[] = root;
    let prefix = folderType;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const isLast = i === segments.length - 1;
      const path = prefix + '/' + seg;
      if (isLast) {
        parent.push({ name: seg, type: folderType, size: 0, path, formattedSize: '0 B' });
      } else {
        let folder = parent.find((c): c is ModelFolder => 'children' in c && c.name === seg) as ModelFolder | undefined;
        if (!folder) {
          folder = { name: seg, type: 'folder', path, children: [], totalSize: 0 };
          parent.push(folder);
        }
        parent = folder.children;
        prefix = path;
      }
    }
  }
  return root;
}

/** Fetch model list from ComfyUI API: GET /models then GET /models/{dir} for each dir */
async function fetchModelsFromComfyUI(): Promise<(ModelFile | ModelFolder)[]> {
  const base = COMFYUI_URL.replace(/\/$/, '');
  const dirsRes = await fetch(`${base}/models`);
  if (!dirsRes.ok) throw new Error(`ComfyUI /models returned ${dirsRes.status}`);
  const dirs: string[] = await dirsRes.json();
  const modelFolders = dirs.filter((d) => d !== 'download_model_base' && d !== 'custom_nodes');
  const structure: (ModelFile | ModelFolder)[] = [];

  for (const dir of modelFolders) {
    try {
      const res = await fetch(`${base}/models/${encodeURIComponent(dir)}`);
      const paths: string[] = res.ok ? await res.json() : [];
      const children = buildTreeFromPaths(Array.isArray(paths) ? paths : [], dir);
      structure.push({
        name: dir,
        type: 'folder',
        path: dir,
        children,
        totalSize: 0,
      });
    } catch {
      structure.push({ name: dir, type: 'folder', path: dir, children: [], totalSize: 0 });
    }
  }
  return structure;
}

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
        if (entry.name === 'custom_nodes') continue;
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
    // Prefer ComfyUI API (reflects ComfyUI/models/ and /data/models/ via extra_model_paths)
    try {
      const structure = await fetchModelsFromComfyUI();
      return NextResponse.json({ structure });
    } catch (comfyError) {
      console.warn('ComfyUI models API unavailable, falling back to filesystem:', comfyError);
    }

    // Fallback: scan filesystem (selected space ComfyUI/models or root ComfyUI/models)
    const spacesPath = join(process.cwd(), 'spaces');
    const selectedVersionPath = join(spacesPath, 'selected_version.txt');
    let selectedVersion = 'v1';
    try {
      const selectedContent = await readFile(selectedVersionPath, 'utf-8');
      selectedVersion = selectedContent.trim() || 'v1';
    } catch {
      // Default to v1 if file doesn't exist
    }

    const comfyUIPath = join(spacesPath, selectedVersion, 'ComfyUI');
    const modelsDir = join(comfyUIPath, 'models');
    let finalModelsDir = modelsDir;
    if (!existsSync(modelsDir)) {
      const fallbackModelsDir = join(process.cwd(), 'ComfyUI', 'models');
      if (existsSync(fallbackModelsDir)) {
        finalModelsDir = fallbackModelsDir;
      } else {
        return NextResponse.json({ structure: [] });
      }
    }

    const structure = await scanDirectory(finalModelsDir);
    return NextResponse.json({ structure });
  } catch (error) {
    console.error('Error reading models:', error);
    return NextResponse.json(
      { error: 'Failed to read models' },
      { status: 500 }
    );
  }
}

