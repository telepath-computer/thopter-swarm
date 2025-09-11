#!/usr/bin/env node

// TypeScript conversion of fly/destroy-gc.sh
// Removes golden claude instances from fly.io

import { FlyWrapper } from '../lib/fly';
import { validateEnvironment } from '../lib/validation';
import { 
  header, success, error, info, warning, selectOption, displayError, EMOJIS 
} from '../lib/output';

async function destroyGoldenClaudes(): Promise<void> {
  header('Golden Claude Destruction', EMOJIS.BOOM);

  try {
    // Load environment (not strictly required for destruction)
    let config;
    try {
      config = await validateEnvironment([]);
    } catch {
      config = { APP_NAME: undefined };
    }
    
    const fly = new FlyWrapper(config.APP_NAME);

    // Find existing golden claude machines
    console.log('1. Scanning for golden claude machines...');
    const gcMachines = await fly.getMachinesByPrefix('gc-');

    if (gcMachines.length === 0) {
      info('No golden claude machines found');
      return;
    }

    warning(`Found ${gcMachines.length} golden claude machine(s):`);
    gcMachines.forEach(gc => {
      info(`  Found: ${gc.name} (${gc.id}) - ${gc.state}`);
    });

    // Get user choice for destruction
    console.log('');
    warning('WARNING: This will destroy golden claude machines and their authentication data!');
    console.log('');
    
    const choice = await selectOption(
      'Choose your action:',
      [
        { name: 'Cancel (exit)', value: 'cancel' },
        { name: 'Destroy golden claude machines only (keep volumes)', value: 'machines' },
        { name: 'Destroy golden claude machines AND their paired volumes (complete cleanup)', value: 'complete' }
      ]
    );

    if (choice === 'cancel') {
      info('Operation cancelled');
      return;
    }

    const destroyVolumes = choice === 'complete';
    console.log('');

    // Stop and destroy golden claude machines
    for (const gc of gcMachines) {
      console.log(`2. Processing golden claude: ${gc.name} (${gc.id})`);
      
      // Stop machine if running
      if (gc.state === 'started') {
        console.log('   Stopping machine...');
        await fly.stopMachine(gc.id);
        
        console.log('   Waiting for stop...');
        const stopped = await fly.waitForMachineState(gc.id, 'stopped', 20000);
        if (stopped) {
          success('   Machine stopped');
        } else {
          warning('   Machine didn\'t stop cleanly, forcing destruction...');
        }
      } else {
        console.log('   Machine is already stopped');
      }
      
      // Destroy machine
      console.log('   Destroying machine...');
      try {
        await fly.destroyMachine(gc.id, true);
        success(`   Golden claude ${gc.name} destroyed successfully`);
      } catch (err) {
        error(`   Failed to destroy golden claude ${gc.name}`);
      }
      
      console.log('');
    }

    // Handle volume destruction
    if (destroyVolumes) {
      console.log('3. Destroying paired Golden Claude volumes...');
      
      for (const gc of gcMachines) {
        // Extract the name part (gc-josh -> josh) and convert to volume format
        const gcBaseName = gc.name?.replace(/^gc-/, '') || 'unknown';
        const gcVolumeName = `gc_volume_${gcBaseName.replace(/-/g, '_')}`;
        
        console.log(`   Looking for volume: ${gcVolumeName}`);
        
        const volume = await fly.getVolumeByName(gcVolumeName);
        if (volume) {
          info(`   Found volume: ${volume.id} (${volume.size_gb}GB in ${volume.region})`);
          
          try {
            await fly.destroyVolume(volume.id);
            success(`   Volume ${gcVolumeName} destroyed`);
          } catch (err) {
            error(`   Failed to destroy volume ${gcVolumeName}`);
            warning(`   You may need to destroy it manually: fly volumes destroy ${volume.id}`);
          }
        } else {
          info(`   No volume found for ${gc.name}`);
        }
      }
    } else {
      console.log('3. Keeping Golden Claude volumes (as requested)');
      
      for (const gc of gcMachines) {
        const gcBaseName = gc.name?.replace(/^gc-/, '') || 'unknown';
        const gcVolumeName = `gc_volume_${gcBaseName.replace(/-/g, '_')}`;
        
        const volume = await fly.getVolumeByName(gcVolumeName);
        if (volume) {
          info(`   Preserved: ${gcVolumeName} (${volume.id}, ${volume.size_gb}GB in ${volume.region})`);
        }
      }
    }

    // Final summary
    console.log('');
    console.log('='.repeat(40));
    success('Golden Claude Destruction Complete!');
    console.log('='.repeat(40));
    console.log('');

    if (destroyVolumes) {
      success('Cleaned up:');
      info('  ✓ All golden claude machines destroyed');
      info('  ✓ All golden_claude volumes destroyed');
      console.log('');
      success('Result: Complete cleanup - you can run recreate-gc.ts to start fresh');
    } else {
      success('Cleaned up:');
      info('  ✓ Golden claude machines destroyed');
      warning('  ⚠ golden_claude volumes preserved');
      console.log('');
      success('Result: Machines destroyed but volumes preserved - run recreate-gc.ts to recreate');
    }

    console.log('');

  } catch (err) {
    console.log('');
    displayError(err as Error, 'Failed to destroy golden claudes');
    process.exit(1);
  }
}

// Main execution
if (require.main === module) {
  destroyGoldenClaudes().catch(err => {
    displayError(err, 'Unexpected error');
    process.exit(1);
  });
}

export { destroyGoldenClaudes };