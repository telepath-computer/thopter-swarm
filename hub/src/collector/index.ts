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
    
    // Validate required fields
    if (!statusUpdate.thopter_id) {
      res.status(400).json({ error: 'Missing required field: thopter_id' });
      return;
    }
    
    if (!statusUpdate.state) {
      res.status(400).json({ error: 'Missing required field: state' });
      return;
    }
    
    if (!['running', 'idle'].includes(statusUpdate.state)) {
      res.status(400).json({ error: 'Invalid state. Must be "running" or "idle"' });
      return;
    }
    
    // Log the status update (silenced for debugging)
    // logger.debug(
    //   `Status update received: ${statusUpdate.state}`,
    //   statusUpdate.agent_id,
    //   'collector',
    //   { 
    //     hasGithubContext: !!statusUpdate.github,
    //     repository: statusUpdate.repository,
    //     screenLength: statusUpdate.screen_dump?.length || 0
    //   }
    // );
    
    // Update state manager with the status
    stateManager.updateThopterFromStatus(statusUpdate);
    
    // Respond with success
    res.json({ 
      received: true, 
      timestamp: new Date().toISOString(),
      thopter_id: statusUpdate.thopter_id,
      state: statusUpdate.state
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