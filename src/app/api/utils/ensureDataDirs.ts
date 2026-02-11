import { mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

/**
 * Ensures the data/models and data/outputs directories exist, creating them if necessary.
 * This should be called during startup or before any operation that needs these directories.
 */
export async function ensureDataDirs(): Promise<void> {
  const dataPath = join(process.cwd(), 'data');
  const modelsPath = join(dataPath, 'models');
  const outputsPath = join(dataPath, 'outputs');
  
  try {
    // Create data directory if it doesn't exist
    if (!existsSync(dataPath)) {
      await mkdir(dataPath, { recursive: true });
      console.log('Created data directory:', dataPath);
    }
    
    // Create models directory if it doesn't exist
    if (!existsSync(modelsPath)) {
      await mkdir(modelsPath, { recursive: true });
      console.log('Created data/models directory:', modelsPath);
    }
    
    // Create outputs directory if it doesn't exist
    if (!existsSync(outputsPath)) {
      await mkdir(outputsPath, { recursive: true });
      console.log('Created data/outputs directory:', outputsPath);
    }
  } catch (error) {
    console.error('Failed to create data directories:', error);
    throw error;
  }
}
