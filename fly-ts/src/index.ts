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
export { buildThopter } from './scripts/build-thopter';
export { ensureMetadata } from './scripts/ensure-metadata';
export { preflightCheck } from './scripts/preflight';
export { recreateGoldenClaude } from './scripts/recreate-gc';
export { recreateHub } from './scripts/recreate-hub';
export { destroyGoldenClaudes } from './scripts/destroy-gc';
export { destroyHub } from './scripts/destroy-hub';
export { destroyThopters } from './scripts/destroy-thopters';
export { testFakeIssue } from './scripts/test-fake-issue';