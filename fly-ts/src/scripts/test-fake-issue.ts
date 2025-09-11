#!/usr/bin/env node

// TypeScript conversion of fly/test-fake-issue.sh
// Test script to exercise the thopter provisioning endpoint

import { FlyWrapper } from '../lib/fly';
import { MetadataClient } from '../lib/metadata';
import { validateEnvironment } from '../lib/validation';
import { runCommand } from '../lib/shell';
import {
  header, success, error, info, warning, displayError, EMOJIS
} from '../lib/output';

interface ProvisionRequest {
  repository: string;
  gc: string;
  github: {
    issueNumber: string;
    issueTitle: string;
    issueBody: string;
    issueUrl: string;
    issueAuthor: string;
    mentionAuthor: string;
    mentionLocation: string;
  };
}

interface ProvisionResponse {
  success: boolean;
  agent?: {
    id: string;
    webTerminalUrl: string;
  };
  error?: string;
}

async function testFakeIssue(): Promise<void> {
  const args = process.argv.slice(2);
  let hubUrl = '';
  let goldenClaude = 'default';
  
  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--url':
        hubUrl = args[i + 1] || '';
        i++;
        break;
      case '--gc':
        goldenClaude = args[i + 1] || 'default';
        i++;
        break;
      case '--help':
        console.log('Usage: test-fake-issue [--url <URL>] [--gc <name>]');
        console.log('  --url <URL>: Test against custom URL');
        console.log('  --gc <name>: Use specific Golden Claude (default: default)');
        return;
    }
  }

  const issueNumber = Date.now().toString(); // Use timestamp for unique issue numbers
  
  header('Testing Thopter Provisioning Endpoint', EMOJIS.GEAR);

  try {
    // Auto-detect hub if no URL specified
    if (!hubUrl) {
      hubUrl = await autoDetectHub();
    } else {
      info(`Using specified URL: ${hubUrl}`);
    }

    console.log('');

    // Test hub health first
    await testHubHealth(hubUrl);

    // Test provisioning
    await testProvisioning(hubUrl, goldenClaude, issueNumber);

  } catch (err) {
    console.log('');
    displayError(err as Error, 'Test failed');
    process.exit(1);
  }
}

async function autoDetectHub(): Promise<string> {
  console.log('Auto-detecting hub from metadata service...');
  
  // Source environment if available
  let config;
  try {
    config = await validateEnvironment([]);
  } catch {
    config = { APP_NAME: 'swarm1' };
  }

  const appName = config.APP_NAME || 'swarm1';
  
  // Get metadata service machine ID
  const fly = new FlyWrapper(appName);
  const metadataMachine = await fly.getMachineByName('metadata');
  
  if (!metadataMachine) {
    throw new Error('No metadata service found. Run recreate-hub.ts to deploy services, or use --url flag');
  }

  info(`Connecting to metadata service: ${metadataMachine.id}.vm.${appName}.internal:6379`);
  
  // Use static hub service discovery - no need to check metadata
  const hubServiceHost = `1.hub.kv._metadata.${appName}.internal`;
  const hubUrl = `http://${hubServiceHost}:8080`;
  
  success(`Using hub service discovery: ${hubServiceHost}`);
  info(`Hub URL: ${hubUrl}`);
  
  return hubUrl;
}

async function testHubHealth(hubUrl: string): Promise<void> {
  console.log('Checking hub health...');
  
  try {
    const healthResult = await runCommand('curl', [
      '-s', '--connect-timeout', '5',
      `${hubUrl}/health`
    ], { silent: true });
    
    if (healthResult.success && healthResult.stdout.includes('"status":"ok"')) {
      success('Hub is healthy');
    } else {
      warning('Hub health check failed (may still work for provisioning)');
    }
  } catch {
    warning('Hub health check failed (may still work for provisioning)');
  }
}

async function testProvisioning(
  hubUrl: string, 
  goldenClaude: string, 
  issueNumber: string
): Promise<void> {
  console.log('');
  console.log('Testing provisioning with sample GitHub issue...');
  warning(`Issue #${issueNumber}`);
  info(`Golden Claude: ${goldenClaude}`);

  // Sample provision request with dynamic issue number
  const provisionRequest: ProvisionRequest = {
    repository: 'test/repo',
    gc: goldenClaude,
    github: {
      issueNumber,
      issueTitle: 'Fix authentication bug in user login',
      issueBody: `Users are experiencing login failures when using special characters in passwords. The authentication service is throwing validation errors.

Steps to reproduce:
1. Create user with password containing @#$%
2. Attempt to login
3. See error

Expected: Login should succeed
Actual: ValidationError thrown

/thopter`,
      issueUrl: `https://github.com/test/repo/issues/${issueNumber}`,
      issueAuthor: 'test-user',
      mentionAuthor: 'test-provisioner',
      mentionLocation: 'body'
    }
  };

  try {
    const curlResult = await runCommand('curl', [
      '-s', '-X', 'POST',
      `${hubUrl}/provision`,
      '-H', 'Content-Type: application/json',
      '-d', JSON.stringify(provisionRequest)
    ], { silent: true });

    if (!curlResult.success) {
      throw new Error(`HTTP request failed: ${curlResult.stderr}`);
    }

    console.log('');
    console.log('Response:');
    
    let response: ProvisionResponse;
    try {
      response = JSON.parse(curlResult.stdout);
      console.log(JSON.stringify(response, null, 2));
    } catch {
      console.log(curlResult.stdout);
      throw new Error('Failed to parse JSON response');
    }

    // Check if provisioning was successful
    if (response.success && response.agent) {
      console.log('');
      success('Thopter provisioned successfully!');
      success(`Agent ID: ${response.agent.id}`);
      success(`Web Terminal: ${response.agent.webTerminalUrl}`);
      console.log('');
      
      console.log('You can now:');
      info(`1. Access the thopter via web terminal: ${response.agent.webTerminalUrl}`);
      info('2. Check status: npm run status');
      info('3. Clean up when done: npm run destroy-thopters');
    } else {
      console.log('');
      error('Provisioning failed');
      const errorMsg = response.error || 'Unknown error';
      error(`Error: ${errorMsg}`);
    }

  } catch (err) {
    throw new Error(`Provisioning request failed: ${err instanceof Error ? err.message : err}`);
  }

  console.log('');
  console.log('='.repeat(40));
}

// Main execution
if (require.main === module) {
  testFakeIssue().catch(err => {
    displayError(err, 'Unexpected error');
    process.exit(1);
  });
}

export { testFakeIssue };