import { OperatingMode, ProvisionRequest, DestroyRequest } from './types';
import { stateManager } from './state-manager';
import { logger } from './logger';
import { generateRequestId } from './utils';

export interface AgentManagerConfig {
  provisioner: any; // Will be ThopterProvisioner instance
}

export class AgentManager {
  private provisioner: any;
  private processingLoop: NodeJS.Timeout | null = null;
  private activeDestroyOperations: Set<string> = new Set();
  private readonly maxConcurrentDestroys: number;
  private readonly maxThopters: number;
  
  constructor(config: AgentManagerConfig) {
    this.provisioner = config.provisioner;
    this.maxConcurrentDestroys = parseInt(process.env.MAX_CONCURRENT_DESTROYS || '5');
    this.maxThopters = parseInt(process.env.MAX_THOPTERS || process.env.MAX_AGENTS || '10');
    logger.info(`Agent manager initialized with max concurrent destroys: ${this.maxConcurrentDestroys}, max thopters: ${this.maxThopters}`, undefined, 'agent-manager');
  }
  
  /**
   * Start the agent manager - begins processing based on current state
   */
  start(): void {
    if (this.processingLoop) {
      logger.warn('Agent manager processing loop already started', undefined, 'agent-manager');
      return;
    }
    
    logger.info(`Starting agent manager processing loop`, undefined, 'agent-manager');
    
    // Start the main processing loop
    this.startProcessingLoop();
  }
  
  /**
   * Main processing loop - runs continuously with 100ms intervals
   */
  private startProcessingLoop(): void {
    const processLoop = async () => {
      try {
        const currentMode = stateManager.getOperatingMode();
        
        // Exit loop if stopping
        if (currentMode === 'stopping') {
          logger.info('Processing loop exiting due to stopping mode', undefined, 'agent-manager');
          return;
        }
        
        // Only process requests when in running mode
        if (currentMode === 'running') {
          await this.processRequests();
        } else {
          //logger.debug(`Skipping request processing, mode: ${currentMode}`, undefined, 'agent-manager');
        }
        
        // Schedule next iteration
        this.processingLoop = setTimeout(processLoop, 100);
        
      } catch (error) {
        logger.error(`Processing loop error: ${error instanceof Error ? error.message : String(error)}`, undefined, 'agent-manager');
        
        // Continue loop despite errors, slower
        this.processingLoop = setTimeout(processLoop, 500);
      }
    };
    
    // Start the loop
    processLoop();
  }
  
  /**
   * Process pending requests in priority order (destroy before provision)
   * Destroy requests are processed in parallel, provision requests remain serial
   */
  private async processRequests(): Promise<void> {
    // Priority 1: Process destroy requests (parallel)
    if (this.activeDestroyOperations.size < this.maxConcurrentDestroys) {
      const availableSlots = this.maxConcurrentDestroys - this.activeDestroyOperations.size;
      const destroyRequests = stateManager.getNextPendingDestroyRequests(availableSlots);
      
      for (const destroyRequest of destroyRequests) {
        // Process destroy request asynchronously (fire and forget)
        this.processDestroyRequestAsync(destroyRequest);
      }
    }
    
    // Priority 2: Process provision requests (serial, only if no destroys are queued)
    if (this.activeDestroyOperations.size === 0) {
      const provisionRequest = stateManager.getNextPendingProvisionRequest();
      if (provisionRequest) {
        await this.processProvisionRequest(provisionRequest);
        return; // Only process one provision request per cycle
      }
    }
    
    // No requests to process or destroy operations in progress
    // logger.debug(`No pending requests to process (${this.activeDestroyOperations.size} destroys active)`, undefined, 'agent-manager');
  }
  
