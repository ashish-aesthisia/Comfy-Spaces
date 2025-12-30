'use client';

import { useEffect, useState } from 'react';
import { Container, Title, Text, Stack, Button, Grid, Card, Group, Menu, ActionIcon, Modal, ScrollArea, Paper, Badge } from '@mantine/core';
import { useRouter } from 'next/navigation';
import { RiHomeLine, RiCheckboxCircleFill, RiCloseCircleFill, RiDownloadLine, RiPencilLine, RiMoreFill, RiDeleteBinLine, RiStopCircleLine, RiHistoryLine, RiFileListLine, RiAddLine, RiArrowDownSLine, RiArrowUpSLine, RiExternalLinkLine } from 'react-icons/ri';
import LogSidebar from './components/LogSidebar';
import NodeTreeModal from './components/NodeTreeModal';

interface Node {
  name: string;
  status: 'active' | 'inactive' | 'failed';
  existsInApi: boolean;
  existsInDataNodes: boolean;
  extensionPaths?: string[];
  githubUrl?: string;
  branch?: string;
  commitId?: string;
  disabled?: boolean;
}

interface SpaceInfo {
  name: string;
  pythonVersion: string;
  lastUpdated: string;
  path: string;
  comfyUIVersion: string;
}

interface Dependency {
  name: string;
  version: string;
  fullLine: string;
}

interface Model {
  name: string;
  type: string;
  size: number;
  path: string;
  formattedSize?: string;
}

