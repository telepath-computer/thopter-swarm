/**
 * Read thopter status from Redis.
 * Connects using REDIS_URL from environment / .env.local.
 */

import { Redis } from "ioredis";
import { printTable } from "./output.js";

function getRedis(): Redis {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error(
      "REDIS_URL not set. Add it to .env.local or set it in your environment.",
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

interface ThopterInfo {
  name: string;
  id: string | null;
  status: string | null;
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

    const [id, status, heartbeat, alive, claudeRunning, lastMessage] = await redis.mget(
      `${prefix}:id`,
      `${prefix}:status`,
      `${prefix}:heartbeat`,
      `${prefix}:alive`,
      `${prefix}:claude_running`,
      `${prefix}:last_message`,
    );

    thopters.push({
      name,
      id,
      status,
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

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export async function showAllStatus(): Promise<void> {
  const redis = getRedis();
  try {
    const thopters = await scanThopters(redis);

    if (thopters.length === 0) {
      console.log("No thopters reporting to redis.");
      return;
    }

    printTable(
      ["NAME", "STATUS", "ALIVE", "CLAUDE", "HEARTBEAT", "LAST MESSAGE"],
      thopters.map((t) => {
        // Truncate last message for table display: first line, max 60 chars
        let msg = t.lastMessage ?? "-";
        const nl = msg.indexOf("\n");
        if (nl > 0) msg = msg.slice(0, nl);
        if (msg.length > 60) msg = msg.slice(0, 57) + "...";
        return [
          t.name,
          t.status ?? "-",
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
  const redis = getRedis();
  try {
    const prefix = `thopter:${name}`;

    const [id, status, heartbeat, alive, claudeRunning, lastMessage] = await redis.mget(
      `${prefix}:id`,
      `${prefix}:status`,
      `${prefix}:heartbeat`,
      `${prefix}:alive`,
      `${prefix}:claude_running`,
      `${prefix}:last_message`,
    );

    if (!heartbeat && !status && !id) {
      console.log(`No data found for thopter '${name}'.`);
      return;
    }

    console.log(`=== ${name} ===`);
    console.log(`ID:             ${id ?? "-"}`);
    console.log(`Status:         ${status ?? "-"}`);
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
