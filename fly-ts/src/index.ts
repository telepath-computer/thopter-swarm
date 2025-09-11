// Main exports for the TypeScript deployment library
export { FlyWrapper } from './lib/fly';
export { DockerWrapper } from './lib/docker';
export { MetadataClient } from './lib/metadata';
export { validateEnvironment, runPreflightChecks } from './lib/validation';
export { runCommand, runCommandOrThrow, runCommandJson } from './lib/shell';
export * from './lib/output';
export * from './lib/types';

// Script exports
export { destroyMetadata } from './scripts/destroy-metadata';
export { showStatus } from './scripts/status';