export default function ActivePage() {
  const [selectedVersion, setSelectedVersion] = useState<string>('');
  const [spaces, setSpaces] = useState<SpaceInfo[]>([]);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [dependencies, setDependencies] = useState<Dependency[]>([]);
  const [dependenciesExpanded, setDependenciesExpanded] = useState(false);
  const [models, setModels] = useState<Model[]>([]);
  const [modelsExpanded, setModelsExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [modalOpened, setModalOpened] = useState(false);
  const [changesModalOpened, setChangesModalOpened] = useState(false);
  const [changesDiff, setChangesDiff] = useState<any>(null);
  const [loadingChanges, setLoadingChanges] = useState(false);
  const [creatingSpace, setCreatingSpace] = useState(false);
  const [nextSpaceName, setNextSpaceName] = useState<string>('');
  const [logsSidebarOpen, setLogsSidebarOpen] = useState(false);
  const router = useRouter();

  const handleUpdate = (node: Node) => {
    if (!node.githubUrl) return;
    const params = new URLSearchParams({
      githubUrl: node.githubUrl,
    });
    if (node.branch) params.append('branch', node.branch);
    if (node.commitId) params.append('commitId', node.commitId);
    router.push(`/install?${params.toString()}`);
  };

  const handleDelete = async (nodeName: string) => {
    if (!confirm(`Are you sure you want to delete "${nodeName}"? This action cannot be undone.`)) {
      return;
    }

    try {
      const response = await fetch(`/api/nodes/${encodeURIComponent(nodeName)}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        alert(data.error || 'Failed to delete node');
        return;
      }

      // Refresh the nodes list
      const extensionsResponse = await fetch('/api/extensions');
      const extensionsData = await extensionsResponse.json();
      if (!extensionsData.error) {
        setNodes(extensionsData.nodes || []);
      }
    } catch (error) {
      console.error('Error deleting node:', error);
      alert('Failed to delete node');
    }
  };

  const handleDisable = async (nodeName: string, currentlyDisabled: boolean) => {
    try {
      const response = await fetch(`/api/nodes/${encodeURIComponent(nodeName)}/disable`, {
        method: currentlyDisabled ? 'DELETE' : 'POST',
      });

      if (!response.ok) {
        const data = await response.json();
        alert(data.error || `Failed to ${currentlyDisabled ? 'enable' : 'disable'} node`);
        return;
      }

      // Refresh the nodes list
      const extensionsResponse = await fetch('/api/extensions');
      const extensionsData = await extensionsResponse.json();
      if (!extensionsData.error) {
        setNodes(extensionsData.nodes || []);
      }
    } catch (error) {
      console.error(`Error ${currentlyDisabled ? 'enabling' : 'disabling'} node:`, error);
      alert(`Failed to ${currentlyDisabled ? 'enable' : 'disable'} node`);
    }
  };

  const handleShowChanges = async () => {
    setLoadingChanges(true);
    setChangesModalOpened(true);
    try {
      const [diffResponse, spacesResponse] = await Promise.all([
        fetch('/api/requirements/diff'),
        fetch('/api/spaces')
      ]);
      
      const diffData = await diffResponse.json();
      const spacesData = await spacesResponse.json();
      
      if (!diffResponse.ok) {
        setChangesDiff({ error: diffData.error || 'Failed to load changes' });
      } else {
        setChangesDiff(diffData);
      }

      // Calculate next space name
      if (spacesData.spaces && spacesData.spaces.length > 0) {
        const versions = spacesData.spaces
          .map((s: SpaceInfo) => {
            const match = s.name.match(/^v(\d+)$/);
            return match ? parseInt(match[1], 10) : 0;
          })
          .filter((v: number) => v > 0)
          .sort((a: number, b: number) => b - a);
        
        const nextVersionNumber = versions.length > 0 ? versions[0] + 1 : 2;
        setNextSpaceName(`v${nextVersionNumber}`);
      } else {
        setNextSpaceName('v2');
      }
    } catch (error) {
      console.error('Error fetching changes:', error);
      setChangesDiff({ error: 'Failed to load changes' });
    } finally {
      setLoadingChanges(false);
    }
  };

  const handleCreateRevision = async () => {
    if (!confirm('Create a new revision? This will update the current revision\'s backup and create a new revision with the current requirements.')) {
      return;
    }

    setCreatingRevision(true);
    try {
      const response = await fetch('/api/revisions/create', {
        method: 'POST',
      });

      const data = await response.json();

      if (!response.ok) {
        alert(data.error || 'Failed to create new revision');
        setCreatingRevision(false);
        return;
      }

      alert(`New revision ${data.newVersion} created successfully!`);
      setChangesModalOpened(false);
      setChangesDiff(null);
      
      // Refresh the page to show the new revision
      window.location.reload();
    } catch (error) {
      console.error('Error creating revision:', error);
      alert('Failed to create new revision');
      setCreatingRevision(false);
    }
  };

  const fetchNodesForSpace = async (spaceId: string) => {
    try {
      const response = await fetch(`/api/extensions?space=${encodeURIComponent(spaceId)}`);
      const data = await response.json();
      if (data.error) {
        setError(data.message || 'Failed to fetch extensions');
        setNodes([]);
      } else {
        setNodes(data.nodes || []);
        setError(null);
      }
    } catch (err) {
      console.error('Error fetching nodes:', err);
      setError('Failed to fetch nodes');
      setNodes([]);
    }
  };

  useEffect(() => {
    // Fetch the selected version and extensions
    Promise.all([
      fetch('/api/spaces').then(res => res.json()),
      fetch('/api/extensions').then(res => res.json()),
      fetch('/api/requirements').then(res => res.json()),
      fetch('/api/models').then(res => res.json())
    ])
      .then(async ([spaceData, extensionsData, requirementsData, modelsData]) => {
        setSelectedVersion(spaceData.selectedVersion);
        setSpaces(spaceData.spaces || []);
        
        // Fetch extensions for the selected space
        const selectedSpaceId = spaceData.selectedVersion;
        if (selectedSpaceId) {
          await fetchNodesForSpace(selectedSpaceId);
        } else {
          // Fallback to default extensions if no space selected
          if (extensionsData.error) {
            setError(extensionsData.message || 'Failed to fetch extensions');
            setNodes([]);
          } else {
            setNodes(extensionsData.nodes || []);
          }
        }
        
        if (requirementsData.error) {
          console.error('Error fetching requirements:', requirementsData.error);
          setDependencies([]);
        } else {
          setDependencies(requirementsData.dependencies || []);
        }
        if (modelsData.error) {
          console.error('Error fetching models:', modelsData.error);
          setModels([]);
        } else {
          setModels(modelsData.models || []);
        }
        setLoading(false);
      })
      .catch(err => {
        console.error('Error fetching data:', err);
        setError('Failed to load data');
        setLoading(false);
      });
  }, []);

  // Refetch nodes when selected space changes
  useEffect(() => {
    if (selectedVersion) {
      fetchNodesForSpace(selectedVersion);
    }
  }, [selectedVersion]);

  return (
    <>
      {/* Top Bar */}
      <Paper
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 100,
          backgroundColor: '#1a1b1e',
          borderBottom: '1px solid #373a40',
          borderRadius: 0,
        }}
      >
        <Container size="xl" py="md" style={{ width: '100%' }}>
          <Group justify="space-between" align="center">
            <Group gap="sm" align="center">
              <ActionIcon
                variant="subtle"
                size="lg"
                onClick={() => router.push('/')}
                style={{ color: '#ffffff' }}
                title="Home"
              >
                <RiHomeLine size={20} />
              </ActionIcon>
              <Text size="lg" fw={600} c="#ffffff">
                {selectedVersion || 'No space selected'}
              </Text>
            </Group>
            <Group gap="sm" align="center">
              <Button
                component="a"
                href="http://localhost:8188"
                target="_blank"
                rel="noopener noreferrer"
                variant="subtle"
                size="sm"
                leftSection={<RiExternalLinkLine size={16} />}
                style={{
                  color: '#0070f3',
                  fontWeight: 'bold',
                }}
              >
                Launch ComfyUI
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  if (!selectedVersion) return;
                  try {
                    const response = await fetch(`/api/spaces/${encodeURIComponent(selectedVersion)}/export`);
                    if (!response.ok) {
                      const error = await response.json();
                      alert(error.error || 'Failed to export space.json');
                      return;
                    }
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `space-${selectedVersion}.json`;
                    document.body.appendChild(a);
                    a.click();
                    window.URL.revokeObjectURL(url);
                    document.body.removeChild(a);
                  } catch (error) {
                    console.error('Error exporting space.json:', error);
                    alert('Failed to export space.json');
                  }
                }}
                disabled={!selectedVersion}
                leftSection={<RiDownloadLine size={16} />}
                styles={{
                  root: {
                    borderColor: selectedVersion ? '#373a40' : '#2c2e33',
                    color: selectedVersion ? '#ffffff' : '#666666',
                    '&:hover': {
                      borderColor: selectedVersion ? '#555555' : '#2c2e33',
                      backgroundColor: selectedVersion ? '#25262b' : 'transparent',
                    },
                    '&:disabled': {
                      borderColor: '#2c2e33',
                      color: '#666666',
                    },
                  },
                }}
              >
                Export
              </Button>
              <ActionIcon
                variant="subtle"
                size="lg"
                onClick={handleShowChanges}
                style={{
                  color: '#51cf66',
                }}
                title="History"
              >
                <RiHistoryLine size={20} />
              </ActionIcon>
              <ActionIcon
                variant={logsSidebarOpen ? 'filled' : 'subtle'}
                size="lg"
                onClick={() => setLogsSidebarOpen(!logsSidebarOpen)}
                style={{
                  color: logsSidebarOpen ? '#ffffff' : '#888888',
                  backgroundColor: logsSidebarOpen ? '#0070f3' : 'transparent',
                }}
                title="Toggle Logs"
              >
                <RiFileListLine size={20} />
              </ActionIcon>
            </Group>
          </Group>
        </Container>
      </Paper>

      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', backgroundColor: '#1a1b1e', paddingTop: '2rem', paddingBottom: '2rem' }}>
        <Container size="xl" py="xl" style={{ width: '100%' }}>
          <Stack gap="md">
            <div>
              <Stack gap="md" mb="md">
                <Group gap="sm" align="center">
                  {(() => {
                    const selectedSpace = spaces.find(s => s.name === selectedVersion);
                    return selectedSpace ? (
                      <>
                        <Badge
                          size="sm"
                          variant="outline"
                          style={{
                            borderColor: '#a78bfa',
                            color: '#a78bfa',
                            backgroundColor: 'transparent',
                          }}
                        >
                          Python: {selectedSpace.pythonVersion}
                        </Badge>
                        <Badge
                          size="sm"
                          variant="outline"
                          style={{
                            borderColor: '#a78bfa',
                            color: '#a78bfa',
                            backgroundColor: 'transparent',
                          }}
                        >
                          ComfyUI: {selectedSpace.comfyUIVersion}
                        </Badge>
                      </>
                    ) : null;
                  })()}
                </Group>
                <Group justify="space-between" align="center">
                  <Group gap="sm" align="center">
                    <Title order={2}>Nodes</Title>
                    <ActionIcon
                      variant="outline"
                      size="sm"
                      onClick={() => router.push('/install')}
                      style={{
                        borderColor: '#0070f3',
                        color: '#0070f3',
                        borderRadius: '50%',
                      }}
                      title="Install new Custom Node"
                    >
                      <RiAddLine size={16} />
                    </ActionIcon>
                  </Group>
                  {nodes.length > 0 && (
                    <Text size="sm" c="dimmed">
                      {nodes.filter(n => n.status === 'active').length} active, {nodes.filter(n => n.status === 'failed').length} failed
                    </Text>
                  )}
                </Group>
              </Stack>
              {error ? (
                <Card padding="md" radius="md" style={{ backgroundColor: '#25262b', border: '1px solid #ff6b6b' }}>
                  <Text c="red" size="sm">Error: {error}</Text>
                </Card>
              ) : loading ? (
                <Text c="dimmed">Loading nodes...</Text>
              ) : nodes.length === 0 ? (
                <Text c="dimmed">No nodes found</Text>
              ) : (
                <Grid gutter="md">
                  {nodes.map((node, index) => (
                    <Grid.Col key={index} span={{ base: 12, sm: 6, md: 4, lg: 3 }}>
                      <Card
                        padding="md"
                        radius="md"
                        style={{
                          backgroundColor: '#25262b',
                          border: node.status === 'failed' 
                            ? '1px solid #ff6b6b' 
                            : '1px solid #373a40',
                          height: '100%',
                          transition: 'transform 0.2s, box-shadow 0.2s',
                          cursor: node.extensionPaths && node.extensionPaths.length > 0 ? 'pointer' : 'default',
                        }}
                        onClick={() => {
                          if (node.extensionPaths && node.extensionPaths.length > 0) {
                            setSelectedNode(node);
                            setModalOpened(true);
                          }
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.transform = 'translateY(-2px)';
                          e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.3)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.transform = 'translateY(0)';
                          e.currentTarget.style.boxShadow = 'none';
                        }}
                      >
                        <Stack gap="xs">
                          <Group gap="sm" align="center" justify="space-between">
                            <Group gap="sm" align="center" style={{ flex: 1 }}>
                              {node.status === 'active' ? (
                                <RiCheckboxCircleFill size={20} color="#51cf66" />
                              ) : node.status === 'failed' ? (
                                <RiCloseCircleFill size={20} color="#ff6b6b" />
                              ) : (
                                <RiCloseCircleFill size={20} color="#ff6b6b" />
                              )}
                              <Text size="sm" fw={500} c="gray.0" style={{ flex: 1 }}>
                                {node.name}
                              </Text>
                            </Group>
                            <Group gap="xs" onClick={(e) => e.stopPropagation()}>
                              {node.githubUrl && (
                                <ActionIcon
                                  variant="subtle"
                                  color="blue"
                                  size="sm"
                                  onClick={() => handleUpdate(node)}
                                  title="Update"
                                  style={{ color: '#4dabf7' }}
                                >
                                  <RiPencilLine size={16} />
                                </ActionIcon>
                              )}
                              <Menu shadow="md" width={200} position="bottom-end">
                                <Menu.Target>
                                  <ActionIcon
                                    variant="subtle"
                                    color="gray"
                                    size="sm"
                                    title="More options"
                                    style={{ color: '#ffffff' }}
                                  >
                                    <RiMoreFill size={16} />
                                  </ActionIcon>
                                </Menu.Target>
                                <Menu.Dropdown>
                                  <Menu.Item
                                    leftSection={<RiStopCircleLine size={16} />}
                                    onClick={() => handleDisable(node.name, node.disabled || false)}
                                  >
                                    {node.disabled ? 'Enable' : 'Disable'}
                                  </Menu.Item>
                                  <Menu.Item
                                    leftSection={<RiDeleteBinLine size={16} />}
                                    color="red"
                                    onClick={() => handleDelete(node.name)}
                                  >
                                    Delete
                                  </Menu.Item>
                                </Menu.Dropdown>
                              </Menu>
                            </Group>
                          </Group>
                        </Stack>
                      </Card>
                    </Grid.Col>
                  ))}
                </Grid>
              )}
            </div>

            <div style={{ marginTop: '2rem' }}>
              <Stack gap="md" mb="md">
                <Group justify="space-between" align="center">
                  <Group gap="sm" align="center">
                    <Title order={2}>Dependencies</Title>
                    <ActionIcon
                      variant="subtle"
                      size="sm"
                      onClick={() => setDependenciesExpanded(!dependenciesExpanded)}
                      style={{ color: '#ffffff' }}
                      title={dependenciesExpanded ? 'Collapse' : 'Expand'}
                    >
                      {dependenciesExpanded ? <RiArrowUpSLine size={16} /> : <RiArrowDownSLine size={16} />}
                    </ActionIcon>
                  </Group>
                  {dependencies.length > 0 && (
                    <Text size="sm" c="dimmed">
                      {dependencies.length} dependencies
                    </Text>
                  )}
                </Group>
              </Stack>
              {dependenciesExpanded && (
                <>
                  {loading ? (
                    <Text c="dimmed">Loading dependencies...</Text>
                  ) : dependencies.length === 0 ? (
                    <Text c="dimmed">No dependencies found</Text>
                  ) : (
                    <Grid gutter="sm">
                      {dependencies.map((dep, index) => (
                        <Grid.Col key={index} span={{ base: 12, sm: 6, md: 4, lg: 2 }}>
                          <Card
                            padding="sm"
                            radius="md"
                            style={{
                              backgroundColor: '#25262b',
                              border: '1px solid #373a40',
                              height: '100%',
                              transition: 'transform 0.2s, box-shadow 0.2s',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.transform = 'translateY(-2px)';
                              e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.3)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.transform = 'translateY(0)';
                              e.currentTarget.style.boxShadow = 'none';
                            }}
                          >
                            <Stack gap="xs">
                              <Text size="xs" fw={500} c="gray.0" style={{ flex: 1 }}>
                                {dep.name}
                              </Text>
                              <Text size="xs" c="#888888" style={{ fontFamily: 'monospace', fontSize: '10px' }}>
                                {dep.version === '*' ? 'any version' : dep.version}
                              </Text>
                            </Stack>
                          </Card>
                        </Grid.Col>
                      ))}
                    </Grid>
                  )}
                </>
              )}
            </div>

            <div style={{ marginTop: '2rem' }}>
              <Stack gap="md" mb="md">
                <Group justify="space-between" align="center">
                  <Group gap="sm" align="center">
                    <Title order={2}>Models</Title>
                    <ActionIcon
                      variant="subtle"
                      size="sm"
                      onClick={() => setModelsExpanded(!modelsExpanded)}
                      style={{ color: '#ffffff' }}
                      title={modelsExpanded ? 'Collapse' : 'Expand'}
                    >
                      {modelsExpanded ? <RiArrowUpSLine size={16} /> : <RiArrowDownSLine size={16} />}
                    </ActionIcon>
                  </Group>
                  {models.length > 0 && (
                    <Text size="sm" c="dimmed">
                      {models.length} models
                    </Text>
                  )}
                </Group>
              </Stack>
              {modelsExpanded && (
                <>
                  {loading ? (
                    <Text c="dimmed">Loading models...</Text>
                  ) : models.length === 0 ? (
                    <Text c="dimmed">No models found</Text>
                  ) : (
                    <Grid gutter="sm">
                      {models.map((model, index) => (
                        <Grid.Col key={index} span={{ base: 12, sm: 6, md: 4, lg: 2 }}>
                          <Card
                            padding="sm"
                            radius="md"
                            style={{
                              backgroundColor: '#25262b',
                              border: '1px solid #373a40',
                              height: '100%',
                              transition: 'transform 0.2s, box-shadow 0.2s',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.transform = 'translateY(-2px)';
                              e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.3)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.transform = 'translateY(0)';
                              e.currentTarget.style.boxShadow = 'none';
                            }}
                          >
                            <Stack gap="xs">
                              <Text size="xs" fw={500} c="gray.0" style={{ flex: 1 }} truncate>
                                {model.name}
                              </Text>
                              <Group gap="xs" justify="space-between">
                                <Badge
                                  size="xs"
                                  variant="outline"
                                  style={{
                                    borderColor: '#a78bfa',
                                    color: '#a78bfa',
                                    backgroundColor: 'transparent',
                                  }}
                                >
                                  {model.type}
                                </Badge>
                                <Text size="xs" c="#888888" style={{ fontFamily: 'monospace', fontSize: '10px' }}>
                                  {model.formattedSize || 'N/A'}
                                </Text>
                              </Group>
                            </Stack>
                          </Card>
                        </Grid.Col>
                      ))}
                    </Grid>
                  )}
                </>
              )}
            </div>
          </Stack>
        </Container>
      </div>
      <LogSidebar isOpen={logsSidebarOpen} onToggle={setLogsSidebarOpen} />
      {selectedNode && (
        <NodeTreeModal
          opened={modalOpened}
          onClose={() => {
            setModalOpened(false);
            setSelectedNode(null);
          }}
          nodeName={selectedNode.name}
          extensionPaths={selectedNode.extensionPaths || []}
        />
      )}

      <Modal
        opened={changesModalOpened}
        onClose={() => {
          setChangesModalOpened(false);
          setChangesDiff(null);
          setNextSpaceName('');
        }}
        title="Requirements Changes"
        size="xl"
        styles={{
          title: { color: '#ffffff' },
          content: { backgroundColor: '#1a1b1e' },
          header: { backgroundColor: '#25262b', borderBottom: '1px solid #373a40' },
          body: { backgroundColor: '#1a1b1e' },
        }}
      >
        {loadingChanges ? (
          <Text c="dimmed" ta="center" py="xl">Loading changes...</Text>
        ) : changesDiff?.error ? (
          <Text c="red" ta="center" py="xl">{changesDiff.error}</Text>
        ) : !changesDiff?.hasBackup ? (
          <Text c="dimmed" ta="center" py="xl">No backup file found. Changes will be shown after the first merge.</Text>
        ) : (
          <Stack gap="md">
            <Group justify="space-between" align="center">
              <Group gap="md">
                <Text size="sm" c="#888888">
                  Backup: {changesDiff.backup.lineCount} lines
                </Text>
                <Text size="sm" c="#888888">
                  Current: {changesDiff.current.lineCount} lines
                </Text>
              </Group>
              <Button
                onClick={handleCreateSpace}
                loading={creatingSpace}
                disabled={creatingSpace || !changesDiff.diff || changesDiff.diff.every((item: any) => item.type === 'unchanged')}
                style={{
                  backgroundColor: creatingSpace || (!changesDiff.diff || changesDiff.diff.every((item: any) => item.type === 'unchanged')) ? undefined : '#0070f3',
                  color: (creatingSpace || !changesDiff.diff || changesDiff.diff.every((item: any) => item.type === 'unchanged')) ? '#000000' : '#ffffff',
                }}
              >
                Create New Space{nextSpaceName ? ` (${nextSpaceName})` : ''}
              </Button>
            </Group>
            
            <Paper 
              p="sm" 
              style={{ 
                backgroundColor: '#0a0a0a', 
                border: '1px solid #373a40',
                maxHeight: '600px',
                overflow: 'auto',
                fontFamily: 'monospace',
                fontSize: '12px',
                lineHeight: '1.6',
              }}
            >
              <ScrollArea h={600}>
                {changesDiff.diff.map((item: any, idx: number) => {
                  let bgColor = 'transparent';
                  let borderLeft = 'none';
                  let textColor = '#ffffff';
                  let prefix = '  ';
                  
                  if (item.type === 'added') {
                    bgColor = '#1b2d1b';
                    borderLeft = '3px solid #51cf66';
                    textColor = '#51cf66';
                    prefix = '+ ';
                  } else if (item.type === 'removed') {
                    bgColor = '#2d1b1b';
                    borderLeft = '3px solid #ff6b6b';
                    textColor = '#ff6b6b';
                    prefix = '- ';
                  } else {
                    textColor = '#888888';
                    prefix = '  ';
                  }
                  
                  const displayLine = item.currentLine || item.backupLine || '';
                  
                  return (
                    <div
                      key={idx}
                      style={{
                        padding: '2px 8px',
                        backgroundColor: bgColor,
                        borderLeft,
                        marginBottom: '1px',
                        whiteSpace: 'pre',
                        color: textColor,
                      }}
                    >
                      <span style={{ color: '#666666', marginRight: '8px' }}>
                        {String(item.lineNumber).padStart(4, ' ')}
                      </span>
                      <span>{prefix}</span>
                      <span>{displayLine || ' '}</span>
                    </div>
                  );
                })}
              </ScrollArea>
            </Paper>
          </Stack>
        )}
      </Modal>
    </>
  );
}

