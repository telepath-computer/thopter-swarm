// MockThopterService — generates fake data for development and Playwright testing.

import type {
  ThopterService,
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
  ClaudeReadyStatus,
  Unsubscribe,
} from './types';

// --- Fake data generators ---

const THOPTER_NAMES = [
  'eager-falcon',
  'calm-horizon',
  'bright-nebula',
  'swift-current',
  'quiet-ember',
];

const TASKS = [
  'Implementing auth middleware for API routes',
  'Fixing CI pipeline flaky test in checkout flow',
  'Refactoring database connection pooling',
  'Adding dark mode support to dashboard',
  'Writing integration tests for payment service',
];

const OWNERS = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve'];

const STATUSES: ThopterStatus[] = ['running', 'running', 'waiting', 'done', 'running'];
const DEVBOX_STATUSES: DevboxStatus[] = ['running', 'running', 'running', 'running', 'suspended'];

// Realistic transcript content by role
const USER_MESSAGES = [
  'Please implement the login endpoint with JWT authentication.',
  'Can you also add rate limiting to the API?',
  'The tests are failing — can you check what went wrong?',
  'Update the error messages to be more user-friendly.',
  'Add input validation for the email field.',
  'Please refactor this to use async/await instead of callbacks.',
  'Can you write unit tests for the new middleware?',
  'Fix the TypeScript type errors in the auth module.',
];

const ASSISTANT_MESSAGES = [
  "I'll implement the JWT authentication endpoint. Let me start by reading the existing auth setup.",
  "Looking at the code, I see the issue. The middleware isn't awaiting the database query, causing a race condition.",
  "I've added rate limiting using a sliding window algorithm. The default is 100 requests per minute per IP.",
  "The tests are passing now. The issue was a missing mock for the Redis connection in the test environment.",
  "I'll refactor this module to use the repository pattern for better testability.",
  "Here's my plan:\n1. Add input validation with zod\n2. Update error responses to use RFC 7807 format\n3. Add unit tests for each validation rule",
  "The TypeScript errors were caused by a missing generic parameter on the `Response` type. I've fixed all 5 occurrences.",
  "I've written 12 unit tests covering the happy path, error cases, and edge cases for the middleware.",
];

const TOOL_USE_ENTRIES = [
  'Read: src/auth/middleware.ts',
  'Edit: src/auth/jwt.ts',
  'Bash: npm test -- --grep "auth"',
  'Read: src/config/database.ts',
  'Edit: src/routes/api.ts',
  'Bash: npm run lint --fix',
  'Glob: src/**/*.test.ts',
  'Read: package.json',
  'Edit: src/middleware/rateLimit.ts',
  'Bash: npx tsc --noEmit',
  'Grep: "TODO" in src/',
  'Write: src/validators/email.ts',
];

const TOOL_RESULT_ENTRIES = [
  'File contents (87 lines)',
  'Edit applied successfully',
  'Tests passed: 12/12',
  'File contents (45 lines)',
  'Edit applied successfully',
  'Fixed 3 lint issues',
  'Found 8 matching files',
  'File contents (32 lines)',
  'New file created',
  'No type errors found',
  'Found 4 matches across 3 files',
  'Tests passed: 5/5',
  'File contents (123 lines)',
  'Compilation successful',
];

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function generateTranscript(count: number): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  const baseTime = Date.now() - count * 15_000; // ~15s between entries

  for (let i = 0; i < count; i++) {
    const ts = new Date(baseTime + i * randomBetween(8_000, 25_000)).toISOString();

    // Weighted role distribution: assistant heavy, with tool pairs
    const roll = Math.random();
    let role: TranscriptRole;
    let summary: string;
    let full: string | undefined;

    if (roll < 0.15) {
      role = 'user';
      summary = randomItem(USER_MESSAGES);
      full = summary;
    } else if (roll < 0.45) {
      role = 'assistant';
      const msg = randomItem(ASSISTANT_MESSAGES);
      summary = msg.length > 80 ? msg.slice(0, 77) + '...' : msg;
      full = msg;
    } else if (roll < 0.65) {
      role = 'tool_use';
      summary = randomItem(TOOL_USE_ENTRIES);
    } else if (roll < 0.85) {
      role = 'tool_result';
      summary = randomItem(TOOL_RESULT_ENTRIES);
    } else {
      role = 'system';
      summary = 'Environment ready';
    }

    entries.push({ ts, role, summary, full });
  }

  return entries;
}

// --- Mock service implementation ---

export class MockThopterService implements ThopterService {
  private thopters: Map<string, ThopterInfo> = new Map();
  private transcripts: Map<string, TranscriptEntry[]> = new Map();
  private subscriptionIntervals: Map<string, ReturnType<typeof setInterval>> = new Map();

