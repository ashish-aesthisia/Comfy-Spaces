#!/usr/bin/env node

/**
 * Integration test script for @comfy-spaces/core package.
 * 
 * This script generates a Dockerfile using the package's generateDockerfile function
 * and optionally builds it with Docker (if Docker is available).
 * 
 * This verifies that:
 * 1. TypeScript compilation works correctly
 * 2. The generated Dockerfile syntax is valid
 * 3. The Docker build process completes successfully (if Docker is running)
 * 
 * Usage:
 *   node integration-test.mjs [--cpu|--gpu] [--build]
 * 
 * Options:
 *   --cpu: Generate a CPU-only image (default)
 *   --gpu: Generate an NVIDIA GPU image
 *   --build: Actually build the Docker image (requires Docker)
 */

import { generateDockerfile, buildImage } from './dist/esm/container/index.js';
import { writeFileSync } from 'fs';

const minimalConfig = {
  nodes: [],
  dependencies: ['numpy>=1.24.0'],
  metadata: {
    visibleName: 'Integration Test Space',
    spaceId: 'integration-test',
    pythonVersion: '3.11',
    githubUrl: 'https://github.com/comfyanonymous/ComfyUI',
    branch: null,
    commitId: null,
    releaseTag: null,
    installManager: false,
  },
};

const useGPU = process.argv.includes('--gpu');
const shouldBuild = process.argv.includes('--build');

console.log('========================================');
console.log('Integration Test: generateDockerfile');
console.log('========================================');
console.log(`Mode: ${useGPU ? 'NVIDIA GPU' : 'CPU'}`);
console.log('========================================\n');

const options = useGPU ? { gpu: 'nvidia', cudaVersion: '12.6' } : {};

console.log('Generating Dockerfile...\n');

try {
  const dockerfile = generateDockerfile(minimalConfig, options);
  
  console.log('Generated Dockerfile:');
  console.log('========================================');
  console.log(dockerfile);
  console.log('========================================\n');
  
  // Write to a file for inspection
  const outputPath = './test-output-Dockerfile';
  writeFileSync(outputPath, dockerfile, 'utf-8');
  console.log(`✓ Dockerfile written to ${outputPath}\n`);
  
  // Basic validation
  const lines = dockerfile.split('\n');
  const hasFrom = lines.some(line => line.startsWith('FROM '));
  const hasWorkdir = lines.some(line => line.startsWith('WORKDIR '));
  const hasExpose = lines.some(line => line.startsWith('EXPOSE '));
  const hasCmd = lines.some(line => line.startsWith('CMD '));
  
  console.log('Dockerfile validation:');
  console.log(`  FROM instruction: ${hasFrom ? '✓' : '✗'}`);
  console.log(`  WORKDIR instruction: ${hasWorkdir ? '✓' : '✗'}`);
  console.log(`  EXPOSE instruction: ${hasExpose ? '✓' : '✗'}`);
  console.log(`  CMD instruction: ${hasCmd ? '✓' : '✗'}`);
  
  if (hasFrom && hasWorkdir && hasExpose && hasCmd) {
    console.log('\n✓ Dockerfile generation test PASSED\n');
    
    if (shouldBuild) {
      console.log('========================================');
      console.log('Building Docker image...');
      console.log('========================================\n');
      
      const buildOptions = {
        ...options,
        tag: 'comfy-spaces-integration-test',
        logger: (msg) => console.log(`[BUILD] ${msg}`),
      };
      
      const result = await buildImage(minimalConfig, buildOptions);
      
      console.log('\n========================================');
      console.log('Build Result:');
      console.log('========================================');
      console.log(`Success: ${result.success}`);
      console.log(`Tag: ${result.tag}`);
      if (result.imageId) {
        console.log(`Image ID: ${result.imageId}`);
      }
      if (result.error) {
        console.log(`Error: ${result.error}`);
      }
      console.log('========================================\n');
      
      if (result.success) {
        console.log('✓ Docker build test PASSED');
        console.log(`\nYou can run the image with:`);
        console.log(`  docker run -p 8188:8188 ${result.tag}\n`);
        console.log(`To remove the test image:`);
        console.log(`  docker rmi ${result.tag}\n`);
        process.exit(0);
      } else {
        console.error('✗ Docker build test FAILED');
        console.error('Note: This is expected if Docker is not running');
        process.exit(1);
      }
    } else {
      console.log('To build the Docker image, run:');
      console.log('  node integration-test.mjs --build\n');
      console.log('Note: Docker must be installed and running.\n');
      process.exit(0);
    }
  } else {
    console.error('\n✗ Dockerfile generation test FAILED');
    console.error('Generated Dockerfile is missing required instructions');
    process.exit(1);
  }
} catch (error) {
  console.error('\n========================================');
  console.error('Error:');
  console.error('========================================');
  console.error(error);
  console.error('========================================\n');
  console.error('✗ Integration test FAILED');
  process.exit(1);
}
