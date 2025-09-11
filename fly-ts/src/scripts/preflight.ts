#!/usr/bin/env node

// TypeScript conversion of fly/preflight.sh
// Validates prerequisites for setting up the thopter swarm on fly.io

import { existsSync, writeFileSync } from 'fs';
import { validateEnvironment, runPreflightChecks, displayValidationResults } from '../lib/validation';
import { runCommand } from '../lib/shell';
import {
  header, success, error, info, warning, displayError, EMOJIS
} from '../lib/output';

async function preflightCheck(): Promise<void> {
  header('Thopter Swarm Preflight Check', EMOJIS.HELICOPTER);

  try {
    const results = await runPreflightChecks();
    
    displayValidationResults(results);

    // Additional specific checks for Thopter Swarm
    await performAdditionalChecks(results);

    console.log('');
    console.log('='.repeat(40));
    console.log('📋 Preflight Summary');
    console.log('='.repeat(40));

    if (results.valid) {
      success('All critical checks passed!');
      console.log('');
    } else {
      error(`Found ${results.issues.length} critical issue(s):`);
      results.issues.forEach(issue => {
        error(`  • ${issue}`);
      });
      console.log('');
      error('Please fix these issues before proceeding.');
      console.log('');
    }

    if (results.warnings.length > 0) {
      warning(`Found ${results.warnings.length} warning(s):`);
      results.warnings.forEach(warn => {
        warning(`  • ${warn}`);
      });
      console.log('');
      warning('These warnings won\'t prevent setup but may impact functionality.');
      console.log('');
    }

    // Exit with error if there are critical issues
    if (!results.valid) {
      process.exit(1);
    }

  } catch (err) {
    console.log('');
    displayError(err as Error, 'Preflight check failed');
    process.exit(1);
  }
}

async function performAdditionalChecks(results: any): Promise<void> {
  console.log('');
  console.log('🚀 Additional Thopter Swarm Checks:');

  // Check for fly.toml configuration
  if (results.config.APP_NAME) {
    if (existsSync('fly.toml')) {
      try {
        const flyTomlContent = await import('fs').then(fs => 
          fs.readFileSync('fly.toml', 'utf-8')
        );
        
        if (flyTomlContent.includes(`app = '${results.config.APP_NAME}'`) ||
            flyTomlContent.includes(`app = "${results.config.APP_NAME}"`)) {
          success(`fly.toml configured for app '${results.config.APP_NAME}'`);
        } else {
          error(`fly.toml exists but doesn't match APP_NAME '${results.config.APP_NAME}'. Fix manually or delete it to auto-create`);
        }
      } catch {
        warning('Could not read fly.toml file');
      }
    } else {
      info(`Creating fly.toml with app='${results.config.APP_NAME}' and primary_region='${results.config.REGION}'`);
      
      const flyTomlContent = `app = '${results.config.APP_NAME}'\nprimary_region = '${results.config.REGION}'\n`;
      
      try {
        writeFileSync('fly.toml', flyTomlContent);
        success('Created fly.toml');
      } catch (err) {
        error('Failed to create fly.toml');
      }
    }
  }

  // Check Docker buildx for ARM64 cross-compilation
  try {
    const archResult = await runCommand('uname', ['-m'], { silent: true });
    if (archResult.success) {
      const arch = archResult.stdout.trim();
      if (arch === 'arm64' || arch === 'aarch64') {
        info('ARM64 architecture detected - checking docker buildx...');
        
        const buildxResult = await runCommand('docker', ['buildx', 'version'], { silent: true });
        if (buildxResult.success) {
          success('Docker buildx available for cross-compilation');
        } else {
          warning('Docker buildx not available - may need manual setup for cross-compilation');
        }
      } else {
        info(`AMD64 architecture detected (${arch}) - native Docker builds will be used`);
      }
    }
  } catch {
    warning('Could not detect system architecture');
  }

  // Check TypeScript deployment scripts
  if (existsSync('fly-ts')) {
    success('TypeScript deployment scripts found in fly-ts/');
    
    try {
      const packageResult = await runCommand('npm', ['list'], { 
        cwd: 'fly-ts',
        silent: true 
      });
      
      if (packageResult.success) {
        success('TypeScript dependencies are installed');
      } else {
        warning('TypeScript dependencies may need installation (run: cd fly-ts && npm install)');
      }
    } catch {
      info('TypeScript deployment scripts available but dependencies not checked');
    }
  } else {
    info('Using bash deployment scripts (fly-ts/ not found)');
  }

  // Validate GitHub integration configuration structure
  if (results.config.GITHUB_INTEGRATION_JSON) {
    try {
      const githubConfig = JSON.parse(results.config.GITHUB_INTEGRATION_JSON);
      
      if (githubConfig.repositories && typeof githubConfig.repositories === 'object') {
        const repoCount = Object.keys(githubConfig.repositories).length;
        success(`GitHub integration configured for ${repoCount} repositories`);
        
        // Show repository details
        Object.keys(githubConfig.repositories).forEach(repo => {
          const repoConfig = githubConfig.repositories[repo];
          const hasIssuesPAT = !!repoConfig.issuesPAT;
          const hasAgentPAT = !!repoConfig.agentCoderPAT;
          
          info(`  ${repo}: Issues PAT ${hasIssuesPAT ? '✓' : '✗'}, Agent PAT ${hasAgentPAT ? '✓' : '✗'}`);
        });
      } else {
        error('GITHUB_INTEGRATION_JSON is missing repositories object');
      }
    } catch {
      // Error already reported in main validation
    }
  }

  // Check for thopter and hub directories
  const requiredDirs = ['thopter', 'hub'];
  requiredDirs.forEach(dir => {
    if (existsSync(dir)) {
      success(`${dir}/ directory found`);
    } else {
      error(`${dir}/ directory missing - required for deployment`);
    }
  });
}

// Main execution
if (require.main === module) {
  preflightCheck().catch(err => {
    displayError(err, 'Unexpected error');
    process.exit(1);
  });
}

export { preflightCheck };