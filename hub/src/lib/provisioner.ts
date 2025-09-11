import { execSync, exec } from 'child_process';
import { promisify } from 'util';
import * as http from 'http';
import { readFileSync } from 'fs';
import { join } from 'path';
import { metadataClient } from './metadata-client';
import { ProvisionRequest } from './types';
import tinyspawn from 'tinyspawn';
import { stateManager } from './state-manager';

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

// ProvisionRequest now imported from ./types

export interface ProvisionResult {
  success: boolean;
  agentId: string;
  machineId?: string;
  error?: string;
  webTerminalUrl?: string;
}

export interface DestroyResult {
  success: boolean;
  agentId: string;
  error?: string;
}

export class ThopterProvisioner {
  private readonly appName: string;
  private readonly region: string;
  private readonly maxAgents: number;
  private readonly webTerminalPort: number;
  private readonly hubHost: string;
  private readonly hubStatusPort: number;
  private readonly flyToken: string;
  private readonly thopterVmSize: string;
  private readonly thopterVolumeSize: string;
  private readonly fly: any;
  
  constructor() {
    this.appName = process.env.APP_NAME!;
    this.region = process.env.REGION!;
    // THOPTER_IMAGE now comes from metadata service, not environment
    this.maxAgents = parseInt(process.env.MAX_THOPTERS || process.env.MAX_AGENTS!);
    this.webTerminalPort = parseInt(process.env.WEB_TERMINAL_PORT!);
    // Hub host should be auto-detected from current machine hostname or environment
    this.hubHost = process.env.HUB_HOST || this.getHubHost();
    this.hubStatusPort = parseInt(process.env.HUB_STATUS_PORT!);
    this.flyToken = process.env.FLY_DEPLOY_KEY!;
    this.thopterVmSize = process.env.THOPTER_VM_SIZE || 'shared-cpu-1x';
    this.thopterVolumeSize = process.env.THOPTER_VOLUME_SIZE || '10';
    
    // Initialize our custom fly wrapper
    this.fly = createFlyWrapper(this.appName);
  }

  /**
   * Auto-detect hub host from current machine hostname
   */
  private getHubHost(): string {
    try {
      const hostname = require('os').hostname();
      // In fly.io, hostname is the machine ID
      return `${hostname}.vm.${this.appName}.internal`;
    } catch (error) {
      console.warn('Failed to auto-detect hub host, using localhost fallback');
      return 'localhost';
    }
  }

  /**
   * Async health check using native HTTP
   */
  private async checkHealthAsync(url: string): Promise<number> {
    return new Promise((resolve) => {
      const urlParts = new URL(url);
      const req = http.request({
        hostname: urlParts.hostname,
        port: urlParts.port,
        path: urlParts.pathname,
        method: 'GET',
        timeout: 3000
      }, (res) => {
        resolve(res.statusCode || 0);
        res.resume(); // Consume response data to free up memory
      });

      req.on('error', () => resolve(0));
      req.on('timeout', () => {
        req.destroy();
        resolve(0);
      });

      req.end();
    });
  }

