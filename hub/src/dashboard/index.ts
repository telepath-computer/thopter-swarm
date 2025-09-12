import express, { Request, Response, Router } from 'express';
import path from 'path';
import { stateManager } from '../lib/state-manager';
import { logger } from '../lib/logger';
import { AgentManager } from '../lib/agent-manager';
import * as utils from '../lib/utils';
import { categorizeThopters, groupThoptersByUser, getOrphanStatus, getWorkBranch, getWebTerminalUrl, getRepository } from '../lib/thopter-utils';

// Create dashboard router
const router = Router();

// Store agent manager reference
let agentManager: AgentManager | null = null;

// Configure EJS template engine
export function setupDashboard(app: express.Application, manager?: AgentManager): void {
  if (manager) {
    agentManager = manager;
  }
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
    const thopters = stateManager.getAllThopters();
    const goldenClaudes = stateManager.getAllGoldenClaudes();
    const provisionRequests = stateManager.getRecentProvisionRequests(5);
    const destroyRequests = stateManager.getRecentDestroyRequests(5);
    const logs = stateManager.getRecentLogs(50);
    const operatingMode = stateManager.getOperatingMode();
    
    // Categorize thopters by status (healthy, orphaned, stopped)
    const categorizedThopters = categorizeThopters(thopters);
    
    // Group thopters by mentionAuthor (the user who created them)
    const healthyThoptersByUser = groupThoptersByUser(categorizedThopters.healthyThopters);
    const orphanedThoptersByUser = groupThoptersByUser(categorizedThopters.orphanedThopters);
    const stoppedThoptersByUser = groupThoptersByUser(categorizedThopters.stoppedThopters);
    
    // Create grouped data for template
    const healthyGroups = Array.from(healthyThoptersByUser.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([user, thopters]) => ({ user, thopters }));
    
    const orphanedGroups = Array.from(orphanedThoptersByUser.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([user, thopters]) => ({ user, thopters }));
      
    const stoppedGroups = Array.from(stoppedThoptersByUser.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([user, thopters]) => ({ user, thopters }));
    
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
      thopters,
      healthyGroups,
      orphanedGroups, 
      stoppedGroups,
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
      },
      helpers: {
        getOrphanStatus,
        getWorkBranch,
        getWebTerminalUrl,
        getRepository
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
 * Thopter detail page
 */
router.get('/agent/:id', (req: Request, res: Response) => {
  try {
    const thopterId = req.params.id;
    const thopter = stateManager.getThopter(thopterId);
    
    if (!thopter) {
      res.status(404).render('error', {
        error: 'Thopter not found',
        details: `Thopter with ID ${thopterId} was not found`
      });
      return;
    }
    
    res.render('agent-detail', {
      agent: thopter, // Keep 'agent' name for template compatibility
      thopter,
      formatters: {
        relativeTime: utils.formatRelativeTime,
        absoluteTime: utils.formatAbsoluteTime,
        stateClass: utils.getStateClass,
        idleDuration: utils.formatIdleDuration,
        truncateText: utils.truncateText,
        gitHubUrl: utils.getGitHubUrl,
        terminalUrl: (thopterId: string) => `http://${thopterId}.vm.${process.env.APP_NAME}.internal:${process.env.WEB_TERMINAL_PORT || '7681'}/`,
        sessionLogUrl: (thopterId: string) => `http://${thopterId}.vm.${process.env.APP_NAME}.internal:7791/`
      },
      helpers: {
        getOrphanStatus,
        getWorkBranch,
        getWebTerminalUrl,
        getRepository
      }
    });
    
  } catch (error) {
    logger.error(`Thopter detail render error: ${error instanceof Error ? error.message : String(error)}`, req.params.id, 'dashboard');
    res.status(500).render('error', {
      error: 'Failed to load thopter details',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * Kill thopter endpoint
 */
router.post('/agent/:id/kill', (req: Request, res: Response) => {
  try {
    const thopterId = req.params.id;
    const thopter = stateManager.getThopter(thopterId);
    
    if (!thopter) {
      res.status(404).render('error', {
        error: 'Thopter not found',
        details: `Thopter with ID ${thopterId} was not found`
      });
      return;
    }
    
    // Check if agent manager is available
    if (!agentManager) {
      res.status(500).render('error', {
        error: 'Service unavailable',
        details: 'Agent manager is not available. Please try again later.'
      });
      return;
    }
    
    // Set kill requested flag
    stateManager.setKillRequested(thopterId, true);
    
    // Create destroy request via agent manager (this now prevents duplicates)
    const requestId = agentManager.createDestroyRequest(thopterId, 'dashboard', 'Manual kill request from dashboard');
    
    if (!requestId) {
      // Agent manager refused the request (already killing or duplicate request)
      logger.warn(`Kill request refused for thopter ${thopterId} - may already be killing`, thopterId, 'dashboard');
      res.redirect('/?warning=thopter-already-killing');
      return;
    }
    
    logger.info(`Kill request created for thopter ${thopterId}: ${requestId}`, thopterId, 'dashboard');
    
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
 * Pause thopter processing
 */
router.post('/control/pause', (req: Request, res: Response) => {
  try {
    const currentMode = stateManager.getOperatingMode();
    
    if (currentMode === 'running') {
      stateManager.setOperatingMode('paused');
      logger.info('Thopter processing paused via dashboard', undefined, 'dashboard');
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
 * Resume thopter processing  
 */
router.post('/control/resume', (req: Request, res: Response) => {
  try {
    const currentMode = stateManager.getOperatingMode();
    
    if (currentMode === 'paused') {
      stateManager.setOperatingMode('running');
      logger.info('Thopter processing resumed via dashboard', undefined, 'dashboard');
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