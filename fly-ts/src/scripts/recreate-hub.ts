#!/usr/bin/env node

// TypeScript conversion of fly/recreate-hub.sh
// Provisions the Thopter Swarm Hub on fly.io

import { FlyWrapper } from '../lib/fly';
import { DockerWrapper } from '../lib/docker';
import { MetadataClient } from '../lib/metadata';
import { validateEnvironment } from '../lib/validation';
import { runCommand } from '../lib/shell';
import {
  header, success, error, info, warning, progress, waitMessage,
  confirmDestructive, selectOption, displayError, EMOJIS
} from '../lib/output';

async function recreateHub(): Promise<void> {
  const args = process.argv.slice(2);
  const forceRecreate = args.includes('--force');
  
  header('Thopter Swarm Hub Provisioning', EMOJIS.HELICOPTER);

  try {
    // Validate environment
    const config = await validateEnvironment([
      'APP_NAME', 'REGION', 'HUB_VM_SIZE', 'HUB_PORT', 'HUB_STATUS_PORT'
    ]);
    
    const fly = new FlyWrapper(config.APP_NAME);
    const docker = new DockerWrapper();

    info(`App: ${config.APP_NAME}, Region: ${config.REGION}`);
    console.log('');

    // Check for existing hub machines and handle accordingly
    const shouldProceed = await handleExistingHubs(fly, forceRecreate);
    if (!shouldProceed) {
      return;
    }

    // Ensure metadata service exists
    await ensureMetadataService(fly);

    // Build and deploy hub
    const hubImage = await buildHubImage(docker, config);
    const hubMachineId = await deployHub(fly, hubImage, config);

    // Wait for hub readiness and verify connectivity
    await waitForHubReady(fly, hubMachineId, config);

  } catch (err) {
    console.log('');
    displayError(err as Error, 'Failed to recreate hub');
    process.exit(1);
  }
}

