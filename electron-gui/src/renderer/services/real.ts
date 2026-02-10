// RealThopterService — connects to Redis directly for queries, shells out to CLI for mutations.
// Designed for merged-context Electron (nodeIntegration: true, contextIsolation: false).

import type {
  ThopterService,
  ThopterInfo,
  ThopterStatus,
  DevboxStatus,
  TranscriptEntry,
  SnapshotInfo,
  RepoConfig,
  RunThopterOpts,
  ReauthOpts,
  AppConfig,
  Unsubscribe,
} from './types';

// --- Node.js imports (available in merged-context Electron) ---

import { execFile as _execFile } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { promisify } from 'util';
import Redis from 'ioredis';

const execFileAsync = promisify(_execFile);

// --- Config helpers ---

const CONFIG_PATH = join(homedir(), '.thopter.json');

interface ThopterConfig {
  runloopApiKey?: string;
  defaultSnapshotId?: string;
  defaultRepo?: string;
  defaultBranch?: string;
  claudeMdPath?: string;
  stopNotifications?: boolean;
  stopNotificationQuietPeriod?: number;
  repos?: RepoConfig[];
  envVars?: Record<string, string>;
}

function loadConfig(): ThopterConfig {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

// --- Redis helpers ---

function createRedis(): Redis {
  const config = loadConfig();
  const url = config.envVars?.THOPTER_REDIS_URL;
  if (!url) throw new Error('THOPTER_REDIS_URL not configured in ~/.thopter.json envVars');

  const parsed = new URL(url);
  return new Redis({
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    password: parsed.password,
    username: parsed.username || undefined,
    tls: {},
    lazyConnect: true,
  });
}

const REDIS_FIELDS = ['id', 'owner', 'status', 'task', 'heartbeat', 'alive', 'claude_running', 'last_message'] as const;

function parseRedisValues(name: string, values: (string | null)[]): ThopterInfo {
  const [id, owner, status, task, heartbeat, alive, claudeRunning, lastMessage] = values;
  const isAlive = alive === '1';

  // Infer devbox status from Redis data (Runloop API not available here).
  // alive=1 → devbox is running. Otherwise best guess from agent status.
  let devboxStatus: DevboxStatus = 'running';
  if (!isAlive) {
    if (!heartbeat && !status && !id) {
      devboxStatus = 'shutdown';
    } else if (status === 'done') {
      devboxStatus = 'running'; // Agent finished but devbox still alive
    } else {
      devboxStatus = 'suspended'; // Best guess for non-alive thopters with data
    }
  }

  return {
    name,
    owner,
    id,
    status: (status as ThopterStatus) ?? null,
    task,
    heartbeat,
    alive: isAlive,
    claudeRunning: claudeRunning === '1',
    lastMessage,
    devboxStatus,
  };
}

function parseTranscriptEntry(raw: string): TranscriptEntry | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed.ts && parsed.role && typeof parsed.summary === 'string') {
      return parsed as TranscriptEntry;
    }
    return null;
  } catch {
    return null;
  }
}

// --- CLI helpers ---

/**
 * Resolve the thopter CLI path. Checks:
 * 1. THOPTER_CLI env var
 * 2. Known dev location in the repo
 */
function getCliPath(): string {
  if (process.env.THOPTER_CLI) return process.env.THOPTER_CLI;

  // Dev location: sibling to electron-gui/
  const devPath = join(__dirname, '..', '..', '..', '..', 'thopter');
  if (existsSync(devPath)) return devPath;

  // Fall back to PATH
  return 'thopter';
}

/**
 * Execute a thopter CLI command. Returns stdout.
 * Uses execFile (not exec) to avoid shell injection.
 */
async function execThopter(...args: string[]): Promise<string> {
  const cliPath = getCliPath();
  const { stdout } = await execFileAsync(cliPath, args, {
    encoding: 'utf-8',
    timeout: 120_000, // 2 min for long operations like run
    env: { ...process.env }, // Inherit env (includes RUNLOOP_API_KEY etc.)
  });
  return stdout;
}

// --- Real service implementation ---

export class RealThopterService implements ThopterService {
  /**
   * Discover all thopters via Redis key scan, then batch-fetch their status.
   * Scans for thopter:*:heartbeat keys to find names.
   */
  async listThopters(): Promise<ThopterInfo[]> {
    const redis = createRedis();
    await redis.connect();
    try {
      // Discover thopter names by scanning for heartbeat keys
      const names: string[] = [];
      let cursor = '0';
      do {
        const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', 'thopter:*:heartbeat', 'COUNT', 100);
        cursor = nextCursor;
        for (const key of keys) {
          // Extract name from "thopter:{name}:heartbeat"
          const match = key.match(/^thopter:(.+):heartbeat$/);
          if (match) names.push(match[1]);
        }
      } while (cursor !== '0');

      if (names.length === 0) return [];

      // Batch fetch all fields for each thopter via pipeline
      const pipeline = redis.pipeline();
      for (const name of names) {
        const prefix = `thopter:${name}`;
        pipeline.mget(...REDIS_FIELDS.map((f) => `${prefix}:${f}`));
      }
      const results = await pipeline.exec();
      if (!results) return [];

      const thopters: ThopterInfo[] = [];
      for (let i = 0; i < names.length; i++) {
        const [err, values] = results[i];
        if (err || !values) continue;
        const info = parseRedisValues(names[i], values as (string | null)[]);
        // Only include thopters that have meaningful data
        if (info.heartbeat || info.status || info.id) {
          thopters.push(info);
        }
      }

      return thopters;
    } finally {
      redis.disconnect();
    }
  }