  /**
   * Main provisioning routine - creates a new thopter agent for a GitHub issue
   */
  async provision(request: ProvisionRequest): Promise<ProvisionResult> {
    const requestId = `${request.repository}#${request.github.issueNumber}`;
    console.log(`🚁 [${requestId}] Starting provisioning for issue: ${request.github.issueTitle}`);
    
    try {
      // Check if we're at max capacity
      console.log(`🔍 [${requestId}] Checking agent capacity...`);
      const activeAgents = await this.getActiveAgentCount();
      console.log(`📊 [${requestId}] Active agents: ${activeAgents}/${this.maxAgents}`);
      if (activeAgents >= this.maxAgents) {
        return {
          success: false,
          agentId: 'capacity-exceeded',
          error: `Maximum agents (${this.maxAgents}) already running. Active: ${activeAgents}`
        };
      }

      // Ensure we have an available volume for the thopter
      console.log(`💾 [${requestId}] Ensuring available volume...`);
      const volumeName = await this.ensureAvailableVolume();
      console.log(`📦 [${requestId}] Using volume: ${volumeName}`);

      // Create and configure the thopter machine
      console.log(`🚀 [${requestId}] Creating thopter machine...`);
      const machineId = await this.createThopterMachine(request, volumeName);
      console.log(`🆔 [${requestId}] Machine created with ID: ${machineId}`);
      
      // Wait for machine to be ready and web terminal to start
      console.log(`⏳ [${requestId}] Waiting for machine to be ready...`);
      const webTerminalUrl = await this.waitForThopterReady(machineId);
      console.log(`🌐 [${requestId}] Machine ready. Web terminal: ${webTerminalUrl}`);

      // Copy Golden Claude data if available (optional step)
      console.log(`🏆 [${requestId}] Checking for Golden Claude data...`);
      await this.copyGoldenClaudeData(machineId, requestId, request.gc);

      // Setup Git configuration and clone repository
      console.log(`🔧 [${requestId}] Setting up Git configuration and cloning repository...`);
      await this.setupGitAndCloneRepo(machineId, request, requestId);

      // Copy issue and prompt files to the machine after it's ready
      console.log(`📄 [${requestId}] Copying context files to machine...`);
      const issueContent = this.prepareIssueContent(request);
      const promptContent = this.preparePromptContent(request, machineId);
      const issueJsonContent = this.prepareIssueJsonContent(request, machineId);
      await this.copyFilesToMachine(machineId, issueContent, promptContent, issueJsonContent);
      console.log(`📋 [${requestId}] Context files copied successfully`);

      // Launch Claude in tmux session (final step)
      console.log(`🚀 [${requestId}] Launching Claude in tmux session...`);
      await this.launchClaudeInTmux(machineId, requestId);

      console.log(`✅ [${requestId}] Thopter ${machineId} provisioned successfully`);
      return {
        success: true,
        agentId: machineId, // Agent ID is the machine ID
        machineId,
        webTerminalUrl
      };

    } catch (error) {
      console.error(`❌ [${requestId}] Provisioning failed:`, error);
      return {
        success: false,
        agentId: 'provision-failed',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }


  /**
   * Ensure an available volume exists for a new thopter
   */
  private async ensureAvailableVolume(): Promise<string> {
    try {
      const volumePoolName = 'thopter_data';
      
      // Get list of all volumes using flyctl
      const volumesOutput = await this.fly(['volumes', 'list', '--json', '-t', this.flyToken]);
      const volumes = JSON.parse(volumesOutput);
      
      // Count unattached volumes in the thopter_data pool
      const availableVolumes = volumes.filter((vol: any) => 
        vol.name === volumePoolName && 
        (!vol.attached_alloc_id || vol.attached_alloc_id === null) &&
        (!vol.attached_machine_id || vol.attached_machine_id === null)
      );

      if (availableVolumes.length > 0) {
        console.log(`🔍 Found ${availableVolumes.length} available volumes in pool: ${volumePoolName}`);
        return volumePoolName;
      }

      // No available volumes found, create a new one in the pool
      console.log(`📦 Creating new volume in pool: ${volumePoolName}`);
      await this.fly(['volume', 'create', volumePoolName, '--size', this.thopterVolumeSize, '--region', this.region, '-t', this.flyToken, '-y']);

      console.log(`✅ Volume created in pool: ${volumePoolName}`);
      return volumePoolName;

    } catch (error) {
      console.error('❌ Volume management failed:', error);
      throw new Error(`Failed to ensure available volume: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get count of currently active thopter agents
   */
  private async getActiveAgentCount(): Promise<number> {
    try {
      const output = await this.fly(['machines', 'list', '--json', '-t', this.flyToken]);
      const machines = JSON.parse(output);
      const thopterMachines = machines.filter((m: any) => 
        m.name && m.name.startsWith('thopter-') && m.state === 'started'
      );
      
      return thopterMachines.length;
    } catch (error) {
      console.warn('Failed to get active agent count:', error);
      return 0; // Assume 0 if we can't check
    }
  }


  /**
   * Create and start a new thopter machine
   */
  private async createThopterMachine(request: ProvisionRequest, volumeName: string): Promise<string> {
    console.log(`🚀 Creating thopter machine...`);

    // Get repository-specific GitHub config
    const repoConfig = stateManager.getGitHubConfig(request.repository);
    if (!repoConfig) {
      throw new Error(`No GitHub configuration found for repository: ${request.repository}`);
    }

    // Get thopter image from metadata service
    let thopterImage: string | null = null;
    try {
      thopterImage = await metadataClient.getThopterImage();
    } catch (error) {
      console.log(`⚠️ Warning: Could not connect to metadata service: ${error}`);
      throw new Error('Metadata service unavailable - cannot retrieve thopter image for provisioning');
    }
    
    if (!thopterImage) {
      throw new Error('THOPTER_IMAGE not set in metadata service - thopter image must be built first');
    }

    console.log(`📦 Using thopter image: ${thopterImage}`);

    // Generate a fly-compatible machine name with random suffix for uniqueness
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    const machineName = `thopter-${request.github.issueNumber}-${random}`
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .slice(0, 50); // Fly machine name length limit

    // Create machine with proper environment and volume mount using flyctl
    const machineRunArgs = [
      'machine', 'run',
      thopterImage,
      '--name', machineName,
      '--region', this.region,
      '--autostop=off',
      '--vm-size', this.thopterVmSize,
      '--volume', `${volumeName}:/data`,
      '--env', `METADATA_SERVICE_HOST=${process.env.METADATA_SERVICE_HOST}`,
      '--env', `APP_NAME=${this.appName}`,
      '--env', `WEB_TERMINAL_PORT=${this.webTerminalPort}`,
      '--env', `HUB_STATUS_PORT=${process.env.HUB_STATUS_PORT}`,
      '--env', `GITHUB_REPO_PAT=${repoConfig.agentCoderPAT}`,
      '--env', `REPOSITORY=${request.repository}`,
      '--env', `ISSUE_NUMBER=${request.github.issueNumber}`,
      '--env', `GIT_USER_NAME=${repoConfig.userName}`,
      '--env', `GIT_USER_EMAIL=${repoConfig.userEmail}`,
      '--env', `DANGEROUSLY_SKIP_FIREWALL=${process.env.DANGEROUSLY_SKIP_FIREWALL || '0'}`,
      '--env', `ALLOWED_DOMAINS=${process.env.ALLOWED_DOMAINS || ''}`,
      '-t', this.flyToken,
      '--detach'
    ];

    // Add .env.thopters file if it exists on hub
    const envFilePath = '/data/thopter-env/.env.thopters';
    if (require('fs').existsSync(envFilePath)) {
      console.log(`  ✅ Found .env.thopters file, including in machine creation`);
      machineRunArgs.push('--file-local', `/tmp/.env.thopters=${envFilePath}`);
    }

    console.log(`Executing async: fly ${machineRunArgs.join(' ')}`);
    
    let output: string;
    try {
      output = await this.fly(machineRunArgs);
    } catch (error) {
      console.error(`❌ Machine creation command failed:`, error);
      throw new Error(`Failed to create thopter machine: ${error instanceof Error ? error.message : String(error)}`);
    }

    console.log(`Machine creation output:`, output);

    // Extract machine ID from output - look for "Machine ID: " pattern first, then fallback to hex pattern
    let machineId: string;
    const machineIdLineMatch = output.match(/Machine ID:\s+([a-f0-9]{14})/);
    if (machineIdLineMatch) {
      machineId = machineIdLineMatch[1];
    } else {
      // Fallback to finding any 14-character hex string
      const hexMatch = output.match(/([a-f0-9]{14})/);
      if (!hexMatch) {
        throw new Error(`Failed to extract machine ID from fly output. Output: ${output}`);
      }
      machineId = hexMatch[1];
    }

    // Validate machine ID format
    if (!/^[a-f0-9]{14}$/.test(machineId)) {
      throw new Error(`Invalid machine ID format: ${machineId}. Expected 14 hex characters.`);
    }

    // Verify machine actually exists
    try {
      const verifyOutput = await this.fly(['machines', 'list', '--json', '-t', this.flyToken]);
      const machines = JSON.parse(verifyOutput);
      const machine = machines.find((m: any) => m.id === machineId);
      
      if (!machine) {
        throw new Error(`Machine ${machineId} was not found after creation. It may have failed to start or been destroyed.`);
      }
      
      console.log(`✅ Thopter machine created and verified: ${machineId}`);
    } catch (error) {
      if (error instanceof Error && error.message.includes('was not found after creation')) {
        throw error;
      }
      throw new Error(`Machine ${machineId} was not found after creation. It may have failed to start or been destroyed.`);
    }

    return machineId;
  }

  /**
   * Copy issue context and prompt files to the thopter machine
   */
  private async copyFilesToMachine(machineId: string, issueContent: string, promptContent: string, issueJsonContent: string): Promise<void> {
    console.log(`📄 Copying context files to machine ${machineId}`);

    // Create temporary files
    const issueFile = `/tmp/issue-${Date.now()}.md`;
    const promptFile = `/tmp/prompt-${Date.now()}.md`;
    const issueJsonFile = `/tmp/issue-${Date.now()}.json`;

    try {
      // Write temporary files
      require('fs').writeFileSync(issueFile, issueContent);
      require('fs').writeFileSync(promptFile, promptContent);
      require('fs').writeFileSync(issueJsonFile, issueJsonContent);

      // Copy files to machine using fly ssh sftp shell
      const execAsync = promisify(exec);
      
      await execAsync(`echo "put ${issueFile} /data/thopter/issue.md" | fly ssh sftp shell --machine ${machineId} -a ${this.appName} -t "${this.flyToken}"`, {
        cwd: process.cwd(),
        shell: '/bin/bash'
      });

      await execAsync(`echo "put ${promptFile} /data/thopter/prompt.md" | fly ssh sftp shell --machine ${machineId} -a ${this.appName} -t "${this.flyToken}"`, {
        cwd: process.cwd(),
        shell: '/bin/bash'
      });

      await execAsync(`echo "put ${issueJsonFile} /data/thopter/issue.json" | fly ssh sftp shell --machine ${machineId} -a ${this.appName} -t "${this.flyToken}"`, {
        cwd: process.cwd(),
        shell: '/bin/bash'
      });

      console.log(`✅ Context files copied successfully`);

    } finally {
      // Clean up temporary files
      try {
        require('fs').unlinkSync(issueFile);
        require('fs').unlinkSync(promptFile);
        require('fs').unlinkSync(issueJsonFile);
      } catch (error) {
        console.warn('Failed to cleanup temp files:', error);
      }
    }
  }

  /**
   * Wait for thopter to be ready and return web terminal URL
   */
  private async waitForThopterReady(machineId: string): Promise<string> {
    console.log(`⏳ Waiting for thopter ${machineId} to be ready...`);
    
    const maxDuration = 30000; // 30 seconds total
    const startTime = Date.now();
    let attempts = 0;

    while (Date.now() - startTime < maxDuration) {
      attempts++;
      try {
        // Check if web terminal is responding via internal DNS
        const internalUrl = `http://${machineId}.vm.${this.appName}.internal:${this.webTerminalPort}/`;
        const healthCheck = await this.checkHealthAsync(internalUrl);

        if (healthCheck === 200) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`✅ Thopter ready after ${elapsed}s! Web terminal: ${internalUrl}`);
          return internalUrl;
        }
      } catch (error) {
        // Health check failed, continue waiting
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`⏳ Attempt ${attempts} at ${elapsed}s - thopter not ready yet`);
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds between attempts
    }

    throw new Error(`Thopter ${machineId} failed to become ready within 30 seconds`);
  }

