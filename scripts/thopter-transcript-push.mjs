#!/usr/bin/env node
// Parse a Claude Code transcript JSONL and push new entries to Redis.
// Called by Claude hooks after each event to stream transcript to Redis.
//
// Usage: thopter-transcript-push.mjs <transcript_path> [--reset]
//   --reset: Reset cursor (used on session start)
//
// Reads THOPTER_NAME and REDIS_URL from environment.
// Tracks read position via /tmp/thopter-transcript-cursor.

import { statSync, openSync, readSync, closeSync, writeFileSync, readFileSync, existsSync, unlinkSync } from "node:fs";
import { execSync } from "node:child_process";

const CURSOR_FILE = "/tmp/thopter-transcript-cursor";
const MAX_ENTRIES = 500;
const TTL_SECONDS = 86400; // 24 hours

const transcriptPath = process.argv[2];
const isReset = process.argv.includes("--reset");

if (!transcriptPath) process.exit(0);

const name = process.env.THOPTER_NAME;
const redisUrl = process.env.REDIS_URL;
if (!name || !redisUrl) process.exit(0);

const redisKey = `thopter:${name}:transcript`;

function rcli(...args) {
  try {
    execSync(
      `redis-cli --tls -u "${redisUrl}" ${args.join(" ")}`,
      { stdio: ["pipe", "pipe", "pipe"], timeout: 5000 },
    );
  } catch {
    // Ignore Redis errors — don't break Claude's workflow
  }
}

function rcliPipe(input, ...args) {
  try {
    execSync(
      `redis-cli --tls -u "${redisUrl}" -x ${args.join(" ")}`,
      { input, stdio: ["pipe", "pipe", "pipe"], timeout: 5000 },
    );
  } catch {
    // Ignore Redis errors
  }
}

function summarizeToolUse(toolName, input) {
  if (!input || typeof input !== "object") return `${toolName}`;
  switch (toolName) {
    case "Read":
      return `Read: ${input.file_path ?? "?"}`;
    case "Write":
      return `Write: ${input.file_path ?? "?"}`;
    case "Edit":
      return `Edit: ${input.file_path ?? "?"}`;
    case "Bash": {
      const cmd = String(input.command ?? "");
      return `Bash: ${cmd.slice(0, 120)}`;
    }
    case "Glob":
      return `Glob: ${input.pattern ?? "?"}`;
    case "Grep":
      return `Grep: ${input.pattern ?? "?"} in ${input.path ?? "."}`;
    case "WebFetch":
      return `WebFetch: ${input.url ?? "?"}`;
    case "Task":
      return `Task: ${input.description ?? "subagent"}`;
    default:
      return `${toolName}: ${JSON.stringify(input).slice(0, 100)}`;
  }
}

function extractText(content) {
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text)
    .join(" ")
    .replace(/\n/g, " ")
    .slice(0, 200);
}

function transformEntry(entry) {
  const entries = [];
  const ts = new Date().toISOString();

  if (entry.type === "human") {
    const text = extractText(entry.message?.content);
    if (text) {
      entries.push({ ts, role: "user", summary: text });
    }
  } else if (entry.type === "assistant") {
    const content = entry.message?.content;
    if (!Array.isArray(content)) return entries;

    for (const block of content) {
      if (block.type === "text" && block.text) {
        const text = block.text.replace(/\n/g, " ").slice(0, 200);
        entries.push({ ts, role: "assistant", summary: text });
      } else if (block.type === "tool_use") {
        const summary = summarizeToolUse(block.name, block.input);
        entries.push({ ts, role: "tool_use", summary });
      }
    }
  } else if (entry.type === "tool_result") {
    const content = entry.content;
    const text = Array.isArray(content)
      ? content.filter((b) => b.type === "text").map((b) => b.text).join(" ").slice(0, 100)
      : String(content ?? "").slice(0, 100);
    if (text) {
      entries.push({ ts, role: "tool_result", summary: text.replace(/\n/g, " ") });
    }
  } else if (entry.type === "system") {
    const text = extractText(entry.message?.content).slice(0, 100);
    if (text) {
      entries.push({ ts, role: "system", summary: text });
    }
  }

  return entries;
}

// Handle cursor reset (session start)
if (isReset) {
  try { unlinkSync(CURSOR_FILE); } catch { /* ok */ }
  // Push session marker
  const marker = JSON.stringify({
    ts: new Date().toISOString(),
    role: "system",
    summary: "--- new session ---",
  });
  rcliPipe(marker, "RPUSH", redisKey);
  rcli("LTRIM", redisKey, `-${MAX_ENTRIES}`, "-1");
  rcli("EXPIRE", redisKey, String(TTL_SECONDS));
  process.exit(0);
}

// Read cursor
let cursor = 0;
if (existsSync(CURSOR_FILE)) {
  try {
    cursor = parseInt(readFileSync(CURSOR_FILE, "utf-8").trim(), 10) || 0;
  } catch {
    cursor = 0;
  }
}

// Check transcript file
let stat;
try {
  stat = statSync(transcriptPath);
} catch {
  process.exit(0);
}

if (stat.size <= cursor) process.exit(0);

// Read new bytes
const readSize = stat.size - cursor;
const buf = Buffer.alloc(readSize);
const fd = openSync(transcriptPath, "r");
readSync(fd, buf, 0, readSize, cursor);
closeSync(fd);

// Parse new lines
const text = buf.toString("utf-8");
const lines = text.split("\n").filter((l) => l.trim());

const newEntries = [];
for (const line of lines) {
  try {
    const entry = JSON.parse(line);
    const transformed = transformEntry(entry);
    newEntries.push(...transformed);
  } catch {
    // Skip unparseable lines (e.g., partial writes)
    continue;
  }
}

// Push to Redis
if (newEntries.length > 0) {
  for (const entry of newEntries) {
    rcliPipe(JSON.stringify(entry), "RPUSH", redisKey);
  }
  rcli("LTRIM", redisKey, `-${MAX_ENTRIES}`, "-1");
  rcli("EXPIRE", redisKey, String(TTL_SECONDS));
}

// Update cursor
writeFileSync(CURSOR_FILE, String(stat.size));
