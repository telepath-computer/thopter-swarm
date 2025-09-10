#!/usr/bin/env node

const { execSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
// Removed ioredis dependency - using redis-cli instead

class SessionObserver {
  constructor() {
    // Auto-detect agent ID from hostname (fly sets hostname to machine ID) or fall back to env var
    this.agentId = process.env.AGENT_ID || require('os').hostname();
    this.metadataServiceHost = process.env.METADATA_SERVICE_HOST;
    this.hubHost = null; // Will be read from metadata service
    this.hubStatusPort = null; // Will be read from metadata service
    this.lastScreen = '';
    this.lastChangeTime = Date.now();
    this.lastState = null;
    this.POLL_INTERVAL = 3000; // 3 seconds
    this.IDLE_THRESHOLD = 60000; // 60 seconds
    this.running = false;
    this.pollTimer = null;
    this.issueContext = null;
    this.spawnedAt = new Date().toISOString();
    // Using redis-cli instead of ioredis module
    this.appName = process.env.APP_NAME || 'thopter-swarm';
  }

  async initialize() {
    if (!this.agentId) {
      throw new Error('AGENT_ID environment variable is required');
    }

    if (!this.metadataServiceHost) {
      throw new Error('METADATA_SERVICE_HOST environment variable is required');
    }

    // Connect to metadata service
    await this.connectToMetadata();
    
    // Get hub connection info from metadata
    await this.updateHubConnectionInfo();

    // Load issue context from JSON file if available
    await this.loadIssueContext();

    console.log(`[SessionObserver] Starting observer for agent: ${this.agentId}`);
    console.log(`[SessionObserver] Hub endpoint: http://${this.hubHost}:${this.hubStatusPort}/status`);
    console.log(`[SessionObserver] Poll interval: ${this.POLL_INTERVAL}ms`);
    if (this.issueContext) {
      console.log(`[SessionObserver] Issue context loaded: ${this.issueContext.repository}#${this.issueContext.github.issueNumber}`);
    }
  }

  async connectToMetadata() {
    console.log(`[SessionObserver] Testing metadata service at ${this.metadataServiceHost}:6379`);
    
    try {
      // Test connection with redis-cli ping
      execSync(`redis-cli -h ${this.metadataServiceHost} -p 6379 ping`, {
        encoding: 'utf8',
        timeout: 10000
      });
      console.log(`[SessionObserver] Metadata service connection verified`);
    } catch (error) {
      console.error(`[SessionObserver] Failed to connect to metadata service: ${error.message}`);
      throw error;
    }
  }

  async updateHubConnectionInfo() {
    try {
      // Get hub status port from environment variable
      const hubStatusPort = process.env.HUB_STATUS_PORT;

      if (!hubStatusPort) {
        console.error(`[SessionObserver] HUB_STATUS_PORT environment variable not set`);
        return false; // Don't throw, return failure
      }

      // Use static service discovery hostname and env port
      this.hubHost = `1.hub.kv._metadata.${this.appName}.internal`;
      this.hubStatusPort = hubStatusPort;

      console.log(`[SessionObserver] Updated hub connection: ${this.hubHost}:${this.hubStatusPort}`);
      return true; // Success
    } catch (error) {
      console.error(`[SessionObserver] Failed to get hub connection info from metadata: ${error.message}`);
      return false; // Don't throw, return failure
    }
  }

  async captureTerminal() {
    try {
      // Capture visible tmux pane content
      const screenDump = execSync('tmux capture-pane -t thopter -p', { 
        encoding: 'utf8',
        timeout: 5000 
      });
      return screenDump;
    } catch (error) {
      throw new Error(`Failed to capture tmux pane: ${error.message}`);
    }
  }

  async postToHub(payload) {
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify(payload);
      
      const options = {
        hostname: this.hubHost,
        port: this.hubStatusPort,
        path: '/status',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 5000 // 5 second timeout
      };

      const req = http.request(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ status: res.statusCode, data });
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', (err) => {
        reject(new Error(`Request failed: ${err.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.write(postData);
      req.end();
    });
  }

  async updateHubState(state, screenDump) {
    try {
      const now = new Date().toISOString();
      const payload = {
        agent_id: this.agentId,
        state: state,
        screen_dump: screenDump,
        last_activity: now,
        timestamp: now,
        spawned_at: this.spawnedAt
      };

      // Include issue context metadata if available
      if (this.issueContext) {
        payload.repository = this.issueContext.repository;
        payload.branch = this.issueContext.branch;
        payload.github = {
          issue_number: this.issueContext.github.issueNumber,
          issue_title: this.issueContext.github.issueTitle,
          issue_body: this.issueContext.github.issueBody,
          issue_url: this.issueContext.github.issueUrl,
          mention_author: this.issueContext.github.mentionAuthor,
          mention_comment_id: this.issueContext.github.mentionCommentId
        };
      }

      // Track idle duration
      if (state === 'idle' && this.lastState !== 'idle') {
        // Just transitioned to idle - record when it went idle
        payload.idle_since = new Date(this.lastChangeTime).toISOString();
      } else if (state === 'running' && this.lastState === 'idle') {
        // Just transitioned to running - clear idle timestamp
        payload.idle_since = null;
      }

      const response = await this.postToHub(payload);

      // Log successful communication
      console.log(`[SessionObserver] Status sent to hub: ${state} (${response.status})`);

      // Log state transitions
      if (this.lastState !== state) {
        console.log(`[SessionObserver] State transition: ${this.lastState || 'initial'} → ${state}`);
        this.lastState = state;
      }

    } catch (error) {
      console.error('[SessionObserver] Failed to update hub state:', error.message);
      // Don't throw - we'll retry on next poll
    }
  }

  async checkActivity() {
    try {
      // 0. Refresh hub connection info from metadata service
      const hubInfoUpdated = await this.updateHubConnectionInfo();
      if (!hubInfoUpdated) {
        console.error(`[SessionObserver] Warning: Could not update hub connection info - using previous values if available`);
        // Continue with existing connection info if metadata is temporarily unavailable
        if (!this.hubHost || !this.hubStatusPort) {
          console.error(`[SessionObserver] No hub connection info available - skipping status update`);
          return; // Skip this cycle
        }
      }

      // 1. Capture current screen
      const currentScreen = await this.captureTerminal();
      const now = Date.now();

      // 2. Compare with previous screen and determine state
      let state;
      if (currentScreen !== this.lastScreen) {
        // Screen changed - agent is active
        state = 'running';
        this.lastChangeTime = now;
        this.lastScreen = currentScreen;
      } else {
        // Screen unchanged - check if idle long enough
        if (now - this.lastChangeTime > this.IDLE_THRESHOLD) {
          state = 'idle';
        } else {
          state = 'running';
        }
      }

      // 3. Always update hub with current screen and state
      await this.updateHubState(state, currentScreen);

    } catch (tmuxError) {
      console.error('[SessionObserver] Tmux capture failed:', tmuxError.message);
      
      // Try to report the error to hub
      try {
        await this.postToHub({
          agent_id: this.agentId,
          state: 'error',
          error: tmuxError.message,
          timestamp: new Date().toISOString()
        });
      } catch (hubError) {
        console.error('[SessionObserver] Failed to report error to hub:', hubError.message);
      }
    }
  }

  start() {
    if (this.running) {
      console.log('[SessionObserver] Observer already running');
      return;
    }

    this.running = true;
    console.log('[SessionObserver] Starting activity monitoring...');

    // Set interval for checkActivity
    this.pollTimer = setInterval(() => {
      this.checkActivity().catch(error => {
        console.error('[SessionObserver] Error in activity check:', error.message);
      });
    }, this.POLL_INTERVAL);

    // Handle graceful shutdown on SIGTERM/SIGINT
    const shutdown = async (signal) => {
      console.log(`[SessionObserver] Received ${signal}, shutting down gracefully...`);
      this.running = false;
      
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }

      // Send final status update
      try {
        await this.postToHub({
          agent_id: this.agentId,
          state: 'stopped',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        console.error('[SessionObserver] Failed to send final status:', error.message);
      }

      console.log('[SessionObserver] Shutdown complete');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Initial activity check
    this.checkActivity().catch(error => {
      console.error('[SessionObserver] Error in initial activity check:', error.message);
    });
  }

  async loadIssueContext() {
    try {
      const issueJsonPath = '/data/thopter/issue.json';
      if (fs.existsSync(issueJsonPath)) {
        const issueData = fs.readFileSync(issueJsonPath, 'utf8');
        this.issueContext = JSON.parse(issueData);
        console.log('[SessionObserver] Issue context loaded from /data/thopter/issue.json');
      } else {
        console.log('[SessionObserver] No issue.json found, observer will report basic status only');
      }
    } catch (error) {
      console.warn('[SessionObserver] Failed to load issue context:', error.message);
    }
  }

  async stop() {
    if (!this.running) {
      return;
    }

    console.log('[SessionObserver] Stopping observer...');
    this.running = false;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}

// Main execution
async function main() {
  const observer = new SessionObserver();
  
  try {
    await observer.initialize();
    observer.start();
  } catch (error) {
    console.error('[SessionObserver] Failed to start:', error);
    process.exit(1);
  }
}

// Only run if this is the main module
if (require.main === module) {
  main();
}

module.exports = SessionObserver;