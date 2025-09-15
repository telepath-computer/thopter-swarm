import { execSync } from 'child_process';
import { ThopterState, ProvisionRequest, DestroyRequest, LogEvent, OperatingMode, ThopterStatusUpdate, GoldenClaudeState, GitHubIntegrationConfig, GitHubContext } from './types';
import { isValidThopterPattern } from './thopter-utils';
import { logger } from './logger';
import tinyspawn from 'tinyspawn';

// Our own flyctl wrapper that properly handles arguments with spaces
const createFlyWrapper = (appName: string) => {
  return async (args: string[]) => {
    const fullArgs = [...args, '--app', appName];
    // Redact fly tokens in logging
    const logArgs = fullArgs.map(arg => 
      arg.match(/^FlyV1/) ? '<redacted_token>' : arg
    );
    console.log(`$ fly ${logArgs.join(' ')}`);
    const result = await tinyspawn('fly', fullArgs);
    return result.stdout;
  };
};

class StateManager {
  private thopters: Map<string, ThopterState> = new Map();
  private goldenClaudes: Map<string, GoldenClaudeState> = new Map();
  private expectedThopters: Map<string, GitHubContext> = new Map(); // Pre-register GitHub context
  private provisionRequests: ProvisionRequest[] = [];
  private destroyRequests: DestroyRequest[] = [];
  private operatingMode: OperatingMode = 'initializing';
  
  private readonly maxProvisionRequests = 50;
  private readonly maxDestroyRequests = 50;
  
  private reconcileInterval: NodeJS.Timeout | null = null;
  private gcRefreshInterval: NodeJS.Timeout | null = null;
  
  private readonly appName: string;
  private readonly flyToken: string;
  private readonly webTerminalPort: number;
  private readonly fly: any;
  private readonly gitHubConfig: GitHubIntegrationConfig;
  