  /**
   * Prepare issue content markdown
   */
  private prepareIssueContent(request: ProvisionRequest): string {
    let content = `# GitHub Issue

**Repository:** ${request.repository}
**Id:** ${request.github.issueNumber}
**Title:** ${request.github.issueTitle}
**URL:** ${request.github.issueUrl}
**Author:** ${request.github.issueAuthor}

## Issue Description

${request.github.issueBody}
`;

    // Add conversation thread if comments exist
    if (request.github.comments && request.github.comments.length > 0) {
      content += `\n## Conversation Thread\n\n`;
      
      for (const comment of request.github.comments) {
        const commentDate = new Date(comment.createdAt).toISOString().split('T')[0];
        content += `### Comment by @${comment.author} (${commentDate})\n\n`;
        content += `${comment.body}\n\n`;
        content += `*[View comment](${comment.url})*\n\n---\n\n`;
      }
    }

    content += `---
*This file was generated automatically by the Thopter Swarm provisioner*
`;

    return content;
  }

  /**
   * Prepare initial prompt for Claude Code
   */
  private preparePromptContent(request: ProvisionRequest, machineId: string): string {
    const branchName = `thopter/${request.github.issueNumber}--${machineId}`;
    const repoName = request.repository.split('/')[1];
    
    // Load template file - use specified prompt or default
    // Normalize prompt name: strip .md extension, lowercase, then add .md back
    let promptName = request.prompt || 'default';
    promptName = promptName.replace(/\.md$/i, '').toLowerCase();
    
    // Try to load the requested template, fall back to default if not found
    let templatePath = join(__dirname, '../../templates/prompts', `${promptName}.md`);
    let template: string;
    
    try {
      template = readFileSync(templatePath, 'utf8');
    } catch (error) {
      if (promptName !== 'default') {
        console.log(`⚠️ Prompt template "${promptName}.md" not found, falling back to default.md`);
        templatePath = join(__dirname, '../../templates/prompts', 'default.md');
        template = readFileSync(templatePath, 'utf8');
      } else {
        throw new Error(`Default prompt template not found at ${templatePath}`);
      }
    }
    
    // Replace template variables
    return template
      .replace(/\{\{repository\}\}/g, request.repository)
      .replace(/\{\{workBranch\}\}/g, branchName)
      .replace(/\{\{repoName\}\}/g, repoName)
      .replace(/\{\{issueNumber\}\}/g, request.github.issueNumber)
      .replace(/\{\{machineId\}\}/g, machineId);
  }

