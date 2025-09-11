import { Octokit } from '@octokit/rest';
import minimist from 'minimist';
import { stateManager } from './state-manager';
import { AgentManager } from './agent-manager';
import { logger } from './logger';
import { GitHubContext } from './types';
import { getDashboardUrl } from './utils';

interface ProcessedCommand {
  repository: string;
  issueNumber: number;
  command: string;
  commentId?: number;
}

class GitHubPollingManager {
  private pollingTimeout: NodeJS.Timeout | null = null;
  private readonly intervalMs: number;
  private processedCommands: Set<string> = new Set();
  private lastPollTime: Date | null = null;
  private agentManager: AgentManager | null = null;

  constructor() {
    // Default to 30 seconds, configurable via env var
    this.intervalMs = parseInt(process.env.GITHUB_ISSUES_POLLING_INTERVAL || '30') * 1000;
  }

  /**
   * Set the agent manager instance
   */
  setAgentManager(agentManager: AgentManager): void {
    this.agentManager = agentManager;
  }

  /**
   * Start polling GitHub repositories for /thopter commands
   */
  start(): void {
    if (this.pollingTimeout) {
      logger.warn('GitHub polling already started', undefined, 'github-polling');
      return;
    }

    const repositories = stateManager.getConfiguredRepositories();
    logger.info(`Starting GitHub polling for ${repositories.length} repositories (${this.intervalMs/1000}s interval)`, undefined, 'github-polling');

    // Start first poll immediately
    this.scheduleNextPoll(0);

    logger.info('GitHub polling started successfully', undefined, 'github-polling');
  }

  /**
   * Stop polling
   */
  stop(): void {
    if (this.pollingTimeout) {
      clearTimeout(this.pollingTimeout);
      this.pollingTimeout = null;
      logger.info('GitHub polling stopped', undefined, 'github-polling');
    }
  }

  /**
   * Schedule the next polling run
   */
  private scheduleNextPoll(delay: number): void {
    // Check if system is stopping
    const operatingMode = stateManager.getOperatingMode();
    if (operatingMode === 'stopping') {
      return;
    }

    this.pollingTimeout = setTimeout(async () => {
      // Re-check operating mode before polling
      const currentMode = stateManager.getOperatingMode();
      if (currentMode === 'stopping') {
        return;
      }

      // Only poll if system is in running mode
      if (currentMode === 'running') {
        try {
          await this.pollAllRepositories();
        } catch (error) {
          logger.error(`Polling failed: ${error instanceof Error ? error.message : String(error)}`, undefined, 'github-polling');
        }
      }

      // Schedule next poll after this one completes
      this.scheduleNextPoll(this.intervalMs);
    }, delay);
  }

  /**
   * Poll all configured repositories
   */
  private async pollAllRepositories(): Promise<void> {
    const currentTime = new Date();
    const repositories = stateManager.getConfiguredRepositories();
    
    logger.debug(`Starting poll cycle for ${repositories.length} repositories`, undefined, 'github-polling');
    
    let anySuccess = false;
    for (const repository of repositories) {
      // Check if system is stopping during loop
      if (stateManager.getOperatingMode() === 'stopping') {
        logger.debug('System stopping, exiting repository loop', undefined, 'github-polling');
        break;
      }

      try {
        await this.pollRepository(repository);
        anySuccess = true; // Mark that at least one repository polled successfully
      } catch (error) {
        logger.error(`Failed to poll repository ${repository}: ${error instanceof Error ? error.message : String(error)}`, undefined, 'github-polling');
      }
    }

    // Only update lastPollTime if at least one repository was successfully polled
    if (anySuccess) {
      this.lastPollTime = currentTime;
      logger.debug('Poll cycle completed successfully', undefined, 'github-polling');
    } else {
      logger.warn('Poll cycle completed with no successful repository polls', undefined, 'github-polling');
    }
  }

