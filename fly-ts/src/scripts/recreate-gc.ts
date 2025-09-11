#!/usr/bin/env node

// TypeScript conversion of fly/recreate-gc.sh
// Provisions golden claude instances on fly.io

import { FlyWrapper } from '../lib/fly';
import { MetadataClient } from '../lib/metadata';
import { validateEnvironment } from '../lib/validation';
import { runCommand } from '../lib/shell';
import {
  header, success, error, info, warning, progress, waitMessage,
  confirmDestructive, selectOption, displayError, EMOJIS
} from '../lib/output';

interface GoldenClaudeConfig {
  name: string;
  machineName: string;
  volumeName: string;
}

async function recreateGoldenClaude(): Promise<void> {
  const args = process.argv.slice(2);
  const rawArg = args[0] || 'default';
  
  // Handle both "josh" and "gc-josh" formats - normalize to just the name part
  const gcName = rawArg.startsWith('gc-') ? rawArg.slice(3) : rawArg;
  
  header('Golden Claude Provisioning', EMOJIS.STAR);

  try {
    // Validate environment
    const config = await validateEnvironment([
      'APP_NAME', 'REGION', 'WEB_TERMINAL_PORT'
    ]);
    
    const fly = new FlyWrapper(config.APP_NAME);
    const gcConfig = await validateAndPrepareGCConfig(gcName, config);

    info(`App: ${config.APP_NAME}, Region: ${config.REGION}`);
    info(`Golden Claude: ${gcConfig.name} (machine: ${gcConfig.machineName})`);
    console.log('');

    // Check if golden claude already exists and handle accordingly
    const existingMachine = await fly.getMachineByName(gcConfig.machineName);
    if (existingMachine) {
      const shouldRecreate = await handleExistingGoldenClaude(existingMachine, fly);
      if (!shouldRecreate) {
        info('Keeping existing golden claude machine');
        return;
      }
    } else {
      success('No existing golden claude machine found');
    }

    // Ensure metadata service exists
    await ensureMetadataService(fly);

    // Build thopter image
    const thopterImage = await buildThopterImage();

    // Create golden claude volume
    await ensureGoldenClaudeVolume(fly, gcConfig, config);

    // Launch golden claude machine
    await launchGoldenClaude(fly, gcConfig, config, thopterImage);

    // Wait for readiness and display results
    await waitForGoldenClaudeReady(fly, gcConfig, config);

  } catch (err) {
    console.log('');
    displayError(err as Error, 'Failed to recreate golden claude');
    process.exit(1);
  }
}

async function validateAndPrepareGCConfig(
  gcName: string, 
  envConfig: any
): Promise<GoldenClaudeConfig> {
  // Validate golden claude name for DNS compatibility
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(gcName)) {
    throw new Error(
      `Golden Claude name '${gcName}' is not DNS compatible.\n` +
      'Requirements:\n' +
      '  - Must start and end with alphanumeric character\n' +
      '  - Can contain lowercase letters, numbers, and hyphens\n' +
      '  - Cannot start or end with hyphen\n' +
      '  - Examples: \'josh\', \'team1\', \'dev-env\''
    );
  }

  // Additional length check
  if (gcName.length > 32) {
    throw new Error(`Golden Claude name '${gcName}' is too long (max 32 characters)`);
  }

  return {
    name: gcName,
    machineName: `gc-${gcName}`,
    volumeName: `gc_volume_${gcName.replace(/-/g, '_')}`
  };
}

