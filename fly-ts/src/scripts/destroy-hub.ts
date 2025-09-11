#!/usr/bin/env node

// TypeScript conversion of fly/destroy-hub.sh
// Removes the Thopter Swarm Hub from fly.io

import { FlyWrapper } from '../lib/fly';
import { validateEnvironment } from '../lib/validation';
import { 
  header, success, error, info, warning, selectOption, displayError, EMOJIS 
} from '../lib/output';

async function destroyHub(): Promise<void> {
  header('Thopter Swarm Hub Destruction', EMOJIS.BOOM);

  try {
    // Load environment (not strictly required for destruction)
    let config;
    try {
      config = await validateEnvironment([]);
    } catch {
      config = { APP_NAME: undefined };
    }
    
    const fly = new FlyWrapper(config.APP_NAME);

    // Check for hub machines
    console.log('1. Checking for existing hub machines...');
    const hubMachines = await fly.getMachinesByPrefix('hub-');

    if (hubMachines.length === 0) {
      info('No hub machines found');
      return;
    }

    warning(`Found ${hubMachines.length} hub machine(s):`);
    hubMachines.forEach(hub => {
      info(`  ${hub.name} (${hub.id}) - state: ${hub.state}`);
    });

    console.log('');
    warning('WARNING: This will destroy ALL hub machines!');
    console.log('');
    
    const choice = await selectOption(
      'Choose your action:',
      [
        { name: 'Cancel (exit)', value: 'cancel' },
        { name: 'Destroy all hub machines', value: 'destroy' }
      ]
    );

    if (choice === 'cancel') {
      info('Operation cancelled');
      return;
    }

    console.log('');

    // Stop and destroy all hub machines
    console.log('2. Processing hub machines...');
    let destroyedCount = 0;
    let failedCount = 0;

    for (const hub of hubMachines) {
      console.log(`  Processing ${hub.name} (${hub.id})...`);
      
      try {
        // Stop if running
        if (hub.state === 'started') {
          console.log('    Stopping machine...');
          await fly.stopMachine(hub.id);
          
          console.log('    Waiting for stop...');
          const stopped = await fly.waitForMachineState(hub.id, 'stopped', 20000);
          if (!stopped) {
            warning('    Failed to stop cleanly, will force destroy');
          }
        }
        
        // Destroy machine
        console.log('    Destroying machine...');
        await fly.destroyMachine(hub.id, true);
        
        success(`    ${hub.name} destroyed successfully`);
        destroyedCount++;
      } catch (err) {
        error(`    Failed to destroy ${hub.name}`);
        failedCount++;
      }
      
      console.log('');
    }

    // Final status check
    const remainingHubs = await fly.getMachinesByPrefix('hub-');
    if (remainingHubs.length === 0) {
      success('All hub machines destroyed successfully');
    } else {
      error(`${remainingHubs.length} hub machines still remain`);
      process.exit(1);
    }

    console.log('');
    console.log('='.repeat(40));
    success('Hub Destruction Complete!');
    console.log('='.repeat(40));
    console.log('');

    success('Cleaned up:');
    info('  ✓ All hub machines destroyed');
    console.log('');
    success('Result: Hub(s) destroyed - you can run recreate-hub.ts to recreate');
    console.log('');

  } catch (err) {
    console.log('');
    displayError(err as Error, 'Failed to destroy hub');
    process.exit(1);
  }
}

// Main execution
if (require.main === module) {
  destroyHub().catch(err => {
    displayError(err, 'Unexpected error');
    process.exit(1);
  });
}

export { destroyHub };