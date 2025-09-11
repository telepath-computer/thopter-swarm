#!/usr/bin/env node

// TypeScript conversion of fly/status.sh
// Shows current state of all thopter swarm resources

import { FlyWrapper } from '../lib/fly';
import { MetadataClient } from '../lib/metadata';
import { validateEnvironment } from '../lib/validation';
import { 
  header, success, error, info, warning, section, detail, 
  displayError, EMOJIS 
} from '../lib/output';
import { FlyMachine, FlyVolume } from '../lib/types';

interface ResourceSummary {
  totalMachines: number;
  hubCount: number;
  metadataCount: number;
  gcCount: number;
  agentCount: number;
  appCount: number;
  totalVolumes: number;
  metadataVolumes: number;
  hubVolumes: number;
  gcVolumes: number;
  thopterVolumes: number;
}

async function showStatus(): Promise<void> {
  header('Thopter Swarm Status', EMOJIS.HELICOPTER);

  try {
    // Load environment (non-required for status)
    let config;
    try {
      config = await validateEnvironment([]);
    } catch {
      config = { APP_NAME: 'unknown', REGION: 'unknown' };
    }

    const fly = new FlyWrapper(config.APP_NAME !== 'unknown' ? config.APP_NAME : undefined);

    // 1. Environment Overview
    console.log(`Environment: ${config.APP_NAME} (${config.REGION})`);
    
    const machines = await fly.listMachines();
    const gcCount = machines.filter(m => m.name?.startsWith('gc-')).length;
    console.log(`Golden Claudes: ${gcCount} found (use './fly/recreate-gc.sh [name]' to create)`);
    console.log('');

    // 2. Metadata Service Status
    await showMetadataStatus(fly, machines, config.APP_NAME);

    // 3. Hub Status
    await showHubStatus(fly, machines, config.APP_NAME, config.HUB_PORT);

    // 4. Golden Claude Status
    await showGoldenClaudeStatus(machines, config.APP_NAME, config.WEB_TERMINAL_PORT);

    // 5. Platform App Machines
    await showPlatformAppMachines(machines);

    // 6. Agent Thopters
    await showAgentThopters(machines, config.APP_NAME, config.WEB_TERMINAL_PORT);

    // 7. Resource Summary
    await showResourceSummary(fly, machines);

  } catch (err) {
    console.log('');
    displayError(err as Error, 'Failed to get status');
    process.exit(1);
  }
}

async function showMetadataStatus(
  fly: FlyWrapper, 
  machines: FlyMachine[], 
  appName: string
): Promise<void> {
  section('Metadata Service:');
  
  const metadataMachine = machines.find(m => m.name === 'metadata');
  
  if (!metadataMachine) {
    error('  No metadata service found - run fly/recreate-hub.sh');
    console.log('');
    return;
  }

  const status = metadataMachine.state === 'started' ? EMOJIS.CHECK : EMOJIS.WARNING;
  console.log(`  ${status} metadata (${metadataMachine.id}) ${metadataMachine.state} in ${metadataMachine.region}`);
  detail('Redis', `${metadataMachine.id}.vm.${appName}.internal:6379`);
  
  if (metadataMachine.state === 'started') {
    try {
      const metadata = MetadataClient.createMachineClient(metadataMachine.id, appName);
      const thopterImage = await metadata.hget('metadata', 'THOPTER_IMAGE');
      
      info(`  Hub service host: 1.hub.kv._metadata.${appName}.internal`);
      if (thopterImage) {
        info(`  Thopter image: ${thopterImage}`);
      }
    } catch {
      info('  (Could not connect to metadata service for details)');
    }
  }
  
  console.log('');
}

async function showHubStatus(
  fly: FlyWrapper,
  machines: FlyMachine[],
  appName: string,
  hubPort?: string
): Promise<void> {
  section('Hub Status:');
  
  const hubMachines = machines.filter(m => m.name?.startsWith('hub-'));
  
  if (hubMachines.length === 0) {
    error('  No hub machine found - run fly/recreate-hub.sh');
  } else if (hubMachines.length > 1) {
    warning(`  Found ${hubMachines.length} hub machines (expected 1):`);
    hubMachines.forEach(hub => {
      info(`    ${hub.name} (${hub.id}) ${hub.state} in ${hub.region}`);
    });
  } else {
    const hub = hubMachines[0];
    if (hub) {
      const status = hub.state === 'started' ? EMOJIS.CHECK : EMOJIS.WARNING;
      console.log(`  ${status} hub (${hub.id}) ${hub.state} in ${hub.region}`);
      
      if (hub.state === 'started') {
        const port = hubPort || '8080';
        detail('Dashboard', `http://${hub.id}.vm.${appName}.internal:${port}/`);
      }
      
      const imageTag = hub.image_ref?.tag || 'unknown';
      info(`  Image: ${imageTag}`);
    }
  }
  
  console.log('');
}

async function showGoldenClaudeStatus(
  machines: FlyMachine[],
  appName: string,
  webTerminalPort?: string
): Promise<void> {
  section('Golden Claude Status:');
  
  const gcMachines = machines.filter(m => m.name?.startsWith('gc-'));
  
  if (gcMachines.length === 0) {
    error('  No golden claude machines found - run fly/recreate-gc.sh');
  } else {
    gcMachines.forEach(gc => {
      const displayName = gc.name?.replace(/^gc-/, '') || 'unknown';
      const status = gc.state === 'started' ? EMOJIS.STAR : EMOJIS.WARNING;
      const port = webTerminalPort || '7681';
      
      if (gc.state === 'started') {
        console.log(`  ${status} ${displayName} (${gc.id}) running in ${gc.region} - http://${gc.id}.vm.${appName}.internal:${port}/`);
      } else {
        console.log(`  ${status} ${displayName} (${gc.id}) ${gc.state} in ${gc.region}`);
      }
    });
  }
  
  console.log('');
}