async function handleExistingHubs(fly: FlyWrapper, forceRecreate: boolean): Promise<boolean> {
  progress('Checking for existing hub machines', '1');
  
  const hubMachines = await fly.getMachinesByPrefix('hub-');
  
  if (hubMachines.length === 0) {
    success('No existing hub machines found');
    return true;
  }

  warning(`Found ${hubMachines.length} existing hub machine(s):`);
  hubMachines.forEach(hub => {
    info(`  ${hub.name} (${hub.id}) - state: ${hub.state}`);
  });

  let choice: 'keep' | 'destroy';
  if (forceRecreate) {
    warning('--force flag specified, destroying all existing hub machines...');
    choice = 'destroy';
  } else {
    choice = await selectOption(
      'What would you like to do?',
      [
        { name: 'Keep existing hub (exit)', value: 'keep' },
        { name: 'Destroy all hubs and recreate', value: 'destroy' }
      ]
    );
  }

  if (choice === 'keep') {
    info('Keeping existing hub machines');
    return false;
  }

  warning('Destroying all existing hub machines...');
  for (const hub of hubMachines) {
    info(`Destroying ${hub.name} (${hub.id})...`);
    
    if (hub.state === 'started') {
      await fly.stopMachine(hub.id);
      info(`Waiting for ${hub.name} to stop...`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    await fly.destroyMachine(hub.id, true);
  }
  
  success('All hub machines destroyed');
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

async function buildHubImage(docker: DockerWrapper, config: any): Promise<string> {
  progress('Building hub image', '3');
  
  const hubTag = await docker.generateImageTag('hub');
  const hubImage = `registry.fly.io/${config.APP_NAME}:${hubTag}`;

  info(`Image tag: ${hubTag}`);

  await docker.buildMultiPlatform({
    image: hubImage,
    context: './hub',
    buildArgs: {
      HUB_PORT: config.HUB_PORT,
      HUB_STATUS_PORT: config.HUB_STATUS_PORT
    }
  });

  // Push to registry with auth retry
  const fly = new FlyWrapper(config.APP_NAME);
  await fly.authenticateDocker();
  await docker.push(hubImage);
  await fly.authenticateDocker();
  await docker.push(hubImage);

  success('Hub image built and pushed successfully');
  return hubImage;
}

async function deployHub(fly: FlyWrapper, hubImage: string, config: any): Promise<string> {
  progress('Launching hub machine', '4');
  
  const epochSeconds = Math.floor(Date.now() / 1000);
  const hubMachineName = `hub-${epochSeconds}`;
  
  info(`Starting hub with image: ${hubImage}`);
  info(`Machine name: ${hubMachineName}`);

  const metadataServiceHost = `1.redis.kv._metadata.${config.APP_NAME}.internal`;

  const hubEnv: Record<string, string> = {
    APP_NAME: config.APP_NAME,
    REGION: config.REGION,
    MAX_THOPTERS: config.MAX_THOPTERS || '10',
    THOPTER_VM_SIZE: config.THOPTER_VM_SIZE || 'shared-cpu-1x',
    THOPTER_VOLUME_SIZE: config.THOPTER_VOLUME_SIZE || '1',
    HUB_VM_SIZE: config.HUB_VM_SIZE,
    DANGEROUSLY_SKIP_FIREWALL: config.DANGEROUSLY_SKIP_FIREWALL || 'false',
    ALLOWED_DOMAINS: config.ALLOWED_DOMAINS || '',
    WEB_TERMINAL_PORT: config.WEB_TERMINAL_PORT || '7681',
    HUB_PORT: config.HUB_PORT,
    HUB_STATUS_PORT: config.HUB_STATUS_PORT,
    METADATA_SERVICE_HOST: metadataServiceHost
  };

  // Add optional environment variables
  if (config.GITHUB_INTEGRATION_JSON) hubEnv.GITHUB_INTEGRATION_JSON = config.GITHUB_INTEGRATION_JSON;
  if (config.GITHUB_ISSUES_POLLING_INTERVAL) hubEnv.GITHUB_ISSUES_POLLING_INTERVAL = config.GITHUB_ISSUES_POLLING_INTERVAL;
  if (config.FLY_DEPLOY_KEY) hubEnv.FLY_DEPLOY_KEY = config.FLY_DEPLOY_KEY;

  const machineId = await fly.createMachine({
    image: hubImage,
    name: hubMachineName,
    region: config.REGION,
    vmSize: config.HUB_VM_SIZE,
    autostop: false,
    env: hubEnv,
    metadata: { hub: '1' }
  });

  success('Hub machine launched successfully');
  info(`Hub ID: ${machineId}`);

  // Update metadata service with hub information
  try {
    const metadata = MetadataClient.createServiceDiscoveryClient(config.APP_NAME);
    const pingSuccess = await metadata.ping();
    
    if (pingSuccess) {
      await metadata.hset('metadata', 'HUB_IMAGE', hubImage);
      success('Metadata service updated with hub information');
    } else {
      warning('Could not update metadata service (service discovery not responding)');
    }
  } catch {
    warning('Could not update metadata service');
  }

  return machineId;
}

async function waitForHubReady(fly: FlyWrapper, hubMachineId: string, config: any): Promise<void> {
  progress('Waiting for hub to start', '5');
  info('Checking if hub process is running...');

  // Check if hub is running internally
  let healthCheckPassed = false;
  for (let i = 1; i <= 12; i++) {
    try {
      const healthResult = await fly.sshCommand(
        hubMachineId,
        `curl -s http://fly-local-6pn:${config.HUB_PORT}/health`
      );
      
      if (healthResult.includes('"status":"ok"')) {
        success('Hub process is running and healthy');
        healthCheckPassed = true;
        break;
      }
    } catch {
      // Continue trying
    }
    
    waitMessage('Waiting for hub to start', i, 12);
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  if (!healthCheckPassed) {
    warning('Hub health check via SSH timed out');
  }

  // Test service discovery
  console.log('');
  progress('Waiting for hub service discovery', '6');
  
  const serviceHost = `1.hub.kv._metadata.${config.APP_NAME}.internal:${config.HUB_PORT}`;
  info(`Testing hub service discovery via ${serviceHost}`);
  
  let hubDnsReady = false;
  for (let i = 1; i <= 24; i++) {
    try {
      const dnsResult = await runCommand('curl', [
        '-s', '--connect-timeout', '2',
        `http://${serviceHost}/health`
      ], { silent: true });
      
      if (dnsResult.success && dnsResult.stdout.includes('"status":"ok"')) {
        success(`Hub service discovery working (attempt ${i})`);
        hubDnsReady = true;
        break;
      }
    } catch {
      // Continue trying
    }
    
    waitMessage('Hub service discovery not ready yet, waiting', i, 24);
    await new Promise(resolve => setTimeout(resolve, 10000));
  }

  if (!hubDnsReady) {
    error('Hub service discovery hostname not responding');
    process.exit(1);
  }

  // Test wireguard connectivity
  console.log('');
  progress('Testing Wireguard connectivity', '7');
  
  const hubUrl = `http://${hubMachineId}.vm.${config.APP_NAME}.internal:${config.HUB_PORT}/health`;
  
  try {
    const wireguardResult = await runCommand('curl', [
      '-s', '--connect-timeout', '3', hubUrl
    ], { silent: true });
    
    if (wireguardResult.success && wireguardResult.stdout.includes('"status":"ok"')) {
      success('Hub accessible via Wireguard');
    } else {
      warning('Cannot reach hub via Wireguard (this may be normal)');
    }
  } catch {
    warning('Cannot reach hub via Wireguard (this may be normal)');
    info('This could mean:');
    info('  - Wireguard VPN is not active');
    info('  - Hub is still starting up');
    info('  - Network connectivity issues');
  }

  // Display final results
  console.log('');
  console.log('='.repeat(40));
  success('Hub Deployment Complete!');
  console.log('='.repeat(40));
  console.log('');
  
  success('Hub Details:');
  info(`  Machine ID: ${hubMachineId}`);
  info(`  VM Size: ${config.HUB_VM_SIZE}`);
  info(`  Region: ${config.REGION}`);
  console.log('');
  
  success('Access URLs (service discovery):');
  info(`  Dashboard: http://1.hub.kv._metadata.${config.APP_NAME}.internal:${config.HUB_PORT}/`);
  info(`  Health: http://1.hub.kv._metadata.${config.APP_NAME}.internal:${config.HUB_PORT}/health`);
  info(`  Status Collector: http://1.hub.kv._metadata.${config.APP_NAME}.internal:${config.HUB_STATUS_PORT}/status`);
  console.log('');
}

// Main execution
if (require.main === module) {
  recreateHub().catch(err => {
    displayError(err, 'Unexpected error');
    process.exit(1);
  });
}

export { recreateHub };