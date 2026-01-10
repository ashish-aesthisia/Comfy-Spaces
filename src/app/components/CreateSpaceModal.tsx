'use client';

import { useState, useEffect } from 'react';
import { Modal, TextInput, Button, Stack, Group, Text, Select, Grid, Loader, Alert } from '@mantine/core';
import { RiErrorWarningLine, RiCheckLine } from 'react-icons/ri';

interface Release {
  tag: string;
  name: string;
  publishedAt: string;
  prerelease: boolean;
}

interface CreateSpaceModalProps {
  opened: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function CreateSpaceModal({ opened, onClose, onSuccess }: CreateSpaceModalProps) {
  const [visibleName, setVisibleName] = useState('');
  const [githubUrl, setGithubUrl] = useState('https://github.com/Comfy-Org/ComfyUI');
  const [comfyUIArgs, setComfyUIArgs] = useState('');
  const [branch, setBranch] = useState('');
  const [commitId, setCommitId] = useState('');
  
  // Default ComfyUI launch args
  const defaultComfyUIArgs = 'main.py --listen 0.0.0.0';
  const [selectedRelease, setSelectedRelease] = useState<string | null>(null);
  const [releases, setReleases] = useState<Release[]>([]);
  const [loadingReleases, setLoadingReleases] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Generate space ID from visible name
  const generateSpaceId = (name: string): string => {
    return name
      .toLowerCase()
      .replace(/%20/g, '-') // Replace %20 with -
      .replace(/[^a-z0-9-]/g, '-') // Replace special chars with -
      .replace(/-+/g, '-') // Replace multiple dashes with single dash
      .replace(/^-|-$/g, ''); // Remove leading/trailing dashes
  };

  // Fetch releases when modal opens
  useEffect(() => {
    if (opened && githubUrl) {
      fetchReleases();
    }
  }, [opened, githubUrl]);

  const fetchReleases = async () => {
    setLoadingReleases(true);
    setError(null);
    try {
      const response = await fetch(`/api/github/releases?repo=${encodeURIComponent(githubUrl)}`);
      const data = await response.json();
      
      if (!response.ok) {
        setError(data.error || 'Failed to fetch releases');
        setReleases([]);
      } else {
        setReleases(data.releases || []);
      }
    } catch (err) {
      console.error('Error fetching releases:', err);
      setError('Failed to fetch releases');
      setReleases([]);
    } finally {
      setLoadingReleases(false);
    }
  };

  const handleCreate = async () => {
    // Validate visible name
    if (!visibleName || visibleName.length < 2) {
      setError('Space name must be at least 2 characters');
      return;
    }

    const spaceId = generateSpaceId(visibleName);
    if (!spaceId || spaceId.length < 2) {
      setError('Space name must contain at least 2 valid characters');
      return;
    }

    setCreating(true);
    setError(null);
    setSuccess(false);

    try {
      const response = await fetch('/api/spaces/create-from-github', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          visibleName,
          spaceId: generateSpaceId(visibleName),
          githubUrl,
          comfyUIArgs: comfyUIArgs.trim() || undefined,
          branch: branch || undefined,
          commitId: commitId || undefined,
          releaseTag: selectedRelease || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Failed to create space');
        setCreating(false);
        return;
      }

      setSuccess(true);
      setTimeout(() => {
        onSuccess();
        handleClose();
      }, 1500);
    } catch (err) {
      console.error('Error creating space:', err);
      setError('Failed to create space');
      setCreating(false);
    }
  };

  const handleClose = () => {
    if (!creating) {
      setVisibleName('');
      setComfyUIArgs('');
      setBranch('');
      setCommitId('');
      setSelectedRelease(null);
      setError(null);
      setSuccess(false);
      onClose();
    }
  };

  const releaseOptions = releases.map((release) => ({
    value: release.tag,
    label: `${release.name} (${release.tag})${release.prerelease ? ' [Pre-release]' : ''}`,
  }));

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={
        <Text size="lg" fw={600} c="#ffffff">
          Create New Space
        </Text>
      }
      size="xl"
      closeOnClickOutside={!creating}
      closeOnEscape={!creating}
      styles={{
        title: { color: '#ffffff' },
        content: { backgroundColor: '#1a1b1e', borderRadius: '8px' },
        header: { backgroundColor: '#25262b', borderBottom: '1px solid #373a40', padding: '20px' },
        body: { backgroundColor: '#1a1b1e', padding: '24px' },
      }}
    >
      <Stack gap="md">
        {error && (
          <Alert
            icon={<RiErrorWarningLine size={16} />}
            color="red"
            title="Error"
            styles={{
              root: { backgroundColor: '#2d2020', border: '1px solid #5c1a1a' },
              title: { color: '#ff6b6b' },
              message: { color: '#ff9999' },
            }}
          >
            {error}
          </Alert>
        )}

        {success && (
          <Alert
            icon={<RiCheckLine size={16} />}
            color="green"
            title="Success"
            styles={{
              root: { backgroundColor: '#1e2e1e', border: '1px solid #2d5a2d' },
              title: { color: '#51cf66' },
              message: { color: '#69db7c' },
            }}
          >
            Space created successfully!
          </Alert>
        )}

        <Stack gap="md">
          <TextInput
            label="Space Name"
            placeholder="Enter space name (min 2 characters)"
            value={visibleName}
            onChange={(e) => setVisibleName(e.target.value)}
            required
            disabled={creating}
            description={visibleName ? `Space ID: ${generateSpaceId(visibleName)}` : undefined}
            styles={{
              label: { color: '#ffffff', marginBottom: '6px', fontWeight: 500 },
              input: { 
                backgroundColor: '#25262b', 
                border: '1px solid #373a40', 
                color: '#ffffff',
                '&:focus': { borderColor: '#0070f3' },
              },
              description: { color: '#888888', fontSize: '12px', marginTop: '4px' },
            }}
          />

          <TextInput
            label="ComfyUI GitHub URL"
            placeholder="https://github.com/Comfy-Org/ComfyUI"
            value={githubUrl}
            onChange={(e) => {
              setGithubUrl(e.target.value);
              setSelectedRelease(null); // Reset release when URL changes
            }}
            required
            disabled={creating}
            styles={{
              label: { color: '#ffffff', marginBottom: '6px', fontWeight: 500 },
              input: { 
                backgroundColor: '#25262b', 
                border: '1px solid #373a40', 
                color: '#ffffff',
                '&:focus': { borderColor: '#0070f3' },
              },
            }}
          />

          <TextInput
            label="ComfyUI Launch Arguments (Optional)"
            placeholder={defaultComfyUIArgs}
            value={comfyUIArgs}
            onChange={(e) => setComfyUIArgs(e.currentTarget.value)}
            disabled={creating}
            styles={{
              label: { color: '#ffffff', marginBottom: '6px', fontWeight: 500 },
              input: { 
                backgroundColor: '#25262b', 
                border: '1px solid #373a40', 
                color: '#ffffff',
                '&:focus': { borderColor: '#0070f3' },
              },
              description: { color: '#888888', fontSize: '12px', marginTop: '4px' },
            }}
            description={`Default: ${defaultComfyUIArgs}. Override to customize launch arguments (e.g., --port, --enable-cors-header, --disable-xformers)`}
          />
        </Stack>

        <div style={{ position: 'relative', marginTop: '8px' }}>
          <Text size="sm" fw={500} c="#ffffff" mb="md">
            Select Version Source
          </Text>
          <Grid gutter="xl">
            <Grid.Col span={5}>
              <Stack gap="md">
                <Text size="xs" fw={500} c="#888888" tt="uppercase" style={{ letterSpacing: '0.5px' }}>
                  Custom Branch/Commit
                </Text>
                <TextInput
                  label="Branch (Optional)"
                  placeholder="e.g., master, main"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  disabled={creating || !!selectedRelease}
                  styles={{
                    label: { color: '#ffffff', marginBottom: '4px' },
                    input: { 
                      backgroundColor: '#25262b', 
                      border: '1px solid #373a40', 
                      color: '#ffffff',
                      '&:focus': { borderColor: '#0070f3' },
                    },
                  }}
                />
                <TextInput
                  label="Commit ID (Optional)"
                  placeholder="e.g., abc123def"
                  value={commitId}
                  onChange={(e) => setCommitId(e.target.value)}
                  disabled={creating || !!selectedRelease}
                  styles={{
                    label: { color: '#ffffff', marginBottom: '4px' },
                    input: { 
                      backgroundColor: '#25262b', 
                      border: '1px solid #373a40', 
                      color: '#ffffff',
                      '&:focus': { borderColor: '#0070f3' },
                    },
                  }}
                />
                {!selectedRelease && (
                  <Text size="xs" c="#666666" mt="-8px">
                    Leave empty to use default branch
                  </Text>
                )}
              </Stack>
            </Grid.Col>
            
            {/* Vertical divider with OR */}
            <Grid.Col span={2} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', minHeight: '120px' }}>
              <div style={{ 
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                width: '100%',
                height: '100%',
              }}>
                {/* Vertical line */}
                <div style={{
                  position: 'absolute',
                  width: '1px',
                  height: '100%',
                  backgroundColor: '#373a40',
                  top: 0,
                  left: '50%',
                  transform: 'translateX(-50%)',
                }} />
                {/* OR text with background */}
                <div style={{
                  backgroundColor: '#1a1b1e',
                  padding: '8px 16px',
                  position: 'relative',
                  zIndex: 2,
                  borderRadius: '4px',
                  border: '1px solid #373a40',
                }}>
                  <Text size="xs" fw={600} c="#888888" style={{ letterSpacing: '1px' }}>
                    OR
                  </Text>
                </div>
              </div>
            </Grid.Col>
            
            <Grid.Col span={5}>
              <Stack gap="md">
                <Text size="xs" fw={500} c="#888888" tt="uppercase" style={{ letterSpacing: '0.5px' }}>
                  Release Version
                </Text>
                <Select
                  label="Select Release"
                  placeholder={loadingReleases ? 'Loading releases...' : 'Choose a release version'}
                  data={releaseOptions}
                  value={selectedRelease}
                  onChange={(value) => {
                    setSelectedRelease(value);
                    if (value) {
                      setBranch('');
                      setCommitId('');
                    }
                  }}
                  disabled={creating || loadingReleases}
                  searchable
                  clearable
                  rightSection={loadingReleases ? <Loader size="xs" /> : undefined}
                  styles={{
                    label: { color: '#ffffff', marginBottom: '4px' },
                    input: { 
                      backgroundColor: '#25262b', 
                      border: '1px solid #373a40', 
                      color: '#ffffff',
                      '&:focus': { borderColor: '#0070f3' },
                    },
                    dropdown: { backgroundColor: '#25262b', border: '1px solid #373a40' },
                    option: { 
                      backgroundColor: '#25262b',
                      color: '#ffffff',
                      '&[dataSelected]': { backgroundColor: '#373a40' },
                      '&[dataHovered]': { backgroundColor: '#2c2e33' },
                    },
                  }}
                />
                {loadingReleases && (
                  <Text size="xs" c="#666666" mt="-8px">
                    Fetching releases from GitHub...
                  </Text>
                )}
                {!loadingReleases && releases.length === 0 && githubUrl && (
                  <Text size="xs" c="#666666" mt="-8px">
                    No releases found or repository not accessible
                  </Text>
                )}
                {!loadingReleases && releases.length > 0 && !selectedRelease && (
                  <Text size="xs" c="#666666" mt="-8px">
                    {releases.length} release{releases.length !== 1 ? 's' : ''} available
                  </Text>
                )}
              </Stack>
            </Grid.Col>
          </Grid>
        </div>

        <Group justify="flex-end" mt="xl" pt="md" style={{ borderTop: '1px solid #373a40' }}>
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={creating}
            size="sm"
            styles={{
              root: { 
                borderColor: '#373a40', 
                color: '#ffffff',
                '&:hover': { 
                  borderColor: '#555555',
                  backgroundColor: '#25262b',
                },
              },
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            loading={creating}
            disabled={!visibleName || visibleName.length < 2 || creating}
            size="sm"
            styles={{
              root: { 
                backgroundColor: '#0070f3', 
                color: '#ffffff',
                '&:hover': { backgroundColor: '#0051cc' },
                '&:disabled': { backgroundColor: '#373a40', color: '#666666' },
              },
            }}
          >
            Launch Space
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

