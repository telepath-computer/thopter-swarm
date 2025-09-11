// Environment validation and prerequisite checking
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { EnvironmentConfig, ValidationError } from './types';
import { commandExists, runCommand } from './shell';
import { warning, error, success, info } from './output';

export interface ValidationResult {
  valid: boolean;
  issues: string[];
  warnings: string[];
  config: Partial<EnvironmentConfig>;
}

export async function validateEnvironment(
  requiredVars: string[] = [],
  projectRoot: string = process.cwd()
): Promise<EnvironmentConfig> {
  const envPath = join(projectRoot, '.env');
  
  if (!existsSync(envPath)) {
    throw new ValidationError('.env file not found. Run fly/preflight.sh first');
  }
  
  // Load environment variables from .env file
  const envContent = readFileSync(envPath, 'utf-8');
  const env: Record<string, string> = {};
  
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        env[key.trim()] = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
      }
    }
  });
  
  // Merge with process.env (process.env takes precedence)
  const config: EnvironmentConfig = {
    APP_NAME: env.APP_NAME || process.env.APP_NAME || '',
    REGION: env.REGION || process.env.REGION || '',
    ...env,
    ...process.env
  } as EnvironmentConfig;
  
  // Validate required variables
  const missing: string[] = [];
  requiredVars.forEach(varName => {
    if (!config[varName as keyof EnvironmentConfig] || 
        config[varName as keyof EnvironmentConfig] === '...') {
      missing.push(varName);
    }
  });
  
  if (missing.length > 0) {
    throw new ValidationError(
      `Missing required environment variables: ${missing.join(', ')}`
    );
  }
  
  return config;
}

export async function runPreflightChecks(
  projectRoot: string = process.cwd()
): Promise<ValidationResult> {
  const issues: string[] = [];
  const warnings: string[] = [];
  let config: Partial<EnvironmentConfig> = {};
  
  // 1. Check CLI tools
  const requiredTools = ['fly', 'docker', 'jq', 'redis-cli', 'curl'];
  const toolChecks = await Promise.all(
    requiredTools.map(async tool => ({
      tool,
      exists: await commandExists(tool)
    }))
  );
  
  toolChecks.forEach(({ tool, exists }) => {
    if (!exists) {
      issues.push(`${tool} CLI not found`);
    }
  });
  
  // 2. Check fly authentication
  try {
    const authResult = await runCommand('fly', ['auth', 'whoami'], { silent: true });
    if (!authResult.success) {
      issues.push('Not authenticated with fly.io. Run: fly auth login');
    }
  } catch {
    issues.push('fly CLI not working or not authenticated');
  }
  
  // 3. Load and validate environment
  try {
    config = await validateEnvironment([
      'APP_NAME',
      'REGION',
      'MAX_THOPTERS',
      'THOPTER_VM_SIZE',
      'THOPTER_VOLUME_SIZE',
      'HUB_VM_SIZE',
      'DANGEROUSLY_SKIP_FIREWALL',
      'ALLOWED_DOMAINS',
      'WEB_TERMINAL_PORT',
      'HUB_PORT',
      'HUB_STATUS_PORT',
      'GITHUB_INTEGRATION_JSON',
      'GITHUB_ISSUES_POLLING_INTERVAL',
      'FLY_DEPLOY_KEY'
    ], projectRoot);
  } catch (err) {
    if (err instanceof ValidationError) {
      issues.push(err.message);
    } else {
      issues.push('Failed to load environment configuration');
    }
  }
  
  // 4. Check fly app exists
  if (config.APP_NAME) {
    try {
      const appsResult = await runCommand('fly', ['apps', 'list'], { silent: true });
      if (appsResult.success && !appsResult.stdout.includes(config.APP_NAME)) {
        issues.push(`Fly app '${config.APP_NAME}' does not exist`);
      }
    } catch {
      warnings.push('Could not verify fly app existence');
    }
  }
  
  // 5. Check wireguard connectivity
  try {
    const dnsResult = await runCommand('dig', ['_apps.internal', 'TXT', '+short', '+timeout=5'], { silent: true });
    if (dnsResult.success && dnsResult.stdout) {
      const apps = dnsResult.stdout.replace(/"/g, '');
      if (config.APP_NAME && !apps.includes(config.APP_NAME)) {
        warnings.push(`Wireguard connected but ${config.APP_NAME} not in internal apps`);
      }
    } else {
      warnings.push('Wireguard VPN not connected - web terminals may not be accessible');
    }
  } catch {
    warnings.push('Could not check wireguard connectivity');
  }
  
  // 6. Validate GitHub tokens if configured
  if (config.GITHUB_INTEGRATION_JSON) {
    try {
      const githubConfig = JSON.parse(config.GITHUB_INTEGRATION_JSON);
      if (githubConfig.repositories) {
        const repos = Object.keys(githubConfig.repositories);
        for (const repo of repos) {
          const repoConfig = githubConfig.repositories[repo];
          
          // Test Issues PAT
          if (repoConfig.issuesPAT) {
            try {
              const issuesResult = await runCommand('curl', [
                '-s',
                '-H', `Authorization: token ${repoConfig.issuesPAT}`,
                '-H', 'Accept: application/vnd.github.v3+json',
                `https://api.github.com/repos/${repo}/issues?per_page=1`
              ], { silent: true });
              
              if (!issuesResult.success || !issuesResult.stdout.includes('[')) {
                issues.push(`GitHub Issues PAT cannot access ${repo}`);
              }
            } catch {
              warnings.push(`Could not test GitHub Issues PAT for ${repo}`);
            }
          } else {
            issues.push(`No issuesPAT configured for repository ${repo}`);
          }
          
          // Test Agent Coder PAT
          if (repoConfig.agentCoderPAT) {
            try {
              const repoResult = await runCommand('curl', [
                '-s',
                '-H', `Authorization: token ${repoConfig.agentCoderPAT}`,
                '-H', 'Accept: application/vnd.github.v3+json',
                `https://api.github.com/repos/${repo}`
              ], { silent: true });
              
              if (!repoResult.success || !repoResult.stdout.includes('"id"')) {
                issues.push(`GitHub Agent Coder PAT cannot access ${repo}`);
              }
            } catch {
              warnings.push(`Could not test GitHub Agent Coder PAT for ${repo}`);
            }
          } else {
            issues.push(`No agentCoderPAT configured for repository ${repo}`);
          }
        }
      }
    } catch {
      issues.push('Could not parse GITHUB_INTEGRATION_JSON');
    }
  }
  
  return {
    valid: issues.length === 0,
    issues,
    warnings,
    config
  };
}

export function displayValidationResults(results: ValidationResult): void {
  if (results.valid) {
    success('All critical checks passed!');
  } else {
    error(`Found ${results.issues.length} critical issue(s):`);
    results.issues.forEach(issue => {
      error(`  • ${issue}`);
    });
  }
  
  if (results.warnings.length > 0) {
    warning(`Found ${results.warnings.length} warning(s):`);
    results.warnings.forEach(warn => {
      warning(`  • ${warn}`);
    });
  }
  
  if (results.config.APP_NAME) {
    info(`App: ${results.config.APP_NAME}, Region: ${results.config.REGION}`);
  }
}