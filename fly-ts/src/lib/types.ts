// Core type definitions for Thopter Swarm deployment scripts

export interface FlyMachine {
  id: string;
  name: string;
  state: 'started' | 'stopped' | 'destroyed' | 'creating' | 'stopping';
  region: string;
  image_ref?: {
    tag: string;
  };
  config?: {
    env?: Record<string, string>;
  };
}

export interface FlyVolume {
  id: string;
  name: string;
  size_gb: number;
  region: string;
  attached_machine_id?: string | null;
}

export interface EnvironmentConfig {
  APP_NAME: string;
  REGION: string;
  MAX_THOPTERS?: string;
  THOPTER_VM_SIZE?: string;
  THOPTER_VOLUME_SIZE?: string;
  HUB_VM_SIZE?: string;
  DANGEROUSLY_SKIP_FIREWALL?: string;
  ALLOWED_DOMAINS?: string;
  WEB_TERMINAL_PORT?: string;
  HUB_PORT?: string;
  HUB_STATUS_PORT?: string;
  GITHUB_INTEGRATION_JSON?: string;
  GITHUB_ISSUES_POLLING_INTERVAL?: string;
  FLY_DEPLOY_KEY?: string;
  METADATA_SERVICE_HOST?: string;
}

export interface MachineConfig {
  image: string;
  name: string;
  region: string;
  vmSize?: string;
  autostop?: boolean;
  volume?: {
    name: string;
    mountPath: string;
  };
  env?: Record<string, string>;
  ports?: Array<{
    port: number;
    handlers?: string[];
  }>;
  metadata?: Record<string, string | number>;
}

export interface DockerBuildConfig {
  image: string;
  context: string;
  dockerfile?: string;
  buildArgs?: Record<string, string>;
  platform?: string;
}

export interface MetadataEntry {
  key: string;
  value: string;
}

export class DeploymentError extends Error {
  constructor(
    message: string, 
    public code: string = 'DEPLOYMENT_ERROR',
    public details?: any
  ) {
    super(message);
    this.name = 'DeploymentError';
  }
}

export class ValidationError extends DeploymentError {
  constructor(message: string, details?: any) {
    super(message, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class ExternalToolError extends DeploymentError {
  constructor(
    tool: string, 
    message: string, 
    public exitCode?: number, 
    details?: any
  ) {
    super(`${tool}: ${message}`, 'EXTERNAL_TOOL_ERROR', details);
    this.name = 'ExternalToolError';
  }
}