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
  
  constructor(config: AgentManagerConfig) {
    this.provisioner = config.provisioner;
    this.maxConcurrentDestroys = parseInt(process.env.MAX_CONCURRENT_DESTROYS || '5');
    logger.info(`Agent manager initialized with max concurrent destroys: ${this.maxConcurrentDestroys}`, undefined, 'agent-manager');
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
      // Update request status to processing
      stateManager.updateProvisionRequest(requestId, {
        status: 'processing'
      });
      
      // Call provisioner with rich ProvisionRequest
      const result = await this.provisioner.provision(request);
      
      if (result.success) {
        // Update request to completed
        stateManager.updateProvisionRequest(requestId, {
          status: 'completed',
          completedAt: new Date(),
          agentId: result.agentId
        });
        
        // Add agent to state in 'provisioning' state
        // Observer will later transition it to 'running' or 'idle'
        stateManager.addAgent(
          result.agentId,
          result.machineId,
          request.repository,
          request.workBranch,
          request.github
        );
        
        logger.info(`Provision request completed: ${requestId} → agent ${result.agentId}`, result.agentId, 'agent-manager');
        
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
    const agentId = request.agentId;
    
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
    const agentId = request.agentId;
    
    logger.info(`Processing destroy request: ${requestId} for agent ${agentId} (${this.activeDestroyOperations.size}/${this.maxConcurrentDestroys} concurrent)`, agentId, 'agent-manager');
    
    try {
      // Update request status to processing
      stateManager.updateDestroyRequest(requestId, {
        status: 'processing'
      });
      
      // Call provisioner destroy method
      const result = await this.provisioner.destroy(agentId);
      
      if (result.success) {
        // Update request to completed
        stateManager.updateDestroyRequest(requestId, {
          status: 'completed',
          completedAt: new Date()
        });
        
        // Remove agent from state
        stateManager.removeAgent(agentId);
        
        logger.info(`Destroy request completed: ${requestId} for agent ${agentId}`, agentId, 'agent-manager');
        
      } else {
        // Update request to failed
        stateManager.updateDestroyRequest(requestId, {
          status: 'failed',
          completedAt: new Date(),
          error: result.error
        });

        // XXX we should handle this with some kind of 'stuck' agent state.
        // perhaps we delete the agent completely and have a separate task that
        // periodically repopulates the agent list from a bootstrap-like
        // operation. as it stands right now, this agent will be stuck in
        // 'killing' state with (1) no available actions to take (2) no way to
        // remove it besides restarting the server.
        
        logger.error(`Destroy request failed: ${requestId} for agent ${agentId} - ${result.error}`, agentId, 'agent-manager');
      }
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Destroy request processing error: ${requestId} for agent ${agentId} - ${errorMessage}`, agentId, 'agent-manager');
      
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
   * Create a new destroy request - ensures only one destroy request per agent
   */
  createDestroyRequest(agentId: string, source: DestroyRequest['source'] = 'dashboard', reason?: string): string | null {
    // Check if agent exists
    const agent = stateManager.getAgent(agentId);
    if (!agent) {
      logger.warn(`Cannot create destroy request for non-existent agent: ${agentId}`, agentId, 'agent-manager');
      return null;
    }
    
    // Check if agent is already being killed
    if (agent.state === 'killing') {
      logger.warn(`Agent already in killing state: ${agentId}`, agentId, 'agent-manager');
      return null;
    }
    
    // Check if there's already a pending or processing destroy request for this agent
    const existingRequest = stateManager.getRecentDestroyRequests().find(
      req => req.agentId === agentId && (req.status === 'pending' || req.status === 'processing')
    );
    
    if (existingRequest) {
      logger.warn(`Destroy request already exists for agent ${agentId}: ${existingRequest.requestId}`, agentId, 'agent-manager');
      return null;
    }
    
    const requestId = generateRequestId('destroy');
    
    const request: DestroyRequest = {
      requestId,
      source,
      createdAt: new Date(),
      status: 'pending',
      agentId,
      reason
    };
    
    // Set agent state to 'killing' to prevent further kill requests
    agent.state = 'killing';
    
    stateManager.addDestroyRequest(request);
    logger.info(`Created destroy request: ${requestId} for agent ${agentId} (reason: ${reason || 'none'})`, agentId, 'agent-manager');
    
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