  /**
   * Poll a single repository for /thopter commands
   */
  private async pollRepository(repository: string): Promise<void> {
    const repoConfig = stateManager.getGitHubConfig(repository);
    if (!repoConfig) {
      logger.error(`No configuration found for repository: ${repository}`, undefined, 'github-polling');
      return;
    }

    const octokit = new Octokit({
      auth: repoConfig.issuesPAT,
    });

    const [owner, repo] = repository.split('/');
    
    try {
      // Calculate time window: last poll time minus 1 minute slosh for safety
      const since = this.lastPollTime ? new Date(this.lastPollTime.getTime() - 60000) : new Date(Date.now() - 24 * 60 * 60 * 1000); // Default to 24 hours ago on first run
      
      // Get issues updated since last poll
      const { data: issues } = await octokit.rest.issues.listForRepo({
        owner,
        repo,
        state: 'open',
        sort: 'updated',
        since: since.toISOString(),
        per_page: 100, // Increased from 50 since we're filtering by time
      });

      logger.debug(`Found ${issues.length} updated issues in ${repository} since ${since.toISOString()}`, undefined, 'github-polling');

      for (const issue of issues) {
        // Check if system is stopping during loop
        if (stateManager.getOperatingMode() === 'stopping') {
          logger.debug('System stopping, exiting issue loop', undefined, 'github-polling');
          break;
        }

        await this.processIssueForCommands(octokit, owner, repo, issue.number, since);
      }
    } catch (error) {
      logger.error(`Failed to list issues for ${repository}: ${error instanceof Error ? error.message : String(error)}`, undefined, 'github-polling');
    }
  }

  /**
   * Process an issue for /thopter commands
   */
  private async processIssueForCommands(octokit: Octokit, owner: string, repo: string, issueNumber: number, since: Date): Promise<void> {
    const repository = `${owner}/${repo}`;
    
    try {
      // Fetch issue details and ALL comments upfront in parallel for efficiency
      const [issueResponse, commentsResponse] = await Promise.all([
        octokit.rest.issues.get({
          owner,
          repo,
          issue_number: issueNumber,
        }),
        octokit.rest.issues.listComments({
          owner,
          repo,
          issue_number: issueNumber,
          per_page: 100,
        })
      ]);

      const issue = issueResponse.data;
      const comments = commentsResponse.data;

      logger.debug(`Processing issue ${repository}#${issueNumber} with ${comments.length} comments for unacknowledged commands`, undefined, 'github-polling');

      // Check issue body for unacknowledged commands
      // Pass the fetched comments to avoid redundant API calls
      await this.extractAndProcessCommands(octokit, repository, issue, issue.body || '', 'body', undefined, comments);

      // Process each comment for /thopter commands
      // Pass the fetched comments to avoid redundant API calls
      for (const comment of comments) {
        // Check if system is stopping during loop
        if (stateManager.getOperatingMode() === 'stopping') {
          logger.debug('System stopping, exiting comment loop', undefined, 'github-polling');
          break;
        }

        await this.extractAndProcessCommands(octokit, repository, issue, comment.body || '', 'comment', comment.id, comments);
      }
    } catch (error) {
      logger.error(`Failed to process issue ${repository}#${issueNumber}: ${error instanceof Error ? error.message : String(error)}`, undefined, 'github-polling');
    }
  }

  /**
   * Extract and process /thopter commands from text
   */
  private async extractAndProcessCommands(
    octokit: Octokit,
    repository: string,
    issue: any,
    text: string,
    location: 'body' | 'comment',
    commentId?: number,
    allComments?: any[]
  ): Promise<void> {
    // Find ONLY the first /thopter command in the text - ignore any additional ones
    const thopterMatch = text.match(/^\/thopter\s*(.*)$/m);
    
    if (!thopterMatch) {
      return; // No /thopter command found
    }

    // Check if there are multiple /thopter commands and warn
    const allMatches = text.match(/^\/thopter\s*(.*)$/gm);
    if (allMatches && allMatches.length > 1) {
      logger.warn(`Found ${allMatches.length} /thopter commands in ${repository}#${issue.number} (${location === 'body' ? 'body' : `comment:${commentId}`}), only processing the first one`, undefined, 'github-polling');
    }

    const commandLine = thopterMatch[1].trim();
    const fullCommand = thopterMatch[0];
    
    // Create simple identifier: body or comment ID
    const commandInstance = location === 'body' ? 'body' : `comment:${commentId}`;
    const commandKey = `${repository}#${issue.number}:${commandInstance}`;

    // Skip if already processed
    if (this.processedCommands.has(commandKey)) {
      return;
    }

    // Check if this command instance has already been acknowledged
    // Use provided comments if available to avoid redundant API call
    const isAlreadyAcknowledged = await this.isCommandAlreadyAcknowledged(octokit, repository, issue.number, commandInstance, allComments);
    if (isAlreadyAcknowledged) {
      this.processedCommands.add(commandKey);
      return;
    }

    logger.info(`Found new /thopter command in ${repository}#${issue.number} (${commandInstance}): ${fullCommand}`, undefined, 'github-polling');

    try {
      // Parse command arguments
      const { gc, prompt } = this.parseThopterCommand(commandLine);

      // Use the already-fetched comments instead of making another API call
      const commentsToUse = allComments || [];

      // Create GitHub context with full conversation thread
      const github: GitHubContext = {
        issueNumber: issue.number.toString(),
        issueTitle: issue.title,
        issueBody: issue.body || '',
        issueUrl: issue.html_url,
        issueAuthor: issue.user?.login || '',
        mentionAuthor: '', // We'll set this when we know who mentioned
        mentionLocation: location,
        mentionCommentId: commentId,
        // Add full conversation thread
        comments: commentsToUse.map(comment => ({
          id: comment.id,
          author: comment.user?.login || '',
          body: comment.body || '',
          createdAt: comment.created_at,
          updatedAt: comment.updated_at,
          url: comment.html_url
        }))
      };

      // Create provision request
      if (!this.agentManager) {
        throw new Error('AgentManager not set - call setAgentManager() before starting polling');
      }
      const requestId = this.agentManager.createProvisionRequest(repository, github, undefined, gc, prompt);
      
      // Comment back to acknowledge the command
      await this.acknowledgeCommand(octokit, repository, issue.number, fullCommand, commandInstance, requestId);
      
      // Mark as processed
      this.processedCommands.add(commandKey);

      logger.info(`Processed /thopter command ${fullCommand} for ${repository}#${issue.number}, created request ${requestId}`, undefined, 'github-polling');
    } catch (error) {
      logger.error(`Failed to process command "${fullCommand}" in ${repository}#${issue.number}: ${error instanceof Error ? error.message : String(error)}`, undefined, 'github-polling');
    }
  }

