/**
 * Read thopter status from Redis.
 * Connects using THOPTER_REDIS_URL from ~/.thopter.json config.
 */

import { Redis } from "ioredis";
import { isDigitalOceanProvider } from "./provider.js";

function getRedis(): Redis {
  const url = process.env.THOPTER_REDIS_URL;
  if (!url) {
    throw new Error(
      "Redis URL not configured. Set it with: thopter env set THOPTER_REDIS_URL <url>",
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

export interface ThopterInfo {
  name: string;
  owner: string | null;
  id: string | null;
  status: string | null;
  statusLine: string | null;
  notes: string | null;
  heartbeat: string | null;
  alive: boolean;
  claudeRunning: string | null;
  lastMessage: string | null;
}

const REDIS_FIELDS = ["id", "owner", "status", "statusline", "notes", "heartbeat", "alive", "claude_running", "last_message"] as const;

function parseRedisValues(name: string, values: (string | null)[]): ThopterInfo {
  const [id, owner, status, statusLine, notes, heartbeat, alive, claudeRunning, lastMessage] = values;
  return { name, owner, id, status, statusLine, notes, heartbeat, alive: alive === "1", claudeRunning, lastMessage };
}

/**
 * Fetch Redis info for multiple thopters using a single connection.
 * Returns a Map keyed by thopter name.
 */
export async function getRedisInfoForNames(names: string[]): Promise<Map<string, ThopterInfo>> {
  if (names.length === 0) return new Map();

  const redis = getRedis();
  try {
    const results = new Map<string, ThopterInfo>();
    for (const name of names) {
      const prefix = `thopter:${name}`;
      const values = await redis.mget(...REDIS_FIELDS.map((f) => `${prefix}:${f}`));
      const info = parseRedisValues(name, values);
      if (info.heartbeat || info.status || info.id) {
        results.set(name, info);
      }
    }
    return results;
  } finally {
    redis.disconnect();
  }
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export async function showThopterStatus(name: string): Promise<void> {
  // Look up Runloop devbox status
  let devboxStatus = "-";
  let devboxId = "-";
  if (isDigitalOceanProvider()) {
    try {
      const { fetchThopters } = await import("./devbox.js");
      const thopters = await fetchThopters();
      const found = thopters.find((t) => t.name === name);
      if (found) {
        devboxStatus = found.devboxStatus;
        devboxId = found.id;
      }
    } catch {
      // DO API unavailable — continue with Redis-only info
    }
  } else {
    try {
      const { getClient } = await import("./client.js");
      const { MANAGED_BY_KEY, MANAGED_BY_VALUE, NAME_KEY } = await import("./config.js");
      const client = getClient();
      outer:
      for (const s of ["running", "suspended", "provisioning", "initializing", "suspending", "resuming"] as const) {
        for await (const db of client.devboxes.list({ status: s, limit: 100 })) {
          const meta = db.metadata ?? {};
          if (meta[MANAGED_BY_KEY] === MANAGED_BY_VALUE && meta[NAME_KEY] === name) {
            devboxStatus = db.status;
            devboxId = db.id;
            break outer;
          }
        }
      }
    } catch {
      // Runloop API unavailable — continue with Redis-only info
    }
  }

  const redis = getRedis();
  try {
    const prefix = `thopter:${name}`;

    const [id, owner, status, statusLine, notes, heartbeat, alive, claudeRunning, lastMessage] = await redis.mget(
      `${prefix}:id`,
      `${prefix}:owner`,
      `${prefix}:status`,
      `${prefix}:statusline`,
      `${prefix}:notes`,
      `${prefix}:heartbeat`,
      `${prefix}:alive`,
      `${prefix}:claude_running`,
      `${prefix}:last_message`,
    );

    if (!heartbeat && !status && !id && devboxStatus === "-") {
      console.log(`No data found for thopter '${name}'.`);
      return;
    }

    console.log(`=== ${name} ===`);
    console.log(`Devbox ID:      ${devboxId !== "-" ? devboxId : id ?? "-"}`);
    console.log(`Devbox status:  ${devboxStatus}`);
    console.log(`Owner:          ${owner ?? "-"}`);
    console.log(`Agent status:   ${status ?? "-"}`);
    console.log(`Status line:    ${statusLine ?? "-"}`);
    if (notes) {
      console.log(`Notes:          ${notes}`);
    }
    console.log(`Alive:          ${alive === "1" ? "yes" : "no"}`);
    console.log(`Claude running: ${claudeRunning === "1" ? "yes" : claudeRunning === "0" ? "no" : "-"}`);
    console.log(`Heartbeat:      ${heartbeat ? `${heartbeat} (${relativeTime(heartbeat)})` : "-"}`);
    if (lastMessage) {
      console.log(`Last message:   ${lastMessage}`);
    }

    // Show recent logs
    const logs = await redis.lrange(`${prefix}:logs`, -20, -1);
    if (logs.length > 0) {
      console.log(`\nRecent logs:`);
      for (const entry of logs) {
        console.log(`  ${entry}`);
      }
    } else {
      console.log(`\nNo logs.`);
    }
  } finally {
    redis.disconnect();
  }
}
