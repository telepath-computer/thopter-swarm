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

let installed = 0;
let skipped = 0;

for (const [event, matchers] of Object.entries(THOPTER_HOOKS)) {
  if (!settings.hooks[event]) {
    settings.hooks[event] = [];
  }

  for (const matcher of matchers) {
    const hookCmd = matcher.hooks[0].command;

    // Check if a hook with this command is already registered
    const alreadyInstalled = settings.hooks[event].some((existing) =>
      existing.hooks?.some((h) => h.command === hookCmd),
    );

    if (alreadyInstalled) {
      skipped++;
      continue;
    }

    settings.hooks[event].push(matcher);
    installed++;
  }
}

mkdirSync(join(HOME, ".claude"), { recursive: true });
writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");

console.log(`Claude hooks: ${installed} installed, ${skipped} already present`);
