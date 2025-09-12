import express from 'express';
import { ThopterProvisioner } from './lib/provisioner';
import { AgentManager } from './lib/agent-manager';
import { stateManager } from './lib/state-manager';
import { metadataClient } from './lib/metadata-client';
import { gitHubPollingManager } from './lib/github-polling-manager';
import { logger } from './lib/logger';
import { setupDashboard } from './dashboard';
import { handleStatusUpdate, handleHealthCheck } from './collector';

const hubPort = parseInt(process.env.HUB_PORT || '8080');
const statusPort = parseInt(process.env.HUB_STATUS_PORT || '8081');

async function startHub() {
  try {
    logger.info('Starting Thopter Swarm Hub', undefined, 'hub');
    
    // Phase 1: Initialize [operatingMode: 'initializing']
    logger.info('Phase 1: Initializing services', undefined, 'hub');
    
    // Create provisioner and agent manager (no async operations)
    const provisioner = new ThopterProvisioner();
    const agentManager = new AgentManager({ provisioner });
    
    // Setup signal handlers early
    const gracefulShutdown = (signal: string) => {
      logger.info(`Received ${signal}, initiating graceful shutdown`, undefined, 'hub');
      
      // Tell components to shutdown
      stateManager.handleShutdownWithCleanup();
      agentManager.handleShutdown();
      gitHubPollingManager.stop();
      
      // Disconnect from metadata service
      metadataClient.disconnect().catch((error) => {
        logger.warn(`Error disconnecting from metadata service: ${error}`, undefined, 'hub');
      });
      
      // Give some time for shutdown
      setTimeout(() => {
        logger.info('Graceful shutdown complete', undefined, 'hub');
        process.exit(0);
      }, 2000);
    };
    
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    
    // Phase 2: Bootstrap [operatingMode: 'starting'] 
    logger.info('Phase 2: Starting bootstrap sequence', undefined, 'hub');
    stateManager.setOperatingMode('starting');
    
    // Connect to metadata service (required for provisioning)
    logger.info('Connecting to metadata service', undefined, 'hub');
    try {
      await metadataClient.connect();
      await metadataClient.validateRequiredValues();
      logger.info('Metadata service connection established', undefined, 'hub');
    } catch (error) {
      logger.error(`Failed to connect to metadata service: ${error instanceof Error ? error.message : String(error)}`, undefined, 'hub');
      throw new Error(`Metadata service connection failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    // Bootstrap state manager from fly.io (required)
    logger.info('Bootstrapping state from fly.io machines', undefined, 'hub');
    await stateManager.bootstrap();
    logger.info('State bootstrap completed successfully', undefined, 'hub');
    
    // Phase 3: Service Activation
    logger.info('Phase 3: Starting services', undefined, 'hub');
    
    // Start agent manager processing loop
    agentManager.start();
    logger.info('Agent manager processing loop started', undefined, 'hub');
    
    // Configure and start GitHub polling
    gitHubPollingManager.setAgentManager(agentManager);
    gitHubPollingManager.start();
    logger.info('GitHub polling manager started', undefined, 'hub');
    
    // Phase 4: Server Startup
    logger.info('Phase 4: Starting HTTP servers', undefined, 'hub');
    
    // Setup main hub server (dashboard, etc.)
    const hubApp = express();
    hubApp.use(express.json());
    hubApp.use(express.urlencoded({ extended: true }));
    
    // Setup dashboard with EJS templates
    setupDashboard(hubApp, agentManager);
    
    // Health check endpoint
    hubApp.get('/health', (req, res) => {
      const stats = stateManager.getStats();
      res.json({ 
        status: 'ok', 
        service: 'thopter-swarm-hub',
        operatingMode: stateManager.getOperatingMode(),
        stats
      });
    });
    
    // Provision endpoint for testing (will be replaced by GitHub integration)
    hubApp.post('/provision', async (req, res) => {
      try {
        // Only accept requests when system is running
        const currentMode = stateManager.getOperatingMode();
        if (currentMode !== 'running') {
          res.status(503).json({
            error: `System not ready, current mode: ${currentMode}`,
            retry_after: 5
          });
          return;
        }
        
        logger.info('Provision request received', undefined, 'hub', req.body);
        
        const { repository, github, gc = 'default', prompt } = req.body;
        
        // Validate required fields
        if (!repository || !github?.issueNumber || !github?.issueTitle || !github?.issueBody) {
          res.status(400).json({
            error: 'Missing required fields: repository, github.issueNumber, github.issueTitle, github.issueBody'
          });
          return;
        }
        
        // Create provision request via agent manager
        const requestId = agentManager.createProvisionRequest(repository, github, undefined, gc, prompt);
        
        res.json({
          success: true,
          requestId,
          message: `Provision request ${requestId} created successfully`
        });
        
      } catch (error) {
        logger.error(`Provision endpoint error: ${error instanceof Error ? error.message : String(error)}`, undefined, 'hub');
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });
    
    // Setup status collector server (separate port)
    const statusApp = express();
    statusApp.use(express.json());
    
    // Status collector endpoints
    statusApp.post('/status', handleStatusUpdate);
    statusApp.get('/health', handleHealthCheck);
    
    // Start both servers
    hubApp.listen(hubPort, '::', () => {
      logger.info(`Hub server started on port ${hubPort}`, undefined, 'hub');
      console.log(`Dashboard: http://localhost:${hubPort}/`);
    });
    
    statusApp.listen(statusPort, '::', () => {
      logger.info(`Status collector started on port ${statusPort}`, undefined, 'hub');
      console.log(`Status endpoint: http://localhost:${statusPort}/status`);
    });
    
    // Phase 5: Ready State [operatingMode: 'running']
    logger.info('Phase 5: System ready', undefined, 'hub');
    stateManager.setOperatingMode('running');
    logger.info('Thopter Swarm Hub fully initialized and running', undefined, 'hub');
    
  } catch (error) {
    logger.error(`Hub startup failed: ${error instanceof Error ? error.message : String(error)}`, undefined, 'hub');
    console.error('Hub startup failed:', error);
    process.exit(1);
  }
}

// Start the hub
startHub().catch((error) => {
  console.error('Failed to start hub:', error);
  process.exit(1);
});
