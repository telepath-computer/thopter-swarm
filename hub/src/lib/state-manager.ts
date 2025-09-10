import { execSync } from 'child_process';
import { AgentState, ProvisionRequest, DestroyRequest, LogEvent, OperatingMode, ThopterStatusUpdate, GoldenClaudeState, GitHubIntegrationConfig } from './types';
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
  private agents: Map<string, AgentState> = new Map();
  private goldenClaudes: Map<string, GoldenClaudeState> = new Map();
  private provisionRequests: ProvisionRequest[] = [];
  private destroyRequests: DestroyRequest[] = [];
  private operatingMode: OperatingMode = 'starting';
  
  private readonly maxProvisionRequests = 50;
  private readonly maxDestroyRequests = 50;
  
  private gcRefreshInterval: NodeJS.Timeout | null = null;
  
  private readonly appName: string;
  private readonly flyToken: string;
  private readonly webTerminalPort: number;
  private readonly fly: any;
  private readonly gitHubConfig: GitHubIntegrationConfig;
  
  constructor() {
    this.appName = process.env.APP_NAME!;
    this.flyToken = process.env.FLY_DEPLOY_KEY!;
    this.webTerminalPort = parseInt(process.env.WEB_TERMINAL_PORT || '8080');
    
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
   * Bootstrap state by querying fly.io machines and adding them as 'orphaned'
   * Agents will transition out of 'orphaned' state when observers report in
   */
  async bootstrap(): Promise<void> {
    // Set initial state to 'starting' during bootstrap
    this.operatingMode = 'starting';
    logger.info('Bootstrapping state from fly.io machines', undefined, 'state-manager');
    
    try {
      const output = await this.fly(['machines', 'list', '--json', '-t', this.flyToken]);
      
      const machines = JSON.parse(output);
      logger.info(`Found ${machines.length} total machines`, undefined, 'state-manager');
      
      // Filter for thopter machines (not the hub itself)
      const thopterMachines = machines.filter((m: any) => 
        m.name && m.name.startsWith('thopter-') && m.state === 'started'
      );
      
      logger.info(`Found ${thopterMachines.length} thopter machines`, undefined, 'state-manager');
      
      // Add each thopter machine as 'orphaned' until observer reports in
      for (const machine of thopterMachines) {
        const agentState: AgentState = {
          id: machine.id,
          machineId: machine.id,
          state: 'orphaned',
          hasObserver: false,
          webTerminalUrl: `http://${machine.id}.vm.${this.appName}.internal:${this.webTerminalPort}/`
        };
        
        this.agents.set(machine.id, agentState);
        logger.info(`Added orphaned agent: ${machine.id}`, machine.id, 'state-manager');
      }
      
      // Bootstrap Golden Claudes
      await this.bootstrapGoldenClaudes();
      
      // Start periodic GC refresh
      this.startGoldenClaudeRefresh();
      
      logger.info('Bootstrap completed successfully', undefined, 'state-manager');
      this.operatingMode = 'running';
      logger.info('State manager ready - operating mode set to running', undefined, 'state-manager');
      
    } catch (error) {
      logger.error(`Bootstrap failed: ${error instanceof Error ? error.message : String(error)}`, undefined, 'state-manager');
      this.operatingMode = 'running';
      logger.info('State manager starting in running mode despite bootstrap error', undefined, 'state-manager');
      throw error;
    }
  }
  
  /**
   * Update agent state from observer status report (authoritative source)
   */
  updateAgentFromStatus(status: ThopterStatusUpdate): void {
    const agentId = status.agent_id;
    let agent = this.agents.get(agentId);
    
    if (!agent) {
      // Agent not known - this shouldn't normally happen after bootstrap
      logger.warn(`Received status for unknown agent: ${agentId}`, agentId, 'state-manager');
      agent = {
        id: agentId,
        machineId: agentId,
        state: 'orphaned',
        hasObserver: false,
        webTerminalUrl: `http://${agentId}.vm.${this.appName}.internal:${this.webTerminalPort}/`
      };
      this.agents.set(agentId, agent);
    }
    
    // Update from status report - observer data is authoritative
    const previousState = agent.state;
    agent.state = status.state === 'running' ? 'running' : 'idle';
    agent.hasObserver = true;
    agent.lastActivity = new Date(status.last_activity);
    agent.screenDump = status.screen_dump;
    
    if (status.idle_since) {
      agent.idleSince = new Date(status.idle_since);
    } else {
      agent.idleSince = undefined;
    }
    
    // Update source-agnostic metadata
    if (status.repository) agent.repository = status.repository;
    if (status.branch) agent.branch = status.branch;
    if (status.spawned_at) agent.spawnedAt = new Date(status.spawned_at);
    
    // Update GitHub context if present
    if (status.github) {
      agent.source = 'github';
      agent.github = {
        issueNumber: status.github.issue_number || '',
        issueTitle: status.github.issue_title || '',
        issueBody: status.github.issue_body || '',
        issueUrl: status.github.issue_url || '',
        issueAuthor: '',
        mentionAuthor: status.github.mention_author || '',
        mentionLocation: 'comment',
        mentionCommentId: status.github.mention_comment_id
      };
    }
    
    // Log state transitions
    if (previousState !== agent.state) {
      logger.info(`Agent state transition: ${previousState} → ${agent.state}`, agentId, 'state-manager');
    }
    
    logger.debug(`Updated agent from status report`, agentId, 'state-manager', { state: agent.state, hasObserver: agent.hasObserver });
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
      logger.info(`Updated provision request: ${requestId} (status: ${request.status})`, request.agentId, 'state-manager');
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
    
    logger.info(`Added destroy request: ${request.requestId} for agent ${request.agentId}`, request.agentId, 'state-manager');
  }
  
  /**
   * Update an existing destroy request
   */
  updateDestroyRequest(requestId: string, updates: Partial<DestroyRequest>): void {
    const request = this.destroyRequests.find(r => r.requestId === requestId);
    if (request) {
      Object.assign(request, updates);
      logger.info(`Updated destroy request: ${requestId} (status: ${request.status})`, request.agentId, 'state-manager');
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
   * Add a new agent to state (used when provisioner creates agent)
   */
  addAgent(agentId: string, machineId: string, repository?: string, branch?: string): AgentState {
    const agent: AgentState = {
      id: agentId,
      machineId,
      state: 'provisioning',
      hasObserver: false,
      repository,
      branch,
      webTerminalUrl: `http://${machineId}.vm.${this.appName}.internal:${this.webTerminalPort}/`,
      spawnedAt: new Date()
    };
    
    this.agents.set(agentId, agent);
    logger.info(`Added new agent in provisioning state`, agentId, 'state-manager');
    
    return agent;
  }
  
  /**
   * Remove an agent from state (used when agent is destroyed)
   */
  removeAgent(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      this.agents.delete(agentId);
      logger.info(`Removed agent from state`, agentId, 'state-manager');
    } else {
      logger.warn(`Agent not found for removal: ${agentId}`, agentId, 'state-manager');
    }
  }
  
  /**
   * Get all agents
   */
  getAllAgents(): AgentState[] {
    return [...this.agents.values()];
  }
  
  /**
   * Get agent by ID
   */
  getAgent(agentId: string): AgentState | undefined {
    return this.agents.get(agentId);
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
  
  setOperatingMode(mode: OperatingMode): void {
    const previousMode = this.operatingMode;
    this.operatingMode = mode;
    
    if (previousMode !== mode) {
      logger.info(`Operating mode changed: ${previousMode} → ${mode}`, undefined, 'state-manager');
    }
  }
  
  /**
   * Handle shutdown - set mode to stopping
   */
  handleShutdown(): void {
    logger.info('State manager shutting down - setting mode to stopping', undefined, 'state-manager');
    this.setOperatingMode('stopping');
  }
  
  /**
   * Get summary statistics
   */
  getStats() {
    const agents = this.getAllAgents();
    const agentsByState = agents.reduce((acc, agent) => {
      acc[agent.state] = (acc[agent.state] || 0) + 1;
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
      totalAgents: agents.length,
      agentsByState,
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
        
        const gcState: GoldenClaudeState = {
          id: machine.id,
          name: name,
          machineId: machine.id,
          state: machine.state === 'started' ? 'running' : 'stopped',
          webTerminalUrl: machine.state === 'started' 
            ? `http://${machine.id}.vm.${this.appName}.internal:${this.webTerminalPort}/`
            : undefined
        };
        
        newGoldenClaudes.set(machine.id, gcState);
        
        // Log changes
        const existing = this.goldenClaudes.get(machine.id);
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
  startGoldenClaudeRefresh(): void {
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
   * Update shutdown handler to clean up GC refresh
   */
  handleShutdownWithCleanup(): void {
    this.stopGoldenClaudeRefresh();
    this.handleShutdown();
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
