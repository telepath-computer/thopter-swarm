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

/** Default devbox resource size. */
export const DEFAULT_RESOURCE_SIZE = "LARGE" as const;

/** Default idle timeout: 1 hour. Suspends on idle (preserves disk). */
export const DEFAULT_IDLE_TIMEOUT_SECONDS = 60 * 60;

/** Secrets to configure during setup, and their env var mappings for devboxes. */
export const SECRETS: Array<{
  runloopName: string;
  envVar: string;
  description: string;
}> = [
  { runloopName: "thopter_anthropic_api_key", envVar: "ANTHROPIC_API_KEY", description: "Anthropic API key (for Claude Code)" },
  { runloopName: "thopter_github_pat", envVar: "GITHUB_PAT", description: "GitHub personal access token (repo read/write)" },
  { runloopName: "thopter_openai_api_key", envVar: "OPENAI_API_KEY", description: "OpenAI API key" },
  { runloopName: "thopter_redis_url", envVar: "REDIS_URL", description: "Upstash Redis URL (redis://default:...@host:port)" },
];

/** Secret mappings to pass to devbox create (env var name → Runloop secret name). */
export const SECRET_MAPPINGS: Record<string, string> = Object.fromEntries(
  SECRETS.map((s) => [s.envVar, s.runloopName]),
);

// --- Local config (default snapshot only) ---

interface LocalConfig {
  defaultSnapshotId?: string;
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
  saveLocalConfig({});
}
