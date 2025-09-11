#!/usr/bin/env node

// TypeScript conversion of fly/ensure-metadata.sh
// Provisions Redis metadata service on fly.io (idempotent)

import { FlyWrapper } from '../lib/fly';
import { DockerWrapper } from '../lib/docker';
import { MetadataClient } from '../lib/metadata';
import { validateEnvironment } from '../lib/validation';
import { runCommand } from '../lib/shell';
import {
  header, success, error, info, warning, progress, waitMessage, 
  displayError, EMOJIS
} from '../lib/output';

async function ensureMetadata(): Promise<void> {
  header('Thopter Swarm Metadata Service Provisioning', EMOJIS.REDIS);

  try {
    // Validate environment
    const config = await validateEnvironment([
      'APP_NAME', 'REGION', 'HUB_STATUS_PORT'
    ]);
    
    const fly = new FlyWrapper(config.APP_NAME);
    const docker = new DockerWrapper();

    info(`App: ${config.APP_NAME}, Region: ${config.REGION}`);
    console.log('');

    // 1. Check if metadata machine already exists
    progress('Checking for existing metadata machine', '1');
    
    const existingMetadata = await fly.getMachineByName('metadata');
    let metadataId: string | undefined;
    let skipImageBuild = false;

    if (existingMetadata) {
      success(`Metadata service already exists: ${existingMetadata.id}`);
      info(`Metadata service state: ${existingMetadata.state}`);
      
      if (existingMetadata.state !== 'started') {
        warning('Starting metadata service...');
        await fly.startMachine(existingMetadata.id);
      }
      
      metadataId = existingMetadata.id;
      skipImageBuild = true;
      info('Skipping image build - using existing metadata machine');
    } else {
      info('No existing metadata service found, will create one...');
      skipImageBuild = false;
    }

    console.log('');

    // 2. Build image only if we need to create a new machine
    let metadataImage = '';
    if (!skipImageBuild) {
      progress('Building metadata Redis image', '2');
      
      const metadataTag = await docker.generateImageTag('metadata');
      metadataImage = `registry.fly.io/${config.APP_NAME}:${metadataTag}`;

      info(`Image tag: ${metadataTag}`);

      await docker.buildMultiPlatform({
        image: metadataImage,
        context: '.',
        dockerfile: 'fly/dockerfile-metadata'
      });

      await fly.authenticateDocker();
      await docker.push(metadataImage);
      // Push twice to handle auth expiration
      await fly.authenticateDocker();
      await docker.push(metadataImage);

      success('Metadata image built and pushed successfully');
      console.log('');
    }

    // 3. Ensure persistent volume exists
    progress('Ensuring metadata volume exists', '3');
    
    const volumeName = 'metadata_redis';
    const existingVolume = await fly.getVolumeByName(volumeName);

    if (existingVolume) {
      success(`Metadata volume already exists: ${existingVolume.id}`);
    } else {
      info('Creating metadata volume (1GB)...');
      await fly.createVolume(volumeName, 1, config.REGION);
      success('Metadata volume created');
    }

    console.log('');

    // 4. Create metadata machine if needed
    if (!skipImageBuild) {
      progress('Creating metadata machine', '4');
      info('Creating Redis metadata machine with persistent storage...');
      
      metadataId = await fly.createMachine({
        image: metadataImage,
        name: 'metadata',
        region: config.REGION,
        vmSize: 'shared-cpu-1x',
        autostop: false,
        volume: {
          name: volumeName,
          mountPath: '/data'
        },
        ports: [{ port: 6379 }],
        metadata: { redis: '1' }
      });

      success(`Created metadata service: ${metadataId}`);
      info(`Service discovery: 1.redis.kv._metadata.${config.APP_NAME}.internal`);
    } else {
      progress('Using existing metadata machine', '4');
      info(`Using existing metadata machine: ${metadataId}`);
    }

    if (!metadataId) {
      throw new Error('Failed to get metadata machine ID');
    }

    console.log('');

    // 5. Initialize metadata values
    progress('Initializing metadata values', '5');
    info('Connecting to metadata service to initialize values...');

    // Wait for Redis to be ready
    info('Waiting for Redis to respond to PING...');
    const metadata = MetadataClient.createMachineClient(metadataId, config.APP_NAME);
    
    const isReady = await metadata.waitForReady(12, 5000);
    if (!isReady) {
      error('Redis did not become ready within 60 seconds');
      process.exit(1);
    }

    success('Redis is ready');

    // Initialize metadata hash with known default values
    await metadata.hset('metadata', 'HUB_STATUS_PORT', config.HUB_STATUS_PORT || '8081');
    success('Metadata values initialized');

    console.log('');

    // 6. Verify external connectivity
    progress('Verifying external connectivity', '6');
    info(`Testing Redis connectivity via ${metadataId}.vm.${config.APP_NAME}.internal:6379`);
    
    const externalClient = MetadataClient.createMachineClient(metadataId, config.APP_NAME);
    const externalReady = await externalClient.waitForReady(12, 5000);
    
    if (!externalReady) {
      error('Redis connectivity not available via internal network dns interface');
      process.exit(1);
    }

    success('External Redis connectivity verified');

    console.log('');
    success('Metadata service provisioning complete!');
    info(`Metadata service ID: ${metadataId}`);
    info(`Machine address: ${metadataId}.vm.${config.APP_NAME}.internal:6379`);
    info(`Service discovery: 1.redis.kv._metadata.${config.APP_NAME}.internal:6379`);
    info(`Persistent storage: volume '${volumeName}' mounted at /data`);
    info('Redis persistence: AOF enabled with everysec fsync');

  } catch (err) {
    console.log('');
    displayError(err as Error, 'Failed to ensure metadata service');
    process.exit(1);
  }
}

// Main execution
if (require.main === module) {
  ensureMetadata().catch(err => {
    displayError(err, 'Unexpected error');
    process.exit(1);
  });
}

export { ensureMetadata };