  /**
   * Get detailed status for a single thopter from Redis.
   */
  async getThopterStatus(name: string): Promise<ThopterInfo> {
    const redis = createRedis();
    await redis.connect();
    try {
      const prefix = `thopter:${name}`;
      const values = await redis.mget(...REDIS_FIELDS.map((f) => `${prefix}:${f}`));
      const info = parseRedisValues(name, values);

      if (!info.heartbeat && !info.status && !info.id) {
        throw new Error(`No data found for thopter '${name}'`);
      }

      return info;
    } finally {
      redis.disconnect();
    }
  }

  /**
   * Fetch transcript entries from Redis list.
   */
  async getTranscript(name: string, lines?: number): Promise<TranscriptEntry[]> {
    const redis = createRedis();
    await redis.connect();
    try {
      const key = `thopter:${name}:transcript`;
      const count = lines ?? 100;
      const raw = await redis.lrange(key, -count, -1);

      const entries: TranscriptEntry[] = [];
      for (const item of raw) {
        const entry = parseTranscriptEntry(item);
        if (entry) entries.push(entry);
      }
      return entries;
    } finally {
      redis.disconnect();
    }
  }

  /**
   * Subscribe to new transcript entries via Redis polling.
   * Uses the transcript_seq counter (same pattern as CLI tail -f).
   */
  subscribeTranscript(name: string, onEntry: (entry: TranscriptEntry) => void): Unsubscribe {
    let stopped = false;
    let redis: Redis | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;
    let lastSeq = 0;

    const start = async () => {
      redis = createRedis();
      await redis.connect();

      // If unsubscribed during connect, clean up immediately
      if (stopped) {
        redis.disconnect();
        redis = null;
        return;
      }

      // Initialize sequence counter
      const seq = await redis.get(`thopter:${name}:transcript_seq`);
      lastSeq = parseInt(seq ?? '0', 10);

      if (stopped) {
        redis.disconnect();
        redis = null;
        return;
      }

      interval = setInterval(async () => {
        if (stopped || !redis) return;
        try {
          const key = `thopter:${name}:transcript`;
          const seqKey = `thopter:${name}:transcript_seq`;
          const currentSeq = parseInt(await redis.get(seqKey) ?? '0', 10);

          if (currentSeq > lastSeq) {
            const newCount = currentSeq - lastSeq;
            const currentLen = await redis.llen(key);
            const fetchCount = Math.min(newCount, currentLen);
            const raw = await redis.lrange(key, -fetchCount, -1);

            for (const item of raw) {
              const entry = parseTranscriptEntry(item);
              if (entry) onEntry(entry);
            }
            lastSeq = currentSeq;
          }
        } catch {
          // Ignore transient Redis errors during polling
        }
      }, 1_000);
    };

    // Start async (fire and forget — errors logged to console)
    start().catch((err) => console.error('subscribeTranscript failed to start:', err));

    return () => {
      stopped = true;
      if (interval) clearInterval(interval);
      if (redis) redis.disconnect();
    };
  }

  /**
   * List snapshots by parsing CLI output.
   * CLI output format (from printTable):
   *   NAME      ID              SOURCE DEVBOX    CREATED
   *   ───────   ───────────     ──────────────   ──────────
   *   default   snp_xxx         dvbx_xxx         1/1/2025, 12:00 AM
   */
  async listSnapshots(): Promise<SnapshotInfo[]> {
    const output = await execThopter('snapshot', 'list');
    const lines = output.split('\n').filter((l) => l.trim());

    const snapshots: SnapshotInfo[] = [];

    for (const line of lines) {
      // Match lines that contain a snapshot ID
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('NAME') || trimmed.startsWith('─') || trimmed === '(none)') continue;
      if (trimmed.startsWith('Default snapshot:')) continue;

      // Split on 2+ spaces to get columns: NAME, ID, SOURCE DEVBOX, CREATED
      const parts = trimmed.split(/\s{2,}/);
      if (parts.length >= 4 && parts[1].startsWith('snp_')) {
        snapshots.push({
          name: parts[0],
          id: parts[1],
          createdAt: parts[3], // Keep as display string; CLI outputs localized date
        });
      }
    }