  constructor() {
    // Generate 5 fake thopters
    for (let i = 0; i < THOPTER_NAMES.length; i++) {
      const name = THOPTER_NAMES[i];
      const heartbeatMinutes = STATUSES[i] === 'done' ? 45 : randomBetween(1, 10);

      this.thopters.set(name, {
        name,
        owner: OWNERS[i],
        id: `dvbx_mock_${name.replace('-', '_')}_${1000 + i}`,
        status: STATUSES[i],
        task: TASKS[i],
        heartbeat: minutesAgo(heartbeatMinutes),
        alive: STATUSES[i] !== 'done' && STATUSES[i] !== 'inactive',
        claudeRunning: STATUSES[i] === 'running',
        lastMessage: randomItem(ASSISTANT_MESSAGES).slice(0, 60),
        devboxStatus: DEVBOX_STATUSES[i],
      });

      // Generate transcript history per thopter
      const entryCount = randomBetween(20, 50);
      this.transcripts.set(name, generateTranscript(entryCount));
    }
  }

  async listThopters(): Promise<ThopterInfo[]> {
    await delay(200);
    return Array.from(this.thopters.values());
  }

  async getThopterStatus(name: string): Promise<ThopterInfo> {
    await delay(100);
    const info = this.thopters.get(name);
    if (!info) throw new Error(`Thopter '${name}' not found`);
    return info;
  }

  async getTranscript(name: string, lines?: number): Promise<TranscriptEntry[]> {
    await delay(150);
    const transcript = this.transcripts.get(name) ?? [];
    if (lines) return transcript.slice(-lines);
    return transcript;
  }

  subscribeTranscript(name: string, onEntry: (entry: TranscriptEntry) => void): Unsubscribe {
    // Clear any existing subscription for this thopter
    const existing = this.subscriptionIntervals.get(name);
    if (existing) clearInterval(existing);

    const interval = setInterval(() => {
      const entry = generateLiveEntry();
      // Add to stored transcript
      let transcript = this.transcripts.get(name);
      if (!transcript) {
        transcript = [];
        this.transcripts.set(name, transcript);
      }
      transcript.push(entry);
      // Keep transcript bounded
      if (transcript.length > 500) transcript.splice(0, transcript.length - 500);

      onEntry(entry);
    }, randomBetween(3_000, 8_000));

    this.subscriptionIntervals.set(name, interval);

    return () => {
      clearInterval(interval);
      this.subscriptionIntervals.delete(name);
    };
  }

  async runThopter(opts: RunThopterOpts): Promise<{ name: string }> {
    await delay(3_000);
    const name = opts.name ?? `mock-${randomItem(['jolly', 'brave', 'sharp', 'cool'])}-${randomItem(['penguin', 'tiger', 'otter', 'fox'])}`;

    this.thopters.set(name, {
      name,
      owner: 'You',
      id: `dvbx_mock_${Date.now()}`,
      status: 'running',
      task: opts.prompt.slice(0, 80),
      heartbeat: new Date().toISOString(),
      alive: true,
      claudeRunning: true,
      lastMessage: 'Starting up...',
      devboxStatus: 'running',
    });

    this.transcripts.set(name, [
      { ts: new Date().toISOString(), role: 'system', summary: 'Environment ready' },
      { ts: new Date().toISOString(), role: 'user', summary: opts.prompt.slice(0, 120) },
    ]);

    return { name };
  }

  async checkClaude(name: string): Promise<ClaudeReadyStatus> {
    await delay(300);
    const info = this.thopters.get(name);
    if (!info) return { tmux: false, claude: false };
    // Suspended thopters have no tmux or Claude
    if (info.devboxStatus === 'suspended') return { tmux: false, claude: false };
    return { tmux: true, claude: info.claudeRunning };
  }

  async getScreenDump(name: string): Promise<string | null> {
    await delay(100);
    const info = this.thopters.get(name);
    if (!info || info.devboxStatus === 'suspended') return null;
    return [
      `user@${name} ~/project (main) $ claude`,
      '',
      '╭──────────────────────────────────────────────────────────╮',
      '│  Claude Code                                    v1.0.30 │',
      '╰──────────────────────────────────────────────────────────╯',
      '',
      `> ${info.task ?? 'Working...'}`,
      '',
      '  I\'ll start by reading the existing code to understand',
      '  the current implementation.',
      '',
      '  Read: src/auth/middleware.ts',
      '  Edit: src/routes/api.ts (12 lines changed)',
      '  Bash: npm test -- --grep "auth" (12 passed)',
      '',
      `  ${info.status === 'waiting' ? '? What would you like me to do next?' : '⠋ Working...'}`,
      '',
    ].join('\n');
  }

