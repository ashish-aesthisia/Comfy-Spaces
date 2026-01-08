'use client';

import { useState, useRef, useCallback } from 'react';
import { Modal, Button, Stack, Group, Text, Alert, Paper, Badge, Divider, Grid, Progress, TextInput } from '@mantine/core';
import { RiErrorWarningLine, RiCheckLine, RiFileCodeLine, RiUploadLine, RiCloseLine, RiFileTextLine, RiCheckboxCircleFill } from 'react-icons/ri';

interface ImportJsonModalProps {
  opened: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface SpaceJson {
  nodes: any[];
  dependencies: string[];
  metadata: {
    visibleName: string;
    spaceId: string;
    pythonVersion: string;
    torchVersion?: string | null;
    githubUrl: string;
    branch: string | null;
    commitId: string | null;
    releaseTag: string | null;
    cmdArgs?: string | null;
    createdAt?: string;
    comfyUISource?: string;
  };
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export default function ImportJsonModal({ opened, onClose, onSuccess }: ImportJsonModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [jsonContent, setJsonContent] = useState<SpaceJson | null>(null);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [nameConflict, setNameConflict] = useState(false);
  const [newSpaceName, setNewSpaceName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Generate space ID from visible name
  const generateSpaceId = (name: string): string => {
    return name
      .toLowerCase()
      .replace(/%20/g, '-') // Replace %20 with -
      .replace(/[^a-z0-9-]/g, '-') // Replace special chars with -
      .replace(/-+/g, '-') // Replace multiple dashes with single dash
      .replace(/^-|-$/g, ''); // Remove leading/trailing dashes
  };

  const validateJson = (json: any): ValidationResult => {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check top-level structure
    if (typeof json !== 'object' || json === null) {
      errors.push('JSON must be an object');
      return { valid: false, errors, warnings };
    }

    // Validate nodes field
    if (!('nodes' in json)) {
      errors.push('Missing required field: "nodes"');
    } else if (!Array.isArray(json.nodes)) {
      errors.push('Field "nodes" must be an array');
    }

    // Validate dependencies field
    if (!('dependencies' in json)) {
      errors.push('Missing required field: "dependencies"');
    } else if (!Array.isArray(json.dependencies)) {
      errors.push('Field "dependencies" must be an array');
    } else {
      // Validate dependencies are strings
      const invalidDeps = json.dependencies.filter((dep: any) => typeof dep !== 'string');
      if (invalidDeps.length > 0) {
        errors.push(`All items in "dependencies" must be strings. Found ${invalidDeps.length} invalid item(s)`);
      }
    }

    // Validate metadata field
    if (!('metadata' in json)) {
      errors.push('Missing required field: "metadata"');
    } else if (typeof json.metadata !== 'object' || json.metadata === null) {
      errors.push('Field "metadata" must be an object');
    } else {
      const metadata = json.metadata;
      
      // Required metadata fields
      const requiredFields = ['visibleName', 'spaceId', 'pythonVersion', 'githubUrl'];
      for (const field of requiredFields) {
        if (!(field in metadata)) {
          errors.push(`Missing required metadata field: "${field}"`);
        } else if (typeof metadata[field] !== 'string') {
          errors.push(`Metadata field "${field}" must be a string`);
        }
      }

      // Optional but validate types if present
      if ('branch' in metadata && metadata.branch !== null && typeof metadata.branch !== 'string') {
        errors.push('Metadata field "branch" must be a string or null');
      }
      if ('commitId' in metadata && metadata.commitId !== null && typeof metadata.commitId !== 'string') {
        errors.push('Metadata field "commitId" must be a string or null');
      }
      if ('releaseTag' in metadata && metadata.releaseTag !== null && typeof metadata.releaseTag !== 'string') {
        errors.push('Metadata field "releaseTag" must be a string or null');
      }
      if ('torchVersion' in metadata && metadata.torchVersion !== null && typeof metadata.torchVersion !== 'string') {
        errors.push('Metadata field "torchVersion" must be a string or null');
      }
      if ('cmdArgs' in metadata && metadata.cmdArgs !== null && typeof metadata.cmdArgs !== 'string') {
        errors.push('Metadata field "cmdArgs" must be a string or null');
      }

      // Validate visibleName length
      if (metadata.visibleName && metadata.visibleName.length < 2) {
        errors.push('Metadata field "visibleName" must be at least 2 characters');
      }

      // Validate spaceId length
      if (metadata.spaceId && metadata.spaceId.length < 2) {
        errors.push('Metadata field "spaceId" must be at least 2 characters');
      }

      // Validate Python version format
      if (metadata.pythonVersion && !/^3\.\d+$/.test(metadata.pythonVersion)) {
        warnings.push('Python version should be in format "3.x" (e.g., "3.11")');
      }

      // Validate GitHub URL format
      if (metadata.githubUrl && !metadata.githubUrl.startsWith('http')) {
        warnings.push('GitHub URL should be a valid URL');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  };

  const handleFileSelect = useCallback(async (selectedFile: File) => {
    if (!selectedFile.name.endsWith('.json')) {
      setError('Please select a JSON file');
      setFile(null);
      setJsonContent(null);
      setValidationResult(null);
      return;
    }

    setFile(selectedFile);
    setError(null);
    setValidationResult(null);
    setSuccess(false);

    try {
      const text = await selectedFile.text();
      const parsed = JSON.parse(text);
      setJsonContent(parsed);
      
      const validation = validateJson(parsed);
      setValidationResult(validation);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse JSON file');
      setFile(null);
      setJsonContent(null);
      setValidationResult(null);
    }
  }, []);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      handleFileSelect(selectedFile);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) {
      handleFileSelect(droppedFile);
    }
  };

  const handleImport = async (useNewName = false) => {
    if (!jsonContent || !validationResult?.valid) {
      return;
    }

    // If using new name, validate it
    if (useNewName) {
      if (!newSpaceName || newSpaceName.length < 2) {
        setError('Space name must be at least 2 characters');
        return;
      }
      const newSpaceId = generateSpaceId(newSpaceName);
      if (!newSpaceId || newSpaceId.length < 2) {
        setError('Space name must contain at least 2 valid characters');
        return;
      }
    }

    setIsImporting(true);
    setError(null);
    setSuccess(false);
    setNameConflict(false);

    try {
      // Prepare the data to send
      const importData = { ...jsonContent };
      
      // If using new name, update the metadata
      if (useNewName && newSpaceName) {
        const newSpaceId = generateSpaceId(newSpaceName);
        importData.metadata = {
          ...importData.metadata,
          visibleName: newSpaceName,
          spaceId: newSpaceId,
        };
      }

      const response = await fetch('/api/spaces/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(importData),
      });

      const data = await response.json();

      if (!response.ok) {
        // Check if it's a name conflict error
        if (data.error && data.error.includes('already exists')) {
          setNameConflict(true);
          setNewSpaceName(jsonContent.metadata?.visibleName || '');
          setError(data.error);
        } else {
          setError(data.error || 'Failed to import space');
        }
        setIsImporting(false);
        return;
      }

      setSuccess(true);
      setTimeout(() => {
        onSuccess();
        handleClose();
      }, 1500);
    } catch (err) {
      console.error('Error importing space:', err);
      setError('Failed to import space');
      setIsImporting(false);
    }
  };

  const handleClose = () => {
    if (!isImporting) {
      setFile(null);
      setJsonContent(null);
      setValidationResult(null);
      setError(null);
      setSuccess(false);
      setIsDragging(false);
      setNameConflict(false);
      setNewSpaceName('');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      onClose();
    }
  };

  const canImport = validationResult?.valid && jsonContent && !isImporting && !nameConflict;

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={
        <Text size="lg" fw={600} c="#ffffff">
          Import Space from JSON
        </Text>
      }
      size="lg"
      closeOnClickOutside={!isImporting}
      closeOnEscape={!isImporting}
      styles={{
        title: { color: '#ffffff' },
        content: { backgroundColor: '#1a1b1e', borderRadius: '8px' },
        header: { backgroundColor: '#25262b', borderBottom: '1px solid #373a40', padding: '20px' },
        body: { backgroundColor: '#1a1b1e', padding: '24px' },
      }}
    >
      <Stack gap="lg">
        {error && !nameConflict && (
          <Alert
            icon={<RiErrorWarningLine size={18} />}
            color="red"
            title="Error"
            styles={{
              root: { backgroundColor: '#2d2020', border: '1px solid #5c1a1a', borderRadius: '8px' },
              title: { color: '#ff6b6b', fontWeight: 600 },
              message: { color: '#ff9999' },
            }}
          >
            {error}
          </Alert>
        )}

        {nameConflict && (
          <Paper
            p="md"
            style={{
              backgroundColor: '#2d2020',
              border: '1px solid #5c1a1a',
              borderRadius: '8px',
            }}
          >
            <Stack gap="md">
              <Group gap="sm">
                <RiErrorWarningLine size={20} color="#ff6b6b" />
                <Text size="md" fw={600} c="#ff6b6b">
                  Space Already Exists
                </Text>
              </Group>
              <Text size="sm" c="#ff9999">
                A space with ID "{jsonContent?.metadata?.spaceId}" already exists. Please provide a different name.
              </Text>
              <TextInput
                label="New Space Name"
                placeholder="Enter a new space name"
                value={newSpaceName}
                onChange={(e) => {
                  setNewSpaceName(e.currentTarget.value);
                  setError(null);
                }}
                description={newSpaceName ? `Space ID: ${generateSpaceId(newSpaceName)}` : undefined}
                disabled={isImporting}
                styles={{
                  label: { color: '#ffffff', marginBottom: '6px', fontWeight: 500 },
                  input: {
                    backgroundColor: '#25262b',
                    border: '1px solid #373a40',
                    color: '#ffffff',
                    '&:focus': { borderColor: '#0070f3' },
                  },
                  description: { color: '#888888', fontSize: '12px', marginTop: '4px' },
                }}
              />
              {error && nameConflict && (
                <Text size="xs" c="#ff6b6b">
                  {error}
                </Text>
              )}
            </Stack>
          </Paper>
        )}

        {success && (
          <Alert
            icon={<RiCheckboxCircleFill size={18} />}
            color="green"
            title="Import Successful"
            styles={{
              root: { backgroundColor: '#1e2e1e', border: '1px solid #2d5a2d', borderRadius: '8px' },
              title: { color: '#51cf66', fontWeight: 600 },
              message: { color: '#69db7c' },
            }}
          >
            Space imported successfully! It will appear in your spaces list.
          </Alert>
        )}

        {/* File Upload Area */}
        <Paper
          p="xl"
          style={{
            border: `2px dashed ${isDragging ? '#0070f3' : file ? '#51cf66' : '#373a40'}`,
            backgroundColor: isDragging ? '#1a1f2e' : file ? '#0f1a0f' : '#0f0f0f',
            borderRadius: '12px',
            cursor: 'pointer',
            transition: 'all 0.3s ease',
            textAlign: 'center',
            position: 'relative',
            overflow: 'hidden',
          }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          {isDragging && (
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0, 112, 243, 0.1)',
                zIndex: 1,
              }}
            />
          )}
          <Stack gap="md" align="center" style={{ position: 'relative', zIndex: 2 }}>
            <div
              style={{
                width: '56px',
                height: '56px',
                borderRadius: '50%',
                backgroundColor: isDragging ? 'rgba(0, 112, 243, 0.2)' : file ? 'rgba(81, 207, 102, 0.2)' : 'rgba(136, 136, 136, 0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.3s ease',
              }}
            >
              {file ? (
                <RiFileTextLine size={28} color="#51cf66" />
              ) : (
                <RiUploadLine size={28} color={isDragging ? '#0070f3' : '#888888'} />
              )}
            </div>
            <Stack gap="xs" align="center">
              <Text size="lg" fw={600} c="#ffffff">
                {file ? file.name : 'Drag & drop your JSON file'}
              </Text>
              {file && (
                <Text size="xs" c="#888888">
                  {(file.size / 1024).toFixed(2)} KB
                </Text>
              )}
              {!file && (
                <Text size="sm" c="#888888">
                  or <span style={{ color: '#0070f3', textDecoration: 'underline' }}>browse</span> to select
                </Text>
              )}
            </Stack>
            {file && (
              <Button
                variant="subtle"
                size="xs"
                leftSection={<RiCloseLine size={14} />}
                onClick={(e) => {
                  e.stopPropagation();
                  setFile(null);
                  setJsonContent(null);
                  setValidationResult(null);
                  if (fileInputRef.current) {
                    fileInputRef.current.value = '';
                  }
                }}
                styles={{
                  root: {
                    color: '#888888',
                    '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.05)' },
                  },
                }}
              >
                Remove file
              </Button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleFileInputChange}
              style={{ display: 'none' }}
            />
          </Stack>
        </Paper>