  /**
   * Parse /thopter command arguments
   */
  private parseThopterCommand(commandLine: string): { gc?: string; prompt?: string } {
    // Split command line into arguments, handling quoted strings
    const args = commandLine.length > 0 ? commandLine.split(/\s+/) : [];
    
    // Parse with minimist
    const parsed = minimist(args, {
      string: ['gc', 'g', 'prompt', 'p'],
      alias: {
        'g': 'gc',
        'p': 'prompt'
      }
    });

    return {
      gc: parsed.gc || parsed.g,
      prompt: parsed.prompt || parsed.p
    };
  }

  /**
   * Check if a command has already been acknowledged in the issue comments
   */
  private async isCommandAlreadyAcknowledged(octokit: Octokit, repository: string, issueNumber: number, commandInstance: string, providedComments?: any[]): Promise<boolean> {
    const [owner, repo] = repository.split('/');
    
    try {
      // Use provided comments if available, otherwise fetch them
      let comments = providedComments;
      if (!comments) {
        const { data } = await octokit.rest.issues.listComments({
          owner,
          repo,
          issue_number: issueNumber,
        });
        comments = data;
      }

      // Look for our acknowledgment pattern with unique instance ID
      const acknowledgmentPattern = `<!-- thopter-ack:${commandInstance} -->`;
      
      return comments.some(comment => 
        comment.body?.includes(acknowledgmentPattern)
      );
    } catch (error) {
      logger.error(`Failed to check acknowledgments for ${repository}#${issueNumber}: ${error instanceof Error ? error.message : String(error)}`, undefined, 'github-polling');
      return false; // Assume not acknowledged on error
    }
  }

  /**
   * Comment on issue to acknowledge command processing
   */
  private async acknowledgeCommand(octokit: Octokit, repository: string, issueNumber: number, command: string, commandInstance: string, requestId: string): Promise<void> {
    const [owner, repo] = repository.split('/');
    
    const body = `🚁 **Thopter request initiated**: \`${command}\`

Request ID: \`${requestId}\`

A thopter will be provisioned to work on this issue. You can track progress in the [Thopter Swarm dashboard](${getDashboardUrl()}).

<!-- thopter-ack:${commandInstance} -->`;

    try {
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body,
      });

      logger.info(`Acknowledged command "${command}" in ${repository}#${issueNumber}`, undefined, 'github-polling');
    } catch (error) {
      logger.error(`Failed to acknowledge command in ${repository}#${issueNumber}: ${error instanceof Error ? error.message : String(error)}`, undefined, 'github-polling');
    }
  }

  /**
   * Get current polling status
   */
  getStatus() {
    const operatingMode = stateManager.getOperatingMode();
    return {
      isRunning: !!this.pollingTimeout && operatingMode === 'running',
      systemMode: operatingMode,
      intervalMs: this.intervalMs,
      lastPollTime: this.lastPollTime,
      configuredRepositories: stateManager.getConfiguredRepositories(),
      processedCommandsCount: this.processedCommands.size
    };
  }
}

// Export singleton instance
export const gitHubPollingManager = new GitHubPollingManager();