    return snapshots;
  }

  /**
   * Read repos directly from ~/.thopter.json.
   */
  async listRepos(): Promise<RepoConfig[]> {
    const config = loadConfig();
    return (config.repos ?? []).map((r) => ({
      repo: r.repo,
      branch: r.branch,
    }));
  }

  /**
   * Read full app config from ~/.thopter.json.
   */
  async getConfig(): Promise<AppConfig> {
    const config = loadConfig();
    return {
      defaultRepo: config.defaultRepo,
      defaultBranch: config.defaultBranch,
      defaultSnapshot: config.defaultSnapshotId,
      ntfyChannel: config.envVars?.THOPTER_NTFY_CHANNEL,
      repos: config.repos ?? [],
      stopNotifications: config.stopNotifications ?? true,
      stopNotificationQuietPeriod: config.stopNotificationQuietPeriod ?? 30,
    };
  }

  /**
   * Launch a new thopter via CLI. Parses the thopter name from output.
   * CLI prints: "Thopter 'name' running."
   */
  async runThopter(opts: RunThopterOpts): Promise<{ name: string }> {
    const args = ['run', opts.prompt, '--repo', opts.repo];
    if (opts.branch) args.push('--branch', opts.branch);
    if (opts.name) args.push('--name', opts.name);
    if (opts.snapshotId) args.push('--snapshot', opts.snapshotId);
    if (opts.keepAliveMinutes) args.push('--keep-alive', String(opts.keepAliveMinutes));

    const output = await execThopter(...args);

    // Parse thopter name from "Thopter 'name' running."
    const match = output.match(/Thopter '([^']+)' running/);
    if (match) return { name: match[1] };

    // Fallback: if name was provided, return it
    if (opts.name) return { name: opts.name };

    throw new Error('Could not determine thopter name from CLI output');
  }

  /**
   * Send a message to a running Claude session via CLI.
   */
  async tellThopter(name: string, message: string, interrupt?: boolean): Promise<void> {
    const args = ['tell', name, message];
    if (interrupt) args.push('--interrupt');
    await execThopter(...args);
  }

  /**
   * Destroy (shut down) a devbox via CLI.
   */
  async destroyThopter(name: string): Promise<void> {
    await execThopter('destroy', name);
  }

  /**
   * Suspend a devbox via CLI.
   */
  async suspendThopter(name: string): Promise<void> {
    await execThopter('suspend', name);
  }

  /**
   * Resume a suspended devbox via CLI.
   */
  async resumeThopter(name: string): Promise<void> {
    await execThopter('resume', name);
  }

  /**
   * Open iTerm2 with SSH connection to the thopter's tmux session.
   * Uses osascript (macOS) to create a new iTerm2 window with the attach command.
   */
  attachThopter(name: string): void {
    const command = `${getCliPath()} attach ${name}`;
    // Use osascript to open iTerm2 with the thopter attach command
    const script = `
      tell application "iTerm2"
        create window with default profile command "${command.replace(/"/g, '\\"')}"
      end tell
    `.trim();

    _execFile('osascript', ['-e', script], (err) => {
      if (err) {
        // Fallback: try Terminal.app if iTerm2 isn't available
        const termScript = `
          tell application "Terminal"
            do script "${command.replace(/"/g, '\\"')}"
            activate
          end tell
        `.trim();
        _execFile('osascript', ['-e', termScript], (err2) => {
          if (err2) console.error('Failed to open terminal for attach:', err2.message);
        });
      }
    });
  }

  /**
   * Re-authenticate Claude Code and update the default snapshot.
   * Delegates to the CLI's interactive reauth wizard.
   */
  async reauth(opts: ReauthOpts): Promise<void> {
    // The CLI reauth is interactive (prompts for input), so we can't use it directly.
    // Instead, build the workflow from individual CLI commands.
    const config = loadConfig();

    let devboxName: string;

    if (opts.machine === 'existing') {
      if (!opts.devboxName) throw new Error('devboxName required for existing machine reauth');
      devboxName = opts.devboxName;
    } else if (opts.machine === 'snapshot') {
      // Create a devbox from the default snapshot
      const snapshotId = config.defaultSnapshotId;
      if (!snapshotId) throw new Error('No default snapshot configured for snapshot-based reauth');
      devboxName = `reauth-${Date.now()}`;
      await execThopter('create', devboxName, '--snapshot', snapshotId);
    } else {
      // Fresh devbox
      devboxName = `reauth-${Date.now()}`;
      await execThopter('create', devboxName, '--fresh');
    }

    // At this point the user needs to SSH in and authenticate manually.
    // The GUI should show the SSH command and wait for user confirmation.
    // After manual auth, snapshot the devbox.
    await execThopter('snapshot', 'replace', devboxName, opts.snapshotName);
  }
}