  /**
   * Prepare issue JSON context for observer
   */
  private prepareIssueJsonContent(request: ProvisionRequest, machineId: string): string {
    const branchName = `thopter/${request.github.issueNumber}--${machineId}`;
    
    const issueContext = {
      source: 'github',
      repository: request.repository,
      workBranch: branchName,
      github: {
        issueNumber: request.github.issueNumber,
        issueTitle: request.github.issueTitle,
        issueBody: request.github.issueBody,
        issueUrl: request.github.issueUrl,
        issueAuthor: request.github.issueAuthor,
        mentionAuthor: request.github.mentionAuthor,
        mentionLocation: request.github.mentionLocation,
        mentionCommentId: request.github.mentionCommentId,
        comments: request.github.comments || []
      }
    };
    
    return JSON.stringify(issueContext, null, 2);
  }

  /**
   * Find a specific Golden Claude machine for credential copying
   */
  private async findAvailableGoldenClaude(gcName: string = 'default'): Promise<string | null> {
    try {
      // Get list of all machines using async flyctl
      const output = await this.fly(['machines', 'list', '--json', '-t', this.flyToken]);
      
      const machines = JSON.parse(output);
      
      // Handle both "xyz" and "gc-xyz" formats
      const targetName = gcName.startsWith('gc-') ? gcName : `gc-${gcName}`;
      
      // Look for the specific GC machine in started state
      const gcMachine = machines.find((m: any) => 
        m.name === targetName && m.state === 'started'
      );
      
      if (gcMachine) {
        console.log(`✅ Found available Golden Claude: ${gcMachine.name} (${gcMachine.id})`);
        return gcMachine.id;
      }
      
      // If specific GC not found, fall back to gc-default if not already trying it
      if (gcName !== 'default') {
        console.log(`ℹ️ Golden Claude '${gcName}' not found, falling back to 'default'`);
        return this.findAvailableGoldenClaude('default');
      }
      
      console.log(`ℹ️ No Golden Claude machines found (looking for ${targetName} in started state)`);
      return null;
      
    } catch (error) {
      console.warn('Failed to find Golden Claude machines:', error);
      return null;
    }
  }