        {/* Validation Results */}
        {validationResult && (
          <Stack gap="md">
            {validationResult.valid ? (
              <Paper
                p="md"
                style={{
                  backgroundColor: '#1e2e1e',
                  border: '1px solid #2d5a2d',
                  borderRadius: '8px',
                }}
              >
                <Group gap="sm" mb="sm">
                  <RiCheckboxCircleFill size={20} color="#51cf66" />
                  <Text size="md" fw={600} c="#51cf66">
                    JSON is Valid
                  </Text>
                  <Badge
                    color="green"
                    variant="light"
                    size="sm"
                    styles={{
                      root: { backgroundColor: 'rgba(81, 207, 102, 0.1)' },
                    }}
                  >
                    Ready to Import
                  </Badge>
                </Group>
                <Text size="sm" c="#69db7c" mb={validationResult.warnings.length > 0 ? 'md' : 0}>
                  All required fields are present and valid.
                </Text>
                {validationResult.warnings.length > 0 && (
                  <Paper
                    p="sm"
                    mt="sm"
                    style={{
                      backgroundColor: 'rgba(255, 193, 7, 0.1)',
                      border: '1px solid rgba(255, 193, 7, 0.3)',
                      borderRadius: '6px',
                    }}
                  >
                    <Text size="xs" c="#ffc107" fw={500} mb="xs">
                      Warnings:
                    </Text>
                    <Stack gap={4}>
                      {validationResult.warnings.map((warning, idx) => (
                        <Text key={idx} size="xs" c="#ffc107" style={{ marginLeft: '8px' }}>
                          • {warning}
                        </Text>
                      ))}
                    </Stack>
                  </Paper>
                )}
              </Paper>
            ) : (
              <Paper
                p="md"
                style={{
                  backgroundColor: '#2d2020',
                  border: '1px solid #5c1a1a',
                  borderRadius: '8px',
                }}
              >
                <Group gap="sm" mb="sm">
                  <RiErrorWarningLine size={20} color="#ff6b6b" />
                  <Text size="md" fw={600} c="#ff6b6b">
                    Validation Failed
                  </Text>
                  <Badge
                    color="red"
                    variant="light"
                    size="sm"
                    styles={{
                      root: { backgroundColor: 'rgba(255, 107, 107, 0.1)' },
                    }}
                  >
                    {validationResult.errors.length} error{validationResult.errors.length !== 1 ? 's' : ''}
                  </Badge>
                </Group>
                <Stack gap="xs">
                  {validationResult.errors.map((err, idx) => (
                    <Group key={idx} gap="xs" align="flex-start">
                      <RiErrorWarningLine size={14} color="#ff6b6b" style={{ marginTop: '2px', flexShrink: 0 }} />
                      <Text size="sm" c="#ff9999" style={{ flex: 1 }}>
                        {err}
                      </Text>
                    </Group>
                  ))}
                </Stack>
              </Paper>
            )}

            {/* Show JSON preview info */}
            {jsonContent && validationResult.valid && (
              <Paper
                p="md"
                style={{
                  backgroundColor: '#0f0f0f',
                  border: '1px solid #373a40',
                  borderRadius: '8px',
                }}
              >
                <Group justify="space-between" mb="md">
                  <Text size="sm" fw={600} c="#ffffff">
                    Space Details
                  </Text>
                  <Badge
                    variant="outline"
                    size="sm"
                    styles={{
                      root: {
                        borderColor: '#373a40',
                        color: '#888888',
                        backgroundColor: 'transparent',
                      },
                    }}
                  >
                    Preview
                  </Badge>
                </Group>
                <Divider color="#373a40" mb="md" />
                <Grid gutter="md">
                  <Grid.Col span={6}>
                    <Stack gap={4}>
                      <Text size="xs" c="#888888" fw={500}>
                        Name
                      </Text>
                      <Text size="sm" c="#ffffff" fw={500}>
                        {jsonContent.metadata?.visibleName || 'N/A'}
                      </Text>
                    </Stack>
                  </Grid.Col>
                  <Grid.Col span={6}>
                    <Stack gap={4}>
                      <Text size="xs" c="#888888" fw={500}>
                        Space ID
                      </Text>
                      <Text size="sm" c="#ffffff" style={{ fontFamily: 'monospace' }}>
                        {jsonContent.metadata?.spaceId || 'N/A'}
                      </Text>
                    </Stack>
                  </Grid.Col>
                  <Grid.Col span={6}>
                    <Stack gap={4}>
                      <Text size="xs" c="#888888" fw={500}>
                        Python Version
                      </Text>
                      <Group gap="xs">
                        <Badge
                          variant="light"
                          size="sm"
                          styles={{
                            root: { backgroundColor: 'rgba(0, 112, 243, 0.1)', color: '#4dabf7' },
                          }}
                        >
                          {jsonContent.metadata?.pythonVersion || 'N/A'}
                        </Badge>
                      </Group>
                    </Stack>
                  </Grid.Col>
                  <Grid.Col span={6}>
                    <Stack gap={4}>
                      <Text size="xs" c="#888888" fw={500}>
                        GitHub URL
                      </Text>
                      <Text size="xs" c="#888888" style={{ fontFamily: 'monospace' }} truncate>
                        {jsonContent.metadata?.githubUrl || 'N/A'}
                      </Text>
                    </Stack>
                  </Grid.Col>
                  <Grid.Col span={6}>
                    <Stack gap={4}>
                      <Text size="xs" c="#888888" fw={500}>
                        Dependencies
                      </Text>
                      <Group gap="xs">
                        <Badge
                          variant="outline"
                          size="sm"
                          styles={{
                            root: {
                              borderColor: '#373a40',
                              color: '#888888',
                              backgroundColor: 'transparent',
                            },
                          }}
                        >
                          {jsonContent.dependencies?.length || 0} items
                        </Badge>
                      </Group>
                    </Stack>
                  </Grid.Col>
                  <Grid.Col span={6}>
                    <Stack gap={4}>
                      <Text size="xs" c="#888888" fw={500}>
                        Custom Nodes
                      </Text>
                      <Group gap="xs">
                        <Badge
                          variant="outline"
                          size="sm"
                          styles={{
                            root: {
                              borderColor: '#373a40',
                              color: '#888888',
                              backgroundColor: 'transparent',
                            },
                          }}
                        >
                          {jsonContent.nodes?.length || 0} items
                        </Badge>
                      </Group>
                    </Stack>
                  </Grid.Col>
                </Grid>
              </Paper>
            )}
          </Stack>
        )}

