#!/usr/bin/env node

/**
 * Helper script for Netlify builds
 * Ensures proper installation of Sharp and other dependencies
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

console.log('Starting Netlify build helper...');
console.log('Node version:', process.version);
console.log('Current directory:', process.cwd());

// Check if we're running on Netlify
const isNetlify = process.env.NETLIFY === 'true';
console.log('Running on Netlify:', isNetlify ? 'Yes' : 'No');

if (isNetlify) {
  console.log('Setting up Netlify build environment...');
  
  // Make scripts executable
  try {
    fs.chmodSync(path.resolve(process.cwd(), 'scripts/optimize-images.js'), '755');
    console.log('Made optimize-images.js executable');
  } catch (err) {
    console.warn('Could not make script executable:', err.message);
  }
  
  // Ensure sharp is installed with native dependencies
  console.log('Ensuring Sharp is properly installed...');
  const sharpInstall = spawnSync('npm', ['rebuild', 'sharp', '--platform=linux', '--libc=glibc'], { 
    stdio: 'inherit',
    shell: true
  });
  
  if (sharpInstall.status !== 0) {
    console.warn('Warning: Sharp rebuild exited with code', sharpInstall.status);
    
    // Try direct installation as fallback
    console.log('Attempting direct installation as fallback...');
    const sharpInstallFallback = spawnSync('npm', ['install', 'sharp'], { 
      stdio: 'inherit',
      shell: true
    });
    
    if (sharpInstallFallback.status !== 0) {
      console.warn('Warning: Sharp direct install exited with code', sharpInstallFallback.status);
      console.log('Will continue with build but image optimization might be limited');
    } else {
      console.log('Sharp installed directly successfully');
    }
  } else {
    console.log('Sharp rebuilt successfully');
  }
  
  // Set memory limits for a more stable build
  console.log('Setting memory limits...');
  process.env.NODE_OPTIONS = process.env.NODE_OPTIONS || '--max-old-space-size=4096';
  process.env.SHARP_MEMORY_ALLOCATION = process.env.SHARP_MEMORY_ALLOCATION || '512';
  
  console.log('Environment prepared for Netlify build');
} else {
  console.log('Not running on Netlify, skipping Netlify-specific setup');
}

console.log('Build helper completed'); 