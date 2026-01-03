import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';

// GET endpoint for fetching requirements.txt
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> | { spaceId: string } }
) {
  try {
    const resolvedParams = params instanceof Promise ? await params : params;
    const spaceId = decodeURIComponent(resolvedParams.spaceId);
    
    if (!spaceId) {
      return NextResponse.json(
        { error: 'Space ID is required' },
        { status: 400 }
      );
    }

    const spacesPath = join(process.cwd(), 'spaces');
    const requirementsPath = join(spacesPath, spaceId, 'requirements.txt');

    // Check if requirements.txt exists
    if (!existsSync(requirementsPath)) {
      return NextResponse.json(
        { error: 'requirements.txt not found for this space' },
        { status: 404 }
      );
    }

    // Read requirements.txt
    const content = await readFile(requirementsPath, 'utf-8');

    return NextResponse.json({ 
      success: true,
      content: content
    });
  } catch (error) {
    console.error('Error reading requirements:', error);
    return NextResponse.json(
      { error: `Failed to read requirements: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}

// PUT endpoint for updating requirements.txt
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> | { spaceId: string } }
) {
  try {
    const resolvedParams = params instanceof Promise ? await params : params;
    const spaceId = decodeURIComponent(resolvedParams.spaceId);
    
    if (!spaceId) {
      return NextResponse.json(
        { error: 'Space ID is required' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { content } = body;

    if (content === undefined || typeof content !== 'string') {
      return NextResponse.json(
        { error: 'content is required and must be a string' },
        { status: 400 }
      );
    }

    const spacesPath = join(process.cwd(), 'spaces');
    const spacePath = join(spacesPath, spaceId);
    const requirementsPath = join(spacePath, 'requirements.txt');
    const spaceJsonPath = join(spacePath, 'space.json');

    // Check if space exists
    if (!existsSync(spacePath)) {
      return NextResponse.json(
        { error: 'Space not found' },
        { status: 404 }
      );
    }

    // Write requirements.txt
    await writeFile(requirementsPath, content, 'utf-8');

    // Update space.json dependencies if it exists
    if (existsSync(spaceJsonPath)) {
      try {
        const spaceJsonContent = await readFile(spaceJsonPath, 'utf-8');
        const spaceJson = JSON.parse(spaceJsonContent);
        
        // Parse requirements.txt content into dependencies array
        const dependencies = content
          .trim()
          .split('\n')
          .filter(line => line.trim().length > 0 && !line.trim().startsWith('#'))
          .map(line => line.trim());
        
        // Update dependencies in space.json
        spaceJson.dependencies = dependencies;
        
        // Write updated space.json
        await writeFile(spaceJsonPath, JSON.stringify(spaceJson, null, 2), 'utf-8');
      } catch (error) {
        console.error('Error updating space.json:', error);
        // Don't fail the request if space.json update fails
      }
    }

    return NextResponse.json({ 
      success: true,
      message: 'requirements.txt updated successfully'
    });
  } catch (error) {
    console.error('Error updating requirements:', error);
    return NextResponse.json(
      { error: `Failed to update requirements: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}


