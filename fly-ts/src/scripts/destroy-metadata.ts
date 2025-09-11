#!/usr/bin/env node

// TypeScript conversion of fly/destroy-metadata.sh
// Destroys the Redis metadata service from fly.io

import { FlyWrapper } from '../lib/fly';
import { validateEnvironment } from '../lib/validation';
import { 
  header, success, error, info, warning, displayError, EMOJIS 
} from '../lib/output';

async function destroyMetadata(): Promise<void> {
  header('Thopter Swarm Metadata Service Destruction', EMOJIS.REDIS);

  try {
    // Load and validate environment
    const config = await validateEnvironment(['APP_NAME']);
    const fly = new FlyWrapper(config.APP_NAME);

    info(`App: ${config.APP_NAME}`);
    console.log('');

    // Check if metadata machine exists
    console.log('1. Checking for metadata machine...');
    const metadataMachine = await fly.getMachineByName('metadata');
    
    if (!metadataMachine) {
      info('No metadata service found - nothing to destroy');
      return;
    }

    info(`Found metadata service: ${metadataMachine.id}`);
    info(`Metadata service state: ${metadataMachine.state}`);

    // Stop the machine if it's running
    if (metadataMachine.state === 'started') {
      info('Stopping metadata service...');
      await fly.stopMachine(metadataMachine.id);
      success('Metadata service stopped');
      
      // Wait a moment for stop to complete
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    // Destroy the machine
    info('Destroying metadata service machine...');
    await fly.destroyMachine(metadataMachine.id, true);
    success('Metadata service machine destroyed');

    console.log('');
    success('Metadata service destruction complete!');

  } catch (err) {
    console.log('');
    displayError(err as Error, 'Failed to destroy metadata service');
    process.exit(1);
  }
}

// Main execution
if (require.main === module) {
  destroyMetadata().catch(err => {
    displayError(err, 'Unexpected error');
    process.exit(1);
  });
}

export { destroyMetadata };