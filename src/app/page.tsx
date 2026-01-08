'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Container, Title, Text, Select, Button, Group, Stack, Paper, ScrollArea, Badge, Menu, ActionIcon, Modal, TextInput, Tooltip, Textarea } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { RiCheckLine, RiErrorWarningLine, RiRefreshLine, RiCheckboxCircleFill, RiCloseLine, RiAddLine, RiFileCodeLine, RiArrowRightLine, RiMoreFill, RiPencilLine, RiDeleteBinLine, RiDownloadLine, RiInformationLine, RiCodeLine, RiHistoryLine, RiFileCopyLine } from 'react-icons/ri';
import CreateSpaceModal from './components/CreateSpaceModal';
import ImportJsonModal from './components/ImportJsonModal';

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
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [isComfyUIReady, setIsComfyUIReady] = useState(false);
  const [activationFailed, setActivationFailed] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const [createSpaceModalOpened, setCreateSpaceModalOpened] = useState(false);
  const [importJsonModalOpened, setImportJsonModalOpened] = useState(false);
  const [renameModalOpened, setRenameModalOpened] = useState(false);
  const [spaceToRename, setSpaceToRename] = useState<SpaceInfo | null>(null);
  const [newSpaceName, setNewSpaceName] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const [spaceToDelete, setSpaceToDelete] = useState<SpaceInfo | null>(null);
  const [updatePackagesModalOpened, setUpdatePackagesModalOpened] = useState(false);
  const [spaceToUpdate, setSpaceToUpdate] = useState<SpaceInfo | null>(null);
  const [requirementsContent, setRequirementsContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [historyModalOpened, setHistoryModalOpened] = useState(false);
  const [spaceForHistory, setSpaceForHistory] = useState<SpaceInfo | null>(null);
  const [historyDiff, setHistoryDiff] = useState<any>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [duplicateModalOpened, setDuplicateModalOpened] = useState(false);
  const [spaceToDuplicate, setSpaceToDuplicate] = useState<SpaceInfo | null>(null);
  const [newDuplicateSpaceName, setNewDuplicateSpaceName] = useState('');
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [deviceInfo, setDeviceInfo] = useState<{ device: string; gpuName: string; cudaVersion: string } | null>(null);

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
        notifications.show({
          title: 'Error',
          message: 'Failed to load spaces',
          color: 'red',
          icon: <RiErrorWarningLine size={18} />,
          autoClose: 5000,
        });
      });

    // Fetch device info on component mount
    fetch('/api/device-info')
      .then(res => res.json())
      .then((data: { device: string; gpuName: string; cudaVersion: string }) => {
        setDeviceInfo(data);
      })
      .catch(err => {
        console.error('Error fetching device info:', err);
        // Set default values on error
        setDeviceInfo({
          device: 'CPU',
          gpuName: 'NA',
          cudaVersion: 'NA',
        });
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
    notifications.show({
      title: 'Cancelled',
      message: 'Activation cancelled',
      color: 'orange',
      icon: <RiCloseLine size={18} />,
      autoClose: 5000,
    });
  };

  const handleActivate = async () => {
    if (!selectedSpace) return;

    setIsActivating(true);
    setLogs([]);
    setShowLogs(true);
    setIsComfyUIReady(false);
    setActivationFailed(false);

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
        setActivationFailed(true);
        notifications.show({
          title: 'Error',
          message: data.error || 'Failed to activate space',
          color: 'red',
          icon: <RiErrorWarningLine size={18} />,
          autoClose: 5000,
        });
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
            setActivationFailed(false);
            notifications.show({
              title: 'Cancelled',
              message: 'Activation cancelled',
              color: 'orange',
              icon: <RiCloseLine size={18} />,
              autoClose: 5000,
            });
            return;
          }
          
          // Check for activation failures
          const message = logEntry.message;
          if (message.includes('[ERROR]') || 
              message.includes('Failed to install dependencies') ||
              message.includes('ERROR:') ||
              message.includes('ResolutionImpossible') ||
              message.includes('Activation failed')) {
            setActivationFailed(true);
            setIsActivating(false);
            setIsComfyUIReady(false);
            return;
          }
          
          // Check if ComfyUI is ready - look for messages in both APP and COMFY logs
          if (message.includes('To see the GUI go to:') || 
              message.includes('Starting server') ||
              message.includes('Server started') ||
              message.includes('Running on') ||
              (message.includes('[COMFY]') && (message.includes('Running on') || message.includes('Server started')))) {
            setIsComfyUIReady(true);
            setIsActivating(false);
            setActivationFailed(false);
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
          setActivationFailed(true);
          notifications.show({
            title: 'Error',
            message: 'Failed to activate space',
            color: 'red',
            icon: <RiErrorWarningLine size={18} />,
            autoClose: 5000,
          });
        }
      };

      // Note: We don't automatically navigate away - let user see the logs
      // They can manually navigate when ready
    } catch (error) {
      console.error('Error activating space:', error);
      setActivationFailed(true);
      notifications.show({
        title: 'Error',
        message: 'Failed to activate space',
        color: 'red',
        icon: <RiErrorWarningLine size={18} />,
        autoClose: 5000,
      });
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

  const handleExportJson = async (space: SpaceInfo) => {
    try {
      const response = await fetch(`/api/spaces/${encodeURIComponent(space.name)}/export`);
      if (!response.ok) {
        const error = await response.json();
        notifications.show({
          title: 'Export Failed',
          message: error.error || 'Failed to export space',
          color: 'red',
          icon: <RiErrorWarningLine size={18} />,
          autoClose: 5000,
        });
        return;
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `space-${space.name}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      notifications.show({
        title: 'Export Successful',
        message: `Space "${space.visibleName || space.name}" exported successfully`,
        color: 'green',
        icon: <RiCheckLine size={18} />,
        autoClose: 5000,
      });
    } catch (error) {
      console.error('Error exporting space:', error);
      notifications.show({
        title: 'Export Failed',
        message: 'Failed to export space',
        color: 'red',
        icon: <RiErrorWarningLine size={18} />,
        autoClose: 5000,
      });
    }
  };

  const handleRename = async () => {
    if (!spaceToRename || !newSpaceName.trim()) {
      return;
    }

    setIsRenaming(true);
    try {
      const response = await fetch(`/api/spaces/${encodeURIComponent(spaceToRename.name)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ visibleName: newSpaceName.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        notifications.show({
          title: 'Rename Failed',
          message: data.error || 'Failed to rename space',
          color: 'red',
          icon: <RiErrorWarningLine size={18} />,
          autoClose: 5000,
        });
        setIsRenaming(false);
        return;
      }

      // Refresh spaces list
      const res = await fetch('/api/spaces');
      const spacesData: SpacesData = await res.json();
      setSpaces(spacesData);
      
      notifications.show({
        title: 'Rename Successful',
        message: `Space renamed to "${newSpaceName.trim()}" successfully`,
        color: 'green',
        icon: <RiCheckLine size={18} />,
        autoClose: 5000,
      });
      setRenameModalOpened(false);
      setSpaceToRename(null);
      setNewSpaceName('');
    } catch (error) {
      console.error('Error renaming space:', error);
      notifications.show({
        title: 'Rename Failed',
        message: 'Failed to rename space',
        color: 'red',
        icon: <RiErrorWarningLine size={18} />,
        autoClose: 5000,
      });
    } finally {
      setIsRenaming(false);
    }
  };

  const handleDelete = async (space: SpaceInfo) => {
    if (!confirm(`Are you sure you want to delete space "${space.visibleName || space.name}"? This action cannot be undone.`)) {
      return;
    }

    try {
      const response = await fetch(`/api/spaces/${encodeURIComponent(space.name)}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (!response.ok) {
        notifications.show({
          title: 'Delete Failed',
          message: data.error || 'Failed to delete space',
          color: 'red',
          icon: <RiErrorWarningLine size={18} />,
          autoClose: 5000,
        });
        return;
      }

      // Refresh spaces list
      const res = await fetch('/api/spaces');
      const spacesData: SpacesData = await res.json();
      setSpaces(spacesData);
      
      // If deleted space was selected, clear selection
      if (selectedSpace === space.name) {
        setSelectedSpace(spacesData.selectedVersion || '');
      }
      
      notifications.show({
        title: 'Delete Successful',
        message: `Space "${space.visibleName || space.name}" deleted successfully`,
        color: 'green',
        icon: <RiCheckLine size={18} />,
        autoClose: 5000,
      });
    } catch (error) {
      console.error('Error deleting space:', error);
      notifications.show({
        title: 'Delete Failed',
        message: 'Failed to delete space',
        color: 'red',
        icon: <RiErrorWarningLine size={18} />,
        autoClose: 5000,
      });
    }
  };

  const openRenameModal = (space: SpaceInfo) => {
    setSpaceToRename(space);
    setNewSpaceName(space.visibleName || space.name);
    setRenameModalOpened(true);
  };

  const openDuplicateModal = (space: SpaceInfo) => {
    setSpaceToDuplicate(space);
    setNewDuplicateSpaceName(`${space.visibleName || space.name} (copy)`);
    setDuplicateModalOpened(true);
  };

  const handleDuplicate = async () => {
    if (!spaceToDuplicate || !newDuplicateSpaceName.trim()) {
      return;
    }

    setIsDuplicating(true);
    try {
      const response = await fetch(`/api/spaces/${encodeURIComponent(spaceToDuplicate.name)}/duplicate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ newSpaceName: newDuplicateSpaceName.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        notifications.show({
          title: 'Clone Failed',
          message: data.error || 'Failed to duplicate space',
          color: 'red',
          icon: <RiErrorWarningLine size={18} />,
          autoClose: 5000,
        });
        setIsDuplicating(false);
        return;
      }

      // Refresh spaces list
      const res = await fetch('/api/spaces');
      const spacesData: SpacesData = await res.json();
      setSpaces(spacesData);
      
      notifications.show({
        title: 'Clone Successful',
        message: `Space cloned as "${newDuplicateSpaceName.trim()}" successfully`,
        color: 'green',
        icon: <RiCheckLine size={18} />,
        autoClose: 5000,
      });
      setDuplicateModalOpened(false);
      setSpaceToDuplicate(null);
      setNewDuplicateSpaceName('');
    } catch (error) {
      console.error('Error duplicating space:', error);
      notifications.show({
        title: 'Clone Failed',
        message: 'Failed to clone space',
        color: 'red',
        icon: <RiErrorWarningLine size={18} />,
        autoClose: 5000,
      });
    } finally {
      setIsDuplicating(false);
    }
  };

  const openUpdatePackagesModal = async (space: SpaceInfo) => {
    setSpaceToUpdate(space);
    try {
      const response = await fetch(`/api/spaces/${encodeURIComponent(space.name)}/requirements`);
      if (!response.ok) {
        const error = await response.json();
        notifications.show({
          title: 'Error',
          message: error.error || 'Failed to load requirements',
          color: 'red',
          icon: <RiErrorWarningLine size={18} />,
          autoClose: 5000,
        });
        return;
      }
      const data = await response.json();
      setRequirementsContent(data.content || '');
      setUpdatePackagesModalOpened(true);
    } catch (error) {
      console.error('Error loading requirements:', error);
      notifications.show({
        title: 'Error',
        message: 'Failed to load requirements',
        color: 'red',
        icon: <RiErrorWarningLine size={18} />,
        autoClose: 5000,
      });
    }
  };

  const handleSaveAndActivate = async () => {
    if (!spaceToUpdate) return;

    setIsSaving(true);
    try {
      // Save requirements.txt
      const response = await fetch(`/api/spaces/${encodeURIComponent(spaceToUpdate.name)}/requirements`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: requirementsContent }),
      });

      if (!response.ok) {
        const error = await response.json();
        notifications.show({
          title: 'Save Failed',
          message: error.error || 'Failed to save requirements',
          color: 'red',
          icon: <RiErrorWarningLine size={18} />,
          autoClose: 5000,
        });
        setIsSaving(false);
        return;
      }

      // Close modal
      setUpdatePackagesModalOpened(false);
      setSpaceToUpdate(null);
      setRequirementsContent('');

      // Activate the space
      setSelectedSpace(spaceToUpdate.name);
      await handleActivate();

      notifications.show({
        title: 'Success',
        message: 'Requirements updated and space activated',
        color: 'green',
        icon: <RiCheckLine size={18} />,
        autoClose: 5000,
      });
    } catch (error) {
      console.error('Error saving requirements:', error);
      notifications.show({
        title: 'Save Failed',
        message: 'Failed to save requirements',
        color: 'red',
        icon: <RiErrorWarningLine size={18} />,
        autoClose: 5000,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleShowHistory = async (space: SpaceInfo) => {
    setSpaceForHistory(space);
    setHistoryModalOpened(true);
    setLoadingHistory(true);
    setHistoryDiff(null);
    
    try {
      const response = await fetch(`/api/spaces/${encodeURIComponent(space.name)}/requirements/diff`);
      const data = await response.json();
      
      if (!response.ok) {
        setHistoryDiff({ error: data.error || 'Failed to load history' });
      } else {
        setHistoryDiff(data);
      }
    } catch (error) {
      console.error('Error fetching history:', error);
      setHistoryDiff({ error: 'Failed to load history' });
    } finally {
      setLoadingHistory(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', backgroundColor: '#000000', paddingTop: '2rem', paddingBottom: '2rem' }}>
      <Container size="xl" py="xl" style={{ width: '100%' }}>
        <Stack gap="md">
          <div style={{ textAlign: 'left', width: '50%', margin: '0 auto' }}>
            <Group gap="xs" align="center" mb="xs">
              <Title order={2} c="#ffffff">Comfy Spaces</Title>
              <Badge
                size="sm"
                variant="filled"
                style={{
                  backgroundColor: '#0070f3',
                  color: '#ffffff',
                }}
              >
                Beta
              </Badge>
            </Group>
            {deviceInfo && (
              <Group gap="md" mt="xs" mb="md">
                <Badge
                  size="sm"
                  variant="outline"
                  style={{
                    borderColor: '#555555',
                    color: '#888888',
                    backgroundColor: 'transparent',
                  }}
                >
                  Device: {deviceInfo.device}
                </Badge>
                <Badge
                  size="sm"
                  variant="outline"
                  style={{
                    borderColor: '#555555',
                    color: '#888888',
                    backgroundColor: 'transparent',
                  }}
                >
                  GPU: {deviceInfo.gpuName}
                </Badge>
                <Badge
                  size="sm"
                  variant="outline"
                  style={{
                    borderColor: '#555555',
                    color: '#888888',
                    backgroundColor: 'transparent',
                  }}
                >
                  CUDA Version: {deviceInfo.cudaVersion}
                </Badge>
              </Group>
            )}
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
                onClick={() => setImportJsonModalOpened(true)}
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
                        <Group gap="xs" wrap="nowrap" justify="space-between" align="center">
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
                          <Group gap="xs" wrap="nowrap">
                            <Menu shadow="md" width={200} position="bottom-end">
                              <Menu.Target>
                                <ActionIcon
                                  variant="subtle"
                                  color="gray"
                                  onClick={(e) => e.stopPropagation()}
                                  style={{ color: '#888888' }}
                                >
                                  <RiMoreFill size={18} />
                                </ActionIcon>
                              </Menu.Target>
                              <Menu.Dropdown style={{ backgroundColor: '#25262b', border: '1px solid #373a40' }}>
                                <Menu.Item
                                  leftSection={<RiDownloadLine size={16} />}
                                  style={{ color: '#ffffff' }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleExportJson(space);
                                  }}
                                >
                                  Export Json
                                </Menu.Item>
                                <Menu.Item
                                  leftSection={<RiCodeLine size={16} />}
                                  style={{ color: '#ffffff' }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openUpdatePackagesModal(space);
                                  }}
                                >
                                  Update Packages
                                </Menu.Item>
                                <Menu.Item
                                  leftSection={<RiHistoryLine size={16} />}
                                  style={{ color: '#ffffff' }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleShowHistory(space);
                                  }}
                                >
                                  History
                                </Menu.Item>
                                <Menu.Item
                                  leftSection={<RiFileCopyLine size={16} />}
                                  style={{ color: '#ffffff' }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openDuplicateModal(space);
                                  }}
                                >
                                  Clone Space
                                </Menu.Item>
                                <Menu.Item
                                  leftSection={<RiPencilLine size={16} />}
                                  style={{ color: '#ffffff' }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openRenameModal(space);
                                  }}
                                >
                                  Rename
                                </Menu.Item>
                                <Menu.Item
                                  leftSection={<RiDeleteBinLine size={16} />}
                                  color="red"
                                  style={{ color: '#ff4444' }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDelete(space);
                                  }}
                                >
                                  Delete
                                </Menu.Item>
                              </Menu.Dropdown>
                            </Menu>
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
                                color="#0070f3"
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
                          Space {selectedSpace} is ready
                        </Text>
                      </Group>
                    )}
                  </Group>
                  {activationFailed ? (
                    <Group gap="xs" align="center">
                      <Text size="sm" c="red" fw={500}>
                        FAILED
                      </Text>
                      <Tooltip
                        label="Activation failures are usually caused by missing or incompatible dependencies. From the Spaces list, click the three-dot menu to update dependencies or adjust their versions, then try activating the space again."
                        multiline
                        w={300}
                        withArrow
                      >
                        <RiInformationLine size={16} color="red" style={{ cursor: 'help' }} />
                      </Tooltip>
                    </Group>
                  ) : (
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
                  )}
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
          } catch (err) {
            console.error('Error refreshing spaces:', err);
          }
        }}
      />

      <ImportJsonModal
        opened={importJsonModalOpened}
        onClose={() => setImportJsonModalOpened(false)}
        onSuccess={async () => {
          // Refresh spaces list (but don't auto-activate)
          try {
            const res = await fetch('/api/spaces');
            const data: SpacesData = await res.json();
            setSpaces(data);
            notifications.show({
              title: 'Import Successful',
              message: 'Space imported successfully. You can now activate it manually.',
              color: 'green',
              icon: <RiCheckLine size={18} />,
              autoClose: 5000,
            });
          } catch (err) {
            console.error('Error refreshing spaces:', err);
            notifications.show({
              title: 'Error',
              message: 'Failed to refresh spaces list',
              color: 'red',
              icon: <RiErrorWarningLine size={18} />,
              autoClose: 5000,
            });
          }
        }}
      />

      <Modal
        opened={renameModalOpened}
        onClose={() => {
          if (!isRenaming) {
            setRenameModalOpened(false);
            setSpaceToRename(null);
            setNewSpaceName('');
          }
        }}
        title={
          <Text size="lg" fw={600} c="#ffffff">
            Rename Space
          </Text>
        }
        size="md"
        closeOnClickOutside={!isRenaming}
        closeOnEscape={!isRenaming}
        styles={{
          title: { color: '#ffffff' },
          content: { backgroundColor: '#1a1b1e', borderRadius: '8px' },
          header: { backgroundColor: '#25262b', borderBottom: '1px solid #373a40', padding: '20px' },
          body: { backgroundColor: '#1a1b1e', padding: '24px' },
        }}
      >
        <Stack gap="md">
          <TextInput
            label="Space Name"
            placeholder="Enter new space name"
            value={newSpaceName}
            onChange={(e) => setNewSpaceName(e.currentTarget.value)}
            disabled={isRenaming}
            styles={{
              label: { color: '#ffffff', marginBottom: '8px' },
              input: {
                backgroundColor: '#25262b',
                border: '1px solid #373a40',
                color: '#ffffff',
                '&:focus': { borderColor: '#0070f3' },
              },
            }}
          />
          <Group justify="flex-end" mt="md">
            <Button
              variant="subtle"
              onClick={() => {
                setRenameModalOpened(false);
                setSpaceToRename(null);
                setNewSpaceName('');
              }}
              disabled={isRenaming}
              style={{ color: '#888888' }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleRename}
              disabled={isRenaming || !newSpaceName.trim()}
              style={{
                backgroundColor: '#0070f3',
                color: '#ffffff',
              }}
            >
              {isRenaming ? 'Renaming...' : 'Rename'}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={duplicateModalOpened}
        onClose={() => {
          if (!isDuplicating) {
            setDuplicateModalOpened(false);
            setSpaceToDuplicate(null);
            setNewDuplicateSpaceName('');
          }
        }}
        title={
          <Text size="lg" fw={600} c="#ffffff">
            Clone Space
          </Text>
        }
        size="md"
        closeOnClickOutside={!isDuplicating}
        closeOnEscape={!isDuplicating}
        styles={{
          title: { color: '#ffffff' },
          content: { backgroundColor: '#1a1b1e', borderRadius: '8px' },
          header: { backgroundColor: '#25262b', borderBottom: '1px solid #373a40', padding: '20px' },
          body: { backgroundColor: '#1a1b1e', padding: '24px' },
        }}
      >
        <Stack gap="md">
          <Text size="sm" c="#888888">
            This will create a new space with a copy of the space.json from "{spaceToDuplicate?.visibleName || spaceToDuplicate?.name}".
          </Text>
          <TextInput
            label="New Space Name"
            placeholder="Enter new space name"
            value={newDuplicateSpaceName}
            onChange={(e) => setNewDuplicateSpaceName(e.currentTarget.value)}
            disabled={isDuplicating}
            styles={{
              label: { color: '#ffffff', marginBottom: '8px' },
              input: {
                backgroundColor: '#25262b',
                border: '1px solid #373a40',
                color: '#ffffff',
                '&:focus': { borderColor: '#0070f3' },
              },
            }}
          />
          <Group justify="flex-end" mt="md">
            <Button
              variant="subtle"
              onClick={() => {
                setDuplicateModalOpened(false);
                setSpaceToDuplicate(null);
                setNewDuplicateSpaceName('');
              }}
              disabled={isDuplicating}
              style={{ color: '#888888' }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleDuplicate}
              disabled={isDuplicating || !newDuplicateSpaceName.trim()}
              style={{
                backgroundColor: '#0070f3',
                color: '#ffffff',
              }}
            >
              {isDuplicating ? 'Cloning...' : 'Clone'}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={updatePackagesModalOpened}
        onClose={() => {
          setUpdatePackagesModalOpened(false);
          setSpaceToUpdate(null);
          setRequirementsContent('');
        }}
        title={
          <Text fw={600} size="lg" c="#ffffff">
            Update Packages - {spaceToUpdate?.visibleName || spaceToUpdate?.name}
          </Text>
        }
        size="xl"
        styles={{
          content: { 
            backgroundColor: '#1a1b1e',
            maxHeight: '90vh',
            display: 'flex',
            flexDirection: 'column',
          },
          header: { backgroundColor: '#1a1b1e', borderBottom: '1px solid #373a40' },
          body: { 
            backgroundColor: '#1a1b1e',
            flex: 1,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }
        }}
      >
        <Stack gap="md" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <Text size="sm" c="#888888">
            Edit the requirements.txt file below. Each line should contain a package name and optional version specification.
          </Text>
          <Paper
            p="sm"
            style={{
              backgroundColor: '#0a0a0a',
              border: '1px solid #373a40',
              position: 'relative',
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <ScrollArea h="calc(90vh - 250px)">
              <div style={{ display: 'flex' }}>
                {/* Line numbers */}
                <div
                  style={{
                    padding: '8px 8px 8px 12px',
                    fontFamily: 'monospace',
                    fontSize: '12px',
                    lineHeight: '1.6',
                    color: '#666666',
                    backgroundColor: '#0a0a0a',
                    borderRight: '1px solid #373a40',
                    userSelect: 'none',
                    minWidth: '50px',
                    textAlign: 'right',
                    flexShrink: 0,
                  }}
                >
                  {requirementsContent.split('\n').map((_, index) => (
                    <div key={index} style={{ minHeight: '19.2px' }}>
                      {index + 1}
                    </div>
                  ))}
                  {requirementsContent === '' && (
                    <div style={{ minHeight: '19.2px' }}>1</div>
                  )}
                </div>
                {/* Textarea */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Textarea
                    value={requirementsContent}
                    onChange={(e) => setRequirementsContent(e.currentTarget.value)}
                    placeholder="package==version&#10;another-package>=1.0.0"
                    autosize
                    minRows={Math.max(20, requirementsContent.split('\n').length || 1)}
                    styles={{
                      input: {
                        fontFamily: 'monospace',
                        fontSize: '12px',
                        lineHeight: '1.6',
                        backgroundColor: '#0a0a0a',
                        color: '#ffffff',
                        border: 'none',
                        padding: '8px',
                        width: '100%',
                        resize: 'none',
                      },
                      wrapper: {
                        width: '100%',
                      },
                    }}
                  />
                </div>
              </div>
            </ScrollArea>
          </Paper>
          <Group justify="flex-end" mt="md">
            <Button
              variant="subtle"
              onClick={() => {
                setUpdatePackagesModalOpened(false);
                setSpaceToUpdate(null);
                setRequirementsContent('');
              }}
              style={{ color: '#888888' }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveAndActivate}
              loading={isSaving}
              style={{
                backgroundColor: '#0070f3',
                color: '#ffffff',
              }}
            >
              Save & Activate
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={historyModalOpened}
        onClose={() => {
          setHistoryModalOpened(false);
          setSpaceForHistory(null);
          setHistoryDiff(null);
        }}
        title={
          <Text fw={600} size="lg" c="#ffffff">
            Requirements History - {spaceForHistory?.visibleName || spaceForHistory?.name}
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
        {loadingHistory ? (
          <Text c="dimmed" ta="center" py="xl">Loading history...</Text>
        ) : historyDiff?.error ? (
          <Text c="red" ta="center" py="xl">{historyDiff.error}</Text>
        ) : !historyDiff?.hasBackup ? (
          <Text c="dimmed" ta="center" py="xl">No backup file found. History will be available after the first update.</Text>
        ) : (
          <Stack gap="md" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <Group justify="space-between" align="center">
              <Group gap="md">
                <Text size="sm" c="#888888">
                  Backup: {historyDiff.backup.lineCount} lines
                </Text>
                <Text size="sm" c="#888888">
                  Current: {historyDiff.current.lineCount} lines
                </Text>
              </Group>
            </Group>
            
            <Paper 
              p="sm" 
              style={{ 
                backgroundColor: '#0a0a0a', 
                border: '1px solid #373a40',
                flex: 1,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <ScrollArea h="calc(90vh - 200px)">
                {historyDiff.diff && historyDiff.diff.length > 0 ? (
                  historyDiff.diff.map((item: any, idx: number) => {
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
                          fontFamily: 'monospace',
                          fontSize: '12px',
                          lineHeight: '1.6',
                        }}
                      >
                        <span style={{ color: '#666666', marginRight: '8px' }}>
                          {String(item.lineNumber).padStart(4, ' ')}
                        </span>
                        <span>{prefix}</span>
                        <span>{displayLine || ' '}</span>
                      </div>
                    );
                  })
                ) : (
                  <Text c="dimmed" ta="center" py="xl">No differences found</Text>
                )}
              </ScrollArea>
            </Paper>
          </Stack>
        )}
      </Modal>
    </div>
  );
}
