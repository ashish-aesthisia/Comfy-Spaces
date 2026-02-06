'use client';

import { useEffect, useState, useRef } from 'react';
import { 
  Paper, 
  Text, 
  TextInput, 
  ScrollArea, 
  Button, 
  Group,
  Stack,
  ActionIcon
} from '@mantine/core';
import { RiSearchLine, RiCloseLine } from 'react-icons/ri';

interface LogEntry {
  message: string;
  timestamp: string;
}

type LogFilter = 'all' | 'app' | 'comfy';

interface LogSidebarProps {
  isOpen?: boolean;
  onToggle?: (isOpen: boolean) => void;
}

export default function LogSidebar(props: LogSidebarProps = {}) {
  const { isOpen: externalIsOpen, onToggle } = props;
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const isOpen = externalIsOpen !== undefined ? externalIsOpen : internalIsOpen;
  
  const setIsOpen = (value: boolean) => {
    if (externalIsOpen !== undefined && onToggle) {
      onToggle(value);
    } else {
      setInternalIsOpen(value);
    }
  };
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [logFilter, setLogFilter] = useState<LogFilter>('all');
  const [isConnected, setIsConnected] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(400);
  const [isResizing, setIsResizing] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<string>('');
  const logsEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Fetch selected version on mount
  useEffect(() => {
    fetch('/api/spaces')
      .then(res => res.json())
      .then((data) => {
        setSelectedVersion(data.selectedVersion || '');
      })
      .catch(err => {
        console.error('Error fetching selected version:', err);
      });
  }, []);

  useEffect(() => {
    if (isOpen && !eventSourceRef.current && selectedVersion) {
      // Connect to log stream with version parameter
      const eventSource = new EventSource(`/api/logs/stream?version=${encodeURIComponent(selectedVersion)}`);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        setIsConnected(true);
      };

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setLogs((prev) => [...prev, data].slice(-1000)); // Keep last 1000 logs
        } catch (error) {
          console.error('Error parsing log data:', error);
        }
      };

      eventSource.onerror = () => {
        setIsConnected(false);
      };
    }

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
        setIsConnected(false);
      }
    };
  }, [isOpen, selectedVersion]);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  // Handle resize
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizing) {
        const newWidth = window.innerWidth - e.clientX;
        if (newWidth >= 200 && newWidth <= 800) {
          setSidebarWidth(newWidth);
        }
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  // Helper function to check if log has a specific tag
  const hasTag = (message: string, tag: string): boolean => {
    const tagPattern = new RegExp(`^\\[${tag}\\]`);
    return tagPattern.test(message);
  };

  // Filter logs based on selected filter and search query
  const filteredLogs = logs.filter((log) => {
    // Apply tag filter
    const matchesFilter = 
      logFilter === 'all' ||
      (logFilter === 'app' && hasTag(log.message, 'APP')) ||
      (logFilter === 'comfy' && hasTag(log.message, 'COMFY'));
    
    // Apply search query
    const matchesSearch = log.message.toLowerCase().includes(searchQuery.toLowerCase());
    
    return matchesFilter && matchesSearch;
  });

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

  return (
    <>
      {/* Sidebar */}
      <Paper
        shadow="xl"
        p="md"
        className="fixed top-0 h-screen z-[999] bg-gray-900 border-l border-gray-700"
        style={{
          right: isOpen ? 0 : `-${sidebarWidth}px`,
          width: `${sidebarWidth}px`,
          transition: isResizing ? 'none' : 'right 0.3s ease, width 0.3s ease',
        }}
      >
        {/* Resize Handle */}
        {isOpen && (
          <div
            onMouseDown={(e) => {
              e.preventDefault();
              setIsResizing(true);
            }}
            className="absolute left-0 top-0 w-1 h-full cursor-col-resize bg-transparent z-[1001]"
          />
        )}
        <Stack gap="sm" className="h-full">
          <Group justify="space-between" align="center">
            <Text fw={600} size="lg">Logs</Text>
            <Group gap="xs">
              <Text size="xs" c={isConnected ? 'green' : 'red'}>
                {isConnected ? '● Connected' : '● Disconnected'}
              </Text>
              <ActionIcon
                variant="subtle"
                size="sm"
                onClick={() => setIsOpen(false)}
              >
                <RiCloseLine size={16} />
              </ActionIcon>
            </Group>
          </Group>

          <TextInput
            placeholder="Search logs..."
            leftSection={<RiSearchLine size={16} />}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            size="sm"
          />

          {/* Filter Buttons */}
          <Group gap="xs">
            <Button
              variant={logFilter === 'all' ? 'filled' : 'subtle'}
              size="xs"
              onClick={() => setLogFilter('all')}
            >
              All
            </Button>
            <Button
              variant={logFilter === 'app' ? 'filled' : 'subtle'}
              size="xs"
              onClick={() => setLogFilter('app')}
              className={logFilter === 'app' ? 'text-blue-400' : ''}
            >
              APP
            </Button>
            <Button
              variant={logFilter === 'comfy' ? 'filled' : 'subtle'}
              size="xs"
              onClick={() => setLogFilter('comfy')}
              className={logFilter === 'comfy' ? 'text-green-500' : ''}
            >
              COMFY
            </Button>
          </Group>

          <ScrollArea
            className="flex-1"
            scrollbarSize={6}
          >
            <div className="pr-2 font-mono text-xs">
              {filteredLogs.length === 0 ? (
                <Text size="sm" c="dimmed" ta="center" py="xl">
                  {searchQuery ? 'No logs match your search' : 'No logs yet...'}
                </Text>
              ) : (
                <>
                  {filteredLogs.map((log, index) => (
                    <div
                      key={index}
                      className="text-white whitespace-pre-wrap break-words leading-relaxed mb-1"
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

          <Group justify="space-between">
            <Text size="xs" c="dimmed">
              {filteredLogs.length} / {logs.length} logs
            </Text>
            <Button
              variant="subtle"
              size="xs"
              onClick={() => setLogs([])}
            >
              Clear
            </Button>
          </Group>
        </Stack>
      </Paper>
    </>
  );
}

