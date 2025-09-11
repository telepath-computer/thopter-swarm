import express, { Request, Response, Router } from 'express';
import path from 'path';
import { stateManager } from '../lib/state-manager';
import { logger } from '../lib/logger';
import * as utils from '../lib/utils';

// Create dashboard router
const router = Router();

// Configure EJS template engine
export function setupDashboard(app: express.Application): void {
  // Set view engine and views directory
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '../../views'));
  
  // Serve static files
  app.use('/styles.css', express.static(path.join(__dirname, '../../public/styles.css')));
  
  // Mount dashboard routes
  app.use('/', router);
}

/**
 * Main dashboard route
 */
router.get('/', (req: Request, res: Response) => {
  try {
    const agents = stateManager.getAllAgents();
    const goldenClaudes = stateManager.getAllGoldenClaudes();
    const provisionRequests = stateManager.getRecentProvisionRequests(5);
    const destroyRequests = stateManager.getRecentDestroyRequests(5);
    const logs = stateManager.getRecentLogs(50);
    const operatingMode = stateManager.getOperatingMode();
    
    // Group agents by mentionAuthor (the user who created them)
    const agentsByUser = new Map<string, typeof agents>();
    for (const agent of agents) {
      const mentionAuthor = agent.github?.mentionAuthor || 'unknown';
      if (!agentsByUser.has(mentionAuthor)) {
        agentsByUser.set(mentionAuthor, []);
      }
      agentsByUser.get(mentionAuthor)!.push(agent);
    }
    
    // Convert to array of groups, sorted by username
    const agentGroups = Array.from(agentsByUser.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([user, userAgents]) => ({
        user,
        agents: userAgents
      }));
    
    // Sort requests by creation date (newest first)
    provisionRequests.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    destroyRequests.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    
    // Sort logs by timestamp (newest first)  
    logs.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    
    // Prepare test form data
    const configuredRepos = stateManager.getConfiguredRepositories();
    const testRepository = configuredRepos[0] || 'test/repo';
    const testIssueNumber = Math.floor(Math.random() * 1000) + 1;
    
    res.render('dashboard', {
      agents,
      agentGroups,
      goldenClaudes,
      provisionRequests,
      destroyRequests,
      logs,
      operatingMode,
      testRepository,
      configuredRepositories: configuredRepos,
      testIssueNumber,
      formatters: {
        relativeTime: utils.formatRelativeTime,
        absoluteTime: utils.formatAbsoluteTime,
        stateClass: utils.getStateClass,
        modeClass: utils.getModeClass,
        requestStatusClass: utils.getRequestStatusClass,
        logLevelClass: utils.getLogLevelClass,
        idleDuration: utils.formatIdleDuration,
        truncateText: utils.truncateText,
        gitHubUrl: utils.getGitHubUrl
      }
    });
    
  } catch (error) {
    logger.error(`Dashboard render error: ${error instanceof Error ? error.message : String(error)}`, undefined, 'dashboard');
    res.status(500).render('error', {
      error: 'Failed to load dashboard',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * Agent detail page
 */
router.get('/agent/:id', (req: Request, res: Response) => {
  try {
    const agentId = req.params.id;
    const agent = stateManager.getAgent(agentId);
    
    if (!agent) {
      res.status(404).render('error', {
        error: 'Agent not found',
        details: `Agent with ID ${agentId} was not found`
      });
      return;
    }
    
    res.render('agent-detail', {
      agent,
      formatters: {
        relativeTime: utils.formatRelativeTime,
        absoluteTime: utils.formatAbsoluteTime,
        stateClass: utils.getStateClass,
        idleDuration: utils.formatIdleDuration,
        truncateText: utils.truncateText,
        gitHubUrl: utils.getGitHubUrl,
        terminalUrl: (agentId: string) => `http://${agentId}.vm.${process.env.APP_NAME}.internal:${process.env.WEB_TERMINAL_PORT || '7681'}/`,
        sessionLogUrl: (agentId: string) => `http://${agentId}.vm.${process.env.APP_NAME}.internal:7791/`
      }
    });
    
  } catch (error) {
    logger.error(`Agent detail render error: ${error instanceof Error ? error.message : String(error)}`, req.params.id, 'dashboard');
    res.status(500).render('error', {
      error: 'Failed to load agent details',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * Kill agent endpoint
 */
router.post('/agent/:id/kill', (req: Request, res: Response) => {
  try {
    const agentId = req.params.id;
    const agent = stateManager.getAgent(agentId);
    
    if (!agent) {
      res.status(404).render('error', {
        error: 'Agent not found',
        details: `Agent with ID ${agentId} was not found`
      });
      return;
    }
    
    // Create destroy request via agent manager (we'll need to pass this through the main app)
    // For now, we'll add the request directly
    const requestId = utils.generateRequestId('destroy');
    const destroyRequest = {
      requestId,
      source: 'dashboard' as const,
      createdAt: new Date(),
      status: 'pending' as const,
      agentId,
      reason: 'Manual kill request from dashboard'
    };
    
    stateManager.addDestroyRequest(destroyRequest);
    
    logger.info(`Kill request created for agent ${agentId}`, agentId, 'dashboard');
    
    // Redirect back to dashboard
    res.redirect('/');
    
  } catch (error) {
    logger.error(`Kill request error: ${error instanceof Error ? error.message : String(error)}`, req.params.id, 'dashboard');
    res.status(500).render('error', {
      error: 'Failed to create kill request',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});


/**
 * Pause agent processing
 */
router.post('/control/pause', (req: Request, res: Response) => {
  try {
    const currentMode = stateManager.getOperatingMode();
    
    if (currentMode === 'running') {
      stateManager.setOperatingMode('paused');
      logger.info('Agent processing paused via dashboard', undefined, 'dashboard');
    } else {
      logger.warn(`Cannot pause from ${currentMode} mode`, undefined, 'dashboard');
    }
    
    res.redirect('/');
    
  } catch (error) {
    logger.error(`Pause control error: ${error instanceof Error ? error.message : String(error)}`, undefined, 'dashboard');
    res.status(500).render('error', {
      error: 'Failed to pause processing',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * Resume agent processing  
 */
router.post('/control/resume', (req: Request, res: Response) => {
  try {
    const currentMode = stateManager.getOperatingMode();
    
    if (currentMode === 'paused') {
      stateManager.setOperatingMode('running');
      logger.info('Agent processing resumed via dashboard', undefined, 'dashboard');
    } else {
      logger.warn(`Cannot resume from ${currentMode} mode`, undefined, 'dashboard');
    }
    
    res.redirect('/');
    
  } catch (error) {
    logger.error(`Resume control error: ${error instanceof Error ? error.message : String(error)}`, undefined, 'dashboard');
    res.status(500).render('error', {
      error: 'Failed to resume processing',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

export { router as dashboardRouter };