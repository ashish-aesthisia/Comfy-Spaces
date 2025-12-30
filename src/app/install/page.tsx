'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Container, Title, Text, TextInput, Button, Alert, Group, Stack, Paper, ScrollArea, Divider, Checkbox } from '@mantine/core';
import { RiCheckLine, RiErrorWarningLine, RiHomeLine, RiCloseLine } from 'react-icons/ri';

interface LogEntry {
  message: string;
  timestamp: string;
}

interface LineAnnotation {
  line: string;
  type: 'added' | 'removed' | 'updated' | 'unchanged' | 'none';
  depName?: string;
}

interface DependencyDiff {
  added: string[];
  removed: string[];
  updated: Array<{ name: string; old: string; new: string }>;
  current?: {
    content: string;
    lines: LineAnnotation[];
  };
  incoming?: {
    content: string;
    lines: LineAnnotation[];
  };
  conflicts?: {
    hasConflicts: boolean;
    details: string;
    conflicts: string[];
    mergedContent: string;
  };
}

export default function InstallPage() {
  const router = useRouter();
  const [githubUrl, setGithubUrl] = useState('');
  const [commitId, setCommitId] = useState('');
  const [branch, setBranch] = useState('');
  const [isCloning, setIsCloning] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [cloneComplete, setCloneComplete] = useState(false);
  const [diff, setDiff] = useState<DependencyDiff | null>(null);
  const [nodeName, setNodeName] = useState<string>('');
  const [isUpdate, setIsUpdate] = useState(false);
  const [selectedCurrent, setSelectedCurrent] = useState<Set<number>>(new Set());
  const [selectedIncoming, setSelectedIncoming] = useState<Set<number>>(new Set());
  const [isMerging, setIsMerging] = useState(false);
  const [selectedRevision, setSelectedRevision] = useState<string>('v1');
  const logsEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Load URL parameters and selected revision on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const urlParam = params.get('githubUrl');
      const branchParam = params.get('branch');
      const commitIdParam = params.get('commitId');
      
      if (urlParam) {
        setGithubUrl(urlParam);
        setIsUpdate(true);
      }
      if (branchParam) {
        setBranch(branchParam);
      }
      if (commitIdParam) {
        setCommitId(commitIdParam);
      }
    }

    // Fetch selected revision
    fetch('/api/spaces')
      .then(res => res.json())
      .then((data) => {
        setSelectedRevision(data.selectedVersion || 'v1');
      })
      .catch(err => {
        console.error('Error fetching selected revision:', err);
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
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsCloning(false);
    setMessage({ type: 'error', text: 'Clone cancelled' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!githubUrl.trim()) {
      setMessage({ type: 'error', text: 'Github URL is required' });
      return;
    }

    setIsCloning(true);
    setMessage(null);
    setLogs([]);
    setShowLogs(true);
    setCloneComplete(false);
    setDiff(null);
    setNodeName('');
    setSelectedCurrent(new Set());
    setSelectedIncoming(new Set());

    // Close existing event source if any
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    try {
      // Start clone process
      const response = await fetch('/api/install', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          githubUrl: githubUrl.trim(),
          commitId: commitId.trim() || undefined,
          branch: branch.trim() || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage({ type: 'error', text: data.error || 'Failed to start clone' });
        setIsCloning(false);
        return;
      }

      setNodeName(data.nodeName || '');

      // Connect to log stream
      const params = new URLSearchParams({
        nodeName: data.nodeName,
        githubUrl: githubUrl.trim(),
      });
      if (commitId.trim()) params.append('commitId', commitId.trim());
      if (branch.trim()) params.append('branch', branch.trim());
      
      const eventSource = new EventSource(`/api/install/stream?${params.toString()}`);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        console.log('Clone log stream connected');
      };

      eventSource.onmessage = (event) => {
        try {
          const logEntry: LogEntry = JSON.parse(event.data);
          setLogs((prev) => [...prev, logEntry]);
          
          // Check if clone was cancelled
          if (logEntry.message.includes('Clone cancelled by user')) {
            setIsCloning(false);
            setMessage({ type: 'error', text: 'Clone cancelled' });
            return;
          }
          
          // Check if clone or update is complete
          if (logEntry.message.includes('Clone completed successfully') || 
              logEntry.message.includes('Update completed successfully')) {
            setIsCloning(false);
            setCloneComplete(true);
            setShowLogs(false); // Hide logs when clone/update completes
            // Fetch diff
            fetchDiff(data.nodeName);
          }
        } catch (error) {
          console.error('Error parsing log data:', error);
        }
      };

      eventSource.onerror = (error) => {
        console.error('EventSource error:', error);
        // If stream closes normally (readyState === 2), clone might have completed
        if (eventSource.readyState === EventSource.CLOSED && !cloneComplete) {
          // Stream closed normally, try to fetch diff
          if (data.nodeName) {
            setIsCloning(false);
            setCloneComplete(true);
            fetchDiff(data.nodeName);
          }
        }
        if (eventSourceRef.current) {
          eventSource.close();
          eventSourceRef.current = null;
          if (!cloneComplete) {
            setIsCloning(false);
          }
        }
      };
    } catch (error) {
      console.error('Error starting clone:', error);
      setMessage({ type: 'error', text: 'Failed to start clone' });
      setIsCloning(false);
    }
  };

  const fetchDiff = async (nodeName: string) => {
    try {
      const response = await fetch(`/api/install/diff?nodeName=${encodeURIComponent(nodeName)}`);
      const data = await response.json();
      
      if (response.ok) {
        setDiff(data);
        // Initialize with all current dependencies selected by default
        if (data.current?.lines) {
          const currentIndices = new Set<number>();
          data.current.lines.forEach((line: LineAnnotation, idx: number) => {
            if (line.depName && line.type !== 'none') {
              currentIndices.add(idx);
            }
          });
          setSelectedCurrent(currentIndices);
        }
        // Initialize with all incoming dependencies selected by default
        if (data.incoming?.lines) {
          const incomingIndices = new Set<number>();
          data.incoming.lines.forEach((line: LineAnnotation, idx: number) => {
            if (line.depName && line.type !== 'none') {
              incomingIndices.add(idx);
            }
          });
          setSelectedIncoming(incomingIndices);
        }
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to load diff' });
      }
    } catch (error) {
      console.error('Error fetching diff:', error);
      setMessage({ type: 'error', text: 'Failed to load diff' });
    }
  };

  const toggleCurrentSelection = (idx: number) => {
    const newSet = new Set(selectedCurrent);
    if (newSet.has(idx)) {
      newSet.delete(idx);
    } else {
      newSet.add(idx);
    }
    setSelectedCurrent(newSet);
  };

  const toggleIncomingSelection = (idx: number) => {
    const newSet = new Set(selectedIncoming);
    if (newSet.has(idx)) {
      newSet.delete(idx);
    } else {
      newSet.add(idx);
    }
    setSelectedIncoming(newSet);
  };

  const selectAllCurrent = () => {
    if (!diff?.current?.lines) return;
    const allIndices = new Set<number>();
    diff.current.lines.forEach((line: LineAnnotation, idx: number) => {
      if (line.depName && line.type !== 'none') {
        allIndices.add(idx);
      }
    });
    setSelectedCurrent(allIndices);
  };

  const deselectAllCurrent = () => {
    setSelectedCurrent(new Set());
  };

  const selectAllIncoming = () => {
    if (!diff?.incoming?.lines) return;
    const allIndices = new Set<number>();
    diff.incoming.lines.forEach((line: LineAnnotation, idx: number) => {
      if (line.depName && line.type !== 'none') {
        allIndices.add(idx);
      }
    });
    setSelectedIncoming(allIndices);
  };

  const deselectAllIncoming = () => {
    setSelectedIncoming(new Set());
  };

  const getMergedDependencies = (): Array<{ line: string; type: 'added' | 'updated' | 'unchanged'; depName?: string }> => {
    if (!diff?.current?.lines || !diff?.incoming?.lines) return [];
    
    const merged: Array<{ line: string; type: 'added' | 'updated' | 'unchanged'; depName?: string }> = [];
    const seenDeps = new Map<string, { line: string; type: 'added' | 'updated' | 'unchanged'; depName?: string }>();
    
    // First, process all selected current dependencies
    diff.current.lines.forEach((line: LineAnnotation, idx: number) => {
      if (selectedCurrent.has(idx) && line.depName && line.type !== 'none') {
        const depName = line.depName.toLowerCase();
        if (!seenDeps.has(depName)) {
          // Check if this dependency also exists in incoming
          const incomingIdx = diff.incoming.lines.findIndex((l: LineAnnotation) => 
            l.depName && l.depName.toLowerCase() === depName
          );
          const incomingLine = incomingIdx >= 0 ? diff.incoming.lines[incomingIdx] : null;
          const isIncomingSelected = incomingIdx >= 0 && selectedIncoming.has(incomingIdx);
          
          let changeType: 'added' | 'updated' | 'unchanged' = 'unchanged';
          let finalLine = line.line.trim();
          
          if (incomingLine && isIncomingSelected) {
            // Dependency exists in both - check if it's updated
            if (incomingLine.type === 'updated') {
              changeType = 'updated';
              finalLine = incomingLine.line.trim(); // Use incoming version for updates
            } else {
              changeType = 'unchanged';
            }
          } else {
            // Only in current - unchanged
            changeType = 'unchanged';
          }
          
          seenDeps.set(depName, {
            line: finalLine,
            type: changeType,
            depName: line.depName,
          });
        }
      }
    });
    
    // Then, add selected incoming dependencies that aren't in current
    diff.incoming.lines.forEach((line: LineAnnotation, idx: number) => {
      if (selectedIncoming.has(idx) && line.depName && line.type !== 'none') {
        const depName = line.depName.toLowerCase();
        if (!seenDeps.has(depName)) {
          // This is a new dependency (added)
          seenDeps.set(depName, {
            line: line.line.trim(),
            type: 'added',
            depName: line.depName,
          });
        }
      }
    });
    
    return Array.from(seenDeps.values());
  };

  const handleMerge = async () => {
    const mergedDeps = getMergedDependencies();
    
    if (mergedDeps.length === 0) {
      setMessage({ type: 'error', text: 'No dependencies selected to merge' });
      return;
    }

    setIsMerging(true);
    setMessage(null);

    try {
      const mergedLines = mergedDeps.map(item => item.line);
      const response = await fetch('/api/install/merge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mergedDependencies: mergedLines,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage({ type: 'error', text: data.error || 'Failed to merge requirements' });
        setIsMerging(false);
        return;
      }

      setMessage({ 
        type: 'success', 
        text: `Requirements merged successfully! Backup created at requirements.bkp` 
      });
      setIsMerging(false);
      
      // Redirect to grid page after a short delay
      setTimeout(() => {
        router.push('/active');
      }, 1500);
    } catch (error) {
      console.error('Error merging requirements:', error);
      setMessage({ type: 'error', text: 'Failed to merge requirements' });
      setIsMerging(false);
    }
  };

  const renderLogMessage = (message: string) => {
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
    return <span>{message}</span>;
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', backgroundColor: '#000000', paddingTop: '2rem', paddingBottom: '2rem' }}>
      <Container size="xl" py="xl" style={{ width: '100%' }}>
        <Stack gap="md">
          <Group justify="space-between" align="center">
            <Title order={2} c="#ffffff">{isUpdate ? 'Update Custom Node' : 'Install Custom Node'}</Title>
            <Button
              variant="subtle"
              leftSection={<RiHomeLine size={16} />}
              onClick={() => router.push('/')}
              size="sm"
              style={{ color: '#ffffff' }}
            >
              Home
            </Button>
          </Group>

          <Paper p="md" style={{ backgroundColor: '#111111', border: '1px solid #333333' }}>
            <form onSubmit={handleSubmit}>
              <Stack gap="md">
                <TextInput
                  label="Github URL"
                  placeholder="https://github.com/user/repo"
                  value={githubUrl}
                  onChange={(e) => setGithubUrl(e.target.value)}
                  required
                  disabled={isCloning}
                  styles={{
                    label: { color: '#ffffff' },
                    input: { backgroundColor: '#1a1b1e', color: '#ffffff', borderColor: '#373a40' },
                  }}
                />
                <TextInput
                  label="Commit ID (optional)"
                  placeholder="Leave empty to use latest"
                  value={commitId}
                  onChange={(e) => setCommitId(e.target.value)}
                  disabled={isCloning}
                  styles={{
                    label: { color: '#ffffff' },
                    input: { backgroundColor: '#1a1b1e', color: '#ffffff', borderColor: '#373a40' },
                  }}
                />
                <TextInput
                  label="Branch (optional)"
                  placeholder="Leave empty to use default branch"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  disabled={isCloning}
                  styles={{
                    label: { color: '#ffffff' },
                    input: { backgroundColor: '#1a1b1e', color: '#ffffff', borderColor: '#373a40' },
                  }}
                />
                <Group justify="flex-end">
                  {isCloning && (
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
                    type="submit"
                    disabled={isCloning || !githubUrl.trim()}
                    loading={isCloning}
                    size="sm"
                    style={{
                      backgroundColor: !isCloning && githubUrl.trim() ? '#0070f3' : undefined,
                      color: (isCloning || !githubUrl.trim()) ? '#000000' : '#ffffff',
                    }}
                  >
                    {isUpdate ? 'Update & Rescan' : 'Install'}
                  </Button>
                </Group>
              </Stack>
            </form>
          </Paper>

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

          {showLogs && (
            <Paper p="md" style={{ backgroundColor: '#111111', border: '1px solid #333333' }}>
              <Stack gap="sm">
                <Group justify="space-between" align="center">
                  <Text fw={600} size="lg" c="#ffffff">Clone Progress</Text>
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
              </Stack>
            </Paper>
          )}

          {cloneComplete && diff && diff.current && diff.incoming && (
            <Paper p="md" style={{ backgroundColor: '#111111', border: '1px solid #333333' }}>
              <Stack gap="md">
                <Group justify="space-between" align="center">
                  <Title order={3} c="#ffffff">Dependency Comparison</Title>
                  <Group gap="md">
                    <Text size="xs" c="#888888">
                      {diff.added.length} added, {diff.removed.length} removed, {diff.updated.length} updated
                    </Text>
                    {diff.conflicts?.hasConflicts && (
                      <Text size="xs" c="#ff6b6b" fw={600}>
                        ⚠️ Conflicts Detected
                      </Text>
                    )}
                    {diff.conflicts && !diff.conflicts.hasConflicts && (
                      <Text size="xs" c="#51cf66" fw={600}>
                        ✓ No Conflicts
                      </Text>
                    )}
                  </Group>
                </Group>
                
                {/* pip-tools Summary */}
                {diff.conflicts && (
                  <Paper p="md" style={{ backgroundColor: '#1a1b1e', border: '1px solid #373a40' }}>
                    <Stack gap="sm">
                      <Group justify="space-between" align="center">
                        <Group gap="xs" align="center">
                          <Text size="sm" fw={600} c="#ffffff">
                            pip-tools Conflict Analysis
                          </Text>
                          {diff.conflicts.hasConflicts ? (
                            <Text size="xs" c="#ff6b6b" fw={600} style={{ 
                              backgroundColor: '#2d1b1b', 
                              padding: '2px 8px', 
                              borderRadius: '4px' 
                            }}>
                              ⚠️ Conflicts Found
                            </Text>
                          ) : diff.conflicts.details && !diff.conflicts.details.includes('not available') ? (
                            <Text size="xs" c="#51cf66" fw={600} style={{ 
                              backgroundColor: '#1b2d1b', 
                              padding: '2px 8px', 
                              borderRadius: '4px' 
                            }}>
                              ✓ No Conflicts
                            </Text>
                          ) : (
                            <Text size="xs" c="#888888" fw={600} style={{ 
                              backgroundColor: '#1a1a1a', 
                              padding: '2px 8px', 
                              borderRadius: '4px' 
                            }}>
                              ⚠ Check Unavailable
                            </Text>
                          )}
                        </Group>
                      </Group>
                      
                      <Group gap="lg">
                        <div>
                          <Text size="xs" c="#888888">Current Dependencies</Text>
                          <Text size="sm" c="#ffffff" fw={600}>
                            {diff.current.lines.filter(l => l.type !== 'none' && l.type !== 'removed').length}
                          </Text>
                        </div>
                        <div>
                          <Text size="xs" c="#888888">Incoming Dependencies</Text>
                          <Text size="sm" c="#ffffff" fw={600}>
                            {diff.incoming.lines.filter(l => l.type !== 'none' && l.type !== 'added').length}
                          </Text>
                        </div>
                        <div>
                          <Text size="xs" c="#888888">New Dependencies</Text>
                          <Text size="sm" c="#51cf66" fw={600}>
                            +{diff.added.length}
                          </Text>
                        </div>
                        <div>
                          <Text size="xs" c="#888888">Version Updates</Text>
                          <Text size="sm" c="#ffd43b" fw={600}>
                            {diff.updated.length}
                          </Text>
                        </div>
                      </Group>
                      
                      {diff.conflicts.details && !diff.conflicts.details.includes('not available') && diff.conflicts.details.trim() && (
                        <Paper p="xs" style={{ backgroundColor: '#0a0a0a', fontFamily: 'monospace', fontSize: '11px' }}>
                          <Text size="xs" c="#888888" mb="xs">pip-compile output:</Text>
                          <Text size="xs" c="#ffffff" style={{ whiteSpace: 'pre-wrap', maxHeight: '100px', overflow: 'auto' }}>
                            {diff.conflicts.details.substring(0, 500)}
                            {diff.conflicts.details.length > 500 && '...'}
                          </Text>
                        </Paper>
                      )}
                    </Stack>
                  </Paper>
                )}
                
                {diff.conflicts?.hasConflicts && (
                  <Alert
                    icon={<RiErrorWarningLine size={16} />}
                    title="Dependency Conflicts Detected"
                    style={{
                      backgroundColor: '#2d1b1b',
                      border: '1px solid #ff6b6b',
                      color: '#ffffff',
                    }}
                  >
                    <Stack gap="xs">
                      <Text size="sm" c="#ff6b6b" fw={600}>
                        pip-compile detected conflicts when merging dependencies:
                      </Text>
                      <Paper p="sm" style={{ backgroundColor: '#1a0a0a', fontFamily: 'monospace', fontSize: '11px' }}>
                        <ScrollArea h={150}>
                          {diff.conflicts.conflicts.length > 0 ? (
                            diff.conflicts.conflicts.map((conflict, idx) => (
                              <div key={idx} style={{ color: '#ff6b6b', marginBottom: '4px' }}>
                                {conflict}
                              </div>
                            ))
                          ) : (
                            <Text size="xs" c="#ff6b6b" style={{ whiteSpace: 'pre-wrap' }}>
                              {diff.conflicts.details || 'Unknown conflict'}
                            </Text>
                          )}
                        </ScrollArea>
                      </Paper>
                      <Text size="xs" c="#888888">
                        Note: Current dependencies will be preserved. Conflicts may need manual resolution.
                      </Text>
                    </Stack>
                  </Alert>
                )}
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                  {/* Current (v1) */}
                  <div>
                    <Group justify="space-between" align="center" mb="xs">
                      <Text fw={600} size="sm" c="#ffffff">
                        Source (Backup)
                      </Text>
                      <Group gap="xs">
                        <Button
                          size="xs"
                          variant="subtle"
                          onClick={selectAllCurrent}
                          style={{ color: '#888888', fontSize: '10px', padding: '2px 8px' }}
                        >
                          Select All
                        </Button>
                        <Button
                          size="xs"
                          variant="subtle"
                          onClick={deselectAllCurrent}
                          style={{ color: '#888888', fontSize: '10px', padding: '2px 8px' }}
                        >
                          Deselect All
                        </Button>
                      </Group>
                    </Group>
                    <Text size="xs" c="#888888" mb="sm">
                      data/revisions/{selectedRevision}/requirements.bkp
                    </Text>
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
                      {diff.current.lines.map((annotation, idx) => {
                        const isSelectable = annotation.depName && annotation.type !== 'none';
                        const isSelected = selectedCurrent.has(idx);
                        let bgColor = 'transparent';
                        let borderLeft = 'none';
                        let tag = '';
                        
                        if (annotation.type === 'removed') {
                          bgColor = '#2d1b1b';
                          borderLeft = '3px solid #ff6b6b';
                          tag = 'REMOVED';
                        } else if (annotation.type === 'updated') {
                          bgColor = '#2d281b';
                          borderLeft = '3px solid #ffd43b';
                          tag = 'UPDATED';
                        } else if (annotation.type === 'unchanged') {
                          bgColor = 'transparent';
                        }
                        
                        return (
                          <div
                            key={idx}
                            style={{
                              padding: '2px 8px',
                              backgroundColor: bgColor,
                              borderLeft,
                              marginBottom: '1px',
                              whiteSpace: 'pre',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                            }}
                          >
                            {isSelectable && (
                              <Checkbox
                                checked={isSelected}
                                onChange={() => toggleCurrentSelection(idx)}
                                size="xs"
                                styles={{
                                  input: {
                                    cursor: 'pointer',
                                  },
                                }}
                              />
                            )}
                            {tag && (
                              <span style={{ 
                                color: annotation.type === 'removed' ? '#ff6b6b' : '#ffd43b',
                                fontWeight: 'bold',
                                fontSize: '10px',
                                marginRight: '4px',
                              }}>
                                [{tag}]
                              </span>
                            )}
                            <span style={{ 
                              color: annotation.type === 'removed' ? '#ff6b6b' : 
                                      annotation.type === 'updated' ? '#ffd43b' : 
                                      annotation.type === 'none' ? '#666666' : '#ffffff',
                              flex: 1,
                            }}>
                              {annotation.line || ' '}
                            </span>
                          </div>
                        );
                      })}
                    </Paper>
                  </div>

                  {/* Incoming (new node) */}
                  <div>
                    <Group justify="space-between" align="center" mb="xs">
                      <Text fw={600} size="sm" c="#ffffff">
                        Incoming
                      </Text>
                      <Group gap="xs">
                        <Button
                          size="xs"
                          variant="subtle"
                          onClick={selectAllIncoming}
                          style={{ color: '#888888', fontSize: '10px', padding: '2px 8px' }}
                        >
                          Select All
                        </Button>
                        <Button
                          size="xs"
                          variant="subtle"
                          onClick={deselectAllIncoming}
                          style={{ color: '#888888', fontSize: '10px', padding: '2px 8px' }}
                        >
                          Deselect All
                        </Button>
                      </Group>
                    </Group>
                    <Text size="xs" c="#888888" mb="sm">
                      data/nodes/{nodeName}/requirements.txt
                    </Text>
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
                      {diff.incoming.lines.map((annotation, idx) => {
                        const isSelectable = annotation.depName && annotation.type !== 'none';
                        const isSelected = selectedIncoming.has(idx);
                        let bgColor = 'transparent';
                        let borderLeft = 'none';
                        let tag = '';
                        
                        if (annotation.type === 'added') {
                          bgColor = '#1b2d1b';
                          borderLeft = '3px solid #51cf66';
                          tag = 'ADDED';
                        } else if (annotation.type === 'updated') {
                          bgColor = '#2d281b';
                          borderLeft = '3px solid #ffd43b';
                          tag = 'UPDATED';
                        } else if (annotation.type === 'unchanged') {
                          bgColor = 'transparent';
                        }
                        
                        return (
                          <div
                            key={idx}
                            style={{
                              padding: '2px 8px',
                              backgroundColor: bgColor,
                              borderLeft,
                              marginBottom: '1px',
                              whiteSpace: 'pre',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                            }}
                          >
                            {isSelectable && (
                              <Checkbox
                                checked={isSelected}
                                onChange={() => toggleIncomingSelection(idx)}
                                size="xs"
                                styles={{
                                  input: {
                                    cursor: 'pointer',
                                  },
                                }}
                              />
                            )}
                            {tag && (
                              <span style={{ 
                                color: annotation.type === 'added' ? '#51cf66' : '#ffd43b',
                                fontWeight: 'bold',
                                fontSize: '10px',
                                marginRight: '4px',
                              }}>
                                [{tag}]
                              </span>
                            )}
                            <span style={{ 
                              color: annotation.type === 'added' ? '#51cf66' : 
                                      annotation.type === 'updated' ? '#ffd43b' : 
                                      annotation.type === 'none' ? '#666666' : '#ffffff',
                              flex: 1,
                            }}>
                              {annotation.line || ' '}
                            </span>
                          </div>
                        );
                      })}
                    </Paper>
                  </div>

                  {/* Merged List */}
                  <div>
                    <Group justify="space-between" align="center" mb="xs">
                      <Text fw={600} size="sm" c="#ffffff">
                        Merged Selection
                      </Text>
                      <Button
                        size="xs"
                        onClick={handleMerge}
                        loading={isMerging}
                        disabled={getMergedDependencies().length === 0}
                        style={{
                          backgroundColor: getMergedDependencies().length === 0 ? undefined : '#0070f3',
                          color: getMergedDependencies().length === 0 ? '#000000' : '#ffffff',
                        }}
                      >
                        Merge Changes
                      </Button>
                    </Group>
                    <Text size="xs" c="#888888" mb="sm">
                      {getMergedDependencies().length} dependencies selected
                    </Text>
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
                      {getMergedDependencies().length === 0 ? (
                        <Text size="xs" c="#666666" ta="center" py="xl">
                          No dependencies selected
                        </Text>
                      ) : (
                        getMergedDependencies().map((item, idx) => {
                          let bgColor = 'transparent';
                          let borderLeft = 'none';
                          let tag = '';
                          let textColor = '#ffffff';
                          
                          if (item.type === 'added') {
                            bgColor = '#1b2d1b';
                            borderLeft = '3px solid #51cf66';
                            tag = 'ADDED';
                            textColor = '#51cf66';
                          } else if (item.type === 'updated') {
                            bgColor = '#2d281b';
                            borderLeft = '3px solid #ffd43b';
                            tag = 'UPDATED';
                            textColor = '#ffd43b';
                          } else {
                            textColor = '#ffffff';
                          }
                          
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
                              {tag && (
                                <span style={{ 
                                  color: item.type === 'added' ? '#51cf66' : '#ffd43b',
                                  fontWeight: 'bold',
                                  fontSize: '10px',
                                  marginRight: '8px',
                                }}>
                                  [{tag}]
                                </span>
                              )}
                              {item.line || ' '}
                            </div>
                          );
                        })
                      )}
                    </Paper>
                  </div>
                </div>
              </Stack>
            </Paper>
          )}
        </Stack>
      </Container>
    </div>
  );
}

