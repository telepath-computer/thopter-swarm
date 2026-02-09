/**
 * Read thopter status from Redis.
 * Connects using REDIS_URL from ~/.thopter.json config.
 */

import { Redis } from "ioredis";
import { printTable } from "./output.js";

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

export interface ThopterInfo {
  name: string;
  owner: string | null;
  id: string | null;
  status: string | null;
  task: string | null;
  heartbeat: string | null;
  alive: boolean;
  claudeRunning: string | null;
  lastMessage: string | null;
}

async function scanThopters(redis: Redis): Promise<ThopterInfo[]> {
  // Find all thopter names by scanning for heartbeat keys
  const keys: string[] = [];
  let cursor = "0";
  do {
    const [next, batch] = await redis.scan(cursor, "MATCH", "thopter:*:heartbeat", "COUNT", 100);
    cursor = next;
    keys.push(...batch);
  } while (cursor !== "0");

  const thopters: ThopterInfo[] = [];
  for (const key of keys) {
    const name = key.replace(/^thopter:/, "").replace(/:heartbeat$/, "");
    const prefix = `thopter:${name}`;

    const [id, owner, status, task, heartbeat, alive, claudeRunning, lastMessage] = await redis.mget(
      `${prefix}:id`,
      `${prefix}:owner`,
      `${prefix}:status`,
      `${prefix}:task`,
      `${prefix}:heartbeat`,
      `${prefix}:alive`,
      `${prefix}:claude_running`,
      `${prefix}:last_message`,
    );

    thopters.push({
      name,
      owner,
      id,
      status,
      task,
      heartbeat,
      alive: alive === "1",
      claudeRunning,
      lastMessage,
    });
  }

  // Sort: alive first, then by name
  thopters.sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return thopters;
}

/**
 * Fetch Redis info for a single thopter by name.
 */
export async function getThopterRedisInfo(name: string): Promise<ThopterInfo | null> {
  const redis = getRedis();
  try {
    const prefix = `thopter:${name}`;
    const [id, owner, status, task, heartbeat, alive, claudeRunning, lastMessage] = await redis.mget(
      `${prefix}:id`,
      `${prefix}:owner`,
      `${prefix}:status`,
      `${prefix}:task`,
      `${prefix}:heartbeat`,
      `${prefix}:alive`,
      `${prefix}:claude_running`,
      `${prefix}:last_message`,
    );

    if (!heartbeat && !status && !id) return null;

    return {
      name,
      owner,
      id,
      status,
      task,
      heartbeat,
      alive: alive === "1",
      claudeRunning,
      lastMessage,
    };
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

export async function showAllStatus(opts: { all?: boolean } = {}): Promise<void> {
  const redis = getRedis();
  try {
    let thopters = await scanThopters(redis);

    // Unless --all, hide dead thopters with heartbeats older than 1 hour
    if (!opts.all) {
      const oneHourMs = 60 * 60 * 1000;
      const hidden = thopters.filter((t) => {
        if (t.alive) return false;
        if (!t.heartbeat) return true;
        return Date.now() - new Date(t.heartbeat).getTime() > oneHourMs;
      }).length;
      thopters = thopters.filter((t) => {
        if (t.alive) return true;
        if (!t.heartbeat) return false;
        return Date.now() - new Date(t.heartbeat).getTime() <= oneHourMs;
      });
      if (hidden > 0) {
        console.log(`(${hidden} stale thopter${hidden === 1 ? "" : "s"} hidden — use --all to show)\n`);
      }
    }

    if (thopters.length === 0) {
      console.log("No thopters reporting to redis.");
      return;
    }

    printTable(
      ["NAME", "OWNER", "STATUS", "TASK", "ALIVE", "CLAUDE", "HEARTBEAT", "LAST MESSAGE"],
      thopters.map((t) => {
        // Truncate task for table display: max 40 chars
        let task = t.task ?? "-";
        if (task.length > 40) task = task.slice(0, 37) + "...";
        // Truncate last message for table display: first line, max 60 chars
        let msg = t.lastMessage ?? "-";
        const nl = msg.indexOf("\n");
        if (nl > 0) msg = msg.slice(0, nl);
        if (msg.length > 60) msg = msg.slice(0, 57) + "...";
        return [
          t.name,
          t.owner ?? "-",
          t.status ?? "-",
          task,
          t.alive ? "yes" : "no",
          t.claudeRunning === "1" ? "yes" : t.claudeRunning === "0" ? "no" : "-",
          t.heartbeat ? relativeTime(t.heartbeat) : "-",
          msg,
        ];
      }),
    );
  } finally {
    redis.disconnect();
  }
}

export async function showThopterStatus(name: string): Promise<void> {
  // Fetch Runloop devbox info in parallel with Redis info
  let devboxStatus = "-";
  let devboxId = "-";
  try {
    const { getClient } = await import("./client.js");
    const { MANAGED_BY_KEY, MANAGED_BY_VALUE, NAME_KEY } = await import("./config.js");
    const client = getClient();
    for (const s of ["running", "suspended", "provisioning", "initializing", "suspending", "resuming"] as const) {
      for await (const db of client.devboxes.list({ status: s, limit: 100 })) {
        const meta = db.metadata ?? {};
        if (meta[MANAGED_BY_KEY] === MANAGED_BY_VALUE && meta[NAME_KEY] === name) {
          devboxStatus = db.status;
          devboxId = db.id;
        }
      }
    }
  } catch {
    // Runloop API unavailable — continue with Redis-only info
  }

  const redis = getRedis();
  try {
    const prefix = `thopter:${name}`;

    const [id, owner, status, task, heartbeat, alive, claudeRunning, lastMessage] = await redis.mget(
      `${prefix}:id`,
      `${prefix}:owner`,
      `${prefix}:status`,
      `${prefix}:task`,
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
    console.log(`Task:           ${task ?? "-"}`);
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
