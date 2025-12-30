import { NextResponse } from 'next/server';
import { join } from 'path';
import { readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';

interface Model {
  name: string;
  type: string;
  size: number;
  path: string;
}

const supportedExtensions = ['.ckpt', '.pt', '.pt2', '.bin', '.pth', '.safetensors', '.pkl', '.sft'];
const modelTypes = ['checkpoints', 'loras', 'vae', 'embeddings', 'controlnet', 'upscale_models', 'clip', 'text_encoders'];

async function getModelsInDirectory(dirPath: string, type: string): Promise<Model[]> {
  const models: Model[] = [];
  
  if (!existsSync(dirPath)) {
    return models;
  }

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isFile()) {
        const ext = entry.name.substring(entry.name.lastIndexOf('.'));
        if (supportedExtensions.includes(ext.toLowerCase())) {
          const fullPath = join(dirPath, entry.name);
          try {
            const stats = await stat(fullPath);
            models.push({
              name: entry.name,
              type,
              size: stats.size,
              path: fullPath,
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

  return models;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

export async function GET() {
  try {
    const comfyUIPath = join(process.cwd(), 'ComfyUI');
    const modelsDir = join(comfyUIPath, 'models');
    
    if (!existsSync(modelsDir)) {
      return NextResponse.json({
        models: [],
      });
    }

    const allModels: Model[] = [];

    // Get models from each model type directory
    for (const type of modelTypes) {
      const typePath = join(modelsDir, type);
      const models = await getModelsInDirectory(typePath, type);
      allModels.push(...models);
    }

    // Format file sizes
    const modelsWithFormattedSize = allModels.map(model => ({
      ...model,
      formattedSize: formatFileSize(model.size),
    }));

    return NextResponse.json({
      models: modelsWithFormattedSize,
    });
  } catch (error) {
    console.error('Error reading models:', error);
    return NextResponse.json(
      { error: 'Failed to read models' },
      { status: 500 }
    );
  }
}

