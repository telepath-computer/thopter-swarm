// Service factory — returns MockThopterService or RealThopterService based on environment.
// RealThopterService is loaded lazily to avoid pulling in Node.js builtins (child_process,
// fs, ioredis, etc.) when running in mock mode — ESM renderer can't resolve bare specifiers.

import type { ThopterService } from './types';
import { MockThopterService } from './mock';

let _service: ThopterService | null = null;

/**
 * Returns true if mock mode is enabled via THOPTER_MOCK env var or --mock CLI flag.
 */
function isMockMode(): boolean {
  if (typeof process !== 'undefined' && process.env.THOPTER_MOCK === '1') {
    return true;
  }
  if (typeof process !== 'undefined' && process.argv.includes('--mock')) {
    return true;
  }
  return false;
}

/**
 * Get or create the singleton ThopterService instance.
 * Uses MockThopterService when THOPTER_MOCK=1 or --mock flag is present.
 */
export function getService(): ThopterService {
  if (!_service) {
    if (isMockMode()) {
      _service = new MockThopterService();
    } else {
      // Dynamic require to avoid ESM resolution issues with Node.js builtins
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { RealThopterService } = require('./real') as typeof import('./real');
      _service = new RealThopterService();
    }
  }
  return _service;
}

// Re-export types for convenience
export type { ThopterService } from './types';
export type {
  ThopterInfo,
  ThopterStatus,
  DevboxStatus,
  TranscriptEntry,
  TranscriptRole,
  SnapshotInfo,
  RepoConfig,
  RunThopterOpts,
  ReauthOpts,
  AppConfig,
  NtfyNotification,
  Unsubscribe,
} from './types';
