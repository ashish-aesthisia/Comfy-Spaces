'use client';

import { useEffect, useState, useRef } from 'react';
import { Container, Title, Text, Stack, Button, Grid, Card, Group, Menu, ActionIcon, Modal, ScrollArea, Paper, Badge, Divider } from '@mantine/core';
import { useRouter } from 'next/navigation';
import { RiHomeLine, RiCheckboxCircleFill, RiCloseCircleFill, RiDownloadLine, RiPencilLine, RiMoreFill, RiDeleteBinLine, RiHistoryLine, RiFileListLine, RiArrowDownSLine, RiArrowUpSLine, RiExternalLinkLine, RiAddLine, RiRefreshLine, RiCircleFill } from 'react-icons/ri';
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

export default function ActivePage() {
  const [selectedVersion, setSelectedVersion] = useState<string>('');
  const [spaces, setSpaces] = useState<SpaceInfo[]>([]);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [dependencies, setDependencies] = useState<Dependency[]>([]);
  const [dependenciesExpanded, setDependenciesExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshingNodes, setRefreshingNodes] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [modalOpened, setModalOpened] = useState(false);
  const [changesModalOpened, setChangesModalOpened] = useState(false);
  const [changesDiff, setChangesDiff] = useState<any>(null);
  const [loadingChanges, setLoadingChanges] = useState(false);
  const [requirementsHistory, setRequirementsHistory] = useState<any[]>([]);
  const [selectedHistoryEntry, setSelectedHistoryEntry] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [logsSidebarOpen, setLogsSidebarOpen] = useState(false);
  const [comfyUIOnline, setComfyUIOnline] = useState(false);
  const [comfyUIRestarting, setComfyUIRestarting] = useState(false);
  const [restartLogs, setRestartLogs] = useState<Array<{ message: string; timestamp: string }>>([]);
  const [showRestartLogs, setShowRestartLogs] = useState(false);
  const [deleteModalOpened, setDeleteModalOpened] = useState(false);
  const [nodeToDelete, setNodeToDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [creatingRevision, setCreatingRevision] = useState(false);
  const restartEventSourceRef = useRef<EventSource | null>(null);
  const restartLogsEndRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const handleUpdate = (node: Node) => {
    if (!node.githubUrl) return;
    const params = new URLSearchParams({
      githubUrl: node.githubUrl,
    });
    if (node.branch) params.append('branch', node.branch);
    if (node.commitId) params.append('commitId', node.commitId);
    router.push(`/install-node?${params.toString()}`);
  };

  const handleDeleteClick = (nodeName: string) => {
    setNodeToDelete(nodeName);
    setDeleteModalOpened(true);
  };

  const handleDeleteConfirm = async () => {
    if (!nodeToDelete) return;

    setDeleting(true);
    try {
      const response = await fetch(`/api/nodes/${encodeURIComponent(nodeToDelete)}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        alert(data.error || 'Failed to delete node');
        setDeleting(false);
        return;
      }

      // Refresh the nodes list
      const extensionsResponse = await fetch('/api/extensions');
      const extensionsData = await extensionsResponse.json();
      if (!extensionsData.error) {
        setNodes(extensionsData.nodes || []);
      }

      setDeleteModalOpened(false);
      setNodeToDelete(null);
      setDeleting(false);
    } catch (error) {
      console.error('Error deleting node:', error);
      alert('Failed to delete node');
      setDeleting(false);
    }
  };


  const handleRestartComfyUI = async () => {
    if (!selectedVersion) {
      alert('No space is currently active');
      return;
    }

    if (!confirm('Are you sure you want to restart ComfyUI? This will stop the current instance and start a new one.')) {
      return;
    }

    setComfyUIRestarting(true);
    setComfyUIOnline(false);
    setRestartLogs([]);
    setShowRestartLogs(true);

    // Close existing event source if any
    if (restartEventSourceRef.current) {
      restartEventSourceRef.current.close();
      restartEventSourceRef.current = null;
    }

    try {
      // First, save the selected version (this will also kill the port)
      const response = await fetch('/api/activate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ version: selectedVersion }),
      });

      const data = await response.json();

      if (!response.ok) {
        setComfyUIRestarting(false);
        alert(data.error || 'Failed to restart ComfyUI');
        setShowRestartLogs(false);
        return;
      }

      // Connect to log stream to see restart progress
      const eventSource = new EventSource(`/api/activate/stream?version=${encodeURIComponent(selectedVersion)}`);
      restartEventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        console.log('Restart log stream connected');
      };

      eventSource.onmessage = (event) => {
        try {
          const logEntry = JSON.parse(event.data);
          setRestartLogs((prev) => [...prev, logEntry]);
          
          const message = logEntry.message;
          
          // Check for restart failures
          if (message.includes('[ERROR]') || 
              message.includes('Failed to install dependencies') ||
              message.includes('ERROR:') ||
              message.includes('ResolutionImpossible') ||
              message.includes('Activation failed')) {
            setComfyUIRestarting(false);
            return;
          }
          
          // Check if ComfyUI is ready - look for messages indicating server started
          if (message.includes('To see the GUI go to:') || 
              message.includes('Starting server') ||
              message.includes('Server started') ||
              message.includes('Running on') ||
              (message.includes('[COMFY]') && (message.includes('Running on') || message.includes('Server started')))) {
            setComfyUIOnline(true);
            setComfyUIRestarting(false);
            // Refresh nodes list when restart completes
            if (selectedVersion) {
              fetchNodesForSpace(selectedVersion);
            }
            // Keep logs visible for a bit, then auto-hide after 3 seconds
            setTimeout(() => {
              setShowRestartLogs(false);
              setRestartLogs([]);
            }, 3000);
          }
        } catch (error) {
          console.error('Error parsing log data:', error);
        }
      };

      eventSource.onerror = (error) => {
        console.error('EventSource error:', error);
        if (restartEventSourceRef.current) {
          restartEventSourceRef.current.close();
          restartEventSourceRef.current = null;
          setComfyUIRestarting(false);
        }
      };
    } catch (error) {
      console.error('Error restarting ComfyUI:', error);
      alert('Failed to restart ComfyUI');
      setComfyUIRestarting(false);
      setShowRestartLogs(false);
    }
  };

  // Helper function to render log message with colored tags
  const renderLogMessage = (message: string) => {
    // Check for [APP] tag
    const appTagMatch = message.match(/^\[APP\]\s*(.*)$/);
    if (appTagMatch) {
      const restOfMessage = appTagMatch[1];
      return (
        <>
          <span style={{ color: '#4dabf7', fontWeight: 'bold' }}>[APP]</span>
          {restOfMessage && ' '}
          <span>{restOfMessage}</span>
        </>
      );
    }
    
    // Check for [COMFY] tag
    const comfyTagMatch = message.match(/^\[COMFY\]\s*(.*)$/);
    if (comfyTagMatch) {
      const restOfMessage = comfyTagMatch[1];
      return (
        <>
          <span style={{ color: '#51cf66', fontWeight: 'bold' }}>[COMFY]</span>
          {restOfMessage && ' '}
          <span>{restOfMessage}</span>
        </>
      );
    }
    
    // No tag, return as-is
    return <span>{message}</span>;
  };

  const handleShowChanges = async () => {
    setLoadingChanges(true);
    setLoadingHistory(true);
    setChangesModalOpened(true);
    setSelectedHistoryEntry(null);
    setChangesDiff(null);
    
    try {
      // Fetch history list
      if (selectedVersion) {
        const historyResponse = await fetch(`/api/spaces/${encodeURIComponent(selectedVersion)}/requirements/history`);
        const historyData = await historyResponse.json();
        
        if (historyResponse.ok && historyData.history) {
          setRequirementsHistory(historyData.history);
          // Select the most recent entry by default
          if (historyData.history.length > 0) {
            setSelectedHistoryEntry(historyData.history[0].id);
            await loadHistoryDiff(historyData.history[0].id);
          }
        }
      }
    } catch (error) {
      console.error('Error fetching history:', error);
    } finally {
      setLoadingHistory(false);
      setLoadingChanges(false);
    }
  };

  const loadHistoryDiff = async (entryId: string) => {
    if (!selectedVersion || !entryId) return;
    
    setLoadingChanges(true);
    try {
      const diffResponse = await fetch(`/api/spaces/${encodeURIComponent(selectedVersion)}/requirements/history/${encodeURIComponent(entryId)}/diff`);
      const diffData = await diffResponse.json();
      
      if (!diffResponse.ok) {
        setChangesDiff({ error: diffData.error || 'Failed to load changes' });
      } else {
        setChangesDiff(diffData);
      }
    } catch (error) {
      console.error('Error fetching changes:', error);
      setChangesDiff({ error: 'Failed to load changes' });
    } finally {
      setLoadingChanges(false);
    }
  };

  const handleHistoryEntrySelect = async (entryId: string) => {
    setSelectedHistoryEntry(entryId);
    await loadHistoryDiff(entryId);
  };

  const handleRestore = async (entryId: string) => {
    if (!selectedVersion || !entryId) return;
    
    if (!confirm('Are you sure you want to restore this version of requirements? This will overwrite the current requirements.txt.')) {
      return;
    }

    setRestoring(true);
    try {
      const response = await fetch(`/api/spaces/${encodeURIComponent(selectedVersion)}/requirements/history/${encodeURIComponent(entryId)}/restore`, {
        method: 'POST',
      });

      const data = await response.json();

      if (!response.ok) {
        alert(data.error || 'Failed to restore requirements');
        setRestoring(false);
        return;
      }

      alert('Requirements restored successfully!');
      setChangesModalOpened(false);
      setChangesDiff(null);
      setSelectedHistoryEntry(null);
      
      // Refresh the page to show updated requirements
      window.location.reload();
    } catch (error) {
      console.error('Error restoring requirements:', error);
      alert('Failed to restore requirements');
      setRestoring(false);
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

  const fetchNodesForSpace = async (spaceId: string, showLoading = false) => {
    if (showLoading) {
      setRefreshingNodes(true);
    }
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
    } finally {
      if (showLoading) {
        setRefreshingNodes(false);
      }
    }
  };

  useEffect(() => {
    // Fetch the selected version and extensions
    Promise.all([
      fetch('/api/spaces').then(res => res.json()),
      fetch('/api/extensions').then(res => res.json()),
      fetch('/api/requirements').then(res => res.json())
    ])
      .then(async ([spaceData, extensionsData, requirementsData]) => {
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

  // Auto-scroll to bottom when new restart logs arrive
  useEffect(() => {
    if (restartLogsEndRef.current) {
      restartLogsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [restartLogs]);

  // Cleanup event source on unmount
  useEffect(() => {
    return () => {
      if (restartEventSourceRef.current) {
        restartEventSourceRef.current.close();
        restartEventSourceRef.current = null;
      }
    };
  }, []);

  // Check ComfyUI online status
  useEffect(() => {
    const checkComfyUIStatus = async () => {
      try {
        // Get the current hostname from the browser window
        const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
        const comfyUIUrl = `http://${hostname}:8188`;
        
        // Use an image request to check if ComfyUI is online
        // This works better with CORS restrictions
        const img = new Image();
        const timeout = setTimeout(() => {
          setComfyUIOnline(false);
        }, 2000);
        
        img.onload = () => {
          clearTimeout(timeout);
          setComfyUIOnline(true);
          // If it was restarting and now online, stop restarting state
          setComfyUIRestarting((prev) => {
            if (prev) {
              return false;
            }
            return prev;
          });
        };
        
        img.onerror = () => {
          clearTimeout(timeout);
          // Try alternative: fetch with no-cors
          fetch(comfyUIUrl, {
            method: 'GET',
            mode: 'no-cors',
            cache: 'no-store'
          }).then(() => {
            setComfyUIOnline(true);
            // If it was restarting and now online, stop restarting state
            setComfyUIRestarting((prev) => {
              if (prev) {
                return false;
              }
              return prev;
            });
          }).catch(() => {
            setComfyUIOnline(false);
          });
        };
        
        // Try to load a favicon or any resource from ComfyUI
        img.src = `${comfyUIUrl}/favicon.ico?` + Date.now();
      } catch (error) {
        setComfyUIOnline(false);
      }
    };

    // Check immediately
    checkComfyUIStatus();

    // Check every 5 seconds
    const interval = setInterval(checkComfyUIStatus, 5000);

    return () => clearInterval(interval);
  }, []);

  return (
    <>
      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
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
              <Group gap={0} align="center" style={{ border: '1px solid #373a40', borderRadius: '4px', overflow: 'hidden' }}>
                <Button
                  variant="subtle"
                  size="sm"
                  component="a"
                  href={typeof window !== 'undefined' ? `http://${window.location.hostname}:8188` : 'http://localhost:8188'}
                  target="_blank"
                  rel="noopener noreferrer"
                  leftSection={
                    comfyUIRestarting ? (
                      <RiCircleFill 
                        size={8} 
                        color="#ffd43b" 
                        style={{ 
                          filter: 'drop-shadow(0 0 3px #ffd43b)',
                          animation: 'blink 1s ease-in-out infinite'
                        }} 
                      />
                    ) : comfyUIOnline ? (
                      <RiCircleFill size={8} color="#51cf66" style={{ filter: 'drop-shadow(0 0 3px #51cf66)' }} />
                    ) : (
                      <RiCircleFill size={8} color="#ff6b6b" />
                    )
                  }
                  rightSection={<RiExternalLinkLine size={16} />}
                  style={{
                    color: '#0070f3',
                    fontWeight: 'bold',
                    borderRadius: 0,
                    borderRight: '1px solid #373a40',
                  }}
                >
                  Launch ComfyUI
                </Button>
                <Menu shadow="md" width={200} position="bottom-end">
                  <Menu.Target>
                    <Button
                      variant="subtle"
                      size="sm"
                      style={{
                        color: '#0070f3',
                        fontWeight: 'bold',
                        padding: '0 8px',
                        borderRadius: 0,
                      }}
                    >
                      <RiArrowDownSLine size={14} />
                    </Button>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Item
                      onClick={handleRestartComfyUI}
                      leftSection={<RiRefreshLine size={16} />}
                      disabled={!selectedVersion}
                    >
                      Restart ComfyUI
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              </Group>
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
                  <Title order={2}>Nodes</Title>
                  <Group gap="sm" align="center">
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      size="md"
                      onClick={() => {
                        if (selectedVersion && !refreshingNodes) {
                          fetchNodesForSpace(selectedVersion, true);
                        }
                      }}
                      title="Refresh Custom Nodes"
                      disabled={refreshingNodes}
                      style={{ 
                        color: refreshingNodes ? '#555555' : '#888888',
                        cursor: refreshingNodes ? 'not-allowed' : 'pointer',
                        opacity: refreshingNodes ? 0.6 : 1,
                        ...(refreshingNodes && {
                          animation: 'spin 1s linear infinite',
                        }),
                      }}
                    >
                      <RiRefreshLine 
                        size={18} 
                        style={refreshingNodes ? {
                          animation: 'spin 1s linear infinite',
                        } : {}}
                      />
                    </ActionIcon>
                    <Button
                      variant="filled"
                      size="xs"
                      leftSection={<RiAddLine size={14} />}
                      onClick={() => {
                        router.push('/install-node');
                      }}
                      style={{
                        backgroundColor: '#0070f3',
                        color: '#ffffff',
                      }}
                    >
                      Install Custom Node
                    </Button>
                    {nodes.length > 0 && (
                      <Text size="sm" c="dimmed">
                        {nodes.filter(n => n.status === 'active').length} active, {nodes.filter(n => n.status === 'failed').length} failed
                      </Text>
                    )}
                  </Group>
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
                <Stack gap="xs">
                  {nodes.map((node, index) => (
                    <Paper
                      key={index}
                      p="sm"
                      style={{
                        backgroundColor: '#25262b',
                        border: node.status === 'failed' 
                          ? '1px solid #ff6b6b' 
                          : '1px solid #373a40',
                        cursor: node.extensionPaths && node.extensionPaths.length > 0 ? 'pointer' : 'default',
                        transition: 'background-color 0.2s',
                      }}
                      onClick={() => {
                        if (node.extensionPaths && node.extensionPaths.length > 0) {
                          setSelectedNode(node);
                          setModalOpened(true);
                        }
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = '#2d2f35';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = '#25262b';
                      }}
                    >
                      <Group gap="xs" align="center" justify="space-between" wrap="nowrap">
                        <Group gap="xs" align="center" style={{ flex: 1, minWidth: 0 }}>
                          {node.status === 'active' ? (
                            <RiCheckboxCircleFill size={16} color="#51cf66" />
                          ) : node.status === 'failed' ? (
                            <RiCloseCircleFill size={16} color="#ff6b6b" />
                          ) : (
                            <RiCloseCircleFill size={16} color="#ff6b6b" />
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
                                leftSection={<RiDeleteBinLine size={16} />}
                                color="red"
                                onClick={() => handleDeleteClick(node.name)}
                              >
                                Delete
                              </Menu.Item>
                            </Menu.Dropdown>
                          </Menu>
                        </Group>
                      </Group>
                    </Paper>
                  ))}
                </Stack>
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
          setSelectedHistoryEntry(null);
          setRequirementsHistory([]);
        }}
        title={
          <Group gap="xs" align="center">
            <RiHistoryLine size={20} />
            <Text>Requirements History</Text>
          </Group>
        }
        size="xl"
        styles={{
          title: { color: '#ffffff' },
          content: { backgroundColor: '#1a1b1e' },
          header: { backgroundColor: '#25262b', borderBottom: '1px solid #373a40' },
          body: { backgroundColor: '#1a1b1e' },
        }}
      >
        {loadingHistory ? (
          <Text c="dimmed" ta="center" py="xl">Loading history...</Text>
        ) : requirementsHistory.length === 0 ? (
          <Text c="dimmed" ta="center" py="xl">No history available yet. History will be created when you install nodes or activate spaces.</Text>
        ) : (
          <Grid gutter="md" style={{ height: '600px' }}>
            {/* Left Column: Diff View */}
            <Grid.Col span={8}>
              <Stack gap="md" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                {loadingChanges ? (
                  <Text c="dimmed" ta="center" py="xl">Loading changes...</Text>
                ) : changesDiff?.error ? (
                  <Text c="red" ta="center" py="xl">{changesDiff.error}</Text>
                ) : !selectedHistoryEntry ? (
                  <Text c="dimmed" ta="center" py="xl">Select a history entry to view changes</Text>
                ) : (
                  <>
                    <Group justify="space-between" align="center" style={{ flexShrink: 0 }}>
                      <Group gap="md">
                        <Text size="sm" c="#888888">
                          History: {changesDiff?.history?.lineCount || 0} lines
                        </Text>
                        <Text size="sm" c="#888888">
                          Current: {changesDiff?.current?.lineCount || 0} lines
                        </Text>
                      </Group>
                    </Group>
                    
                    <Paper 
                      p="sm" 
                      style={{ 
                        backgroundColor: '#0a0a0a', 
                        border: '1px solid #373a40',
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        minHeight: 0,
                        fontFamily: 'monospace',
                        fontSize: '12px',
                        lineHeight: '1.6',
                      }}
                    >
                      <ScrollArea style={{ flex: 1, height: '100%' }}>
                        {changesDiff?.diff?.map((item: any, idx: number) => {
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
                          } else if (item.type === 'updated') {
                            bgColor = '#2d2b1b';
                            borderLeft = '3px solid #ffd43b';
                            textColor = '#ffd43b';
                            prefix = '~ ';
                          } else if (item.type === 'downgraded') {
                            bgColor = '#2d1b2b';
                            borderLeft = '3px solid #ff8787';
                            textColor = '#ff8787';
                            prefix = '↓ ';
                          } else {
                            textColor = '#888888';
                            prefix = '  ';
                          }
                          
                          const displayLine = item.currentLine || item.historyLine || '';
                          
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
                              {item.type === 'updated' || item.type === 'downgraded' ? (
                                <div style={{ paddingLeft: '20px', color: '#ff6b6b', fontSize: '11px' }}>
                                  {item.historyLine}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </ScrollArea>
                    </Paper>
                  </>
                )}
              </Stack>
            </Grid.Col>

            {/* Right Column: History List */}
            <Grid.Col span={4}>
              <Stack gap="xs" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <Text size="sm" fw={600} c="#ffffff" style={{ flexShrink: 0 }}>History Entries</Text>
                <Divider style={{ flexShrink: 0 }} />
                <ScrollArea style={{ flex: 1, minHeight: 0 }}>
                  <Stack gap="xs">
                    {requirementsHistory.map((entry) => {
                      const title = entry.type === 'node_install' && entry.nodeName
                        ? entry.nodeName
                        : entry.type === 'activation'
                        ? 'Activation'
                        : 'Node Install';
                      
                      return (
                        <Paper
                          key={entry.id}
                          p="sm"
                          style={{
                            backgroundColor: selectedHistoryEntry === entry.id ? '#2d2f35' : '#25262b',
                            border: selectedHistoryEntry === entry.id ? '1px solid #0070f3' : '1px solid #373a40',
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                          }}
                          onClick={() => handleHistoryEntrySelect(entry.id)}
                          onMouseEnter={(e) => {
                            if (selectedHistoryEntry !== entry.id) {
                              e.currentTarget.style.backgroundColor = '#2d2f35';
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (selectedHistoryEntry !== entry.id) {
                              e.currentTarget.style.backgroundColor = '#25262b';
                            }
                          }}
                        >
                          <Stack gap="xs">
                            <Group justify="space-between" align="flex-start">
                              <Text size="sm" fw={500} c="#ffffff" style={{ flex: 1 }}>
                                {title}
                              </Text>
                              <Button
                                size="xs"
                                variant="subtle"
                                color="blue"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRestore(entry.id);
                                }}
                                loading={restoring && selectedHistoryEntry === entry.id}
                                disabled={restoring}
                              >
                                Restore
                              </Button>
                            </Group>
                            <Text size="xs" c="#666666">
                              {new Date(entry.timestamp).toLocaleString()}
                            </Text>
                          </Stack>
                        </Paper>
                      );
                    })}
                  </Stack>
                </ScrollArea>
              </Stack>
            </Grid.Col>
          </Grid>
        )}
      </Modal>

      <Modal
        opened={showRestartLogs}
        onClose={() => {
          setShowRestartLogs(false);
          // Don't clear logs or close event source - let restart continue in background
          // User can reopen modal if needed
        }}
        title={
          <Text fw={600} size="lg" c="#ffffff">
            Restarting ComfyUI
          </Text>
        }
        size="xl"
        styles={{
          title: { color: '#ffffff' },
          content: { 
            backgroundColor: '#1a1b1e',
            maxHeight: '90vh',
            display: 'flex',
            flexDirection: 'column',
          },
          header: { backgroundColor: '#25262b', borderBottom: '1px solid #373a40' },
          body: { 
            backgroundColor: '#1a1b1e',
            flex: 1,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }
        }}
      >
        <Stack gap="sm" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <ScrollArea h={500} scrollbarSize={6}>
            <div style={{ paddingRight: '8px', fontFamily: 'monospace', fontSize: '12px' }}>
              {restartLogs.length === 0 ? (
                <Text size="sm" c="dimmed" ta="center" py="xl">
                  Waiting for logs...
                </Text>
              ) : (
                <>
                  {restartLogs.map((log, index) => (
                    <div
                      key={index}
                      style={{
                        color: '#ffffff',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        lineHeight: '1.5',
                        marginBottom: '4px',
                      }}
                    >
                      <span style={{ color: '#868e96', fontSize: '11px' }}>
                        {new Date(log.timestamp).toLocaleTimeString()}{' '}
                      </span>
                      {renderLogMessage(log.message)}
                    </div>
                  ))}
                  <div ref={restartLogsEndRef} />
                </>
              )}
            </div>
          </ScrollArea>
          <Group justify="space-between" align="center">
            <Text size="xs" c="#888888">
              {restartLogs.length} log entries
            </Text>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={deleteModalOpened}
        onClose={() => {
          if (!deleting) {
            setDeleteModalOpened(false);
            setNodeToDelete(null);
          }
        }}
        title="Delete Node"
        styles={{
          title: { color: '#ffffff' },
          content: { backgroundColor: '#1a1b1e' },
          header: { backgroundColor: '#25262b', borderBottom: '1px solid #373a40' },
          body: { backgroundColor: '#1a1b1e' },
        }}
      >
        <Stack gap="md">
          <Text c="#ffffff">
            Are you sure you want to delete <strong>{nodeToDelete}</strong>? This action cannot be undone.
          </Text>
          <Text size="sm" c="#888888">
            This will remove the node from the custom_nodes directory and update space.json.
          </Text>
          <Group justify="flex-end" gap="sm">
            <Button
              variant="subtle"
              onClick={() => {
                setDeleteModalOpened(false);
                setNodeToDelete(null);
              }}
              disabled={deleting}
              style={{ color: '#ffffff' }}
            >
              Cancel
            </Button>
            <Button
              color="red"
              onClick={handleDeleteConfirm}
              loading={deleting}
              leftSection={<RiDeleteBinLine size={16} />}
            >
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