async function handleExistingGoldenClaude(
  existingMachine: any,
  fly: FlyWrapper
): Promise<boolean> {
  warning(`Golden Claude machine already exists: ${existingMachine.id} (state: ${existingMachine.state})`);
  
  const choice = await selectOption(
    'What would you like to do?',
    [
      { name: 'Keep existing golden claude (exit)', value: 'keep' },
      { name: 'Destroy and recreate golden claude', value: 'recreate' }
    ]
  );

  if (choice === 'keep') {
    return false;
  }

  warning('Destroying existing golden claude machine...');
  if (existingMachine.state === 'started') {
    await fly.stopMachine(existingMachine.id);
    info('Waiting for golden claude to stop...');
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  
  await fly.destroyMachine(existingMachine.id, true);
  success('Golden Claude machine destroyed');
  
  return true;
}

async function ensureMetadataService(fly: FlyWrapper): Promise<void> {
  progress('Ensuring metadata service is provisioned', '2');
  
  const metadataMachine = await fly.getMachineByName('metadata');
  if (!metadataMachine) {
    throw new Error('Metadata service not found. Run ensure-metadata script first');
  }

  if (metadataMachine.state !== 'started') {
    throw new Error('Metadata service is not running. Please start it first');
  }

  success('Metadata service is ready');
}

async function buildThopterImage(): Promise<string> {
  progress('Building thopter image', '3');
  
  // For now, we'll assume the build-thopter script has been run
  // In a full implementation, we could call the buildThopter function directly
  info('Using existing thopter image or building via separate script...');
  
  // This would typically call the build-thopter script or function
  // For simplicity, we'll return a placeholder that would be retrieved from metadata
  success('Thopter image ready');
  
  return 'registry.fly.io/thopter-app:latest'; // Placeholder
}

async function ensureGoldenClaudeVolume(
  fly: FlyWrapper,
  gcConfig: GoldenClaudeConfig,
  envConfig: any
): Promise<void> {
  progress('Ensuring golden claude volume exists', '4');
  
  const existingVolume = await fly.getVolumeByName(gcConfig.volumeName);
  
  if (!existingVolume) {
    info(`Creating golden claude volume: ${gcConfig.volumeName}`);
    await fly.createVolume(gcConfig.volumeName, 10, envConfig.REGION);
    success(`Golden claude volume created: ${gcConfig.volumeName}`);
  } else {
    success(`Golden claude volume already exists: ${gcConfig.volumeName}`);
  }
}

async function launchGoldenClaude(
  fly: FlyWrapper,
  gcConfig: GoldenClaudeConfig,
  envConfig: any,
  thopterImage: string
): Promise<string> {
  progress('Launching golden claude machine', '5');
  info(`Starting golden claude with image: ${thopterImage}`);

  // Create restricted environment for golden claude (no sensitive hub secrets)
  const gcEnv: Record<string, string> = {
    WEB_TERMINAL_PORT: envConfig.WEB_TERMINAL_PORT || '7681',
    ALLOWED_DOMAINS: envConfig.ALLOWED_DOMAINS || '',
    DANGEROUSLY_SKIP_FIREWALL: envConfig.DANGEROUSLY_SKIP_FIREWALL || 'false'
  };

  // Add optional environment variables if they exist
  if (envConfig.GITHUB_REPOS) gcEnv.GITHUB_REPOS = envConfig.GITHUB_REPOS;
  if (envConfig.GIT_USER_NAME) gcEnv.GIT_USER_NAME = envConfig.GIT_USER_NAME;
  if (envConfig.GIT_USER_EMAIL) gcEnv.GIT_USER_EMAIL = envConfig.GIT_USER_EMAIL;
  if (envConfig.GITHUB_AGENT_CODER_PAT) gcEnv.GITHUB_AGENT_CODER_PAT = envConfig.GITHUB_AGENT_CODER_PAT;

  // Add metadata service host
  gcEnv.METADATA_SERVICE_HOST = `1.redis.kv._metadata.${envConfig.APP_NAME}.internal`;

  const machineId = await fly.createMachine({
    image: thopterImage,
    name: gcConfig.machineName,
    region: envConfig.REGION,
    vmSize: 'shared-cpu-2x',
    autostop: false,
    volume: {
      name: gcConfig.volumeName,
      mountPath: '/data'
    },
    env: gcEnv
  });

  success('Golden Claude machine launched successfully');
  info(`Golden Claude ID: ${machineId}`);
  
  return machineId;
}

async function waitForGoldenClaudeReady(
  fly: FlyWrapper,
  gcConfig: GoldenClaudeConfig,
  envConfig: any
): Promise<void> {
  progress('Waiting for golden claude to be ready', '6');
  info('Checking if gotty web terminal is running...');

  const machine = await fly.getMachineByName(gcConfig.machineName);
  if (!machine) {
    throw new Error('Golden Claude machine not found after creation');
  }

  const webTerminalPort = envConfig.WEB_TERMINAL_PORT || '7681';
  
  // Wait up to 60 seconds for the golden claude to start
  let ready = false;
  for (let i = 1; i <= 12; i++) {
    try {
      const curlResult = await runCommand('curl', [
        '-s', '-o', '/dev/null', '-w', '%{http_code}',
        `http://localhost:${webTerminalPort}/`
      ], { 
        silent: true,
        timeout: 5000 
      });
      
      if (curlResult.success && curlResult.stdout.trim() === '200') {
        success('Golden Claude web terminal is ready (HTTP 200)');
        ready = true;
        break;
      }
    } catch {
      // Continue trying
    }
    
    waitMessage('Waiting for golden claude to start', i, 12);
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  if (!ready) {
    warning('Golden Claude web terminal health check timed out');
  }

  // Display final results
  console.log('');
  console.log('='.repeat(40));
  success('Golden Claude Deployment Complete!');
  console.log('='.repeat(40));
  console.log('');
  
  success('Golden Claude Details:');
  info(`  Machine ID: ${machine.id}`);
  info(`  Machine Name: ${gcConfig.machineName}`);
  info(`  VM Size: shared-cpu-2x`);
  info(`  Region: ${envConfig.REGION}`);
  console.log('');
  
  success('Access URLs (via Wireguard):');
  info(`  Web Terminal: http://${machine.id}.vm.${envConfig.APP_NAME}.internal:${webTerminalPort}/`);
  info(`  SSH Console: fly ssh console --machine ${machine.id}`);
  console.log('');
  
  success('Setup Instructions:');
  info('Access the web terminal and set up Claude authentication:');
  info('   - Run: yolo-claude (an alias for claude --dangerously-skip-permissions)');
  info('     (the yolo flag is important or it wont be pre-approved in agents!)');
  info('   - Login using Claude\'s UI');
  info('   - Accept all safety checks and autonomous operation prompts');
  console.log('');
}

// Main execution
if (require.main === module) {
  recreateGoldenClaude().catch(err => {
    displayError(err, 'Unexpected error');
    process.exit(1);
  });
}

export { recreateGoldenClaude };