  /**
   * Copy Golden Claude home directory data to a newly provisioned thopter
   */
  private async copyGoldenClaudeData(thopterMachineId: string, requestId: string, gcName?: string): Promise<void> {
    const startTime = Date.now();
    
    try {
      // Find an available Golden Claude machine
      const gcMachineId = await this.findAvailableGoldenClaude(gcName);
      if (!gcMachineId) {
        console.log(`ℹ️ [${requestId}] Skipping Golden Claude data copy - no Golden Claude available`);
        return;
      }
      
      console.log(`📦 [${requestId}] Copying data from Golden Claude ${gcMachineId} to thopter ${thopterMachineId}`);
      
      // Generate unique filenames to avoid conflicts
      const timestamp = Date.now();
      const gcSnapshotPath = `/tmp/gc-snapshot-${timestamp}.tgz`;
      const localSnapshotPath = `/tmp/gc-local-${timestamp}.tgz`;
      
      try {
        // Step 1: Create tarball on Golden Claude machine
        console.log(`  1️⃣ Creating snapshot on Golden Claude...`);
        const execAsync = promisify(exec);
        await execAsync(
          `fly ssh console -C "tar czf ${gcSnapshotPath} -C /data/thopter ." --machine ${gcMachineId} -t "${this.flyToken}" -a ${this.appName}`,
          { 
            cwd: process.cwd()
          }
        );
        
        // Step 2: Download tarball from Golden Claude
        console.log(`  2️⃣ Downloading snapshot from Golden Claude...`);
        await execAsync(
          `fly ssh sftp get ${gcSnapshotPath} ${localSnapshotPath} --machine ${gcMachineId} -t "${this.flyToken}" -a ${this.appName}`,
          { 
            cwd: process.cwd()
          }
        );
        
        // Step 3: Upload tarball to thopter
        console.log(`  3️⃣ Uploading snapshot to thopter...`);
        await execAsync(
          `echo "put ${localSnapshotPath} /data/thopter/gc-snapshot.tgz" | fly ssh sftp shell --machine ${thopterMachineId} -t "${this.flyToken}" -a ${this.appName}`,
          { 
            cwd: process.cwd(),
            shell: '/bin/bash'
          }
        );
        
        // Step 4: Extract tarball and fix permissions on thopter
        console.log(`  4️⃣ Extracting snapshot and setting permissions...`);
        await execAsync(
          `fly ssh console -C "sh -c 'cd /data/thopter && tar -xzf gc-snapshot.tgz && rm gc-snapshot.tgz && chown -R thopter:thopter /data/thopter'" --machine ${thopterMachineId} -t "${this.flyToken}" -a ${this.appName}`,
          { 
            cwd: process.cwd()
          }
        );
        
        // Step 5: Clean up Golden Claude temp file
        console.log(`  5️⃣ Cleaning up temporary files...`);
        try {
          await execAsync(
            `fly ssh console -C "rm -f ${gcSnapshotPath}" --machine ${gcMachineId} -t "${this.flyToken}" -a ${this.appName}`,
            { 
              cwd: process.cwd()
            }
          );
        } catch (cleanupError) {
          console.warn(`    ⚠️ Failed to cleanup GC temp file: ${cleanupError}`);
        }
        
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`✅ [${requestId}] Golden Claude data copied successfully in ${elapsed}s`);
        
      } finally {
        // Always try to clean up local temp file
        try {
          require('fs').unlinkSync(localSnapshotPath);
        } catch (error) {
          // Ignore cleanup errors
        }
      }
      
    } catch (error) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.error(`⚠️ [${requestId}] Golden Claude data copy failed after ${elapsed}s:`, error);
      console.log(`ℹ️ [${requestId}] Continuing provisioning without Golden Claude data`);
      // Don't throw - this is an optional step
    }
  }

  /**
   * Setup Git configuration and clone repository in the thopter machine
   */
  private async setupGitAndCloneRepo(machineId: string, request: ProvisionRequest, requestId: string): Promise<void> {
    const startTime = Date.now();
    
    try {
      // Get repository-specific GitHub config
      const repoConfig = stateManager.getGitHubConfig(request.repository);
      if (!repoConfig) {
        throw new Error(`No GitHub configuration found for repository: ${request.repository}`);
      }
      
      const gitUserName = repoConfig.userName;
      const gitUserEmail = repoConfig.userEmail;
      const githubToken = repoConfig.agentCoderPAT;

      const execAsync = promisify(exec);
      let gitConfigured = false;
      let workspaceCreated = false;
      let repositoryCloned = false;
      let branchCreated = false;
      
      // Step 1: Configure Git user identity
      console.log(`  1️⃣ Configuring Git user identity...`);
      try {
        await execAsync(
          `fly ssh console -C "su - thopter -c \\"git config --global user.name '${gitUserName}' && git config --global user.email '${gitUserEmail}'\\"" --machine ${machineId} -t "${this.flyToken}" -a ${this.appName}`,
          { 
            cwd: process.cwd()
          }
        );
        console.log(`  ✅ Configured Git user identity: ${gitUserName} <${gitUserEmail}>`);
        gitConfigured = true;
      } catch (error) {
        console.warn(`  ⚠️ Git configuration failed: ${error instanceof Error ? error.message : String(error)}`);
      }

      // Step 2: Create workspace directory
      // TODO this has already been created in the docker image but -p makes it safe
      console.log(`  2️⃣ Preparing workspace directory...`);
      try {
        await execAsync(
          `fly ssh console -C "su - thopter -c \\"mkdir -p /data/thopter/workspace\\"" --machine ${machineId} -t "${this.flyToken}" -a ${this.appName}`,
          { 
            cwd: process.cwd()
          }
        );
        console.log(`  ✅ Workspace directory ready`);
        workspaceCreated = true;
      } catch (error) {
        console.warn(`  ⚠️ Workspace creation failed: ${error instanceof Error ? error.message : String(error)}`);
      }

      // Step 3: Clone repository with PAT authentication (only if workspace was created)
      if (workspaceCreated) {
        console.log(`  3️⃣ Cloning repository ${request.repository}...`);
        try {
          const repositoryUrl = `https://${githubToken}@github.com/${request.repository}.git`;
          
          await execAsync(
            `fly ssh console -C "su - thopter -c \\"cd /data/thopter/workspace && git clone '${repositoryUrl}' \\"" --machine ${machineId} -t "${this.flyToken}" -a ${this.appName}`,
            { 
              cwd: process.cwd()
            }
          );
          console.log(`  ✅ Repository cloned successfully`);
          repositoryCloned = true;
        } catch (error) {
          console.warn(`  ⚠️ Repository clone failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      } else {
        console.log(`  ⏭️ Skipping repository clone (workspace creation failed)`);
      }

      // commenting out - prompt has instructions to claude to create branch more dynamically.
      // // Step 4: Create and checkout feature branch (only if repository was cloned)
      // if (repositoryCloned) {
      //   console.log(`  4️⃣ Creating feature branch...`);
      //   try {
      //     const branchName = `thopter/${request.github.issueNumber}--${machineId}`;
      //
      //     await execAsync(
      //       `fly ssh console -C "su - thopter -c \\"cd /data/thopter/workspace && git checkout -b '${branchName}'\\"" --machine ${machineId} -t "${this.flyToken}" -a ${this.appName}`,
      //       { 
      //         cwd: process.cwd()
      //       }
      //     );
      //     console.log(`  ✅ Feature branch created: ${branchName}`);
      //     branchCreated = true;
      //   } catch (error) {
      //     console.warn(`  ⚠️ Branch creation failed: ${error instanceof Error ? error.message : String(error)}`);
      //   }
      // } else {
      //   console.log(`  ⏭️ Skipping branch creation (repository clone failed)`);
      // }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      
      // Summary of what succeeded
      const successes = [];
      if (gitConfigured) successes.push('Git configured');
      if (workspaceCreated) successes.push('Workspace created');  
      if (repositoryCloned) successes.push('Repository cloned');
      if (branchCreated) successes.push('Branch created');
      
      if (successes.length > 0) {
        console.log(`✅ [${requestId}] Git setup completed in ${elapsed}s (${successes.join(', ')})`);
        console.log(`  📂 Repository: ${request.repository}`);
        if (branchCreated) {
          const branchName = `thopter/${request.github.issueNumber}--${machineId}`;
          console.log(`  🌿 Branch: ${branchName}`);
        }
        console.log(`  📁 Workspace: /data/thopter/workspace`);
      } else {
        console.log(`⚠️ [${requestId}] Git setup completed in ${elapsed}s (no steps succeeded)`);
      }
      
    } catch (error) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.error(`⚠️ [${requestId}] Git setup failed after ${elapsed}s:`, error);
      console.log(`ℹ️ [${requestId}] Continuing provisioning without repository clone`);
      // Don't throw - provision the agent and let a developer find out what's wrong
    }
  }

  /**
   * Launch Claude in the thopter's tmux session
   */
  private async launchClaudeInTmux(machineId: string, requestId: string): Promise<void> {
    const startTime = Date.now();
    
    try {
      const execAsync = promisify(exec);
      
      // already there
      // // Step 1: Change to workspace directory in tmux
      // console.log(`  1️⃣ Navigating to workspace in tmux...`);
      // try {
      //   await execAsync(
      //     `fly ssh console -C "su - thopter -c 'tmux send-keys -t thopter \\"cd /data/thopter/workspace\\" Enter'" --machine ${machineId} -t "${this.flyToken}" -a ${this.appName}`,
      //     { 
      //       cwd: process.cwd()
      //     }
      //   );
      //   console.log(`  ✅ Navigated to workspace`);
      // } catch (error) {
      //   console.warn(`  ⚠️ Failed to navigate to workspace: ${error instanceof Error ? error.message : String(error)}`);
      // }

      // Step 2: Launch Claude with prompt
      console.log(`  2️⃣ Launching Claude with instructions...`);
      try {
        await execAsync(
          `fly ssh console -C "su - thopter -c 'tmux send-keys -t thopter \\"claude --dangerously-skip-permissions \\\\\\\"read /data/thopter/prompt.md for your instructions\\\\\\\"\\" Enter'" --machine ${machineId} -t "${this.flyToken}" -a ${this.appName}`,
          { 
            cwd: process.cwd()
          }
        );
        console.log(`  ✅ Claude launched successfully`);
      } catch (error) {
        console.warn(`  ⚠️ Failed to launch Claude: ${error instanceof Error ? error.message : String(error)}`);
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`✅ [${requestId}] Claude launch completed in ${elapsed}s`);
      
    } catch (error) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.error(`⚠️ [${requestId}] Claude launch failed after ${elapsed}s:`, error);
      console.log(`ℹ️ [${requestId}] Thopter provisioned but Claude may need manual start`);
      // Don't throw - this is not a critical failure, the thopter is still usable
    }
  }

  /**
   * Destroy a thopter agent and its associated resources
   */
  async destroy(agentId: string): Promise<DestroyResult> {
    console.log(`🔥 Destroying thopter agent: ${agentId}`);
    
    try {
      // Get machine details to find associated volume
      let machineDetails;
      try {
        const machineOutput = await this.fly(['machines', 'list', '--json', '-t', this.flyToken]);
        const machines = JSON.parse(machineOutput);
        machineDetails = machines.find((m: any) => m.id === agentId);
      } catch (error) {
        console.warn(`Could not get machine details for ${agentId}:`, error);
      }
      
      // Stop and destroy the machine
      console.log(`🛑 Stopping machine ${agentId}...`);
      try {
        await this.fly(['machine', 'stop', agentId, '-t', this.flyToken]);
      } catch (error) {
        console.warn(`Machine stop failed (continuing with destroy):`, error);
      }
      
      console.log(`💥 Destroying machine ${agentId}...`);
      await this.fly(['machine', 'destroy', agentId, '-t', this.flyToken, '--force']);
      
      // Leave volumes in pool for reuse by future agents
      if (machineDetails?.config?.mounts?.length > 0) {
        console.log(`💾 Volumes left in pool for reuse: ${machineDetails.config.mounts.map((m: any) => m.volume).join(', ')}`);
      }
      
      console.log(`✅ Thopter ${agentId} destroyed successfully`);
      return {
        success: true,
        agentId
      };
      
    } catch (error) {
      console.error(`❌ Failed to destroy thopter ${agentId}:`, error);
      return {
        success: false,
        agentId,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}
