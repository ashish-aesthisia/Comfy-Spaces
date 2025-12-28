'use client';

import { Modal, ScrollArea, Text, Group } from '@mantine/core';
import { RiFolderFill, RiFile3Fill, RiArrowRightSLine, RiArrowDownSLine } from 'react-icons/ri';
import { useState } from 'react';

interface TreeNode {
  name: string;
  type: 'folder' | 'file';
  children?: Map<string, TreeNode>;
  fullPath?: string;
}

interface NodeTreeModalProps {
  opened: boolean;
  onClose: () => void;
  nodeName: string;
  extensionPaths: string[];
}

function buildTree(paths: string[]): Map<string, TreeNode> {
  const root = new Map<string, TreeNode>();

  paths.forEach((path) => {
    // Remove /extensions/<node-name>/ prefix
    // Path format: /extensions/<node-name>/path/to/file.js
    const match = path.match(/^\/extensions\/[^\/]+\/(.+)$/);
    if (!match) return;
    
    const relativePath = match[1];
    const parts = relativePath.split('/').filter(p => p.length > 0);
    let current = root;

    parts.forEach((part, index) => {
      const isLast = index === parts.length - 1;
      const isFile = isLast && part.includes('.');

      if (!current.has(part)) {
        current.set(part, {
          name: part,
          type: isFile ? 'file' : 'folder',
          children: isFile ? undefined : new Map(),
          fullPath: isFile ? path : undefined,
        });
      }

      if (!isFile && current.get(part)?.children) {
        current = current.get(part)!.children!;
      }
    });
  });

  return root;
}

function TreeNodeComponent({ node, level = 0 }: { node: TreeNode; level?: number }) {
  const [expanded, setExpanded] = useState(level < 2); // Auto-expand first 2 levels

  const hasChildren = node.children && node.children.size > 0;
  const indent = level * 20;

  return (
    <div>
      <Group
        gap="xs"
        style={{
          paddingLeft: `${indent}px`,
          paddingTop: '4px',
          paddingBottom: '4px',
          cursor: hasChildren ? 'pointer' : 'default',
          userSelect: 'none',
        }}
        onClick={() => hasChildren && setExpanded(!expanded)}
      >
        {hasChildren && (
          <span style={{ display: 'inline-flex', alignItems: 'center' }}>
            {expanded ? (
              <RiArrowDownSLine size={16} color="#868e96" />
            ) : (
              <RiArrowRightSLine size={16} color="#868e96" />
            )}
          </span>
        )}
        {!hasChildren && <span style={{ width: '16px' }} />}
        {node.type === 'folder' ? (
          <RiFolderFill size={16} color="#4dabf7" />
        ) : (
          <RiFile3Fill size={16} color="#868e96" />
        )}
        <Text size="sm" c="gray.0" style={{ flex: 1 }}>
          {node.name}
        </Text>
      </Group>
      {hasChildren && expanded && (
        <div>
          {Array.from(node.children!.entries())
            .sort(([a], [b]) => {
              const aIsFolder = node.children!.get(a)?.type === 'folder';
              const bIsFolder = node.children!.get(b)?.type === 'folder';
              if (aIsFolder && !bIsFolder) return -1;
              if (!aIsFolder && bIsFolder) return 1;
              return a.localeCompare(b);
            })
            .map(([key, childNode]) => (
              <TreeNodeComponent key={key} node={childNode} level={level + 1} />
            ))}
        </div>
      )}
    </div>
  );
}

export default function NodeTreeModal({ opened, onClose, nodeName, extensionPaths }: NodeTreeModalProps) {
  const tree = buildTree(extensionPaths);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Text size="lg" fw={600} c="gray.0">
          {nodeName} - Extensions
        </Text>
      }
      size="lg"
      styles={{
        content: {
          backgroundColor: '#1a1b1e',
        },
        header: {
          backgroundColor: '#25262b',
          borderBottom: '1px solid #373a40',
        },
        body: {
          backgroundColor: '#1a1b1e',
        },
      }}
    >
      <ScrollArea h={500}>
        <div style={{ padding: '8px 0' }}>
          {Array.from(tree.entries())
            .sort(([a], [b]) => {
              const aIsFolder = tree.get(a)?.type === 'folder';
              const bIsFolder = tree.get(b)?.type === 'folder';
              if (aIsFolder && !bIsFolder) return -1;
              if (!aIsFolder && bIsFolder) return 1;
              return a.localeCompare(b);
            })
            .map(([key, node]) => (
              <TreeNodeComponent key={key} node={node} />
            ))}
        </div>
      </ScrollArea>
    </Modal>
  );
}

