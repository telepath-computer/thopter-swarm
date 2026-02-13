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

/** Default keep-alive time: 12 hours. Devbox shuts down after this period unless reset. */
export const DEFAULT_KEEP_ALIVE_SECONDS = 12 * 60 * 60;

// --- Local config ---

export interface UploadEntry {
  local: string;
  remote: string;
}

export interface RepoConfig {
  repo: string;     // owner/repo format (e.g. "telepath-computer/thopter-swarm")
  branch?: string;  // Pinned branch. If omitted → prompt at run time (default: main)
}

export interface SyncthingConfig {
  /** This laptop's SyncThing device ID. */
  deviceId: string;
  /** SyncThing folder ID (must match on both sides). */
  folderId: string;
  /** Path on the laptop (local). */
  localPath: string;
  /** Path on devboxes (remote). */
  remotePath: string;
}

interface LocalConfig {
  runloopApiKey?: string;
  defaultSnapshotName?: string;
  defaultSnapshotId?: string; // Legacy alias for defaultSnapshotName (stores a name, not an ID)
  defaultRepo?: string;
  defaultBranch?: string;
  claudeMdPath?: string;
  uploads?: UploadEntry[];
  stopNotifications?: boolean;
  stopNotificationQuietPeriod?: number;
  envVars?: Record<string, string>;
  defaultThopter?: string;
  repos?: RepoConfig[];
  syncthing?: SyncthingConfig;
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
  const config = loadLocalConfig();
  return config.defaultSnapshotName ?? config.defaultSnapshotId;
}

export function setDefaultSnapshot(name: string): void {
  const config = loadLocalConfig();
  config.defaultSnapshotName = name;
  delete config.defaultSnapshotId; // Migrate away from legacy field
  saveLocalConfig(config);
}

export function clearDefaultSnapshot(): void {
  const config = loadLocalConfig();
  delete config.defaultSnapshotName;
  delete config.defaultSnapshotId;
  saveLocalConfig(config);
}

export function getDefaultRepo(): string | undefined {
  return loadLocalConfig().defaultRepo;
}

export function setDefaultRepo(repo: string): void {
  const config = loadLocalConfig();
  config.defaultRepo = repo;
  saveLocalConfig(config);
}

export function getDefaultBranch(): string | undefined {
  return loadLocalConfig().defaultBranch;
}

export function setDefaultBranch(branch: string): void {
  const config = loadLocalConfig();
  config.defaultBranch = branch;
  saveLocalConfig(config);
}

export function getStopNotifications(): boolean {
  return loadLocalConfig().stopNotifications ?? true;
}

export function setStopNotifications(enabled: boolean): void {
  const config = loadLocalConfig();
  config.stopNotifications = enabled;
  saveLocalConfig(config);
}

export function getStopNotificationQuietPeriod(): number {
  return loadLocalConfig().stopNotificationQuietPeriod ?? 30;
}

export function setStopNotificationQuietPeriod(seconds: number): void {
  const config = loadLocalConfig();
  config.stopNotificationQuietPeriod = seconds;
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
 * Resolve "." to the default thopter name. Pass through anything else unchanged.
 * Throws if "." is used but no default is set.
 */
export function resolveThopterName(name: string): string {
  if (name !== ".") return name;
  const defaultName = getDefaultThopter();
  if (!defaultName) {
    throw new Error(
      "No default thopter set. Set one with: thopter use <name>",
    );
  }
  return defaultName;
}

// --- Predefined repos ---

export function getRepos(): RepoConfig[] {
  return loadLocalConfig().repos ?? [];
}

export function setRepos(repos: RepoConfig[]): void {
  const config = loadLocalConfig();
  config.repos = repos;
  saveLocalConfig(config);
}

export function addRepo(entry: RepoConfig): void {
  const config = loadLocalConfig();
  if (!config.repos) config.repos = [];
  config.repos.push(entry);
  saveLocalConfig(config);
}

export function removeRepo(repo: string, branch?: string): boolean {
  const config = loadLocalConfig();
  if (!config.repos) return false;
  const before = config.repos.length;
  config.repos = config.repos.filter((r) => {
    if (r.repo !== repo) return true;
    if (branch !== undefined) return r.branch !== branch;
    return false;
  });
  if (config.repos.length === before) return false;
  saveLocalConfig(config);
  return true;
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

// --- SyncThing ---

export function getSyncthingConfig(): SyncthingConfig | undefined {
  return loadLocalConfig().syncthing;
}

export function setSyncthingConfig(syncthing: SyncthingConfig): void {
  const config = loadLocalConfig();
  config.syncthing = syncthing;
  saveLocalConfig(config);
}

export function clearSyncthingConfig(): void {
  const config = loadLocalConfig();
  delete config.syncthing;
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
  const envVars = config.envVars ?? {};
  if (envVars.THOPTER_REDIS_URL && !process.env.THOPTER_REDIS_URL) {
    process.env.THOPTER_REDIS_URL = envVars.THOPTER_REDIS_URL;
  }
}