async function showPlatformAppMachines(machines: FlyMachine[]): Promise<void> {
  section('Platform App Machines:');
  
  const appMachines = machines.filter(m => m.config?.env?.FLY_PROCESS_GROUP === 'app');
  
  if (appMachines.length === 0) {
    info('  No platform app machines found');
  } else {
    appMachines.forEach(machine => {
      const status = machine.state === 'started' ? EMOJIS.GEAR : EMOJIS.WARNING;
      console.log(`  ${status} ${machine.name} (${machine.id}) ${machine.state} in ${machine.region} (flyio/hellofly dummy app)`);
    });
  }
  
  console.log('');
}

async function showAgentThopters(
  machines: FlyMachine[],
  appName: string,
  webTerminalPort?: string
): Promise<void> {
  section('Agent Thopters:');
  
  const agentMachines = machines.filter(m => m.name?.startsWith('thopter-'));
  
  if (agentMachines.length === 0) {
    info('  No agent thopters running');
  } else {
    agentMachines.forEach(agent => {
      const status = agent.state === 'started' ? EMOJIS.HELICOPTER : EMOJIS.WARNING;
      const port = webTerminalPort || '7681';
      
      if (agent.state === 'started') {
        console.log(`  ${status} ${agent.name} (${agent.id}) running in ${agent.region} - http://${agent.id}.vm.${appName}.internal:${port}/`);
      } else {
        console.log(`  ${status} ${agent.name} (${agent.id}) ${agent.state} in ${agent.region}`);
      }
    });
  }
  
  console.log('');
}

async function showResourceSummary(fly: FlyWrapper, machines: FlyMachine[]): Promise<void> {
  section('Resource Summary:');
  
  const summary: ResourceSummary = {
    totalMachines: machines.length,
    hubCount: machines.filter(m => m.name?.startsWith('hub-')).length,
    metadataCount: machines.filter(m => m.name === 'metadata').length,
    gcCount: machines.filter(m => m.name?.startsWith('gc-')).length,
    agentCount: machines.filter(m => m.name?.startsWith('thopter-')).length,
    appCount: machines.filter(m => m.config?.env?.FLY_PROCESS_GROUP === 'app').length,
    totalVolumes: 0,
    metadataVolumes: 0,
    hubVolumes: 0,
    gcVolumes: 0,
    thopterVolumes: 0
  };

  info(`  Machines: ${summary.totalMachines} total (hub: ${summary.hubCount}, metadata: ${summary.metadataCount}, golden: ${summary.gcCount}, agents: ${summary.agentCount}, platform: ${summary.appCount})`);

  // Check for unknown machines
  const expectedCount = summary.hubCount + summary.metadataCount + summary.gcCount + summary.agentCount + summary.appCount;
  if (summary.totalMachines > expectedCount) {
    const unknownCount = summary.totalMachines - expectedCount;
    console.log('');
    warning(`Unknown Machines (${unknownCount}):`);
    
    machines.forEach(machine => {
      if (!machine.name?.startsWith('hub-') &&
          machine.name !== 'metadata' &&
          !machine.name?.startsWith('gc-') &&
          !machine.name?.startsWith('thopter-') &&
          machine.config?.env?.FLY_PROCESS_GROUP !== 'app') {
        const status = machine.state === 'started' ? EMOJIS.WARNING : EMOJIS.WARNING;
        console.log(`  ${status} ${machine.name} (${machine.id}) ${machine.state} in ${machine.region}`);
      }
    });
  }

  // Volume summary
  try {
    const volumes = await fly.listVolumes();
    summary.totalVolumes = volumes.length;
    summary.metadataVolumes = volumes.filter(v => v.name === 'metadata_redis').length;
    summary.hubVolumes = volumes.filter(v => v.name === 'hub_volume').length;
    summary.gcVolumes = volumes.filter(v => v.name === 'golden_claude').length;
    summary.thopterVolumes = volumes.filter(v => v.name === 'thopter_data').length;

    const totalSize = volumes.reduce((sum, v) => sum + v.size_gb, 0);
    
    console.log('');
    console.log('='.repeat(40));
    success(`Volumes: ${summary.totalVolumes} total, ${totalSize}GB (metadata: ${summary.metadataVolumes}, hub: ${summary.hubVolumes}, golden: ${summary.gcVolumes}, thopter_data: ${summary.thopterVolumes})`);
    
    // Show thopter volume pool details
    if (summary.thopterVolumes > 0) {
      console.log('');
      section('Thopter Volume Pool Status:');
      
      const attachedVolumes = volumes.filter(v => v.name === 'thopter_data' && v.attached_machine_id).length;
      const availableVolumes = summary.thopterVolumes - attachedVolumes;
      const poolSize = volumes.filter(v => v.name === 'thopter_data').reduce((sum, v) => sum + v.size_gb, 0);
      
      info(`  Pool: ${summary.thopterVolumes} volumes, ${poolSize}GB total`);
      info(`  Status: ${attachedVolumes} attached, ${availableVolumes} available`);
    }
  } catch {
    warning('Could not retrieve volume information');
  }

  console.log('');
}

// Main execution
if (require.main === module) {
  showStatus().catch(err => {
    displayError(err, 'Unexpected error');
    process.exit(1);
  });
}

export { showStatus };