  /**
   * Process a provision request
   */
  private async processProvisionRequest(request: ProvisionRequest): Promise<void> {
    const requestId = request.requestId;
    logger.info(`Processing provision request: ${requestId}`, undefined, 'agent-manager');
    
    try {
      // Check capacity using state manager data (authoritative)
      const activeThopters = stateManager.getAllThopters()
        .filter(t => t.fly.machineState === 'started').length;
        
      if (activeThopters >= this.maxThopters) {
        logger.info(`Provision request ${requestId} deferred - at capacity (${activeThopters}/${this.maxThopters})`, undefined, 'agent-manager');
        return; // Keep request pending, retry next cycle
      }
      
      // Update request status to processing
      stateManager.updateProvisionRequest(requestId, {
        status: 'processing'
      });
      
      // Call provisioner with rich ProvisionRequest (no capacity check needed)
      const result = await this.provisioner.provision(request);
      
      // Pre-register GitHub context for any machine that was created (success or partial)
      if (result.machineId && request.github) {
        stateManager.expectThopter(result.machineId, request.github);
      }
      
      if (result.success && result.thopterId && result.machineId && result.region && result.image) {
        // Update request to completed
        stateManager.updateProvisionRequest(requestId, {
          status: 'completed',
          completedAt: new Date(),
          thopterId: result.thopterId
        });
        
        // Add thopter to state with fly information
        // Observer will later populate session state when it reports in
        stateManager.addThopter(
          result.machineId,
          result.machineName || `thopter-${result.thopterId}`,
          result.region,
          result.image,
          request.github
        );
        
        logger.info(`Provision request completed: ${requestId} → thopter ${result.thopterId}`, result.thopterId, 'agent-manager');
        
        // Trigger immediate reconciliation to discover the new thopter
        stateManager.triggerReconciliation().catch(error => {
          logger.warn(`Failed to trigger reconciliation after provisioning: ${error.message}`, result.thopterId, 'agent-manager');
        });
        
      } else {
        // Update request to failed
        stateManager.updateProvisionRequest(requestId, {
          status: 'failed',
          completedAt: new Date(),
          error: result.error
        });
        
        logger.error(`Provision request failed: ${requestId} - ${result.error}`, undefined, 'agent-manager');
      }
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Provision request processing error: ${requestId} - ${errorMessage}`, undefined, 'agent-manager');
      
      // Mark request as failed
      stateManager.updateProvisionRequest(requestId, {
        status: 'failed',
        completedAt: new Date(),
        error: errorMessage
      });
    }
  }
  
  /**
   * Process a destroy request asynchronously
   */
  private async processDestroyRequestAsync(request: DestroyRequest): Promise<void> {
    const requestId = request.requestId;
    const thopterId = request.thopterId;
    
    // Track this destroy operation
    this.activeDestroyOperations.add(requestId);
    
    try {
      await this.processDestroyRequest(request);
    } finally {
      // Always remove from active operations when done
      this.activeDestroyOperations.delete(requestId);
    }
  }
  
  /**
   * Process a destroy request
   */
  private async processDestroyRequest(request: DestroyRequest): Promise<void> {
    const requestId = request.requestId;
    const thopterId = request.thopterId;
    
    logger.info(`Processing destroy request: ${requestId} for thopter ${thopterId} (${this.activeDestroyOperations.size}/${this.maxConcurrentDestroys} concurrent)`, thopterId, 'agent-manager');
    
    try {
      // Update request status to processing
      stateManager.updateDestroyRequest(requestId, {
        status: 'processing'
      });
      
      // Call provisioner destroy method
      const result = await this.provisioner.destroy(thopterId);
      
      if (result.success) {
        // Update request to completed
        stateManager.updateDestroyRequest(requestId, {
          status: 'completed',
          completedAt: new Date()
        });
        
        // Remove thopter from state
        stateManager.removeThopter(thopterId);
        
        logger.info(`Destroy request completed: ${requestId} for thopter ${thopterId}`, thopterId, 'agent-manager');
        
      } else {
        // Update request to failed
        stateManager.updateDestroyRequest(requestId, {
          status: 'failed',
          completedAt: new Date(),
          error: result.error
        });

        // Clear the kill requested flag so the user can try again
        stateManager.setKillRequested(thopterId, false);

        logger.error(`Destroy request failed: ${requestId} for thopter ${thopterId} - ${result.error}`, thopterId, 'agent-manager');
      }
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Destroy request processing error: ${requestId} for thopter ${thopterId} - ${errorMessage}`, thopterId, 'agent-manager');
      
      // Mark request as failed
      stateManager.updateDestroyRequest(requestId, {
        status: 'failed',
        completedAt: new Date(),
        error: errorMessage
      });
    }
  }
  
  /**
   * Create a new provision request
   */
  createProvisionRequest(repository: string, github: ProvisionRequest['github'], workBranch?: string, gc?: string, prompt?: string): string {
    const requestId = generateRequestId('provision');
    
    const request: ProvisionRequest = {
      requestId,
      source: 'github',
      createdAt: new Date(),
      status: 'pending',
      repository,
      workBranch,
      gc,
      prompt,
      github
    };
    
    stateManager.addProvisionRequest(request);
    logger.info(`Created provision request: ${requestId} for ${repository}#${github.issueNumber}`, undefined, 'agent-manager');
    
    return requestId;
  }
  
  /**
   * Create a new destroy request - ensures only one destroy request per thopter
   */
  createDestroyRequest(thopterId: string, source: DestroyRequest['source'] = 'dashboard', reason?: string): string | null {
    // Check if thopter exists
    const thopter = stateManager.getThopter(thopterId);
    if (!thopter) {
      logger.warn(`Cannot create destroy request for non-existent thopter: ${thopterId}`, thopterId, 'agent-manager');
      return null;
    }
    
    // Check if thopter is already being killed
    if (thopter.hub.killRequested) {
      logger.warn(`Thopter already has kill request: ${thopterId}`, thopterId, 'agent-manager');
      return null;
    }
    
    // Check if there's already a pending or processing destroy request for this thopter
    const existingRequest = stateManager.getRecentDestroyRequests().find(
      req => req.thopterId === thopterId && (req.status === 'pending' || req.status === 'processing')
    );
    
    if (existingRequest) {
      logger.warn(`Destroy request already exists for thopter ${thopterId}: ${existingRequest.requestId}`, thopterId, 'agent-manager');
      return null;
    }
    
    const requestId = generateRequestId('destroy');
    
    const request: DestroyRequest = {
      requestId,
      source,
      createdAt: new Date(),
      status: 'pending',
      thopterId: thopterId, // Keep thopterId for backward compatibility with request interface
      reason
    };
    
    // Set kill requested flag to prevent further kill requests
    stateManager.setKillRequested(thopterId, true);
    
    stateManager.addDestroyRequest(request);
    logger.info(`Created destroy request: ${requestId} for thopter ${thopterId} (reason: ${reason || 'none'})`, thopterId, 'agent-manager');
    
    return requestId;
  }
  
  /**
   * Handle shutdown - cancel processing loop
   */
  handleShutdown(): void {
    logger.info('Agent manager shutting down - canceling processing loop', undefined, 'agent-manager');
    
    if (this.processingLoop) {
      clearTimeout(this.processingLoop);
      this.processingLoop = null;
    }
  }
  
  /**
   * Get current status
   */
  getStatus() {
    const operatingMode = stateManager.getOperatingMode();
    return {
      isRunning: !!this.processingLoop && operatingMode === 'running',
      systemMode: operatingMode,
      hasProcessingLoop: !!this.processingLoop
    };
  }
}
