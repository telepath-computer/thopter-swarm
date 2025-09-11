#!/usr/bin/env node

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = '/data/thopter/.claude/projects';
const INTERVAL = 30000;

// Handle shutdown signals
let shouldStop = false;
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  shouldStop = true;
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully...');
  shouldStop = true;
});

function runClaudeCodeLog() {
  if (shouldStop) {
    console.log('Shutting down claude-log-generator...');
    process.exit(0);
  }

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Recursively delete existing .html files to force regeneration
  console.log(`[${new Date().toISOString()}] Cleaning existing .html files...`);
  deleteHtmlFiles(OUTPUT_DIR);

  console.log(`[${new Date().toISOString()}] Running claude-code-log...`);
  
  exec('uvx claude-code-log@latest', {
    cwd: OUTPUT_DIR,
    env: { ...process.env, PATH: `/root/.local/bin:${process.env.PATH}` }
  }, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error running claude-code-log: ${error.message}`);
      console.error(`stderr: ${stderr}`);
    } else {
      console.log(`[${new Date().toISOString()}] claude-code-log completed successfully`);
      if (stdout) console.log(`stdout: ${stdout}`);
    }
  });
}

function deleteHtmlFiles(dir) {
  try {
    const items = fs.readdirSync(dir);
    
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        deleteHtmlFiles(fullPath); // Recursively delete in subdirectories
      } else if (stat.isFile() && item.endsWith('.html')) {
        fs.unlinkSync(fullPath);
        console.log(`  Deleted: ${fullPath}`);
      }
    }
  } catch (error) {
    console.warn(`Failed to clean .html files from ${dir}: ${error.message}`);
  }
}

// Run immediately on start
runClaudeCodeLog();

// Schedule to run every minute
const intervalId = setInterval(() => {
  runClaudeCodeLog();
}, INTERVAL);

// Cleanup on exit
process.on('exit', () => {
  clearInterval(intervalId);
});

console.log('claude-log-generator started, will update HTML every minute...');
