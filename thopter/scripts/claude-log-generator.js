#!/usr/bin/env node

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = '/data/thopter/.claude/projects';
const INTERVAL = 60000; // 1 minute

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