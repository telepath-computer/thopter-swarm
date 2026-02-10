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

/**
 * Build secret mappings dynamically from all Runloop secrets.
 * Convention: secret name in Runloop = env var name in devbox.
 */
export async function getSecretMappings(): Promise<Record<string, string>> {
  const { listSecrets } = await import("./secrets.js");
  const secrets = await listSecrets();
  return Object.fromEntries(secrets.map((s) => [s.name, s.name]));
}

// --- Local config (default snapshot only) ---

interface LocalConfig {
  runloopApiKey?: string;
  redisUrl?: string;
  defaultSnapshotId?: string;
  ntfyChannel?: string;
  defaultThopter?: string;
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

export function getNtfyChannel(): string | undefined {
  return loadLocalConfig().ntfyChannel;
}

export function setNtfyChannel(channel: string): void {
  const config = loadLocalConfig();
  config.ntfyChannel = channel;
  saveLocalConfig(config);
}

export function getDefaultThopter(): string | undefined {
  return loadLocalConfig().defaultThopter;
}

export function setDefaultThopter(name: string): void {
  const config = loadLocalConfig();
  config.defaultThopter = name;
  saveLocalConfig(config);
}

export function clearDefaultThopter(): void {
  const config = loadLocalConfig();
  delete config.defaultThopter;
  saveLocalConfig(config);
}

/**
 * Resolve a thopter name argument. If ".", returns the default thopter.
 * Otherwise returns the name as-is.
 */
export function resolveThopterName(name: string): string {
  if (name === ".") {
    const def = getDefaultThopter();
    if (!def) {
      throw new Error(
        'No default thopter set. Use "thopter use <name>" to set one.',
      );
    }
    return def;
  }
  return name;
}

export function getRunloopApiKey(): string | undefined {
  return loadLocalConfig().runloopApiKey;
}

export function setRunloopApiKey(key: string): void {
  const config = loadLocalConfig();
  config.runloopApiKey = key;
  saveLocalConfig(config);
}

export function getRedisUrl(): string | undefined {
  return loadLocalConfig().redisUrl;
}

export function setRedisUrl(url: string): void {
  const config = loadLocalConfig();
  config.redisUrl = url;
  saveLocalConfig(config);
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
  if (config.redisUrl && !process.env.REDIS_URL) {
    process.env.REDIS_URL = config.redisUrl;
  }
}
