'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Container, Title, Text, Select, Button, Alert, Group, Stack, Paper, ScrollArea, Badge } from '@mantine/core';
import { RiCheckLine, RiErrorWarningLine, RiRefreshLine, RiCheckboxCircleFill, RiCloseLine, RiAddLine, RiFileCodeLine, RiGitBranchLine, RiArrowRightLine } from 'react-icons/ri';
import CreateSpaceModal from './components/CreateSpaceModal';

interface SpaceInfo {
  name: string; // spaceId (directory name)
  visibleName?: string; // visible name from space.json
  pythonVersion: string;
  lastUpdated: string;
  path: string;
  comfyUIVersion: string;
}

interface SpacesData {
  spaces: SpaceInfo[];
  selectedVersion: string;
}

interface LogEntry {
  message: string;
  timestamp: string;
}

export default function Home() {
  const router = useRouter();
  const [spaces, setSpaces] = useState<SpacesData | null>(null);
  const [selectedSpace, setSelectedSpace] = useState<string>('');
  const [isActivating, setIsActivating] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [isComfyUIReady, setIsComfyUIReady] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const [createSpaceModalOpened, setCreateSpaceModalOpened] = useState(false);

  useEffect(() => {
    // Fetch spaces on component mount
    fetch('/api/spaces')
      .then(res => res.json())
      .then((data: SpacesData) => {
        setSpaces(data);
        setSelectedSpace(data.selectedVersion);
      })
      .catch(err => {
        console.error('Error fetching spaces:', err);
        setMessage({ type: 'error', text: 'Failed to load spaces' });
      });
  }, []);

  const formatDate = (dateString: string) => {
    if (dateString === 'Unknown') return dateString;
    try {
      const date = new Date(dateString);
      return date.toLocaleString();
    } catch {
      return dateString;
    }
  };

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  // Cleanup event source on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, []);

  const handleCancel = async () => {
    if (eventSourceRef.current) {
      // Close the event source which will trigger abort signal on server
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsActivating(false);
    setIsComfyUIReady(false);
    setMessage({ type: 'error', text: 'Activation cancelled' });
  };

  const handleActivate = async () => {
    if (!selectedSpace) return;

    setIsActivating(true);
    setMessage(null);
    setLogs([]);
    setShowLogs(true);
    setIsComfyUIReady(false);

    // Close existing event source if any
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    try {
      // First, save the selected version
      const response = await fetch('/api/activate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ version: selectedSpace }),
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage({ type: 'error', text: data.error || 'Failed to activate space' });
        setIsActivating(false);
        return;
      }

      // Update the selected version in spaces data
      if (spaces) {
        setSpaces({ ...spaces, selectedVersion: selectedSpace });
      }

      // Create AbortController for cancellation
      const abortController = new AbortController();
      
      // Connect to log stream with abort signal
      const eventSource = new EventSource(`/api/activate/stream?version=${encodeURIComponent(selectedSpace)}`);
      eventSourceRef.current = eventSource;

      // Store abort controller for cancellation
      (eventSource as any).abortController = abortController;

      eventSource.onopen = () => {
        console.log('Log stream connected');
      };

      eventSource.onmessage = (event) => {
        try {
          const logEntry: LogEntry = JSON.parse(event.data);
          setLogs((prev) => [...prev, logEntry]);
          
          // Check if activation was cancelled
          if (logEntry.message.includes('Activation cancelled by user')) {
            setIsActivating(false);
            setIsComfyUIReady(false);
            setMessage({ type: 'error', text: 'Activation cancelled' });
            return;
          }
          
          // Check if ComfyUI is ready - look for messages in both APP and COMFY logs
          const message = logEntry.message;
          if (message.includes('To see the GUI go to:') || 
              message.includes('Starting server') ||
              message.includes('Server started') ||
              message.includes('Running on') ||
              (message.includes('[COMFY]') && (message.includes('Running on') || message.includes('Server started')))) {
            setIsComfyUIReady(true);
            setIsActivating(false);
          }
        } catch (error) {
          console.error('Error parsing log data:', error);
        }
      };

      eventSource.onerror = (error) => {
        console.error('EventSource error:', error);
        // Only close if not manually cancelled
        if (eventSourceRef.current) {
          eventSource.close();
          eventSourceRef.current = null;
          setIsActivating(false);
        }
      };

      // Note: We don't automatically navigate away - let user see the logs
      // They can manually navigate when ready
    } catch (error) {
      console.error('Error activating space:', error);
      setMessage({ type: 'error', text: 'Failed to activate space' });
      setIsActivating(false);
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

  const isActivateEnabled = !!selectedSpace;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', backgroundColor: '#000000', paddingTop: '2rem', paddingBottom: '2rem' }}>
      <Container size="xl" py="xl" style={{ width: '100%' }}>
        <Stack gap="md">
          <div style={{ textAlign: 'left', width: '50%', margin: '0 auto' }}>
            <Title order={2} mb="xs" c="#ffffff">Comfy Spaces</Title>
            <Group gap="xs" mt="md">
              <Paper
                p="sm"
                style={{
                  border: '1px solid #333333',
                  backgroundColor: 'transparent',
                  cursor: 'pointer',
                  flex: 1,
                  textAlign: 'center',
                }}
                onClick={() => setCreateSpaceModalOpened(true)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#555555';
                  e.currentTarget.style.backgroundColor = '#1a1a1a';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = '#333333';
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                <Group gap="xs" justify="center" align="center">
                  <RiAddLine size={16} color="#888888" />
                  <Text size="sm" c="#888888">Create new Space</Text>
                </Group>
              </Paper>
              <Paper
                p="sm"
                style={{
                  border: '1px solid #333333',
                  backgroundColor: 'transparent',
                  cursor: 'pointer',
                  flex: 1,
                  textAlign: 'center',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#555555';
                  e.currentTarget.style.backgroundColor = '#1a1a1a';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = '#333333';
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                <Group gap="xs" justify="center" align="center">
                  <RiFileCodeLine size={16} color="#888888" />
                  <Text size="sm" c="#888888">Import Json</Text>
                </Group>
              </Paper>
              <Paper
                p="sm"
                style={{
                  border: '1px solid #333333',
                  backgroundColor: 'transparent',
                  cursor: 'pointer',
                  flex: 1,
                  textAlign: 'center',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#555555';
                  e.currentTarget.style.backgroundColor = '#1a1a1a';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = '#333333';
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                <Group gap="xs" justify="center" align="center">
                  <RiGitBranchLine size={16} color="#888888" />
                  <Text size="sm" c="#888888">Import from Git</Text>
                </Group>
              </Paper>
            </Group>
          </div>

          {spaces?.spaces && spaces.spaces.length > 0 ? (
            <Paper p="md" style={{ backgroundColor: '#111111', border: '1px solid #333333', width: '50%', margin: '0 auto' }}>
              <Stack gap="xs">
                {[...spaces.spaces].sort((a, b) => {
                  const dateA = a.lastUpdated === 'Unknown' ? 0 : new Date(a.lastUpdated).getTime();
                  const dateB = b.lastUpdated === 'Unknown' ? 0 : new Date(b.lastUpdated).getTime();
                  return dateB - dateA; // Sort descending (most recent first)
                }).map((space) => (
                  <Paper
                    key={space.name}
                    p="sm"
                    style={{
                      backgroundColor: selectedSpace === space.name ? '#1a1a2e' : '#0a0a0a',
                      border: '1px solid #333333',
                      cursor: 'pointer',
                      transition: 'background-color 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      if (selectedSpace !== space.name) {
                        e.currentTarget.style.backgroundColor = '#1a1a1a';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (selectedSpace !== space.name) {
                        e.currentTarget.style.backgroundColor = '#0a0a0a';
                      }
                    }}
                    onClick={() => {
                      if (!isActivating) {
                        setSelectedSpace(space.name);
                        setShowLogs(false);
                        setLogs([]);
                        setIsComfyUIReady(false);
                      }
                    }}
                  >
                    <Group justify="space-between" align="center" wrap="nowrap">
                      <Stack gap="xs" style={{ flex: 1, minWidth: 0 }}>
                        <Group gap="xs" wrap="nowrap">
                          <Text fw={500} c="#ffffff" size="sm">
                            {space.visibleName || space.name}
                          </Text>
                          <Badge
                            size="sm"
                            variant="outline"
                            style={{
                              borderColor: '#555555',
                              color: '#888888',
                              backgroundColor: 'transparent',
                            }}
                          >
                            ComfyUI {space.comfyUIVersion}
                          </Badge>
                        </Group>
                        <Group gap="md" wrap="nowrap">
                          <Text size="xs" c="#888888">
                            Python: {space.pythonVersion}
                          </Text>
                          <Text size="xs" c="#888888">
                            Updated: {formatDate(space.lastUpdated)}
                          </Text>
                          <Text size="xs" c="#888888" style={{ fontFamily: 'monospace' }} truncate>
                            {space.path}
                          </Text>
                        </Group>
                      </Stack>
                      {isActivating && selectedSpace === space.name ? (
                        <Button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCancel();
                          }}
                          variant="outline"
                          size="xs"
                          style={{
                            borderColor: '#ff4444',
                            color: '#ff4444',
                          }}
                          leftSection={<RiCloseLine size={14} />}
                        >
                          Cancel
                        </Button>
                      ) : (
                        <RiArrowRightLine 
                          size={20} 
                          color="#888888"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (selectedSpace === space.name) {
                              handleActivate();
                            } else {
                              setSelectedSpace(space.name);
                              setShowLogs(false);
                              setLogs([]);
                              setIsComfyUIReady(false);
                            }
                          }}
                          style={{ cursor: 'pointer' }}
                        />
                      )}
                    </Group>
                  </Paper>
                ))}
              </Stack>
            </Paper>
          ) : spaces !== null ? (
            <Paper p="xl" style={{ backgroundColor: '#111111', border: '1px solid #333333', width: '50%', margin: '0 auto', textAlign: 'center' }}>
              <Stack gap="md" align="center">
                <Text size="lg" c="#888888" fw={500}>
                  No spaces found
                </Text>
                <Text size="sm" c="#666666">
                  Create your first space to get started
                </Text>
              </Stack>
            </Paper>
          ) : null}

          {message && (
            <Alert
              icon={message.type === 'success' ? <RiCheckLine size={16} /> : <RiErrorWarningLine size={16} />}
              style={{
                backgroundColor: message.type === 'success' ? '#00d9ff' : '#ff4444',
                color: '#000000',
                border: 'none',
              }}
              size="sm"
            >
              {message.text}
            </Alert>
          )}

          {showLogs && selectedSpace && (
            <Paper p="md" style={{ backgroundColor: '#111111', border: '1px solid #333333' }}>
              <Stack gap="sm">
                <Group justify="space-between" align="center">
                  <Text fw={600} size="lg" c="#ffffff">Activation Logs - {selectedSpace}</Text>
                  <Button
                    variant="subtle"
                    size="xs"
                    style={{ color: '#888888' }}
                    onClick={() => {
                      setShowLogs(false);
                      setLogs([]);
                      if (eventSourceRef.current) {
                        eventSourceRef.current.close();
                        eventSourceRef.current = null;
                      }
                    }}
                  >
                    Hide Logs
                  </Button>
                </Group>
                <ScrollArea h={400} scrollbarSize={6}>
                  <div style={{ paddingRight: '8px', fontFamily: 'monospace', fontSize: '12px' }}>
                    {logs.length === 0 ? (
                      <Text size="sm" c="dimmed" ta="center" py="xl">
                        Waiting for logs...
                      </Text>
                    ) : (
                      <>
                        {logs.map((log, index) => (
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
                        <div ref={logsEndRef} />
                      </>
                    )}
                  </div>
                </ScrollArea>
                <Group justify="space-between" align="center">
                  <Group gap="xs" align="center">
                    <Text size="xs" c="#888888">
                      {logs.length} log entries
                    </Text>
                    {isComfyUIReady && (
                      <Group gap="xs" align="center" style={{ marginLeft: '1rem' }}>
                        <RiCheckboxCircleFill size={16} color="#00d9ff" />
                        <Text size="sm" c="#00d9ff" fw={500}>
                          VI is ready ({selectedSpace})
                        </Text>
                      </Group>
                    )}
                  </Group>
                  <Button
                    variant={isComfyUIReady ? "filled" : "subtle"}
                    size="sm"
                    onClick={() => router.push('/active')}
                    disabled={!isComfyUIReady}
                    style={{
                      backgroundColor: isComfyUIReady ? '#0070f3' : undefined,
                      color: isComfyUIReady ? '#ffffff' : '#000000',
                    }}
                  >
                    Go to Dashboard
                  </Button>
                </Group>
              </Stack>
            </Paper>
          )}
        </Stack>
      </Container>

      <CreateSpaceModal
        opened={createSpaceModalOpened}
        onClose={() => setCreateSpaceModalOpened(false)}
        onSuccess={async () => {
          // Refresh spaces list
          try {
            const res = await fetch('/api/spaces');
            const data: SpacesData = await res.json();
            setSpaces(data);
            if (data.selectedVersion) {
              setSelectedSpace(data.selectedVersion);
              // Automatically activate the new space
              setTimeout(() => {
                handleActivate();
              }, 500);
            }
          } catch (err) {
            console.error('Error refreshing spaces:', err);
          }
        }}
      />
    </div>
  );
}
