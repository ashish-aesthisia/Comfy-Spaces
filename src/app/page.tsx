'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Container, Title, Text, Select, Button, Group, Stack, Paper, ScrollArea, Badge, Menu, ActionIcon, Modal, TextInput, Tooltip, Textarea } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { RiCheckLine, RiErrorWarningLine, RiRefreshLine, RiCheckboxCircleFill, RiCloseLine, RiAddLine, RiFileCodeLine, RiArrowRightLine, RiMoreFill, RiPencilLine, RiDeleteBinLine, RiDownloadLine, RiInformationLine, RiCodeLine, RiHistoryLine, RiFileCopyLine, RiTerminalBoxLine, RiArrowUpSLine, RiArrowDownSLine } from 'react-icons/ri';
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
  const [logsExpanded, setLogsExpanded] = useState(false);
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
  const [editCmdArgsModalOpened, setEditCmdArgsModalOpened] = useState(false);
  const [spaceToEditCmdArgs, setSpaceToEditCmdArgs] = useState<SpaceInfo | null>(null);
  const [cmdArgs, setCmdArgs] = useState('');
  const [currentCmdArgs, setCurrentCmdArgs] = useState<string | null>(null);
  const [isSavingCmdArgs, setIsSavingCmdArgs] = useState(false);
  const [loadingCmdArgs, setLoadingCmdArgs] = useState(false);
  const [deviceInfo, setDeviceInfo] = useState<{ device: string; gpuName: string; cudaVersion: string; pythonVersion: string } | null>(null);

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
      .then((data: { device: string; gpuName: string; cudaVersion: string; pythonVersion: string }) => {
        setDeviceInfo(data);
      })
      .catch(err => {
        console.error('Error fetching device info:', err);
        // Set default values on error
        setDeviceInfo({
          device: 'CPU',
          gpuName: 'NA',
          cudaVersion: 'NA',
          pythonVersion: 'NA',
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
    setLogsExpanded(true);
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
          <span className="text-blue-400 font-bold">[APP]</span>
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
          <span className="text-green-500 font-bold">[COMFY]</span>
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

  const openEditCmdArgsModal = async (space: SpaceInfo) => {
    setSpaceToEditCmdArgs(space);
    setLoadingCmdArgs(true);
    setEditCmdArgsModalOpened(true);
    try {
      // Fetch current comfyUIArgs from space.json
      const response = await fetch(`/api/spaces/${encodeURIComponent(space.name)}/metadata`);
      if (response.ok) {
        const data = await response.json();
        const currentArgs = data.comfyUIArgs || null;
        setCurrentCmdArgs(currentArgs);
        setCmdArgs(currentArgs || '');
      } else {
        setCurrentCmdArgs(null);
        setCmdArgs('');
      }
    } catch (error) {
      console.error('Error fetching command args:', error);
      setCurrentCmdArgs(null);
      setCmdArgs('');
    } finally {
      setLoadingCmdArgs(false);
    }
  };

  const handleSaveCmdArgs = async () => {
    if (!spaceToEditCmdArgs) return;

    setIsSavingCmdArgs(true);
    try {
      const response = await fetch(`/api/spaces/${encodeURIComponent(spaceToEditCmdArgs.name)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ comfyUIArgs: cmdArgs.trim() || null }),
      });

      const data = await response.json();

      if (!response.ok) {
        notifications.show({
          title: 'Save Failed',
          message: data.error || 'Failed to save command arguments',
          color: 'red',
          icon: <RiErrorWarningLine size={18} />,
          autoClose: 5000,
        });
        setIsSavingCmdArgs(false);
        return;
      }

      // Update current args to reflect what was saved
      setCurrentCmdArgs(cmdArgs.trim() || null);
      
      notifications.show({
        title: 'Save Successful',
        message: 'Command arguments saved to space.json',
        color: 'green',
        icon: <RiCheckLine size={18} />,
        autoClose: 5000,
      });
      
      // Close the modal
      setEditCmdArgsModalOpened(false);
      setSpaceToEditCmdArgs(null);
      setCmdArgs('');
      setCurrentCmdArgs(null);
    } catch (error) {
      console.error('Error saving command args:', error);
      notifications.show({
        title: 'Save Failed',
        message: 'Failed to save command arguments',
        color: 'red',
        icon: <RiErrorWarningLine size={18} />,
        autoClose: 5000,
      });
    } finally {
      setIsSavingCmdArgs(false);
    }
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
    <div className={`min-h-screen flex items-start justify-center bg-black pt-8 transition-all duration-300 ${showLogs ? (logsExpanded ? 'pb-[80vh]' : 'pb-16') : 'pb-8'}`}>
      <Container size="xl" py="xl" className="w-full">
        <Stack gap="md">
          <div className="text-left w-1/2 mx-auto">
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
                  Python: {deviceInfo.pythonVersion}
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
                      <Stack gap="xs" className="flex-1 min-w-0">
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
                                  Modify requirements.txt
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
                                  leftSection={<RiTerminalBoxLine size={16} />}
                                  style={{ color: '#ffffff' }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openEditCmdArgsModal(space);
                                  }}
                                >
                                  Edit Command Args
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
                                className="border-red-500 text-red-500 hover:bg-red-950/20"
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
            <Paper p="xl" className="bg-gray-900 border border-gray-700 w-1/2 mx-auto text-center">
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

          {/* Bottom Log Drawer */}
          {showLogs && selectedSpace && (
            <div
              className={`fixed bottom-0 left-0 right-0 z-50 bg-gray-900 border-t border-gray-700 shadow-2xl transition-all duration-300 ease-in-out ${
                logsExpanded ? 'h-[80vh]' : 'h-16'
              }`}
            >
              {/* Drag Handle / Header */}
              <div
                className="h-16 flex items-center justify-between px-4 cursor-pointer hover:bg-gray-800/50 transition-colors border-b border-gray-700"
                onClick={() => setLogsExpanded(!logsExpanded)}
              >
                <div className="flex items-center gap-3">
                  <div className="w-12 h-1 bg-gray-600 rounded-full"></div>
                  <div className="flex items-center gap-2">
                    <Text fw={600} size="sm" className="text-white">
                      Activation Logs - {selectedSpace}
                    </Text>
                    {logs.length > 0 && (
                      <span className="px-2 py-0.5 text-[10px] font-medium text-gray-400 bg-gray-800 rounded">
                        {logs.length} entries
                      </span>
                    )}
                    {isComfyUIReady && (
                      <div className="flex items-center gap-1.5 px-2 py-0.5 bg-green-950/30 border border-green-500/30 rounded">
                        <RiCheckboxCircleFill size={12} color="#00d9ff" />
                        <Text size="xs" className="text-green-400 font-medium">
                          Ready
                        </Text>
                      </div>
                    )}
                    {activationFailed && (
                      <div className="flex items-center gap-1.5 px-2 py-0.5 bg-red-950/30 border border-red-500/30 rounded">
                        <Text size="xs" className="text-red-400 font-medium">
                          FAILED
                        </Text>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {logsExpanded && (
                    <Button
                      variant="subtle"
                      size="xs"
                      className="text-gray-400 hover:text-white"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isComfyUIReady) {
                          router.push('/active');
                        }
                      }}
                      disabled={!isComfyUIReady}
                    >
                      Go to Dashboard
                    </Button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setLogsExpanded(!logsExpanded);
                    }}
                    className="p-1.5 rounded hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
                  >
                    {logsExpanded ? <RiArrowDownSLine size={16} /> : <RiArrowUpSLine size={16} />}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowLogs(false);
                      setLogsExpanded(false);
                      setLogs([]);
                      if (eventSourceRef.current) {
                        eventSourceRef.current.close();
                        eventSourceRef.current = null;
                      }
                    }}
                    className="p-1.5 rounded hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
                  >
                    <RiCloseLine size={16} />
                  </button>
                </div>
              </div>

              {/* Expanded Content */}
              {logsExpanded && (
                <div className="h-[calc(80vh-4rem)] flex flex-col">
                  {/* Log Content */}
                  <div className="flex-1 bg-black overflow-hidden">
                    <ScrollArea h="100%" scrollbarSize={6}>
                      <div className="pr-2 font-mono text-xs bg-black p-3">
                        {logs.length === 0 ? (
                          <div className="flex flex-col items-center justify-center h-full py-12">
                            <Text size="sm" c="dimmed" ta="center">
                              Waiting for logs...
                            </Text>
                            <Text size="xs" c="dimmed" className="mt-2">
                              Activation in progress
                            </Text>
                          </div>
                        ) : (
                          <>
                            {logs.map((log, index) => (
                              <div
                                key={index}
                                className="text-white whitespace-pre-wrap break-words leading-relaxed mb-1 py-0.5 hover:bg-gray-900/30 rounded px-1"
                              >
                                <span className="text-gray-500 text-[11px]">
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
                  </div>

                  {/* Footer */}
                  <div className="h-12 px-4 border-t border-gray-700 bg-gray-800/50 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <Text size="xs" className="text-gray-400">
                        {logs.length} log entries
                      </Text>
                      {isComfyUIReady && (
                        <div className="flex items-center gap-1.5">
                          <RiCheckboxCircleFill size={14} color="#00d9ff" />
                          <Text size="xs" className="text-green-400 font-medium">
                            Space {selectedSpace} is ready
                          </Text>
                        </div>
                      )}
                      {activationFailed && (
                        <div className="flex items-center gap-1.5">
                          <Text size="xs" className="text-red-400 font-medium">
                            Activation failed
                          </Text>
                          <Tooltip
                            label="Activation failures are usually caused by missing or incompatible dependencies. From the Spaces list, click the three-dot menu to update dependencies or adjust their versions, then try activating the space again."
                            multiline
                            w={300}
                            withArrow
                          >
                            <RiInformationLine size={14} color="red" className="cursor-help" />
                          </Tooltip>
                        </div>
                      )}
                    </div>
                    <Button
                      variant={isComfyUIReady ? "filled" : "subtle"}
                      size="xs"
                      onClick={() => router.push('/active')}
                      disabled={!isComfyUIReady}
                      className={isComfyUIReady ? "bg-blue-600 text-white hover:bg-blue-700" : "text-gray-400"}
                    >
                      Go to Dashboard
                    </Button>
                  </div>
                </div>
              )}
            </div>
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
        classNames={{
          title: 'text-white',
          content: 'bg-gray-900 rounded-lg',
          header: 'bg-gray-800 border-b border-gray-700 p-5',
          body: 'bg-gray-900 p-6',
        }}
      >
        <Stack gap="md">
          <TextInput
            label="Space Name"
            placeholder="Enter new space name"
            value={newSpaceName}
            onChange={(e) => setNewSpaceName(e.currentTarget.value)}
            disabled={isRenaming}
            classNames={{
              label: 'text-white mb-2',
              input: 'bg-gray-800 border-gray-700 text-white focus:border-blue-600',
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
              className="text-gray-400"
            >
              Cancel
            </Button>
            <Button
              onClick={handleRename}
              disabled={isRenaming || !newSpaceName.trim()}
              className="bg-blue-600 text-white hover:bg-blue-700"
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
        classNames={{
          title: 'text-white',
          content: 'bg-gray-900 rounded-lg',
          header: 'bg-gray-800 border-b border-gray-700 p-5',
          body: 'bg-gray-900 p-6',
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
            classNames={{
              label: 'text-white mb-2',
              input: 'bg-gray-800 border-gray-700 text-white focus:border-blue-600',
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
              className="text-gray-400"
            >
              Cancel
            </Button>
            <Button
              onClick={handleDuplicate}
              disabled={isDuplicating || !newDuplicateSpaceName.trim()}
              className="bg-blue-600 text-white hover:bg-blue-700"
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
            Modify requirements.txt - {spaceToUpdate?.visibleName || spaceToUpdate?.name}
          </Text>
        }
        size="xl"
        classNames={{
          content: 'bg-gray-900 max-h-[90vh] flex flex-col',
          header: 'bg-gray-900 border-b border-gray-700',
          body: 'bg-gray-900 flex-1 overflow-hidden flex flex-col',
        }}
      >
        <Stack gap="md" className="h-full flex flex-col">
          <Text size="sm" c="#888888">
            Edit the requirements.txt file below. Each line should contain a package name and optional version specification.
          </Text>
          <Paper
            p="sm"
            className="bg-black border border-gray-700 relative flex-1 min-h-0 flex flex-col"
          >
            <ScrollArea h="calc(90vh - 250px)">
              <div className="flex">
                {/* Line numbers */}
                <div className="py-2 px-2 pl-3 font-mono text-xs leading-relaxed text-gray-500 bg-black border-r border-gray-700 select-none min-w-[50px] text-right flex-shrink-0">
                  {requirementsContent.split('\n').map((_, index) => (
                    <div key={index} className="min-h-[19.2px]">
                      {index + 1}
                    </div>
                  ))}
                  {requirementsContent === '' && (
                    <div className="min-h-[19.2px]">1</div>
                  )}
                </div>
                {/* Textarea */}
                <div className="flex-1 min-w-0">
                  <Textarea
                    value={requirementsContent}
                    onChange={(e) => setRequirementsContent(e.currentTarget.value)}
                    placeholder="package==version&#10;another-package>=1.0.0"
                    autosize
                    minRows={Math.max(20, requirementsContent.split('\n').length || 1)}
                    classNames={{
                      input: 'font-mono text-xs leading-relaxed bg-black text-white border-none p-2 w-full resize-none',
                      wrapper: 'w-full',
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
              className="text-gray-400"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveAndActivate}
              loading={isSaving}
              className="bg-blue-600 text-white hover:bg-blue-700"
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
        classNames={{
          title: 'text-white',
          content: 'bg-gray-900 max-h-[90vh] flex flex-col',
          header: 'bg-gray-800 border-b border-gray-700',
          body: 'bg-gray-900 flex-1 overflow-hidden flex flex-col',
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
                    
                    const bgClass = item.type === 'added' ? 'bg-green-950/30' :
                                   item.type === 'removed' ? 'bg-red-950/30' : '';
                    const borderClass = item.type === 'added' ? 'border-l-2 border-l-green-500' :
                                       item.type === 'removed' ? 'border-l-2 border-l-red-500' : '';
                    const textClass = item.type === 'added' ? 'text-green-500' :
                                     item.type === 'removed' ? 'text-red-500' : 'text-gray-400';
                    
                    return (
                      <div
                        key={idx}
                        className={`py-0.5 px-2 mb-px whitespace-pre font-mono text-xs leading-relaxed ${bgClass} ${borderClass} ${textClass}`}
                      >
                        <span className="text-gray-500 mr-2">
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

      <Modal
        opened={editCmdArgsModalOpened}
        onClose={() => {
          setEditCmdArgsModalOpened(false);
          setSpaceToEditCmdArgs(null);
          setCmdArgs('');
          setCurrentCmdArgs(null);
        }}
        title={
          <Text fw={600} size="lg" c="#ffffff">
            Edit Command Arguments - {spaceToEditCmdArgs?.visibleName || spaceToEditCmdArgs?.name}
          </Text>
        }
        size="lg"
        classNames={{
          title: 'text-white',
          content: 'bg-gray-900',
          header: 'bg-gray-800 border-b border-gray-700',
          body: 'bg-gray-900',
        }}
      >
        <Stack gap="md">
          {loadingCmdArgs ? (
            <Text c="dimmed" ta="center" py="md">Loading current arguments...</Text>
          ) : (
            <>
              {currentCmdArgs && (
                <Paper p="sm" className="bg-gray-800 border border-gray-700">
                  <Text size="sm" c="#888888" mb="xs" fw={500}>Current Arguments (saved in space.json):</Text>
                  <Text size="sm" c="#ffffff" className="font-mono break-all">
                    {currentCmdArgs || '(none)'}
                  </Text>
                </Paper>
              )}
              <TextInput
                label="ComfyUI Launch Arguments"
                placeholder="--port 8188 --enable-cors-header"
                value={cmdArgs}
                onChange={(e) => setCmdArgs(e.currentTarget.value)}
                disabled={isSavingCmdArgs}
                classNames={{
                  label: 'text-white mb-1.5 font-medium',
                  input: 'bg-gray-800 border-gray-700 text-white focus:border-blue-600',
                  description: 'text-gray-400 text-xs mt-1',
                }}
                description="Enter command-line arguments for ComfyUI launch. main.py is added automatically. Leave empty to use default arguments."
              />
            </>
          )}
          <Group justify="flex-end" mt="md">
            <Button
              variant="subtle"
              onClick={() => {
                setEditCmdArgsModalOpened(false);
                setSpaceToEditCmdArgs(null);
                setCmdArgs('');
                setCurrentCmdArgs(null);
              }}
              disabled={isSavingCmdArgs || loadingCmdArgs}
              className="text-gray-400"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveCmdArgs}
              loading={isSavingCmdArgs}
              disabled={loadingCmdArgs}
              className="bg-blue-600 text-white hover:bg-blue-700"
            >
              Save
            </Button>
          </Group>
        </Stack>
      </Modal>
    </div>
  );
}
