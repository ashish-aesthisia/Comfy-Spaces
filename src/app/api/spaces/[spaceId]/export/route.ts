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
    const spaceJson = JSON.parse(spaceJsonContent);
    spaceJson.metadata = spaceJson.metadata || {};
    if (!spaceJson.metadata.torchVersion) {
      const requirementsPath = join(spacesPath, spaceId, 'requirements.txt');
      if (existsSync(requirementsPath)) {
        const torchLine = (await readFile(requirementsPath, 'utf-8'))
          .split('\n')
          .map((line) => line.split('#')[0].trim())
          .find((line) =>
            line &&
            !line.startsWith('--') &&
            (/^torch($|[=<>!~\s@])/i.test(line) || /(^|\/)torch-.*\.(whl|zip|tar\.gz)$/i.test(line))
          );
        if (torchLine) {
          const match = torchLine.match(/^torch\s*==\s*([^\s#]+)$/i);
          spaceJson.metadata.torchVersion = match ? match[1] : torchLine;
        }
      }
      if (!spaceJson.metadata.torchVersion) {
        spaceJson.metadata.torchVersion = null;
      }
    }
    
    // Return as JSON with proper headers for download
    return new NextResponse(JSON.stringify(spaceJson, null, 2), {
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
