#!/usr/bin/env node

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { exec } = require('child_process');
const { promisify } = require('util');
const http = require('http');
const fs = require('fs');

const execAsync = promisify(exec);

class GitProxyMCPServer {
  constructor() {
    this.server = new Server(
      {
        name: "git-proxy",
        version: "1.0.0"
      },
      {
        capabilities: {
          tools: {}
        }
      }
    );
    
    // Check if running in golden claude mode
    this.isGoldenClaude = process.env.IS_GOLDEN_CLAUDE === 'true';
    this.bareRepoPath = '/data/root/thopter-repo';
    this.workBranch = process.env.WORK_BRANCH;
    
    if (this.isGoldenClaude) {
      this.log("Running in golden claude mode - git operations disabled");
    } else {
      this.log(`Git proxy initialized with work branch: ${this.workBranch}`);
    }
    
    this.setupHandlers();
    this.setupErrorHandlers();
  }

  log(message) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [git-proxy] ${message}`);
  }

  setupErrorHandlers() {
    process.on('uncaughtException', (error) => {
      this.log(`Uncaught exception: ${error.message}`);
      console.error(error);
    });

    process.on('unhandledRejection', (reason, promise) => {
      this.log(`Unhandled rejection at: ${promise}, reason: ${reason}`);
    });
  }

  setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "fetch",
            description: "Fetch latest changes from GitHub repository",
            inputSchema: {
              type: "object",
              properties: {},
              required: []
            }
          },
          {
            name: "push", 
            description: "Push commits to the designated work branch on GitHub",
            inputSchema: {
              type: "object",
              properties: {},
              required: []
            }
          }
        ]
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name } = request.params;
      
      this.log(`Received request for tool: ${name}`);
      
      if (this.isGoldenClaude) {
        return {
          content: [
            {
              type: "text",
              text: "Git operations are disabled in golden claude mode"
            }
          ]
        };
      }

      try {
        switch (name) {
          case "fetch":
            return await this.handleFetch();
          case "push":
            return await this.handlePush();
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        this.log(`Error handling tool ${name}: ${error.message}`);
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error.message}`
            }
          ]
        };
      }
    });
  }

  async handleFetch() {
    try {
      // Check if repository exists
      if (!fs.existsSync(this.bareRepoPath)) {
        const errorMsg = `Repository not found at ${this.bareRepoPath}`;
        this.log(errorMsg);
        return {
          content: [
            {
              type: "text",
              text: errorMsg
            }
          ]
        };
      }

      this.log(`Executing: git fetch`);
      
      const { stdout, stderr } = await execAsync('git fetch', {
        cwd: this.bareRepoPath,
        timeout: 30000 // 30 second timeout
      });

      // Log the output
      if (stdout) {
        this.log(`git fetch stdout: ${stdout}`);
      }
      if (stderr) {
        this.log(`git fetch stderr: ${stderr}`);
      }

      return {
        content: [
          {
            type: "text",
            text: `Fetch completed successfully.\nStdout: ${stdout}\nStderr: ${stderr}`
          }
        ]
      };
    } catch (error) {
      this.log(`git fetch failed: ${error.message}`);
      return {
        content: [
          {
            type: "text",
            text: `Fetch failed: ${error.message}`
          }
        ]
      };
    }
  }

  async handlePush() {
    try {
      // Check if repository exists
      if (!fs.existsSync(this.bareRepoPath)) {
        const errorMsg = `Repository not found at ${this.bareRepoPath}`;
        this.log(errorMsg);
        return {
          content: [
            {
              type: "text",
              text: errorMsg
            }
          ]
        };
      }

      // Check if work branch is set
      if (!this.workBranch) {
        const errorMsg = "WORK_BRANCH environment variable not set";
        this.log(errorMsg);
        return {
          content: [
            {
              type: "text", 
              text: errorMsg
            }
          ]
        };
      }

      const command = `git push origin ${this.workBranch}`;
      this.log(`Executing: ${command}`);
      
      const { stdout, stderr } = await execAsync(command, {
        cwd: this.bareRepoPath,
        timeout: 60000 // 60 second timeout for push operations
      });

      // Log the output
      if (stdout) {
        this.log(`git push stdout: ${stdout}`);
      }
      if (stderr) {
        this.log(`git push stderr: ${stderr}`);
      }

      return {
        content: [
          {
            type: "text",
            text: `Push completed successfully to branch ${this.workBranch}.\nStdout: ${stdout}\nStderr: ${stderr}`
          }
        ]
      };
    } catch (error) {
      this.log(`git push failed: ${error.message}`);
      return {
        content: [
          {
            type: "text",
            text: `Push failed: ${error.message}`
          }
        ]
      };
    }
  }

  async startHttpServer() {
    return new Promise((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        // Enable CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        
        if (req.method === 'OPTIONS') {
          res.writeHead(200);
          res.end();
          return;
        }

        if (req.method !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        let body = '';
        req.on('data', chunk => {
          body += chunk.toString();
        });

        req.on('end', async () => {
          try {
            const request = JSON.parse(body);
            
            // Handle MCP request
            let response;
            if (request.method === 'tools/list') {
              const listResponse = await this.server.request(request, null);
              response = listResponse;
            } else if (request.method === 'tools/call') {
              const callResponse = await this.server.request(request, null);
              response = callResponse;
            } else {
              response = {
                error: {
                  code: -32601,
                  message: 'Method not found'
                }
              };
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(response));
          } catch (error) {
            this.log(`HTTP request error: ${error.message}`);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal server error' }));
          }
        });
      });

      server.listen(8777, '::', (error) => {
        if (error) {
          reject(error);
        } else {
          this.log('Git proxy MCP server started on port 8777');
          resolve();
        }
      });

      server.on('error', (error) => {
        this.log(`HTTP server error: ${error.message}`);
      });
    });
  }
}

// Start the server
async function main() {
  try {
    const gitProxy = new GitProxyMCPServer();
    await gitProxy.startHttpServer();
    
    // Keep the process running
    process.on('SIGTERM', () => {
      gitProxy.log('Received SIGTERM, shutting down gracefully');
      process.exit(0);
    });
    
    process.on('SIGINT', () => {
      gitProxy.log('Received SIGINT, shutting down gracefully');
      process.exit(0);
    });
    
  } catch (error) {
    console.error('Failed to start git proxy MCP server:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}