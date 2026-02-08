/**
 * Constants and local configuration for runloop-thopters.
 * Local config (~/.runloop-thopters/config.json) stores the default snapshot ID.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CONFIG_DIR = join(homedir(), ".runloop-thopters");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

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
  defaultSnapshotId?: string;
  ntfyChannel?: string;
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
  mkdirSync(CONFIG_DIR, { recursive: true });
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