  async tellThopter(name: string, message: string, _interrupt?: boolean): Promise<void> {
    await delay(500);
    const info = this.thopters.get(name);
    if (!info) throw new Error(`Thopter '${name}' not found`);

    const entry: TranscriptEntry = {
      ts: new Date().toISOString(),
      role: 'user',
      summary: message.length > 80 ? message.slice(0, 77) + '...' : message,
      full: message,
    };

    let transcript = this.transcripts.get(name);
    if (!transcript) {
      transcript = [];
      this.transcripts.set(name, transcript);
    }
    transcript.push(entry);
  }

  async destroyThopter(name: string): Promise<void> {
    await delay(2_000);
    if (!this.thopters.has(name)) throw new Error(`Thopter '${name}' not found`);

    // Clean up subscription
    const interval = this.subscriptionIntervals.get(name);
    if (interval) {
      clearInterval(interval);
      this.subscriptionIntervals.delete(name);
    }

    this.thopters.delete(name);
    this.transcripts.delete(name);
  }

  async suspendThopter(name: string): Promise<void> {
    await delay(1_000);
    const info = this.thopters.get(name);
    if (!info) throw new Error(`Thopter '${name}' not found`);
    info.status = 'inactive';
    info.alive = false;
    info.claudeRunning = false;
    info.devboxStatus = 'suspended';
  }

  async resumeThopter(name: string): Promise<void> {
    await delay(1_000);
    const info = this.thopters.get(name);
    if (!info) throw new Error(`Thopter '${name}' not found`);
    info.status = 'running';
    info.alive = true;
    info.claudeRunning = true;
    info.heartbeat = new Date().toISOString();
    info.devboxStatus = 'running';
  }

  async updateTask(name: string, task: string): Promise<void> {
    const info = this.thopters.get(name);
    if (!info) throw new Error(`Unknown thopter '${name}'`);
    info.task = task;
  }

  attachThopter(name: string): void {
    console.log(`[Mock] Would open iTerm2 and SSH into thopter '${name}'`);
  }

  async listSnapshots(): Promise<SnapshotInfo[]> {
    await delay(200);
    return [
      { id: 'snp_mock_default_001', name: 'default', createdAt: minutesAgo(60 * 24 * 3) },
      { id: 'snp_mock_lean_002', name: 'lean-image', createdAt: minutesAgo(60 * 24) },
      { id: 'snp_mock_gpu_003', name: 'gpu-enabled', createdAt: minutesAgo(60 * 6) },
    ];
  }

  async listRepos(): Promise<RepoConfig[]> {
    await delay(100);
    return [
      { repo: 'telepath-computer/thopter-swarm', branch: 'main' },
      { repo: 'telepath-computer/web-app', branch: 'develop' },
      { repo: 'telepath-computer/ml-pipeline' },
      { repo: 'acme-corp/backend-api', branch: 'main' },
    ];
  }

  async getConfig(): Promise<AppConfig> {
    await delay(100);
    return {
      defaultRepo: 'telepath-computer/thopter-swarm',
      defaultBranch: 'main',
      defaultSnapshot: 'snp_mock_default_001',
      ntfyChannel: 'thopter-mock',
      repos: await this.listRepos(),
      stopNotifications: true,
      stopNotificationQuietPeriod: 30,
    };
  }

  async reauth(opts: ReauthOpts): Promise<void> {
    console.log(`[Mock] Re-authenticating: machine=${opts.machine}, snapshot=${opts.snapshotName}`);
    if (opts.devboxName) console.log(`[Mock]   devbox: ${opts.devboxName}`);
    await delay(2_000);
    console.log('[Mock] SSH step: would show SSH command for manual auth');
    await delay(2_000);
    console.log('[Mock] Creating snapshot and saving as default...');
    await delay(1_000);
    console.log('[Mock] Re-auth complete');
  }
}

// --- Helpers ---

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateLiveEntry(): TranscriptEntry {
  const roll = Math.random();
  let role: TranscriptRole;
  let summary: string;
  let full: string | undefined;

  if (roll < 0.1) {
    role = 'user';
    summary = randomItem(USER_MESSAGES);
    full = summary;
  } else if (roll < 0.4) {
    role = 'assistant';
    const msg = randomItem(ASSISTANT_MESSAGES);
    summary = msg.length > 80 ? msg.slice(0, 77) + '...' : msg;
    full = msg;
  } else if (roll < 0.65) {
    role = 'tool_use';
    summary = randomItem(TOOL_USE_ENTRIES);
  } else if (roll < 0.9) {
    role = 'tool_result';
    summary = randomItem(TOOL_RESULT_ENTRIES);
  } else {
    role = 'system';
    summary = 'Environment ready';
  }

  return { ts: new Date().toISOString(), role, summary, full };
}
