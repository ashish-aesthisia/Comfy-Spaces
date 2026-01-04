import { mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

/**
 * Ensures the spaces directory exists, creating it if necessary.
 * This should be called during startup or before any operation that needs the spaces directory.
 */
export async function ensureSpacesDir(): Promise<void> {
  const spacesPath = join(process.cwd(), 'spaces');
  
  if (!existsSync(spacesPath)) {
    try {
      await mkdir(spacesPath, { recursive: true });
      console.log('Created spaces directory:', spacesPath);
    } catch (error) {
      console.error('Failed to create spaces directory:', error);
      throw error;
    }
  }
}

