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
  ReauthPrepareOpts,
  ReauthPrepareResult,
  AppConfig,
  ClaudeReadyStatus,
  Unsubscribe,
} from './types';

// --- Node.js runtime imports via Electron's native require ---
// Standard ES imports are intercepted by Vite's dev server, which pre-bundles
// Node.js packages as browser ESM — breaking ioredis's stream.Readable inheritance.
// window.require is Electron's real Node.js require (nodeIntegration: true),
// bypassing Vite entirely. Works in both dev and production modes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeRequire = (window as any).require as NodeRequire;

const { execFile: _execFile } = nodeRequire('child_process');
const { readFileSync, existsSync } = nodeRequire('fs');
const { join } = nodeRequire('path');
const { homedir } = nodeRequire('os');
const { promisify } = nodeRequire('util');
const Redis = nodeRequire('ioredis');

const execFileAsync = promisify(_execFile);

// --- Config helpers ---

const CONFIG_PATH = join(homedir(), '.thopter.json');

interface ThopterConfig {
  runloopApiKey?: string;
  defaultSnapshotName?: string;
  defaultSnapshotId?: string; // Legacy alias for defaultSnapshotName
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
   * List live thopters via `thopter status --json`.
   * Uses the same Runloop API + Redis logic as the CLI — Runloop is the source
   * of truth for which devboxes are alive, Redis provides agent annotations.
   */
  async listThopters(): Promise<ThopterInfo[]> {
    const output = await execThopter('status', '--json');
    const raw = JSON.parse(output) as Array<{
      name: string; owner: string; id: string; devboxStatus: string;
      status: string | null; task: string | null; heartbeat: string | null;
      alive: boolean; claudeRunning: boolean; lastMessage: string | null;
    }>;

    return raw.map((t) => ({
      name: t.name,
      owner: t.owner,
      id: t.id,
      status: (t.status as ThopterStatus) ?? null,
      task: t.task,
      heartbeat: t.heartbeat,
      alive: t.alive,
      claudeRunning: t.claudeRunning,
      lastMessage: t.lastMessage,
      devboxStatus: t.devboxStatus as DevboxStatus,
    }));
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
      defaultSnapshot: config.defaultSnapshotName ?? config.defaultSnapshotId,
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
    const args = ['run', opts.prompt];

    if (opts.homeDir) {
      args.push('--home');
      if (opts.checkouts) {
        for (const c of opts.checkouts) {
          const checkoutArg = c.branch ? `${c.repo}:${c.branch}` : c.repo;
          args.push('--checkout', checkoutArg);
        }
      }
    } else if (opts.repo) {
      args.push('--repo', opts.repo);
      if (opts.branch) args.push('--branch', opts.branch);
    }

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
   * Check if a thopter has tmux and Claude running via CLI.
   */
  async checkClaude(name: string): Promise<ClaudeReadyStatus> {
    try {
      const output = await execThopter('check', name, '--json');
      return JSON.parse(output) as ClaudeReadyStatus;
    } catch {
      return { tmux: false, claude: false };
    }
  }

  /**
   * Fetch the latest tmux screen capture from Redis.
   */
  async getScreenDump(name: string): Promise<string | null> {
    const redis = createRedis();
    await redis.connect();
    try {
      return await redis.get(`thopter:${name}:screen_dump`);
    } finally {
      redis.disconnect();
    }
  }

  /**
   * Resolve SSH spawn info from a devbox ID.
   * Parses `rli devbox ssh --config-only <id>` output (same as src/devbox.ts).
   */
  private async resolveSSHSpawn(devboxId: string): Promise<{ command: string; args: string[] }> {
    const { stdout: configOutput } = await execFileAsync('rli', ['devbox', 'ssh', '--config-only', devboxId], {
      encoding: 'utf-8',
      timeout: 15_000,
    });

    const hostname = configOutput.match(/Hostname\s+(.+)/)?.[1]?.trim();
    const identityFile = configOutput.match(/IdentityFile\s+(.+)/)?.[1]?.trim();
    const proxyCommand = configOutput.match(/ProxyCommand\s+(.+)/)?.[1]?.trim();

    if (!hostname || !identityFile || !proxyCommand) {
      throw new Error('Failed to parse SSH config from rli');
    }

    return {
      command: 'ssh',
      args: [
        '-tt',
        '-o', 'StrictHostKeyChecking=no',
        '-o', `ProxyCommand=${proxyCommand}`,
        '-i', identityFile,
        `user@${hostname}`,
        'bash -l',
      ],
    };
  }

  /**
   * Get SSH spawn command + args by thopter name (resolves devbox ID via Redis).
   */
  async getSSHSpawn(name: string): Promise<{ command: string; args: string[] }> {
    const status = await this.getThopterStatus(name);
    if (!status.id) throw new Error(`No devbox ID for thopter '${name}'`);
    return this.resolveSSHSpawn(status.id);
  }

  /**
   * Get SSH spawn command + args directly by devbox ID (skips Redis lookup).
   */
  async getSSHSpawnById(devboxId: string): Promise<{ command: string; args: string[] }> {
    return this.resolveSSHSpawn(devboxId);
  }

  /**
   * Send a message to a running Claude session via CLI.
   */
  async tellThopter(name: string, message: string, interrupt?: boolean): Promise<void> {
    const args = ['tell', name, message, '--no-tail'];
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
   * Update the task description in Redis (same key the devbox hook writes to).
   */
  async updateTask(name: string, task: string): Promise<void> {
    const redis = createRedis();
    await redis.connect();
    try {
      await redis.set(`thopter:${name}:task`, task, 'EX', 86400);
    } finally {
      redis.disconnect();
    }
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
   * Prepare a devbox for re-authentication.
   * For 'existing': finds the devbox, resumes it if suspended.
   * For 'snapshot'/'fresh': creates a new devbox.
   */
  async reauthPrepare(opts: ReauthPrepareOpts): Promise<ReauthPrepareResult> {
    if (opts.machine === 'existing') {
      if (!opts.devboxName) throw new Error('devboxName required for existing machine reauth');
      const thopters = await this.listThopters();
      const thopter = thopters.find((t) => t.name === opts.devboxName);
      if (!thopter) throw new Error(`Devbox '${opts.devboxName}' not found`);
      if (!thopter.id) throw new Error(`No devbox ID for '${opts.devboxName}'`);

      if (thopter.devboxStatus === 'suspended') {
        await execThopter('resume', opts.devboxName);
      }

      return { devboxName: opts.devboxName, devboxId: thopter.id };
    }

    const config = loadConfig();
    const devboxName = `reauth-${Date.now()}`;

    if (opts.machine === 'snapshot') {
      const snapshotName = config.defaultSnapshotName ?? config.defaultSnapshotId;
      if (!snapshotName) throw new Error('No default snapshot configured for snapshot-based reauth');
      const output = await execThopter('create', devboxName, '--snapshot', snapshotName);
      const match = output.match(/Devbox created:\s*(\S+)/);
      const devboxId = match?.[1];
      if (!devboxId) throw new Error('Could not parse devbox ID from create output');
      return { devboxName, devboxId };
    }

    // fresh
    const output = await execThopter('create', devboxName, '--fresh');
    const match = output.match(/Devbox created:\s*(\S+)/);
    const devboxId = match?.[1];
    if (!devboxId) throw new Error('Could not parse devbox ID from create output');
    return { devboxName, devboxId };
  }

  /**
   * Finalize re-authentication: snapshot the devbox and set it as the default.
   */
  async reauthFinalize(devboxName: string, snapshotName: string): Promise<void> {
    await execThopter('snapshot', 'replace', devboxName, snapshotName);
    await execThopter('snapshot', 'default', snapshotName);
  }
}
