import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const repoUrl = searchParams.get('repo');
    
    if (!repoUrl) {
      return NextResponse.json(
        { error: 'Repository URL is required' },
        { status: 400 }
      );
    }

    // Extract owner and repo from URL
    // Support formats: https://github.com/owner/repo or owner/repo
    let owner: string, repo: string;
    if (repoUrl.includes('github.com')) {
      const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
      if (!match) {
        return NextResponse.json(
          { error: 'Invalid GitHub URL format' },
          { status: 400 }
        );
      }
      [, owner, repo] = match;
      // Remove .git if present
      repo = repo.replace(/\.git$/, '');
    } else {
      const parts = repoUrl.split('/');
      if (parts.length !== 2) {
        return NextResponse.json(
          { error: 'Invalid repository format. Use owner/repo or full GitHub URL' },
          { status: 400 }
        );
      }
      [owner, repo] = parts;
    }

    // Fetch releases from GitHub API
    const releasesUrl = `https://api.github.com/repos/${owner}/${repo}/releases`;
    const response = await fetch(releasesUrl, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'ComfyUI-Space-Manager',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return NextResponse.json(
          { error: 'Repository not found' },
          { status: 404 }
        );
      }
      const errorText = await response.text();
      return NextResponse.json(
        { error: `Failed to fetch releases: ${response.statusText}`, details: errorText },
        { status: response.status }
      );
    }

    const releases = await response.json();
    
    // Format releases to include tag_name, name, published_at
    const formattedReleases = releases.map((release: any) => ({
      tag: release.tag_name,
      name: release.name || release.tag_name,
      publishedAt: release.published_at,
      prerelease: release.prerelease,
    }));

    return NextResponse.json({
      releases: formattedReleases,
      owner,
      repo,
    });
  } catch (error) {
    console.error('Error fetching GitHub releases:', error);
    return NextResponse.json(
      { error: `Failed to fetch releases: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}





