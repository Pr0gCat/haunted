#!/usr/bin/env node

/**
 * Post-install script for Haunted CLI
 * Performs setup tasks after package installation
 */

import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';

async function postInstall() {
  try {
    console.log('🔧 Setting up Haunted CLI...');

    // Check if we're in a development environment
    const isDev = process.env.NODE_ENV === 'development' ||
                  process.env.npm_config_dev === 'true';

    if (isDev) {
      console.log('📦 Development environment detected - skipping post-install setup');
      return;
    }

    // Check Node.js version
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);

    if (majorVersion < 20) {
      console.warn('⚠️  Warning: Node.js 20.0.0 or higher is recommended for Haunted CLI');
      console.warn(`   Current version: ${nodeVersion}`);
    }

    // Check if Claude Code CLI is available
    try {
      execSync('claude --version', { stdio: 'ignore' });
      console.log('✅ Claude Code CLI detected');
    } catch (error) {
      console.log('ℹ️  Claude Code CLI not found - you can install it later from https://claude.ai/download');
    }

    // Check if Git is available
    try {
      execSync('git --version', { stdio: 'ignore' });
      console.log('✅ Git detected');
    } catch (error) {
      console.warn('⚠️  Git not found - Git is required for Haunted CLI functionality');
    }

    console.log('');
    console.log('🎉 Haunted CLI setup complete!');
    console.log('');
    console.log('Quick start:');
    console.log('  cd your-project');
    console.log('  npx haunted init');
    console.log('  npx haunted start');
    console.log('');
    console.log('For help: npx haunted --help');

  } catch (error) {
    console.error('❌ Post-install setup failed:', error.message);
    // Don't fail the installation
    process.exit(0);
  }
}

// Only run if called directly (not imported)
if (import.meta.url === `file://${process.argv[1]}`) {
  postInstall().catch(console.error);
}

export default postInstall;