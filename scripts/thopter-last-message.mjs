#!/usr/bin/env node
// Parse a Claude Code transcript JSONL and print the last assistant text
// message to stdout. Called by the Stop hook to capture what Claude last said.

import { statSync, openSync, readSync, closeSync } from "node:fs";

const transcriptPath = process.argv[2];
if (!transcriptPath) process.exit(0);

// Read last 200KB — plenty for recent messages
const stat = statSync(transcriptPath);
const readSize = Math.min(stat.size, 200 * 1024);
const buf = Buffer.alloc(readSize);
const fd = openSync(transcriptPath, "r");
readSync(fd, buf, 0, readSize, stat.size - readSize);
closeSync(fd);

const tail = buf.toString("utf-8");
// Skip potential partial first line
const firstNewline = tail.indexOf("\n");
const lines = tail
  .slice(firstNewline + 1)
  .split("\n")
  .filter((l) => l.trim());

// Walk backwards to find last assistant message with text
for (let i = lines.length - 1; i >= 0; i--) {
  try {
    const entry = JSON.parse(lines[i]);
    if (entry.type !== "assistant") continue;
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;

    const texts = content
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text);

    if (texts.length > 0) {
      let text = texts.join("\n");
      // Truncate for redis storage
      if (text.length > 500) {
        text = text.slice(0, 497) + "...";
      }
      process.stdout.write(text);
      process.exit(0);
    }
  } catch {
    continue;
  }
}
