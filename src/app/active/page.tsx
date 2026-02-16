'use client';

import { useEffect, useState, useRef } from 'react';
import { Container, Title, Text, Stack, Button, Grid, Card, Group, Menu, ActionIcon, Modal, ScrollArea, Paper, Badge, Divider } from '@mantine/core';
import { useRouter } from 'next/navigation';
import { RiHomeLine, RiCheckboxCircleFill, RiCloseCircleFill, RiDownloadLine, RiPencilLine, RiMoreFill, RiDeleteBinLine, RiHistoryLine, RiFileListLine, RiArrowDownSLine, RiArrowUpSLine, RiExternalLinkLine, RiAddLine, RiRefreshLine, RiCircleFill, RiFolderLine, RiFolderOpenLine, RiFileLine, RiImageLine, RiVideoLine, RiFileTextLine } from 'react-icons/ri';
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

interface ModelFile {
  name: string;
  type: string;
  size: number;
  path: string;
  formattedSize?: string;
}

interface ModelFolder {
  name: string;
  type: 'folder';
  path: string;
  children: (ModelFile | ModelFolder)[];
  totalSize?: number;
}

type ModelItem = ModelFile | ModelFolder;

type TabType = 'comfyui' | 'nodes' | 'models' | 'files';

export default function ActivePage() {
  const [activeTab, setActiveTab] = useState<TabType>('comfyui');
  const [selectedVersion, setSelectedVersion] = useState<string>('');
  const [spaces, setSpaces] = useState<SpaceInfo[]>([]);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [dependencies, setDependencies] = useState<Dependency[]>([]);
  const [models, setModels] = useState<ModelItem[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [files, setFiles] = useState<any[]>([]);
  const [filesGroupedByDate, setFilesGroupedByDate] = useState<Record<string, any[]>>({});
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(new Set());
  const [imageErrors, setImageErrors] = useState<Set<string>>(new Set());
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

  /** Collect all folder paths from model tree so we can start with all collapsed */
  const getAllFolderPaths = (items: ModelItem[]): string[] => {
    const paths: string[] = [];
    for (const item of items) {
      if ('type' in item && item.type === 'folder') {
        paths.push(item.path);
        paths.push(...getAllFolderPaths(item.children));
      }
    }
    return paths;
  };

  const fetchModels = async () => {
    setLoadingModels(true);
    try {
      const response = await fetch('/api/models');
      const data = await response.json();
      if (data.error) {
        console.error('Error fetching models:', data.error);
        setModels([]);
        setCollapsedFolders(new Set());
      } else {
        const structure = data.structure || [];
        setModels(structure);
        setCollapsedFolders(new Set(getAllFolderPaths(structure)));
      }
    } catch (err) {
      console.error('Error fetching models:', err);
      setModels([]);
      setCollapsedFolders(new Set());
    } finally {
      setLoadingModels(false);
    }
  };

  const toggleFolder = (path: string) => {
    setCollapsedFolders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(path)) {
        newSet.delete(path);
      } else {
        newSet.add(path);
      }
      return newSet;
    });
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const renderModelItem = (item: ModelItem, level: number = 0): JSX.Element => {
    const isFolder = 'type' in item && item.type === 'folder';
    const isCollapsed = collapsedFolders.has(item.path);
    const indent = level * 24;

    if (isFolder) {
      const folder = item as ModelFolder;
      const isEmpty = folder.children.length === 0;
      const FolderIcon = isCollapsed ? RiFolderLine : RiFolderOpenLine;
      
      return (
        <div key={item.path} className="group">
          <div
            className="flex items-center gap-3 py-2.5 px-4 hover:bg-gray-800/50 rounded-lg cursor-pointer transition-all duration-200 border border-transparent hover:border-gray-700/50"
            style={{ paddingLeft: `${indent + 16}px` }}
            onClick={() => toggleFolder(item.path)}
          >
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-shrink-0">
                <FolderIcon 
                  size={18} 
                  className={`transition-colors ${isEmpty ? 'text-gray-600' : 'text-blue-400'}`}
                />
                <RiArrowDownSLine 
                  size={14} 
                  className={`text-gray-500 transition-all duration-200 ${isCollapsed ? '-rotate-90' : ''} ${isEmpty ? 'opacity-40' : ''}`}
                />
              </div>
              <span className={`text-sm font-semibold truncate ${isEmpty ? 'text-gray-500' : 'text-gray-200'}`}>
                {folder.name}
              </span>
              <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
                {isEmpty ? (
                  <span className="px-2 py-0.5 text-xs font-medium text-gray-600 bg-gray-800/50 rounded-md">empty</span>
                ) : folder.totalSize ? (
                  <span className="px-2 py-0.5 text-xs font-medium text-gray-400 bg-gray-800/30 rounded-md">
                    {formatFileSize(folder.totalSize)}
                  </span>
                ) : null}
                {!isEmpty && (
                  <span className="px-2 py-0.5 text-xs font-medium text-gray-500 bg-gray-800/30 rounded-md">
                    {folder.children.length} {folder.children.length === 1 ? 'item' : 'items'}
                  </span>
                )}
              </div>
            </div>
          </div>
          {!isCollapsed && !isEmpty && (
            <div className="ml-4 border-l border-gray-700/50">
              {folder.children.map(child => renderModelItem(child, level + 1))}
            </div>
          )}
        </div>
      );
    } else {
      const file = item as ModelFile;
      const getTypeColor = (type: string) => {
        const colors: Record<string, string> = {
          checkpoints: 'bg-blue-900/30 text-blue-300 border-blue-700/30',
          loras: 'bg-purple-900/30 text-purple-300 border-purple-700/30',
          vae: 'bg-green-900/30 text-green-300 border-green-700/30',
          embeddings: 'bg-yellow-900/30 text-yellow-300 border-yellow-700/30',
          controlnet: 'bg-red-900/30 text-red-300 border-red-700/30',
          upscale_models: 'bg-pink-900/30 text-pink-300 border-pink-700/30',
          clip: 'bg-indigo-900/30 text-indigo-300 border-indigo-700/30',
          text_encoders: 'bg-cyan-900/30 text-cyan-300 border-cyan-700/30',
        };
        return colors[type] || 'bg-gray-800/50 text-gray-300 border-gray-700/30';
      };
      
      return (
        <div
          key={item.path}
          className="group flex items-center gap-3 py-2.5 px-4 hover:bg-gray-800/50 rounded-lg transition-all duration-200 border border-transparent hover:border-gray-700/50"
          style={{ paddingLeft: `${indent + 16}px` }}
        >
          <RiFileLine size={16} className="text-gray-500 flex-shrink-0" />
          <span className="text-sm text-gray-200 flex-1 truncate font-medium" title={file.name}>
            {file.name}
          </span>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className={`px-2.5 py-1 text-xs font-semibold rounded-md border ${getTypeColor(file.type)}`}>
              {file.type}
            </span>
            <span className="px-2.5 py-1 text-xs font-medium text-gray-400 bg-gray-800/30 rounded-md min-w-[60px] text-right">
              {file.formattedSize || formatFileSize(file.size)}
            </span>
          </div>
        </div>
      );
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

  // Fetch models when Models tab is active
  useEffect(() => {
    if (activeTab === 'models' && models.length === 0 && !loadingModels) {
      fetchModels();
    }
  }, [activeTab, models.length, loadingModels]);

  const fetchFiles = async () => {
    setLoadingFiles(true);
    setImageErrors(new Set()); // Clear image errors on refresh
    try {
      const response = await fetch('/api/files');
      const data = await response.json();
      if (data.error) {
        console.error('Error fetching files:', data.error);
        setFiles([]);
        setFilesGroupedByDate({});
      } else {
        setFiles(data.files || []);
        setFilesGroupedByDate(data.groupedByDate || {});
      }
    } catch (err) {
      console.error('Error fetching files:', err);
      setFiles([]);
      setFilesGroupedByDate({});
    } finally {
      setLoadingFiles(false);
    }
  };

  // Fetch files when Files tab is active
  useEffect(() => {
    if (activeTab === 'files' && files.length === 0 && !loadingFiles) {
      fetchFiles();
    }
  }, [activeTab, files.length, loadingFiles]);

  const toggleDateGroup = (date: string) => {
    setCollapsedDates(prev => {
      const newSet = new Set(prev);
      if (newSet.has(date)) {
        newSet.delete(date);
      } else {
        newSet.add(date);
      }
      return newSet;
    });
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    if (dateString === today.toISOString().split('T')[0]) {
      return 'Today';
    } else if (dateString === yesterday.toISOString().split('T')[0]) {
      return 'Yesterday';
    } else {
      return date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    }
  };

  const isImageFile = (extension: string): boolean => {
    const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];
    return imageExts.includes(extension);
  };

  const getFileIcon = (extension: string) => {
    const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];
    const videoExts = ['.mp4', '.avi', '.mov', '.webm', '.mkv'];
    
    if (imageExts.includes(extension)) {
      return <RiImageLine size={16} className="text-blue-400" />;
    } else if (videoExts.includes(extension)) {
      return <RiVideoLine size={16} className="text-purple-400" />;
    } else {
      return <RiFileTextLine size={16} className="text-gray-400" />;
    }
  };

  const getFileImageUrl = (filePath: string): string => {
    // Split path and encode each segment separately for catch-all route
    const segments = filePath.split('/').map(segment => encodeURIComponent(segment));
    return `/api/files/${segments.join('/')}`;
  };

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

  const getComfyUIUrl = () => {
    if (typeof window === 'undefined') return 'http://localhost:8188';
    return `http://${window.location.hostname}:8188`;
  };

  const tabs = [
    { id: 'comfyui' as TabType, label: 'ComfyUI' },
    { id: 'nodes' as TabType, label: 'Custom Nodes' },
    { id: 'models' as TabType, label: 'Models' },
    { id: 'files' as TabType, label: 'Files' },
  ];

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
      
      {/* Tab-based Header */}
      <div className="sticky top-0 z-50 bg-gray-900 border-b border-gray-800 shadow-lg">
        <div className="w-full px-3 sm:px-4 lg:px-6">
          <div className="flex items-center justify-between h-10">
            {/* Left side: Home icon and tabs */}
            <div className="flex items-center gap-3 flex-1">
              <button
                onClick={() => router.push('/')}
                className="p-1 rounded hover:bg-gray-800 transition-colors text-gray-300 hover:text-white"
                title="Home"
              >
                <RiHomeLine size={18} />
              </button>
              
              {/* Tabs */}
              <div className="flex items-center gap-4">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    style={{ fontSize: '14px' }}
                    className={`relative px-2 py-1 font-medium transition-colors duration-200 ${
                      activeTab === tab.id
                        ? 'text-white'
                        : 'text-gray-400 hover:text-gray-300'
                    }`}
                  >
                    {tab.label}
                    {activeTab === tab.id && (
                      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500"></div>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Right side: Actions */}
            <div className="flex items-center gap-1.5">
              {/* ComfyUI Status & Actions */}
              <div className="flex items-center border border-gray-700 rounded overflow-hidden">
                <a
                  href={getComfyUIUrl()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 py-1 text-xs font-medium text-blue-400 hover:text-blue-300 flex items-center gap-1.5 border-r border-gray-700"
                >
                  {comfyUIRestarting ? (
                    <RiCircleFill 
                      size={6} 
                      color="#ffd43b" 
                      className="animate-pulse drop-shadow-[0_0_2px_#ffd43b]"
                    />
                  ) : comfyUIOnline ? (
                    <RiCircleFill size={6} color="#51cf66" className="drop-shadow-[0_0_2px_#51cf66]" />
                  ) : (
                    <RiCircleFill size={6} color="#ff6b6b" />
                  )}
                  ComfyUI 
                  <RiExternalLinkLine size={12} />
                </a>
                <Menu shadow="md" width={200} position="bottom-end">
                  <Menu.Target>
                    <button className="px-1.5 py-1 text-blue-400 hover:text-blue-300">
                      <RiArrowDownSLine size={12} />
                    </button>
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
              </div>

              {/* Export Button */}
              <button
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
                className="px-2.5 py-1 text-xs   rounded text-gray-300 hover:bg-gray-800 hover:border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                <RiDownloadLine size={14} />
              </button>

              {/* History Button */}
              <button
                onClick={handleShowChanges}
                className="p-1 rounded hover:bg-gray-800 transition-colors text-green-400 hover:text-green-300"
                title="History"
              >
                <RiHistoryLine size={16} />
              </button>

              {/* Logs Toggle */}
              <button
                onClick={() => setLogsSidebarOpen(!logsSidebarOpen)}
                className={`p-1 rounded transition-colors ${
                  logsSidebarOpen 
                    ? 'bg-blue-600 text-white' 
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`}
                title="Toggle Logs"
              >
                <RiFileListLine size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Tab Content */}
      <div className="min-h-screen bg-gray-900">
        {/* ComfyUI Tab */}
        {activeTab === 'comfyui' && (
          <div className="h-[calc(100vh-2.5rem)] w-full">
            {comfyUIOnline ? (
              <iframe
                src={getComfyUIUrl()}
                className="w-full h-full border-0"
                title="ComfyUI"
              />
            ) : (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <RiCloseCircleFill size={48} className="mx-auto mb-4 text-red-500" />
                  <h3 className="text-xl font-semibold text-white mb-2">ComfyUI is not available</h3>
                  <p className="text-gray-400 mb-4">Please ensure ComfyUI is running on port 8188</p>
                  <button
                    onClick={handleRestartComfyUI}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    disabled={!selectedVersion}
                  >
                    Restart ComfyUI
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Custom Nodes Tab */}
        {activeTab === 'nodes' && (
          <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-2xl font-bold text-white mb-1">Custom Nodes</h2>
                <p className="text-sm text-gray-400">Manage your ComfyUI custom nodes and extensions</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    if (selectedVersion && !refreshingNodes) {
                      fetchNodesForSpace(selectedVersion, true);
                    }
                  }}
                  disabled={refreshingNodes}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-600 text-gray-300 hover:text-white rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Refresh Custom Nodes"
                >
                  <RiRefreshLine 
                    size={16} 
                    className={refreshingNodes ? 'animate-spin' : ''}
                  />
                  <span className="text-sm font-medium">Refresh</span>
                </button>
                <button
                  onClick={() => router.push('/install-node')}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-all duration-200"
                >
                  <RiAddLine size={16} />
                  <span className="text-sm font-medium">Install Node</span>
                </button>
              </div>
            </div>

            {/* Space Info Badges */}
            {(() => {
              const selectedSpace = spaces.find(s => s.name === selectedVersion);
              return selectedSpace ? (
                <div className="flex items-center gap-2 mb-6">
                  <span className="px-3 py-1.5 text-xs font-medium border border-purple-500/50 text-purple-400 bg-purple-900/20 rounded-lg">
                    Python: {selectedSpace.pythonVersion}
                  </span>
                  <span className="px-3 py-1.5 text-xs font-medium border border-purple-500/50 text-purple-400 bg-purple-900/20 rounded-lg">
                    ComfyUI: {selectedSpace.comfyUIVersion}
                  </span>
                  {nodes.length > 0 && (
                    <span className="px-3 py-1.5 text-xs font-medium text-gray-400 bg-gray-800/50 border border-gray-700/50 rounded-lg">
                      {nodes.filter(n => n.status === 'active').length} active, {nodes.filter(n => n.status === 'failed').length} failed
                    </span>
                  )}
                </div>
              ) : null;
            })()}

            {/* Content */}
            {error ? (
              <div className="p-4 bg-red-900/20 border border-red-500/50 rounded-lg">
                <p className="text-red-400 text-sm font-medium">Error: {error}</p>
              </div>
            ) : loading ? (
              <div className="flex flex-col items-center justify-center py-16">
                <RiRefreshLine size={32} className="text-gray-500 animate-spin mb-4" />
                <p className="text-gray-400 font-medium">Loading nodes...</p>
                <p className="text-sm text-gray-500 mt-1">Scanning custom nodes directory</p>
              </div>
            ) : nodes.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 bg-gray-800/30 border border-gray-700/50 rounded-xl">
                <RiFileListLine size={48} className="text-gray-600 mb-4" />
                <p className="text-gray-300 font-semibold text-lg mb-1">No nodes found</p>
                <p className="text-sm text-gray-500 text-center max-w-md">
                  Install custom nodes to extend ComfyUI functionality
                </p>
              </div>
            ) : (
              <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700/50 rounded-xl shadow-xl overflow-hidden">
                <div className="divide-y divide-gray-700/30">
                  {nodes.map((node, index) => (
                    <div
                      key={index}
                      onClick={() => {
                        if (node.extensionPaths && node.extensionPaths.length > 0) {
                          setSelectedNode(node);
                          setModalOpened(true);
                        }
                      }}
                      className={`px-4 py-3 hover:bg-gray-800/50 transition-all ${
                        node.extensionPaths && node.extensionPaths.length > 0 ? 'cursor-pointer' : 'cursor-default'
                      } ${node.status === 'failed' ? 'bg-red-900/10' : ''}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          {node.status === 'active' ? (
                            <RiCheckboxCircleFill size={18} className="text-green-500 flex-shrink-0" />
                          ) : node.status === 'failed' ? (
                            <RiCloseCircleFill size={18} className="text-red-500 flex-shrink-0" />
                          ) : (
                            <RiCloseCircleFill size={18} className="text-red-500 flex-shrink-0" />
                          )}
                          <span className="text-sm font-semibold text-gray-200 truncate">{node.name}</span>
                        </div>
                        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          {node.githubUrl && (
                            <button
                              onClick={() => handleUpdate(node)}
                              className="p-2 rounded-lg hover:bg-gray-700 text-blue-400 hover:text-blue-300 transition-colors"
                              title="Update"
                            >
                              <RiPencilLine size={16} />
                            </button>
                          )}
                          <Menu shadow="md" width={200} position="bottom-end">
                            <Menu.Target>
                              <button className="p-2 rounded-lg hover:bg-gray-700 text-white transition-colors">
                                <RiMoreFill size={16} />
                              </button>
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
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Dependencies Section */}
            <div className="mt-8">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <h2 className="text-2xl font-bold text-white">Dependencies</h2>
                  <button
                    onClick={() => setDependenciesExpanded(!dependenciesExpanded)}
                    className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
                    title={dependenciesExpanded ? 'Collapse' : 'Expand'}
                  >
                    {dependenciesExpanded ? <RiArrowUpSLine size={16} /> : <RiArrowDownSLine size={16} />}
                  </button>
                </div>
                {dependencies.length > 0 && (
                  <span className="text-sm text-gray-400">{dependencies.length} dependencies</span>
                )}
              </div>
              {dependenciesExpanded && (
                <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700/50 rounded-xl shadow-xl overflow-hidden p-4">
                  {loading ? (
                    <p className="text-gray-400 text-sm">Loading dependencies...</p>
                  ) : dependencies.length === 0 ? (
                    <p className="text-gray-400 text-sm">No dependencies found</p>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                      {dependencies.map((dep, index) => (
                        <div
                          key={index}
                          className="p-3 bg-gray-800/50 border border-gray-700/50 rounded-lg hover:shadow-lg hover:-translate-y-0.5 transition-all"
                        >
                          <div className="space-y-1">
                            <p className="text-xs font-medium text-white truncate">{dep.name}</p>
                            <p className="text-xs text-gray-400 font-mono">
                              {dep.version === '*' ? 'any version' : dep.version}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Models Tab */}
        {activeTab === 'models' && (
          <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-2xl font-bold text-white mb-1">Models</h2>
                <p className="text-sm text-gray-400">Browse and manage your ComfyUI models</p>
              </div>
              <button
                onClick={fetchModels}
                disabled={loadingModels}
                className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-600 text-gray-300 hover:text-white rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Refresh Models"
              >
                <RiRefreshLine 
                  size={16} 
                  className={loadingModels ? 'animate-spin' : ''}
                />
                <span className="text-sm font-medium">Refresh</span>
              </button>
            </div>

            {/* Content */}
            {loadingModels ? (
              <div className="flex flex-col items-center justify-center py-16">
                <RiRefreshLine size={32} className="text-gray-500 animate-spin mb-4" />
                <p className="text-gray-400 font-medium">Loading models...</p>
                <p className="text-sm text-gray-500 mt-1">Scanning directory structure</p>
              </div>
            ) : models.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 bg-gray-800/30 border border-gray-700/50 rounded-xl">
                <RiFileListLine size={48} className="text-gray-600 mb-4" />
                <p className="text-gray-300 font-semibold text-lg mb-1">No models found</p>
                <p className="text-sm text-gray-500 text-center max-w-md">
                  Models will appear here once they are added to the ComfyUI models directory
                </p>
              </div>
            ) : (
              <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700/50 rounded-xl shadow-xl overflow-hidden">
                <div className="p-2">
                  {models.map(item => renderModelItem(item))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Files Tab */}
        {activeTab === 'files' && (
          <div className="w-full px-3 sm:px-4 lg:px-6 py-4">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-white">Output Files</h2>
                <p className="text-xs text-gray-400">Browse generated outputs from ComfyUI</p>
              </div>
              <button
                onClick={fetchFiles}
                disabled={loadingFiles}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-600 text-gray-300 hover:text-white rounded-md transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Refresh Files"
              >
                <RiRefreshLine 
                  size={14} 
                  className={loadingFiles ? 'animate-spin' : ''}
                />
                <span className="text-xs font-medium">Refresh</span>
              </button>
            </div>

            {/* Content */}
            {loadingFiles ? (
              <div className="flex flex-col items-center justify-center py-12">
                <RiRefreshLine size={24} className="text-gray-500 animate-spin mb-3" />
                <p className="text-xs text-gray-400 font-medium">Loading files...</p>
                <p className="text-[10px] text-gray-500 mt-0.5">Scanning output directory</p>
              </div>
            ) : files.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 bg-gray-800/30 border border-gray-700/50 rounded-lg">
                <RiFileListLine size={32} className="text-gray-600 mb-3" />
                <p className="text-sm text-gray-300 font-semibold mb-0.5">No files found</p>
                <p className="text-xs text-gray-500 text-center max-w-md">
                  Generated outputs will appear here once ComfyUI creates files in the output directory
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {Object.entries(filesGroupedByDate)
                  .sort(([dateA], [dateB]) => dateB.localeCompare(dateA)) // Sort dates descending (most recent first)
                  .map(([date, dateFiles]) => {
                    const isCollapsed = collapsedDates.has(date);
                    return (
                      <div key={date} className="bg-gray-800/50 backdrop-blur-sm border border-gray-700/50 rounded-lg shadow-lg overflow-hidden">
                        {/* Date Header */}
                        <div
                          className="flex items-center justify-between px-3 py-2 bg-gray-800/70 border-b border-gray-700/50 cursor-pointer hover:bg-gray-800/90 transition-colors"
                          onClick={() => toggleDateGroup(date)}
                        >
                          <div className="flex items-center gap-2">
                            <RiArrowDownSLine 
                              size={12} 
                              className={`text-gray-400 transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                            />
                            <h3 className="text-sm font-semibold text-white">{formatDate(date)}</h3>
                            <span className="px-1.5 py-0.5 text-[10px] font-medium text-gray-400 bg-gray-700/50 rounded">
                              {dateFiles.length} {dateFiles.length === 1 ? 'file' : 'files'}
                            </span>
                          </div>
                          <div className="text-xs text-gray-500">
                            {dateFiles.reduce((sum, file) => sum + file.size, 0) > 0 && (
                              <span>{formatFileSize(dateFiles.reduce((sum, file) => sum + file.size, 0))}</span>
                            )}
                          </div>
                        </div>

                        {/* Files Grid */}
                        {!isCollapsed && (
                          <div className="p-3">
                            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-3">
                              {dateFiles.map((file, index) => {
                                const isImage = isImageFile(file.extension);
                                return (
                                  <div
                                    key={`${file.path}-${index}`}
                                    className="group cursor-pointer"
                                  >
                                    <div className="aspect-square bg-gray-800/50 border border-gray-700/50 rounded-md overflow-hidden hover:border-gray-600 transition-all hover:shadow-lg">
                                      {isImage && !imageErrors.has(file.path) ? (
                                        <img
                                          src={getFileImageUrl(file.path)}
                                          alt={file.name}
                                          className="w-full h-full object-cover"
                                          onError={() => {
                                            setImageErrors(prev => new Set(prev).add(file.path));
                                          }}
                                        />
                                      ) : (
                                        <div className="w-full h-full flex flex-col items-center justify-center p-2 text-gray-500">
                                          {getFileIcon(file.extension)}
                                        </div>
                                      )}
                                    </div>
                                    <div className="mt-1.5 px-1">
                                      <p className="text-[10px] text-gray-300 truncate text-center font-medium" title={file.name}>
                                        {file.name}
                                      </p>
                                      <div className="flex items-center justify-center gap-1.5 mt-0.5">
                                        <span className="text-[9px] text-gray-500">
                                          {file.formattedSize}
                                        </span>
                                        <span className="text-[9px] text-gray-600">•</span>
                                        <span className="text-[9px] text-gray-500">
                                          {new Date(file.created).toLocaleTimeString('en-US', { 
                                            hour: '2-digit', 
                                            minute: '2-digit'
                                          })}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        )}
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
            <Grid.Col span={8} style={{ height: '600px', display: 'flex', flexDirection: 'column' }}>
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
                        overflow: 'hidden',
                      }}
                    >
                      <ScrollArea h="100%" style={{ flex: 1 }}>
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
            <Grid.Col span={4} style={{ height: '600px', display: 'flex', flexDirection: 'column' }}>
              <Stack gap="xs" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <Text size="sm" fw={600} c="#ffffff" style={{ flexShrink: 0 }}>History Entries</Text>
                <Divider style={{ flexShrink: 0 }} />
                <ScrollArea h="100%" style={{ flex: 1 }}>
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
