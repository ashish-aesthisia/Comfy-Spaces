import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> | { spaceId: string } }
) {
  try {
    // Handle both Promise and direct params (for Next.js version compatibility)
    const resolvedParams = params instanceof Promise ? await params : params;
    const spaceId = decodeURIComponent(resolvedParams.spaceId);
    
    if (!spaceId) {
      return NextResponse.json(
        { error: 'Space ID is required' },
        { status: 400 }
      );
    }

    const spacesPath = join(process.cwd(), 'spaces');
    const spaceJsonPath = join(spacesPath, spaceId, 'space.json');

    if (!existsSync(spaceJsonPath)) {
      return NextResponse.json(
        { error: 'space.json not found for this space' },
        { status: 404 }
      );
    }

    const spaceJsonContent = await readFile(spaceJsonPath, 'utf-8');
    
    // Return as JSON with proper headers for download
    return new NextResponse(spaceJsonContent, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="space-${spaceId}.json"`,
      },
    });
  } catch (error) {
    console.error('Error exporting space.json:', error);
    return NextResponse.json(
      { error: `Failed to export space.json: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}

