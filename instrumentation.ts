export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { ensureDataDirs } = await import('./src/app/api/utils/ensureDataDirs');
    const { ensureSpacesDir } = await import('./src/app/api/utils/ensureSpacesDir');
    
    // Ensure required directories exist on startup
    try {
      await ensureSpacesDir();
      await ensureDataDirs();
      console.log('[APP] Required directories initialized successfully');
    } catch (error) {
      console.error('[APP] Failed to initialize directories:', error);
    }
  }
}