  constructor() {
    this.appName = process.env.APP_NAME!;
    this.flyToken = process.env.FLY_DEPLOY_KEY!;
    this.webTerminalPort = parseInt(process.env.WEB_TERMINAL_PORT || '7681');
    
    if (!this.appName || !this.flyToken) {
      throw new Error('APP_NAME and FLY_DEPLOY_KEY environment variables are required');
    }
    
    // Parse GitHub integration config
    const gitHubIntegrationJson = process.env.GITHUB_INTEGRATION_JSON;
    if (!gitHubIntegrationJson) {
      throw new Error('GITHUB_INTEGRATION_JSON environment variable is required');
    }
    
    try {
      this.gitHubConfig = JSON.parse(gitHubIntegrationJson);
      logger.info(`GitHub integration configured for ${Object.keys(this.gitHubConfig.repositories).length} repositories`, undefined, 'state-manager');
    } catch (error) {
      throw new Error(`Failed to parse GITHUB_INTEGRATION_JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    // Initialize our custom fly wrapper
    this.fly = createFlyWrapper(this.appName);
  }
  
  /**
   * Start fly-first reconciliation system
   */
  async startReconciliation(): Promise<void> {
    logger.info('Starting fly-first reconciliation system', undefined, 'state-manager');
    
    // Initial sync with fly
    await this.reconcileWithFly();
    
    // Continuous reconciliation every 30 seconds
    this.reconcileInterval = setInterval(() => {
      this.reconcileWithFly().catch(error => {
        logger.error(`Fly reconciliation failed: ${error.message}`, undefined, 'state-manager');
      });
    }, 30000);
    
    // Start Golden Claude refresh
    this.startGoldenClaudeRefresh();
    
    logger.info('Fly-first reconciliation system started', undefined, 'state-manager');
  }
  
  /**
   * Trigger immediate reconciliation (e.g., after provisioning)
   */
  async triggerReconciliation(): Promise<void> {
    logger.debug('Triggering immediate reconciliation', undefined, 'state-manager');
    await this.reconcileWithFly();
  }

  /**
   * Reconcile thopter state with fly machines (fly machines are authoritative)
   */
  private async reconcileWithFly(): Promise<void> {
    try {
      // Fly machines are the single source of truth
      const flyMachines = await this.getFlyMachines();
      const thopterMachines = flyMachines.filter((m: any) => 
        m.name && isValidThopterPattern(m.name)
      );
      
      const newThopters = new Map<string, ThopterState>();
      
      // Build state from fly data + preserved session/context
      for (const machine of thopterMachines) {
        const existing = this.thopters.get(machine.id);
        
        // TODO i'd prefer to use something like { ...existing, fly: { ... } }
        // that blanket preserves existing keys instead of manually preserving
        // existing keys.
        const thopterState: ThopterState = {
          // === FLY DATA (authoritative) ===
          fly: {
            id: machine.id,
            name: machine.name,
            machineState: machine.state,
            region: machine.region || existing?.fly?.region || 'unknown',
            image: machine.image_ref?.tag || existing?.fly?.image || 'unknown',
            createdAt: new Date(machine.created_at)
          },
          
          // === HUB MANAGEMENT (preserve existing) ===
          hub: {
            killRequested: existing?.hub?.killRequested || false
          },
          
          // === SESSION STATE (preserve existing) ===
          session: existing?.session,
          
          // === GITHUB CONTEXT (preserve existing or use expected) ===
          github: existing?.github || this.expectedThopters.get(machine.id)
        };
        
        newThopters.set(machine.id, thopterState);
        
        // Clean up expected entry if it was used
        if (this.expectedThopters.has(machine.id)) {
          this.expectedThopters.delete(machine.id);
          logger.debug(`Consumed expected GitHub context for thopter: ${machine.id}`, machine.id, 'state-manager');
        }
      }
      
      // Log changes and update
      this.logThopterChanges(this.thopters, newThopters);
      this.thopters = newThopters;
      
    } catch (error) {
      logger.error(`Fly reconciliation failed: ${error instanceof Error ? error.message : String(error)}`, undefined, 'state-manager');
    }
  }
  
  private async getFlyMachines(): Promise<any[]> {
    const output = await this.fly(['machines', 'list', '--json', '-t', this.flyToken]);
    return JSON.parse(output);
  }
  
  private logThopterChanges(oldThopters: Map<string, ThopterState>, newThopters: Map<string, ThopterState>): void {
    // Log new thopters
    for (const [id, thopter] of newThopters) {
      if (!oldThopters.has(id)) {
        logger.info(`Discovered new thopter: ${thopter.fly.name} (${id}) - ${thopter.fly.machineState}`, id, 'state-manager');
      }
    }
    
    // Log removed thopters
    for (const [id, thopter] of oldThopters) {
      if (!newThopters.has(id)) {
        logger.info(`Thopter no longer exists: ${thopter.fly.name} (${id}) - removed from tracking`, id, 'state-manager');
      }
    }
    
    // Log state changes
    for (const [id, newThopter] of newThopters) {
      const oldThopter = oldThopters.get(id);
      if (oldThopter && oldThopter.fly.machineState !== newThopter.fly.machineState) {
        logger.info(`Thopter machine state changed: ${oldThopter.fly.machineState} → ${newThopter.fly.machineState}`, id, 'state-manager');
      }
    }
  }
  
  /**
   * Update thopter from observer status report (best-effort metadata)
   */
  updateThopterFromStatus(status: ThopterStatusUpdate): void {
    let thopter = this.thopters.get(status.thopterId);  // UPDATED field name
    
    if (!thopter) {
      // NEW: Check if this is a golden claude reporting
      const goldenClaude = this.goldenClaudes.get(status.thopterId);
      if (goldenClaude) {
        this.updateGoldenClaudeFromStatus(goldenClaude, status);
        return;
      }
      
      logger.warn(`Received status for unknown thopter: ${status.thopterId}`, status.thopterId, 'state-manager');
      // Don't auto-create - fly reconciliation will discover it if it exists
      // This prevents phantom thopters from bad status updates
      return;
    }
    
    // Update session state (best-effort metadata) - ALL camelCase
    thopter.session = {
      tmuxState: status.tmuxState,
      claudeProcess: status.claudeProcess,
      lastActivity: new Date(status.lastActivity),
      idleSince: status.idleSince ? new Date(status.idleSince) : undefined,
      screenDump: status.screenDump
    };
    
    // Update GitHub context if provided (best-effort metadata)
    // Note: status.github should include repository field now
    if (status.github) {
      thopter.github = status.github;
    }
    
    // Log successful status update
    logger.debug(`Updated thopter session state: ${status.thopterId}`, status.thopterId, 'state-manager');
  }

  /**
   * Handle golden claude status updates (NEW METHOD)
   */
  updateGoldenClaudeFromStatus(goldenClaude: GoldenClaudeState, status: ThopterStatusUpdate): void {
    goldenClaude.session = {
      tmuxState: status.tmuxState,
      claudeProcess: status.claudeProcess,
      lastActivity: new Date(status.lastActivity),
      idleSince: status.idleSince ? new Date(status.idleSince) : undefined,
      screenDump: status.screenDump
    };
    
    logger.debug(`Updated golden claude session state: ${status.thopterId}`, status.thopterId, 'state-manager');
  }
  
  /**
   * Add a new provision request to the queue
   */
  addProvisionRequest(request: ProvisionRequest): void {
    this.provisionRequests.push(request);
    
    // Maintain circular buffer
    if (this.provisionRequests.length > this.maxProvisionRequests) {
      this.provisionRequests.shift();
    }
    
    logger.info(`Added provision request: ${request.requestId}`, undefined, 'state-manager');
  }
  
  /**
   * Update an existing provision request
   */
  updateProvisionRequest(requestId: string, updates: Partial<ProvisionRequest>): void {
    const request = this.provisionRequests.find(r => r.requestId === requestId);
    if (request) {
      Object.assign(request, updates);
      logger.info(`Updated provision request: ${requestId} (status: ${request.status})`, request.thopterId, 'state-manager');
    } else {
      logger.warn(`Provision request not found: ${requestId}`, undefined, 'state-manager');
    }
  }
  
  /**
   * Get recent provision requests
   */
  getRecentProvisionRequests(limit?: number): ProvisionRequest[] {
    const requests = limit ? this.provisionRequests.slice(-limit) : this.provisionRequests;
    return [...requests]; // Return copy
  }
  
  /**
   * Get next pending provision request
   */
  getNextPendingProvisionRequest(): ProvisionRequest | undefined {
    return this.provisionRequests.find(r => r.status === 'pending');
  }
  
  /**
   * Add a new destroy request to the queue
   */
  addDestroyRequest(request: DestroyRequest): void {
    this.destroyRequests.push(request);
    
    // Maintain circular buffer
    if (this.destroyRequests.length > this.maxDestroyRequests) {
      this.destroyRequests.shift();
    }
    
    logger.info(`Added destroy request: ${request.requestId} for thopter ${request.thopterId}`, request.thopterId, 'state-manager');
  }
  
  /**
   * Update an existing destroy request
   */
  updateDestroyRequest(requestId: string, updates: Partial<DestroyRequest>): void {
    const request = this.destroyRequests.find(r => r.requestId === requestId);
    if (request) {
      Object.assign(request, updates);
      logger.info(`Updated destroy request: ${requestId} (status: ${request.status})`, request.thopterId, 'state-manager');
    } else {
      logger.warn(`Destroy request not found: ${requestId}`, undefined, 'state-manager');
    }
  }
  
  /**
   * Get recent destroy requests
   */
  getRecentDestroyRequests(limit?: number): DestroyRequest[] {
    const requests = limit ? this.destroyRequests.slice(-limit) : this.destroyRequests;
    return [...requests]; // Return copy
  }
  
  /**
   * Get next pending destroy request
   */
  getNextPendingDestroyRequest(): DestroyRequest | undefined {
    return this.destroyRequests.find(r => r.status === 'pending');
  }
  
  /**
   * Get multiple pending destroy requests for parallel processing
   */
  getNextPendingDestroyRequests(limit: number): DestroyRequest[] {
    return this.destroyRequests.filter(r => r.status === 'pending').slice(0, limit);
  }
  
  /**
   * Pre-register a thopter with GitHub context before it's discovered by reconciliation
   */
  expectThopter(machineId: string, github: GitHubContext): void {
    this.expectedThopters.set(machineId, github);
    logger.info(`Pre-registered thopter with GitHub context: ${github.repository}#${github.issueNumber}`, machineId, 'state-manager');
  }

  /**
   * Add a new thopter to state (used when provisioner creates thopter)
   */
  addThopter(machineId: string, machineName: string, region: string, image: string, github?: GitHubContext, createdAt?: Date): ThopterState {
    const thopter: ThopterState = {
      fly: {
        id: machineId,
        name: machineName,
        machineState: 'started', // Provisioner knows it created a started machine
        region: region,
        image: image,
        createdAt: createdAt || new Date() // Use actual creation time if available
      },
      hub: {
        killRequested: false
      },
      session: undefined, // Will be populated when observer reports in
      github: github
    };
    
    this.thopters.set(machineId, thopter);
    logger.info(`Added new thopter to state${github ? ' with GitHub context' : ''}`, machineId, 'state-manager');
    
    return thopter;
  }
  
  /**
   * Remove a thopter from state (used when thopter is destroyed)
   */
  removeThopter(thopterId: string): void {
    const thopter = this.thopters.get(thopterId);
    if (thopter) {
      this.thopters.delete(thopterId);
      logger.info(`Removed thopter from state`, thopterId, 'state-manager');
    } else {
      logger.warn(`Thopter not found for removal: ${thopterId}`, thopterId, 'state-manager');
    }
  }
  
  /**
   * Set kill requested flag for a thopter
   */
  setKillRequested(thopterId: string, requested: boolean = true): void {
    const thopter = this.thopters.get(thopterId);
    if (thopter) {
      thopter.hub.killRequested = requested;
      logger.info(`Set kill requested: ${requested}`, thopterId, 'state-manager');
    } else {
      logger.warn(`Thopter not found for kill request: ${thopterId}`, thopterId, 'state-manager');
    }
  }
  
  /**
   * Get all thopters
   */
  getAllThopters(): ThopterState[] {
    return [...this.thopters.values()];
  }
  
  /**
   * Get thopter by ID
   */
  getThopter(thopterId: string): ThopterState | undefined {
    return this.thopters.get(thopterId);
  }
  
  /**
   * Get recent logs from logger
   */
  getRecentLogs(limit?: number): LogEvent[] {
    return logger.getRecentLogs(limit);
  }
  
  /**
   * Get/set operating mode
   */
  getOperatingMode(): OperatingMode {
    return this.operatingMode;
  }
  
  setOperatingMode(mode: OperatingMode): void /* syntax fix comment */ {
    const previousMode = this.operatingMode;
    this.operatingMode = mode;
    
    if (previousMode !== mode) {
      logger.info(`Operating mode changed: ${previousMode} → ${mode}`, undefined, 'state-manager');
    }
  }
  
  /**
   * Handle shutdown - set mode to stopping and clean up intervals
   */
  handleShutdown(): void /* syntax fix comment */ {
    logger.info('State manager shutting down - setting mode to stopping', undefined, 'state-manager');
    this.setOperatingMode('stopping');
    
    if (this.reconcileInterval) {
      clearInterval(this.reconcileInterval);
      this.reconcileInterval = null;
    }
    
    this.stopGoldenClaudeRefresh();
  }
  
  /**
   * Get summary statistics
   */
  getStats() {
    const thopters = this.getAllThopters();
    const thoptersByMachineState = thopters.reduce((acc, thopter) => {
      acc[thopter.fly.machineState] = (acc[thopter.fly.machineState] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    const provisionRequestsByStatus = this.provisionRequests.reduce((acc, req) => {
      acc[req.status] = (acc[req.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    const destroyRequestsByStatus = this.destroyRequests.reduce((acc, req) => {
      acc[req.status] = (acc[req.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    return {
      totalThopters: thopters.length,
      thoptersByMachineState,
      totalProvisionRequests: this.provisionRequests.length,
      provisionRequestsByStatus,
      totalDestroyRequests: this.destroyRequests.length,
      destroyRequestsByStatus,
      operatingMode: this.operatingMode,
      recentLogCount: this.getRecentLogs().length
    };
  }
  
  /**
   * Bootstrap Golden Claude state by querying fly.io machines
   */
  async bootstrapGoldenClaudes(): Promise<void> {
    logger.info('Bootstrapping Golden Claude state from fly.io machines', undefined, 'state-manager');
    
    try {
      const output = await this.fly(['machines', 'list', '--json', '-t', this.flyToken]);
      const machines = JSON.parse(output);
      
      // Filter for golden claude machines (gc-*)
      const gcMachines = machines.filter((m: any) => 
        m.name && m.name.startsWith('gc-')
      );
      
      logger.info(`Found ${gcMachines.length} Golden Claude machines`, undefined, 'state-manager');
      
      // Create a new map to replace the current one (this handles removals)
      const newGoldenClaudes = new Map<string, GoldenClaudeState>();
      
      // Add each GC machine to our tracking
      for (const machine of gcMachines) {
        // Extract name from machine name (gc-default -> default)
        const name = machine.name.replace(/^gc-/, '');
        
        // PRESERVE existing session data if it exists
        const existing = this.goldenClaudes.get(machine.id);
        
        const gcState: GoldenClaudeState = {
          machineId: machine.id,
          name: name,
          state: machine.state === 'started' ? 'running' : 'stopped',
          webTerminalUrl: machine.state === 'started' 
            ? `http://${machine.id}.vm.${this.appName}.internal:${this.webTerminalPort}/`
            : undefined,
          // PRESERVE session data from observer updates
          session: existing?.session
        };
        
        newGoldenClaudes.set(machine.id, gcState);
        
        // Log changes
        if (!existing) {
          logger.info(`Added Golden Claude: ${name} (${machine.id}) - ${gcState.state}`, undefined, 'state-manager');
        } else if (existing.state !== gcState.state) {
          logger.info(`Golden Claude ${name} state changed: ${existing.state} → ${gcState.state}`, undefined, 'state-manager');
        }
      }
      
      // Log removed GCs
      for (const [machineId, existing] of this.goldenClaudes) {
        if (!newGoldenClaudes.has(machineId)) {
          logger.info(`Removed Golden Claude: ${existing.name} (${machineId}) - no longer exists`, undefined, 'state-manager');
        }
      }
      
      // Replace the map
      this.goldenClaudes = newGoldenClaudes;
      
    } catch (error) {
      logger.error(`Failed to bootstrap Golden Claudes: ${error instanceof Error ? error.message : String(error)}`, undefined, 'state-manager');
    }
  }
  
  /**
   * Start periodic refresh of Golden Claude state
   */
  startGoldenClaudeRefresh(): void /*this comment fixes neovim syntax highlighting*/ {
    // Refresh every 30 seconds
    this.gcRefreshInterval = setInterval(() => {
      this.bootstrapGoldenClaudes().catch(error => {
        logger.error(`Golden Claude refresh failed: ${error instanceof Error ? error.message : String(error)}`, undefined, 'state-manager');
      });
    }, 30000);
    
    logger.info('Started Golden Claude periodic refresh (30s interval)', undefined, 'state-manager');
  }
  
  /**
   * Stop Golden Claude refresh interval
   */
  stopGoldenClaudeRefresh(): void {
    if (this.gcRefreshInterval) {
      clearInterval(this.gcRefreshInterval);
      this.gcRefreshInterval = null;
      logger.info('Stopped Golden Claude periodic refresh', undefined, 'state-manager');
    }
  }
  
  /**
   * Get all Golden Claudes
   */
  getAllGoldenClaudes(): GoldenClaudeState[] {
    return Array.from(this.goldenClaudes.values());
  }
  
  /**
   * Get Golden Claude by name
   */
  getGoldenClaude(name: string): GoldenClaudeState | undefined {
    // Find by name, not machine ID
    return Array.from(this.goldenClaudes.values()).find(gc => gc.name === name);
  }
  
  /**
   * Get GitHub configuration for a specific repository
   */
  getGitHubConfig(repository: string) {
    return this.gitHubConfig.repositories[repository];
  }
  
  /**
   * Get list of configured repositories
   */
  getConfiguredRepositories(): string[] {
    return Object.keys(this.gitHubConfig.repositories);
  }
  
}

// Export singleton instance
export const stateManager = new StateManager();
