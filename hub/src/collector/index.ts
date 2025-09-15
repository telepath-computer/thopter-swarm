import { Request, Response } from 'express';
import { ThopterStatusUpdate } from '../lib/types';
import { stateManager } from '../lib/state-manager';
import { logger } from '../lib/logger';

/**
 * Handle POST /status requests from thopter observers
 * This is the main entry point for status updates from thopters
 */
export function handleStatusUpdate(req: Request, res: Response): void {
  try {
    const statusUpdate: ThopterStatusUpdate = req.body;
    
    // Validate required fields - ALL camelCase
    if (!statusUpdate.thopterId) {
      res.status(400).json({ error: 'Missing required field: thopterId' });
      return;
    }
    
    if (!statusUpdate.tmuxState) {
      res.status(400).json({ error: 'Missing required field: tmuxState' });
      return;
    }
    
    if (!['active', 'idle'].includes(statusUpdate.tmuxState)) {
      res.status(400).json({ error: 'Invalid tmuxState. Must be "active" or "idle"' });
      return;
    }
    
    if (!statusUpdate.claudeProcess) {
      res.status(400).json({ error: 'Missing required field: claudeProcess' });
      return;
    }
    
    if (!['running', 'notFound'].includes(statusUpdate.claudeProcess)) {
      res.status(400).json({ error: 'Invalid claudeProcess. Must be "running" or "notFound"' });
      return;
    }
    
    // Log the status update for debugging
    // logger.info(
    //   `Status update received: ${statusUpdate.state}`,
    //   statusUpdate.thopter_id,
    //   'collector',
    //   { 
    //     hasGithubContext: !!statusUpdate.github,
    //     repository: statusUpdate.repository,
    //     githubRepository: statusUpdate.github?.repository,
    //     screenLength: statusUpdate.screen_dump?.length || 0
    //   }
    // );
    
    // Update state manager with the status
    stateManager.updateThopterFromStatus(statusUpdate);
    
    // Respond with success
    res.json({ 
      received: true, 
      timestamp: new Date().toISOString(),
      thopterId: statusUpdate.thopterId,
      tmuxState: statusUpdate.tmuxState,
      claudeProcess: statusUpdate.claudeProcess
    });
    
  } catch (error) {
    logger.error(
      `Status update processing failed: ${error instanceof Error ? error.message : String(error)}`,
      req.body?.thopter_id,
      'collector'
    );
    
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * Health check endpoint for the status collector
 */
export function handleHealthCheck(req: Request, res: Response): void {
  res.json({ 
    status: 'ok', 
    service: 'thopter-swarm-status-collector',
    timestamp: new Date().toISOString(),
    operatingMode: stateManager.getOperatingMode()
  });
}