        {isImporting && (
          <Paper
            p="md"
            style={{
              backgroundColor: '#0f0f0f',
              border: '1px solid #373a40',
              borderRadius: '8px',
            }}
          >
            <Stack gap="sm">
              <Group justify="space-between">
                <Text size="sm" fw={500} c="#ffffff">
                  Importing Space...
                </Text>
                <Text size="xs" c="#888888">
                  This may take a few moments
                </Text>
              </Group>
              <Progress
                value={100}
                animated
                color="blue"
                size="sm"
                radius="xl"
                styles={{
                  root: { backgroundColor: '#25262b' },
                  bar: { backgroundColor: '#0070f3' },
                }}
              />
            </Stack>
          </Paper>
        )}

        <Divider color="#373a40" />
        <Group justify="flex-end" gap="sm">
          <Button
            variant="subtle"
            onClick={handleClose}
            disabled={isImporting}
            size="md"
            styles={{
              root: {
                color: '#888888',
                '&:hover': {
                  backgroundColor: '#25262b',
                  color: '#ffffff',
                },
                '&:disabled': { color: '#555555' },
              },
            }}
          >
            Cancel
          </Button>
          {nameConflict ? (
            <Button
              onClick={() => handleImport(true)}
              loading={isImporting}
              disabled={!newSpaceName || newSpaceName.length < 2 || isImporting}
              size="md"
              leftSection={!isImporting && <RiFileCodeLine size={18} />}
              styles={{
                root: {
                  backgroundColor: newSpaceName && newSpaceName.length >= 2 ? '#0070f3' : '#373a40',
                  color: '#ffffff',
                  fontWeight: 500,
                  '&:hover': newSpaceName && newSpaceName.length >= 2 ? { backgroundColor: '#0051cc' } : {},
                  '&:disabled': { backgroundColor: '#373a40', color: '#666666', cursor: 'not-allowed' },
                },
              }}
            >
              {isImporting ? 'Importing...' : 'Import with New Name'}
            </Button>
          ) : (
            <Button
              onClick={() => handleImport(false)}
              loading={isImporting}
              disabled={!canImport}
              size="md"
              leftSection={!isImporting && <RiFileCodeLine size={18} />}
              styles={{
                root: {
                  backgroundColor: canImport ? '#0070f3' : '#373a40',
                  color: '#ffffff',
                  fontWeight: 500,
                  '&:hover': canImport ? { backgroundColor: '#0051cc' } : {},
                  '&:disabled': { backgroundColor: '#373a40', color: '#666666', cursor: 'not-allowed' },
                },
              }}
            >
              {isImporting ? 'Importing...' : 'Import Space'}
            </Button>
          )}
        </Group>
      </Stack>
    </Modal>
  );
}
