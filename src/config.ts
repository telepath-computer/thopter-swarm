/**
 * Constants and local configuration for runloop-thopters.
 * Local config (~/.thopter.json) stores developer settings.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CONFIG_FILE = join(homedir(), ".thopter.json");

/** Metadata key used to tag devboxes we manage. */
export const MANAGED_BY_KEY = "managed_by";
export const MANAGED_BY_VALUE = "runloop-thopters";
export const NAME_KEY = "thopter_name";
export const OWNER_KEY = "thopter_owner";

/** Default devbox resource size. */
export const DEFAULT_RESOURCE_SIZE = "LARGE" as const;

/** Default idle timeout: 12 hours. Suspends on idle (preserves disk). */
export const DEFAULT_IDLE_TIMEOUT_SECONDS = 12 * 60 * 60;

// --- Local config ---

export interface UploadEntry {
  local: string;
  remote: string;
}

interface LocalConfig {
  runloopApiKey?: string;
  defaultSnapshotId?: string;
  claudeMdPath?: string;
  uploads?: UploadEntry[];
  stopNotifications?: boolean;
  envVars?: Record<string, string>;
}

function loadLocalConfig(): LocalConfig {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function saveLocalConfig(config: LocalConfig): void {
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
}

export function getDefaultSnapshot(): string | undefined {
  return loadLocalConfig().defaultSnapshotId;
}

export function setDefaultSnapshot(snapshotId: string): void {
  const config = loadLocalConfig();
  config.defaultSnapshotId = snapshotId;
  saveLocalConfig(config);
}

export function clearDefaultSnapshot(): void {
  const config = loadLocalConfig();
  delete config.defaultSnapshotId;
  saveLocalConfig(config);
}

export function getStopNotifications(): boolean {
  return loadLocalConfig().stopNotifications ?? false;
}

export function setStopNotifications(enabled: boolean): void {
  const config = loadLocalConfig();
  config.stopNotifications = enabled;
  saveLocalConfig(config);
}

export function getRunloopApiKey(): string | undefined {
  return loadLocalConfig().runloopApiKey;
}

export function setRunloopApiKey(key: string): void {
  const config = loadLocalConfig();
  config.runloopApiKey = key;
  saveLocalConfig(config);
}

// --- Devbox env vars ---

const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function validateEnvKey(key: string): void {
  if (!ENV_KEY_RE.test(key)) {
    throw new Error(
      `Invalid env var name '${key}'. Must match [A-Za-z_][A-Za-z0-9_]*.`,
    );
  }
}

/** Escape a value for safe inclusion in a shell `export KEY="VALUE"` line. */
export function escapeEnvValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/`/g, "\\`");
}

export function getEnvVars(): Record<string, string> {
  return loadLocalConfig().envVars ?? {};
}

export function setEnvVar(key: string, value: string): void {
  validateEnvKey(key);
  const config = loadLocalConfig();
  if (!config.envVars) config.envVars = {};
  config.envVars[key] = value;
  saveLocalConfig(config);
}

export function deleteEnvVar(key: string): void {
  const config = loadLocalConfig();
  if (config.envVars) {
    delete config.envVars[key];
    saveLocalConfig(config);
  }
}

// --- Custom CLAUDE.md and file uploads ---

export function getClaudeMdPath(): string | undefined {
  return loadLocalConfig().claudeMdPath;
}

export function getUploads(): UploadEntry[] {
  return loadLocalConfig().uploads ?? [];
}

/**
 * Load config values into process.env so downstream code (client.ts, status.ts)
 * can read them without changes. Config values don't override existing env vars.
 */
export function loadConfigIntoEnv(): void {
  const config = loadLocalConfig();
  if (config.runloopApiKey && !process.env.RUNLOOP_API_KEY) {
    process.env.RUNLOOP_API_KEY = config.runloopApiKey;
  }
  const envVars = config.envVars ?? {};
  if (envVars.THOPTER_REDIS_URL && !process.env.THOPTER_REDIS_URL) {
    process.env.THOPTER_REDIS_URL = envVars.THOPTER_REDIS_URL;
  }
}
