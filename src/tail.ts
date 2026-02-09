/**
 * Tail a thopter's transcript stream from Redis.
 * Entries are pushed by thopter-transcript-push.mjs on the devbox side.
 */

import { Redis } from "ioredis";

function getRedis(): Redis {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error(
      "Redis URL not configured. Set it with: thopter config set redisUrl <url>",
    );
  }
  const parsed = new URL(url);
  return new Redis({
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    password: parsed.password,
    username: parsed.username || undefined,
    tls: {},
  });
}

interface TranscriptEntry {
  ts: string;
  role: string;
  summary: string;
}

// ANSI color helpers — respect NO_COLOR env var
const useColor = !process.env.NO_COLOR;
const c = {
  green: (s: string) => (useColor ? `\x1b[32m${s}\x1b[0m` : s),
  cyan: (s: string) => (useColor ? `\x1b[36m${s}\x1b[0m` : s),
  yellow: (s: string) => (useColor ? `\x1b[33m${s}\x1b[0m` : s),
  dim: (s: string) => (useColor ? `\x1b[2m${s}\x1b[0m` : s),
  magenta: (s: string) => (useColor ? `\x1b[35m${s}\x1b[0m` : s),
};

function colorRole(role: string): string {
  switch (role) {
    case "user":
      return c.green(role.padEnd(11));
    case "assistant":
      return c.cyan(role.padEnd(11));
    case "tool_use":
      return c.yellow(role.padEnd(11));
    case "tool_result":
      return c.dim(role.padEnd(11));
    case "system":
      return c.magenta(role.padEnd(11));
    default:
      return role.padEnd(11);
  }
}

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toTimeString().slice(0, 8); // HH:MM:SS
  } catch {
    return "??:??:??";
  }
}

function formatEntry(entry: TranscriptEntry): string {
  const time = c.dim(formatTime(entry.ts));
  const role = colorRole(entry.role);
  return `${time}  ${role}  ${entry.summary}`;
}

function parseEntry(raw: string): TranscriptEntry | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed.ts && parsed.role && typeof parsed.summary === "string") {
      return parsed as TranscriptEntry;
    }
    return null;
  } catch {
    return null;
  }
}

export async function tailTranscript(
  name: string,
  opts: { follow?: boolean; lines?: number },
): Promise<void> {
  const redis = getRedis();
  const key = `thopter:${name}:transcript`;
  const numLines = opts.lines ?? 20;

  try {
    // Get initial entries
    const entries = await redis.lrange(key, -numLines, -1);

    if (entries.length === 0 && !opts.follow) {
      console.log(`No transcript data for '${name}'. Is Claude running?`);
      return;
    }

    // Print initial entries
    for (const raw of entries) {
      const entry = parseEntry(raw);
      if (entry) {
        console.log(formatEntry(entry));
      }
    }

    if (!opts.follow) {
      return;
    }

    // Follow mode — poll for new entries
    if (entries.length === 0) {
      console.log(`No transcript data yet for '${name}'. Waiting...`);
    }
    console.log(c.dim(`Tailing ${name}... (Ctrl-C to stop)`));

    let knownLength = await redis.llen(key);

    // Poll every second
    const interval = setInterval(async () => {
      try {
        const currentLength = await redis.llen(key);
        if (currentLength > knownLength) {
          // Fetch only new entries
          const newEntries = await redis.lrange(key, knownLength, -1);
          for (const raw of newEntries) {
            const entry = parseEntry(raw);
            if (entry) {
              console.log(formatEntry(entry));
            }
          }
          knownLength = currentLength;
        } else if (currentLength < knownLength) {
          // List was trimmed or cleared — reset
          knownLength = currentLength;
        }
      } catch {
        // Ignore transient Redis errors during polling
      }
    }, 1000);

    // Clean up on Ctrl-C
    const cleanup = () => {
      clearInterval(interval);
      redis.disconnect();
      process.exit(0);
    };
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

    // Keep alive — the interval keeps the process running
    await new Promise(() => {});
  } finally {
    redis.disconnect();
  }
}
