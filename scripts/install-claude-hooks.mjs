#!/usr/bin/env node
// Install Claude Code hooks for thopter status reporting.
// Idempotent: merges hooks into existing settings without overwriting.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const HOME = process.env.HOME || "/home/user";
const SETTINGS_PATH = join(HOME, ".claude", "settings.json");
const HOOKS_DIR = join(HOME, ".claude", "hooks");

// Hook definitions: event → matcher groups
const THOPTER_HOOKS = {
  SessionStart: [
    {
      hooks: [
        { type: "command", command: join(HOOKS_DIR, "on-session-start.sh") },
      ],
    },
  ],
  UserPromptSubmit: [
    {
      hooks: [{ type: "command", command: join(HOOKS_DIR, "on-prompt.sh") }],
    },
  ],
  Notification: [
    {
      hooks: [
        { type: "command", command: join(HOOKS_DIR, "on-notification.sh") },
      ],
    },
  ],
  PostToolUse: [
    {
      hooks: [
        { type: "command", command: join(HOOKS_DIR, "on-tool-use.sh") },
      ],
    },
  ],
  Stop: [
    {
      hooks: [{ type: "command", command: join(HOOKS_DIR, "on-stop.sh") }],
    },
  ],
  SessionEnd: [
    {
      hooks: [
        { type: "command", command: join(HOOKS_DIR, "on-session-end.sh") },
      ],
    },
  ],
};

// Load existing settings or start fresh
let settings = {};
if (existsSync(SETTINGS_PATH)) {
  try {
    settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
  } catch {
    console.error(
      `Warning: could not parse ${SETTINGS_PATH}, starting fresh`,
    );
    settings = {};
  }
}

if (!settings.hooks) {
  settings.hooks = {};
}

// Remove any existing thopter hooks (identified by commands pointing to HOOKS_DIR)
// before adding fresh ones. This prevents duplicates from snapshot-based creates.
for (const [event, matcherList] of Object.entries(settings.hooks)) {
  if (!Array.isArray(matcherList)) continue;
  settings.hooks[event] = matcherList.filter(
    (m) => !m.hooks?.some((h) => h.command?.startsWith(HOOKS_DIR)),
  );
}

for (const [event, matchers] of Object.entries(THOPTER_HOOKS)) {
  if (!settings.hooks[event]) {
    settings.hooks[event] = [];
  }
  for (const matcher of matchers) {
    settings.hooks[event].push(matcher);
  }
}

mkdirSync(join(HOME, ".claude"), { recursive: true });
writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");

const hookCount = Object.values(THOPTER_HOOKS).reduce((n, matchers) => n + matchers.length, 0);
console.log(`Claude hooks: ${hookCount} installed`);
