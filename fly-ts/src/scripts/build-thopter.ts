#!/usr/bin/env node

// TypeScript conversion of fly/build-thopter.sh
// Builds and pushes Thopter Docker image and updates metadata

import { join } from 'path';
import { FlyWrapper } from '../lib/fly';
import { DockerWrapper } from '../lib/docker';
import { MetadataClient } from '../lib/metadata';
import { validateEnvironment } from '../lib/validation';
import { runCommandOrThrow } from '../lib/shell';
import {
  header, success, error, info, progress, displayError, EMOJIS
} from '../lib/output';

async function buildThopter(): Promise<void> {
  header('Thopter Image Builder', EMOJIS.BIRD);

  try {
    // Validate environment
    const config = await validateEnvironment(['APP_NAME']);
    const fly = new FlyWrapper(config.APP_NAME);
    const docker = new DockerWrapper();

    info(`App: ${config.APP_NAME}`);
    console.log('');

    // 1. Ensure metadata service exists and is configured
    progress('Ensuring metadata service is provisioned', '1');
    
    const metadataMachine = await fly.getMachineByName('metadata');
    if (!metadataMachine) {
      error('Metadata service not found. Run ensure-metadata script first');
      process.exit(1);
    }

    if (metadataMachine.state !== 'started') {
      error('Metadata service is not running. Please start it first');
      process.exit(1);
    }

    success('Metadata service is ready');
    console.log('');

    // 2. Generate unique tag for this deployment
    progress('Building thopter image', '2');
    const thopterTag = await docker.generateImageTag('thopter');
    const thopterImage = `registry.fly.io/${config.APP_NAME}:${thopterTag}`;

    info(`Image tag: ${thopterTag}`);

    // 3. Build image with multi-platform support
    const buildConfig = {
      image: thopterImage,
      context: './thopter',
      buildArgs: {
        CURRENT_IMAGE: thopterImage
      }
    };

    await docker.buildMultiPlatform(buildConfig);
    success('Thopter image built successfully');

    // 4. Push to fly registry (with auth and retry)
    progress('Pushing to Fly registry');
    
    await fly.authenticateDocker();
    await docker.push(thopterImage);
    
    // Push twice to handle auth expiration (crude but effective)
    await fly.authenticateDocker();
    await docker.push(thopterImage);

    success('Thopter image pushed successfully');

    // 5. Update metadata service with new thopter image
    progress('Updating metadata service');
    
    const metadataClient = MetadataClient.createMachineClient(
      metadataMachine.id, 
      config.APP_NAME
    );

    const pingSuccess = await metadataClient.ping();
    if (!pingSuccess) {
      error('Could not connect to metadata service for update');
      info('The image was built and pushed but metadata update was skipped');
    } else {
      await metadataClient.hset('metadata', 'THOPTER_IMAGE', thopterImage);
      success(`Metadata service updated with thopter image: ${thopterImage}`);
    }

    // 6. Success summary
    console.log('');
    console.log('='.repeat(40));
    success('Thopter Image Build Complete!');
    console.log('='.repeat(40));
    console.log('');
    
    success('Image Details:');
    info(`  Image: ${thopterImage}`);
    info(`  Tag: ${thopterTag}`);
    console.log('');
    
    success('Next Steps:');
    info('  You can now use this image in golden claude or thopter deployments');
    info('  The metadata server has been updated with the new image tag');
    console.log('');

  } catch (err) {
    console.log('');
    displayError(err as Error, 'Failed to build thopter image');
    process.exit(1);
  }
}

// Main execution
if (require.main === module) {
  buildThopter().catch(err => {
    displayError(err, 'Unexpected error');
    process.exit(1);
  });
}

export { buildThopter };