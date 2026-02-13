// Service factory — returns MockThopterService or RealThopterService based on environment.

import type { ThopterService } from './types';
import { MockThopterService } from './mock';
import { RealThopterService } from './real';

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
    _service = isMockMode() ? new MockThopterService() : new RealThopterService();
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
