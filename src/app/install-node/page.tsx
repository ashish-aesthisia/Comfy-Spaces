'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Container, Title, Group, ActionIcon, Paper, Stack, TextInput, Button, Alert, Text, Collapse, Badge, Divider, Checkbox } from '@mantine/core';
import { RiArrowLeftLine, RiCheckLine, RiErrorWarningLine, RiArrowDownSLine, RiArrowUpSLine, RiShieldCheckLine, RiInformationLine } from 'react-icons/ri';

type DependencyStatus = 'installed' | 'upgrade' | 'downgrade' | 'new';

interface SubDependency {
  name: string;
  version?: string;
  status?: DependencyStatus;
  currentVersion?: string;
  selected?: boolean;
}

interface Dependency {
  name: string;
  version?: string;
  status?: DependencyStatus;
  currentVersion?: string;
  subdependencies: SubDependency[];
  selected?: boolean;
}

export default function InstallNodePage() {
  const router = useRouter();
  const [githubUrl, setGithubUrl] = useState('');
  const [commitId, setCommitId] = useState('');
  const [branch, setBranch] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [dependencies, setDependencies] = useState<Dependency[] | null>(null);
  const [expandedDeps, setExpandedDeps] = useState<Set<string>>(new Set());
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);

  const getStatusBadge = (status?: DependencyStatus) => {
    if (!status) return null;
    
    const statusConfig = {
      installed: { label: 'Installed', color: 'gray' },
      upgrade: { label: 'Upgrade', color: 'yellow' },
      downgrade: { label: 'Downgrade', color: 'orange' },
      new: { label: 'New', color: 'green' },
    };
    
    const config = statusConfig[status];
    return (
      <Badge size="sm" variant="light" color={config.color}>
        {config.label}
      </Badge>
    );
  };

  const toggleDependencySelection = (depName: string, isSubDep: boolean = false, parentName?: string) => {
    if (!dependencies) return;
    
    const updatedDeps = dependencies.map(dep => {
      if (isSubDep && parentName && dep.name === parentName) {
        return {
          ...dep,
          subdependencies: dep.subdependencies.map(sub => 
            sub.name === depName ? { ...sub, selected: !sub.selected } : sub
          ),
        };
      } else if (!isSubDep && dep.name === depName) {
        return {
          ...dep,
          selected: !dep.selected,
        };
      }
      return dep;
    });
    
    setDependencies(updatedDeps);
  };

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!githubUrl.trim()) {
      setMessage({ type: 'error', text: 'Github URL is required' });
      return;
    }

    setIsAnalyzing(true);
    setMessage(null);
    setDependencies(null);

    try {
      const response = await fetch('/api/install-node/analyze', {
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
        setMessage({ type: 'error', text: data.error || 'Failed to analyze dependencies' });
        setIsAnalyzing(false);
        return;
      }

      setDependencies(data.dependencies || []);
      setIsAnalyzing(false);
    } catch (error) {
      console.error('Error analyzing dependencies:', error);
      setMessage({ type: 'error', text: 'Failed to analyze dependencies' });
      setIsAnalyzing(false);
    }
  };

  const handleInstall = async () => {
    if (!githubUrl.trim()) {
      setMessage({ type: 'error', text: 'Github URL is required' });
      return;
    }

    setIsInstalling(true);
    setIsStreaming(true);
    setMessage(null);
    setLogs([]);
    setShowLogs(true);

    try {
      // Get selected dependencies
      const selectedDeps: Array<{ name: string; version?: string }> = [];
      
      if (dependencies) {
        dependencies.forEach(dep => {
          if (dep.selected !== false) {
            selectedDeps.push({
              name: dep.name,
              version: dep.version,
            });
          }
          
          dep.subdependencies.forEach(subDep => {
            if (subDep.selected !== false) {
              selectedDeps.push({
                name: subDep.name,
                version: subDep.version,
              });
            }
          });
        });
      }

      // Build query parameters
      const params = new URLSearchParams({
        githubUrl: githubUrl.trim(),
        selectedDeps: JSON.stringify(selectedDeps),
      });
      
      if (commitId.trim()) {
        params.append('commitId', commitId.trim());
      }
      if (branch.trim()) {
        params.append('branch', branch.trim());
      }

      // Stream installation logs
      const response = await fetch(`/api/install-node/stream?${params.toString()}`);
      
      if (!response.ok) {
        throw new Error('Failed to start installation');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('No response body');
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.message) {
                setLogs(prev => [...prev, data.message]);
                
                // Check for completion
                if (data.message === '[COMPLETE]') {
                  setIsStreaming(false);
                  setIsInstalling(false);
                  
                  // Redirect to active page
                  setTimeout(() => {
                    router.push('/active');
                  }, 2000);
                  return;
                }
              }
            } catch (error) {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (error) {
      console.error('Error installing node:', error);
      setMessage({ type: 'error', text: 'Failed to install node' });
      setIsInstalling(false);
      setIsStreaming(false);
    }
  };

  const toggleDependency = (depName: string) => {
    const newExpanded = new Set(expandedDeps);
    if (newExpanded.has(depName)) {
      newExpanded.delete(depName);
    } else {
      newExpanded.add(depName);
    }
    setExpandedDeps(newExpanded);
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', backgroundColor: '#1a1b1e', paddingTop: '2rem', paddingBottom: '2rem' }}>
      <Container size="xl" py="xl" style={{ width: '100%' }}>
        <Stack gap="md">
          <Group gap="sm" align="center">
            <ActionIcon
              variant="subtle"
              size="lg"
              onClick={() => router.push('/active')}
              style={{ color: '#ffffff' }}
              title="Back"
            >
              <RiArrowLeftLine size={20} />
            </ActionIcon>
            <Title order={3} c="#ffffff">Install Custom Node</Title>
          </Group>

          <Paper p="md" style={{ backgroundColor: '#25262b', border: '1px solid #373a40' }}>
            <form onSubmit={handleAnalyze}>
              <Stack gap="md">
                <TextInput
                  label="Github URL"
                  placeholder="https://github.com/user/repo"
                  value={githubUrl}
                  onChange={(e) => setGithubUrl(e.target.value)}
                  disabled={isAnalyzing || isInstalling}
                  required
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
                  disabled={isAnalyzing || isInstalling}
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
                  disabled={isAnalyzing || isInstalling}
                  styles={{
                    label: { color: '#ffffff' },
                    input: { backgroundColor: '#1a1b1e', color: '#ffffff', borderColor: '#373a40' },
                  }}
                />
                <Group justify="flex-end">
                  <Button
                    type="submit"
                    disabled={isAnalyzing || isInstalling || !githubUrl.trim()}
                    loading={isAnalyzing}
                    style={{
                      backgroundColor: !isAnalyzing && !isInstalling && githubUrl.trim() ? '#0070f3' : undefined,
                      color: (isAnalyzing || isInstalling || !githubUrl.trim()) ? '#000000' : '#ffffff',
                    }}
                  >
                    Analyze Dependencies
                  </Button>
                </Group>
              </Stack>
            </form>
          </Paper>

          {dependencies && dependencies.length > 0 && (
            <Paper p="md" style={{ backgroundColor: '#25262b', border: '1px solid #373a40' }}>
              <Stack gap="md">
                <Title order={4} c="#ffffff">Dependency Safety Check</Title>
                
                {/* Info Section */}
                <Paper p="md" style={{ backgroundColor: '#1a1b1e', border: '1px solid #373a40', borderRadius: '8px' }}>
                  <Group gap="sm" align="flex-start">
                    <RiShieldCheckLine size={24} style={{ color: '#00d9ff', marginTop: '2px', flexShrink: 0 }} />
                    <Stack gap="sm" style={{ flex: 1 }}>
                      <Group gap="xs" align="center">
                        <Text size="sm" c="#ffffff" fw={600}>Dependency Safety Features</Text>
                      </Group>
                      <Stack gap="xs" style={{ paddingLeft: '0.5rem' }}>
                        <Group gap="xs" align="flex-start">
                          <RiCheckLine size={16} style={{ color: '#00d9ff', marginTop: '2px', flexShrink: 0 }} />
                          <Text size="sm" c="#cccccc" style={{ lineHeight: 1.5 }}>
                            Automatically filters out dependencies that are already installed
                          </Text>
                        </Group>
                        <Group gap="xs" align="flex-start">
                          <RiCheckLine size={16} style={{ color: '#00d9ff', marginTop: '2px', flexShrink: 0 }} />
                          <Text size="sm" c="#cccccc" style={{ lineHeight: 1.5 }}>
                            Clearly highlights which dependencies will be upgraded or downgraded
                          </Text>
                        </Group>
                        <Group gap="xs" align="flex-start">
                          <RiCheckLine size={16} style={{ color: '#00d9ff', marginTop: '2px', flexShrink: 0 }} />
                          <Text size="sm" c="#cccccc" style={{ lineHeight: 1.5 }}>
                            Lets you selectively choose which dependencies to include
                          </Text>
                        </Group>
                        <Group gap="xs" align="flex-start">
                          <RiCheckLine size={16} style={{ color: '#00d9ff', marginTop: '2px', flexShrink: 0 }} />
                          <Text size="sm" c="#cccccc" style={{ lineHeight: 1.5 }}>
                            Automatically excludes preinstalled packages to avoid conflicts
                          </Text>
                        </Group>
                      </Stack>
                    </Stack>
                  </Group>
                </Paper>

                <Divider style={{ borderColor: '#373a40' }} />

                {/* Two Column Layout */}
                <Group align="flex-start" gap="md" style={{ width: '100%' }}>
                  {/* Left Column: Incoming */}
                  <Paper p="md" style={{ backgroundColor: '#1a1b1e', border: '1px solid #373a40', flex: 1 }}>
                    <Stack gap="md">
                      <Title order={5} c="#ffffff">Incoming</Title>
                      <Stack gap="xs">
                        {dependencies.map((dep, index) => (
                          <div key={index}>
                            <Group
                              justify="space-between"
                              style={{
                                padding: '0.5rem',
                                backgroundColor: '#25262b',
                                borderRadius: '4px',
                              }}
                            >
                              <Group gap="xs" style={{ flex: 1 }}>
                                <Checkbox
                                  checked={dep.selected !== false}
                                  onChange={() => toggleDependencySelection(dep.name)}
                                  size="sm"
                                  styles={{
                                    input: { cursor: 'pointer' },
                                  }}
                                />
                                {dep.subdependencies.length > 0 && (
                                  <ActionIcon
                                    variant="subtle"
                                    size="sm"
                                    style={{ color: '#ffffff', cursor: 'pointer' }}
                                    onClick={() => toggleDependency(dep.name)}
                                  >
                                    {expandedDeps.has(dep.name) ? (
                                      <RiArrowUpSLine size={16} />
                                    ) : (
                                      <RiArrowDownSLine size={16} />
                                    )}
                                  </ActionIcon>
                                )}
                                <Text size="sm" c="#ffffff" fw={500}>
                                  {dep.name}
                                </Text>
                                {dep.version && (
                                  <Badge size="sm" variant="light" color="blue">
                                    {dep.version}
                                  </Badge>
                                )}
                                {dep.currentVersion && dep.status !== 'installed' && (
                                  <Text size="xs" c="#888888">
                                    (current: {dep.currentVersion})
                                  </Text>
                                )}
                                {getStatusBadge(dep.status)}
                              </Group>
                              {dep.subdependencies.length > 0 && (
                                <Badge size="sm" variant="outline" color="gray">
                                  {dep.subdependencies.length} subdependencies
                                </Badge>
                              )}
                            </Group>
                            <Collapse in={expandedDeps.has(dep.name)}>
                              <div style={{ paddingLeft: '2rem', paddingTop: '0.5rem', paddingBottom: '0.5rem' }}>
                                <Stack gap="xs">
                                  {dep.subdependencies.map((subDep, subIndex) => (
                                    <Group key={subIndex} gap="xs" style={{ paddingLeft: '1rem' }}>
                                      <Checkbox
                                        checked={subDep.selected !== false}
                                        onChange={() => toggleDependencySelection(subDep.name, true, dep.name)}
                                        size="xs"
                                        styles={{
                                          input: { cursor: 'pointer' },
                                        }}
                                      />
                                      <Text size="xs" c="#aaaaaa">
                                        • {subDep.name}
                                      </Text>
                                      {subDep.version && (
                                        <Badge size="xs" variant="outline" color="gray">
                                          {subDep.version}
                                        </Badge>
                                      )}
                                      {subDep.currentVersion && subDep.status !== 'installed' && (
                                        <Text size="xs" c="#666666">
                                          (current: {subDep.currentVersion})
                                        </Text>
                                      )}
                                      {getStatusBadge(subDep.status)}
                                    </Group>
                                  ))}
                                </Stack>
                              </div>
                            </Collapse>
                          </div>
                        ))}
                      </Stack>
                    </Stack>
                  </Paper>

                  {/* Right Column: To be installed */}
                  <Paper p="md" style={{ backgroundColor: '#1a1b1e', border: '1px solid #373a40', flex: 1, minWidth: '300px' }}>
                    <Stack gap="md">
                      <Title order={5} c="#ffffff">To be installed</Title>
                      <Stack gap="xs" style={{ maxHeight: '600px', overflowY: 'auto' }}>
                        {(() => {
                          const selectedDeps: Array<{ name: string; version?: string; isSub: boolean; parentName?: string }> = [];
                          
                          dependencies.forEach(dep => {
                            if (dep.selected !== false) {
                              selectedDeps.push({
                                name: dep.name,
                                version: dep.version,
                                isSub: false,
                              });
                            }
                            
                            dep.subdependencies.forEach(subDep => {
                              if (subDep.selected !== false) {
                                selectedDeps.push({
                                  name: subDep.name,
                                  version: subDep.version,
                                  isSub: true,
                                  parentName: dep.name,
                                });
                              }
                            });
                          });
                          
                          if (selectedDeps.length === 0) {
                            return (
                              <Text size="sm" c="#888888" style={{ fontStyle: 'italic' }}>
                                No dependencies selected
                              </Text>
                            );
                          }
                          
                          return selectedDeps.map((item, index) => (
                            <Group key={index} gap="xs" style={{ padding: '0.5rem', backgroundColor: '#25262b', borderRadius: '4px' }}>
                              <Text size="sm" c="#ffffff">
                                {item.isSub && item.parentName ? `  • ${item.name}` : `• ${item.name}`}
                              </Text>
                              {item.version && (
                                <Badge size="sm" variant="light" color="blue">
                                  {item.version}
                                </Badge>
                              )}
                            </Group>
                          ));
                        })()}
                      </Stack>
                    </Stack>
                  </Paper>
                </Group>

                <Divider style={{ borderColor: '#373a40' }} />
                
                {/* Activation Logs */}
                {(isInstalling || logs.length > 0) && (
                  <>
                    <Paper p="sm" style={{ backgroundColor: '#1a1b1e', border: '1px solid #373a40' }}>
                      <Stack gap="xs">
                        <Group justify="space-between" align="center">
                          <Text size="sm" c="#ffffff" fw={500}>Activation Logs</Text>
                          <Button
                            variant="subtle"
                            size="xs"
                            onClick={() => setShowLogs(!showLogs)}
                            style={{ color: '#ffffff' }}
                          >
                            {showLogs ? 'Hide' : 'Show'}
                          </Button>
                        </Group>
                        <Collapse in={showLogs}>
                          <Paper p="sm" style={{ backgroundColor: '#0a0a0a', maxHeight: '300px', overflowY: 'auto', fontFamily: 'monospace' }}>
                            <Stack gap="xs">
                              {logs.length === 0 ? (
                                <Text size="xs" c="#888888">Waiting for logs...</Text>
                              ) : (
                                logs.map((log, index) => (
                                  <Text key={index} size="xs" c="#aaaaaa" style={{ whiteSpace: 'pre-wrap' }}>
                                    {log}
                                  </Text>
                                ))
                              )}
                              {isStreaming && (
                                <Text size="xs" c="#00d9ff">Streaming...</Text>
                              )}
                            </Stack>
                          </Paper>
                        </Collapse>
                      </Stack>
                    </Paper>
                    <Divider style={{ borderColor: '#373a40' }} />
                  </>
                )}

                <Group justify="flex-end">
                  <Button
                    onClick={handleInstall}
                    disabled={isInstalling}
                    loading={isInstalling}
                    style={{
                      backgroundColor: !isInstalling ? '#0070f3' : undefined,
                      color: isInstalling ? '#000000' : '#ffffff',
                    }}
                  >
                    Install & Restart
                  </Button>
                </Group>
              </Stack>
            </Paper>
          )}

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
        </Stack>
      </Container>
    </div>
  );
}

