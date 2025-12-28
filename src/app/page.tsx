'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Container, Title, Text, Select, Button, Alert, Group, Stack, Paper, ScrollArea } from '@mantine/core';
import { RiCheckLine, RiErrorWarningLine, RiRefreshLine, RiCheckboxCircleFill, RiCloseLine } from 'react-icons/ri';

interface RevisionsData {
  versions: string[];
  selectedVersion: string;
}

interface LogEntry {
  message: string;
  timestamp: string;
}

export default function Home() {
  const router = useRouter();
  const [revisions, setRevisions] = useState<RevisionsData | null>(null);
  const [selectedRevision, setSelectedRevision] = useState<string>('');
  const [isActivating, setIsActivating] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [isComfyUIReady, setIsComfyUIReady] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // Fetch revisions on component mount
    fetch('/api/revisions')
      .then(res => res.json())
      .then((data: RevisionsData) => {
        setRevisions(data);
        setSelectedRevision(data.selectedVersion);
      })
      .catch(err => {
        console.error('Error fetching revisions:', err);
        setMessage({ type: 'error', text: 'Failed to load revisions' });
      });
  }, []);

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
    if (!selectedRevision) return;

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
        body: JSON.stringify({ version: selectedRevision }),
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage({ type: 'error', text: data.error || 'Failed to activate revision' });
        setIsActivating(false);
        return;
      }

      // Update the selected version in revisions data
      if (revisions) {
        setRevisions({ ...revisions, selectedVersion: selectedRevision });
      }

      // Create AbortController for cancellation
      const abortController = new AbortController();
      
      // Connect to log stream with abort signal
      const eventSource = new EventSource(`/api/activate/stream?version=${encodeURIComponent(selectedRevision)}`);
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
      console.error('Error activating revision:', error);
      setMessage({ type: 'error', text: 'Failed to activate revision' });
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

  const isActivateEnabled = !!selectedRevision;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', backgroundColor: '#000000', paddingTop: '2rem', paddingBottom: '2rem' }}>
      <Container size="xl" py="xl" style={{ width: '100%' }}>
        <Stack gap="md">
          <div style={{ textAlign: 'center' }}>
            <Title order={2} mb="xs" c="#ffffff">Custom Nodes Manager</Title>
            {revisions?.selectedVersion && (
              <Text size="xs" c="#888888">
                Active: <Text span c="#ffffff" fw={500}>{revisions.selectedVersion}</Text>
              </Text>
            )}
          </div>

          <Group gap="xs" align="flex-end" justify="center">
            <Select
              label="Revision"
              placeholder="Select revision"
              value={selectedRevision}
              onChange={(value) => {
                setSelectedRevision(value || '');
                setShowLogs(false);
                setLogs([]);
                setIsComfyUIReady(false);
              }}
              data={revisions?.versions || []}
              style={{ width: '200px' }}
              size="sm"
              styles={{
                label: { color: '#ffffff' },
                input: { 
                  backgroundColor: '#1a1b1e', 
                  color: '#ffffff', 
                  borderColor: '#373a40' 
                },
                dropdown: {
                  backgroundColor: '#25262b',
                  border: '1px solid #373a40',
                },
                option: {
                  color: '#ffffff',
                  '&[data-selected]': {
                    backgroundColor: '#0070f3',
                  },
                  '&:hover': {
                    backgroundColor: '#373a40',
                  },
                },
              }}
            />
            <Group gap="xs">
              {isActivating && (
                <Button
                  onClick={handleCancel}
                  variant="outline"
                  style={{
                    borderColor: '#ff4444',
                    color: '#ff4444',
                  }}
                  leftSection={<RiCloseLine size={16} />}
                  size="sm"
                >
                  Cancel
                </Button>
              )}
              <Button
                onClick={handleActivate}
                disabled={!isActivateEnabled || isActivating}
                loading={isActivating}
                leftSection={!isActivating && <RiRefreshLine size={16} />}
                size="sm"
                style={{
                  backgroundColor: isActivateEnabled && !isActivating ? '#0070f3' : undefined,
                  color: (!isActivateEnabled || isActivating) ? '#000000' : '#ffffff',
                }}
              >
                Activate
              </Button>
            </Group>
          </Group>

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

          {showLogs && selectedRevision && (
            <Paper p="md" style={{ backgroundColor: '#111111', border: '1px solid #333333' }}>
              <Stack gap="sm">
                <Group justify="space-between" align="center">
                  <Text fw={600} size="lg" c="#ffffff">Activation Logs - {selectedRevision}</Text>
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
                          VI is ready ({selectedRevision})
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
    </div>
  );
}
