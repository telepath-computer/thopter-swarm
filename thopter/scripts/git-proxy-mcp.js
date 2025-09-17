#!/usr/bin/env node

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');
const http = require('http');

const execAsync = promisify(exec);

// Repository path
const REPO_PATH = '/root/thopter-repo';

// Helper function to format timestamps
function getTimestamp() {
  return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

// Helper function to log with timestamp
function log(message) {
  console.log(`[${getTimestamp()}] ${message}`);
}

// Helper function to check if repository exists
async function checkRepoExists() {
  try {
    await fs.access(REPO_PATH);
    const stats = await fs.stat(REPO_PATH);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

// Helper function to execute git commands safely
async function executeGitCommand(command, commandDescription) {
  log(`Executing: ${commandDescription}`);
  
  try {
    // Check if repository exists first
    const repoExists = await checkRepoExists();
    if (!repoExists) {
      const error = `Repository does not exist at ${REPO_PATH}`;
      log(`Error: ${error}`);
      return { success: false, output: error };
    }

    // Execute the git command
    const { stdout, stderr } = await execAsync(command, {
      cwd: REPO_PATH,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large outputs
    });

    // Log output
    if (stdout) {
      log(`stdout: ${stdout}`);
    }
    if (stderr) {
      log(`stderr: ${stderr}`);
    }

    log(`${commandDescription} completed successfully`);
    return {
      success: true,
      output: `stdout:\n${stdout || '(empty)'}\n\nstderr:\n${stderr || '(empty)'}`
    };
  } catch (error) {
    // Log error details
    log(`Error during ${commandDescription}: ${error.message}`);
    if (error.stdout) {
      log(`stdout: ${error.stdout}`);
    }
    if (error.stderr) {
      log(`stderr: ${error.stderr}`);
    }

    return {
      success: false,
      output: `Error: ${error.message}\n\nstdout:\n${error.stdout || '(empty)'}\n\nstderr:\n${error.stderr || '(empty)'}`
    };
  }
}

// Create MCP server
const server = new Server(
  {
    name: 'git-proxy',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle list tools request
server.setRequestHandler('tools/list', async () => {
  return {
    tools: [
      {
        name: 'fetch',
        description: 'Fetch latest changes from GitHub',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'push',
        description: 'Push changes to the designated work branch',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler('tools/call', async (request) => {
  const { name } = request.params;
  
  log(`Received request for tool: ${name}`);

  try {
    if (name === 'fetch') {
      // Execute git fetch
      const result = await executeGitCommand('git fetch origin', 'git fetch origin');
      
      return {
        content: [
          {
            type: 'text',
            text: result.output,
          },
        ],
      };
    } else if (name === 'push') {
      // Get work branch from environment
      const workBranch = process.env.WORK_BRANCH;
      
      if (!workBranch) {
        const error = 'WORK_BRANCH environment variable is not set';
        log(`Error: ${error}`);
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error}`,
            },
          ],
        };
      }

      // Execute git push to specific branch
      const command = `git push origin ${workBranch}`;
      const result = await executeGitCommand(command, command);
      
      return {
        content: [
          {
            type: 'text',
            text: result.output,
          },
        ],
      };
    } else {
      const error = `Unknown tool: ${name}`;
      log(`Error: ${error}`);
      return {
        content: [
          {
            type: 'text',
            text: error,
          },
        ],
      };
    }
  } catch (error) {
    // This should never happen due to our error handling, but just in case
    log(`Unexpected error handling tool ${name}: ${error.message}`);
    return {
      content: [
        {
          type: 'text',
          text: `Unexpected error: ${error.message}`,
        },
      ],
    };
  }
});

// Set up HTTP server for cross-user communication
async function startHttpServer() {
  const PORT = 8777;

  // Create an HTTP server that wraps our MCP server
  const httpServer = http.createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end('Method not allowed');
      return;
    }

    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const message = JSON.parse(body);
        
        // Route the message to the appropriate handler
        if (message.method === 'tools/list') {
          const response = await server._requestHandlers.get('tools/list')();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response));
        } else if (message.method === 'tools/call') {
          const response = await server._requestHandlers.get('tools/call')(message);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response));
        } else {
          res.writeHead(400);
          res.end('Unknown method');
        }
      } catch (error) {
        log(`Error processing request: ${error.message}`);
        res.writeHead(500);
        res.end(JSON.stringify({ error: error.message }));
      }
    });
  });

  httpServer.listen(PORT, '::', () => {
    log(`Git proxy MCP server started on port ${PORT}`);
  });

  // Also listen on IPv4 if needed
  httpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      log('Port already in use, server may already be running');
    } else {
      log(`HTTP server error: ${err.message}`);
    }
  });
}

// Error handlers to ensure server never crashes
process.on('uncaughtException', (error) => {
  log(`Uncaught exception: ${error.message}`);
  log(error.stack);
  // Keep the process running
});

process.on('unhandledRejection', (reason, promise) => {
  log(`Unhandled rejection at: ${promise}, reason: ${reason}`);
  // Keep the process running
});

// Start the server
async function main() {
  try {
    log('Starting git proxy MCP server...');
    
    // Check initial repository status
    const repoExists = await checkRepoExists();
    if (!repoExists) {
      log(`Warning: Repository does not exist at ${REPO_PATH}`);
      log('Server will continue running but git operations will fail until repository is created');
    } else {
      log(`Repository found at ${REPO_PATH}`);
    }

    // Check WORK_BRANCH environment variable
    if (!process.env.WORK_BRANCH) {
      log('Warning: WORK_BRANCH environment variable is not set');
      log('Push operations will fail until WORK_BRANCH is set');
    } else {
      log(`WORK_BRANCH is set to: ${process.env.WORK_BRANCH}`);
    }

    // Start HTTP server
    await startHttpServer();
  } catch (error) {
    log(`Failed to start server: ${error.message}`);
    log(error.stack);
    // Even if startup fails, keep the process running
    log('Server will remain running despite startup errors');
  }
}

// Run the server
main();