#!/usr/bin/env node

// TypeScript conversion of fly/destroy-thopters.sh
// Cleanup script to destroy all thopter machines and optionally volumes

import { FlyWrapper } from '../lib/fly';
import { validateEnvironment } from '../lib/validation';
import { 
  header, success, error, info, warning, selectOption, displayError, EMOJIS 
} from '../lib/output';

async function destroyThopters(): Promise<void> {
  const args = process.argv.slice(2);
  const cleanupVolumes = args.includes('--volumes');
  
  header('Thopter Cleanup Script', EMOJIS.CLEAN);

  try {
    // Load environment (not strictly required for cleanup)
    let config;
    try {
      config = await validateEnvironment([]);
    } catch {
      config = { APP_NAME: undefined };
    }
    
    const fly = new FlyWrapper(config.APP_NAME);

    // Get all thopter machines
    console.log('1. Finding thopter machines...');
    const thopterMachines = await fly.getMachinesByPrefix('thopter');

    if (thopterMachines.length === 0) {
      success('No thopter machines found');
    } else {
      warning('Found thopter machines:');
      thopterMachines.forEach(machine => {
        info(`  ${machine.id} - ${machine.name} (${machine.state})`);
      });
      console.log('');
      
      console.log('2. Destroying thopter machines...');
      for (const machine of thopterMachines) {
        console.log(`Destroying machine: ${machine.id}`);
        
        // Try to stop first, ignore errors
        try {
          await fly.stopMachine(machine.id);
          console.log('  (machine stopped)');
        } catch {
          console.log('  (machine already stopped or error stopping)');
        }
        
        // Destroy with force
        try {
          await fly.destroyMachine(machine.id, true);
          success(`✅ Destroyed: ${machine.id}`);
        } catch (err) {
          error(`❌ Failed to destroy: ${machine.id}`);
        }
      }
    }

    console.log('');

    // Volume cleanup (only if --volumes flag is specified)
    if (cleanupVolumes) {
      console.log('3. Finding thopter_data volumes...');
      
      const thopterVolumes = await fly.listVolumes();
      const dataVolumes = thopterVolumes.filter(v => v.name === 'thopter_data');

      if (dataVolumes.length === 0) {
        success('No thopter_data volumes found');
      } else {
        warning('Found thopter_data volumes:');
        dataVolumes.forEach(volume => {
          const attachedTo = volume.attached_machine_id || 'none';
          info(`  ${volume.id} - ${volume.name} - attached: ${attachedTo}`);
        });
        console.log('');
        
        console.log('4. Destroying thopter_data volumes...');
        for (const volume of dataVolumes) {
          console.log(`Destroying volume: ${volume.id}`);
          
          try {
            await fly.destroyVolume(volume.id);
            success(`✅ Destroyed: ${volume.id}`);
          } catch (err) {
            error(`❌ Failed to destroy: ${volume.id}`);
          }
        }
      }
    } else {
      console.log('3. Skipping volume cleanup (use --volumes flag to include)');
    }

    console.log('');
    console.log('='.repeat(40));
    success('Cleanup completed!');
    console.log('');

    // Final resource report
    await generateResourceReport(fly);

  } catch (err) {
    console.log('');
    displayError(err as Error, 'Cleanup failed');
    process.exit(1);
  }
}

async function generateResourceReport(fly: FlyWrapper): Promise<void> {
  console.log('📊 Final Resource Report:');
  console.log('='.repeat(25));

  // Check for remaining thopter machines
  const remainingThopters = await fly.getMachinesByPrefix('thopter');
  if (remainingThopters.length > 0) {
    warning('⚠️  Remaining thopter machines (may be stuck):');
    remainingThopters.forEach(machine => {
      info(`  ${machine.id} - ${machine.name} (${machine.state})`);
    });
    console.log('');
  }

  // Check for remaining thopter_data volumes
  const allVolumes = await fly.listVolumes();
  const remainingDataVolumes = allVolumes.filter(v => v.name === 'thopter_data');
  
  if (remainingDataVolumes.length > 0) {
    warning('⚠️  Remaining thopter_data volumes:');
    remainingDataVolumes.forEach(volume => {
      const attachedTo = volume.attached_machine_id || 'none';
      info(`  ${volume.id} - attached: ${attachedTo}`);
    });
    console.log('');
    
    // Check for orphaned volumes
    const orphanedVolumes = remainingDataVolumes.filter(volume => {
      return volume.attached_machine_id && 
             !remainingThopters.find(m => m.id === volume.attached_machine_id);
    });
    
    if (orphanedVolumes.length > 0) {
      info('💡 If volumes show as attached to non-existent machines:');
      info('   This is likely a fly.io state propagation delay.');
      info('   Try running the cleanup again in a few minutes.');
      console.log('');
    }
  }

  if (remainingThopters.length > 0 || remainingDataVolumes.length > 0) {
    console.log('');
    warning('📝 TODO: Improve cleanup script to handle fly.io state propagation delays');
    info('   - Add proper volume detachment waiting logic');
    info('   - Add retry mechanism for stuck resources');
    info('   - Handle eventual consistency in fly.io API responses');
  }
}

// Main execution
if (require.main === module) {
  destroyThopters().catch(err => {
    displayError(err, 'Unexpected error');
    process.exit(1);
  });
}

export { destroyThopters };