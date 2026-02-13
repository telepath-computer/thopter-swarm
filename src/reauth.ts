/**
 * Interactive reauth wizard.
 * Consolidates the multi-step process of re-authenticating Claude Code
 * on a devbox into a single guided flow.
 */

import { createInterface } from "node:readline";
import { execSync, spawn } from "node:child_process";
import { getClient } from "./client.js";
import {
  MANAGED_BY_KEY,
  MANAGED_BY_VALUE,
  NAME_KEY,
  OWNER_KEY,
  getDefaultSnapshot,
  setDefaultSnapshot,
} from "./config.js";
import { generateName } from "./names.js";
import {
  createDevbox,
  resolveDevbox,
  snapshotDevbox,
  replaceSnapshot,
} from "./devbox.js";

// --- readline helpers (same pattern as setup.ts) ---

let rl = createInterface({ input: process.stdin, output: process.stdout });

function resetReadline() {
  rl = createInterface({ input: process.stdin, output: process.stdout });
}

function ask(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve(answer.trim()));
  });
}

async function askRequired(prompt: string): Promise<string> {
  while (true) {
    const answer = await ask(prompt);
    if (answer) return answer;
    console.log("  This is required.");
  }
}

async function askYesNo(prompt: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  const answer = await ask(`${prompt} ${hint} `);
  if (!answer) return defaultYes;
  return answer.toLowerCase().startsWith("y");
}

// --- SSH helper that returns instead of calling process.exit ---

function sshAndWait(devboxId: string): Promise<number> {
  // Check rli is available
  try {
    execSync("which rli", { stdio: "ignore" });
  } catch {
    console.error("ERROR: 'rli' CLI not found.");
    console.error("  Install it with: npm install -g @runloop/rl-cli");
    rl.close();
    process.exit(1);
  }

  return new Promise((resolve) => {
    const child = spawn("rli", ["devbox", "ssh", devboxId], {
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      resolve(code ?? 0);
    });
  });
}

// --- Wizard ---

export async function runReauth(): Promise<void> {
  console.log("=".repeat(60));
  console.log("Thopter Reauth Wizard");
  console.log("=".repeat(60));
  console.log();

  // --- Step 1: How do you want to get a machine? ---
  console.log("Step 1: Choose a machine");
  console.log();
  console.log("  a) Use an existing machine");
  console.log("  b) Create a new machine from a snapshot");
  console.log("  c) Create a new machine fresh (no snapshot)");
  console.log();

  let choice: string;
  while (true) {
    choice = await ask("  Choice [a/b/c]: ");
    if (["a", "b", "c"].includes(choice.toLowerCase())) break;
    console.log("  Please enter a, b, or c.");
  }
  choice = choice.toLowerCase();

  let devboxId: string;
  let devboxName: string;

  if (choice === "a") {
    // List managed devboxes and let user pick
    const client = getClient();
    const devboxes: { name: string; id: string; status: string }[] = [];
    for (const status of ["running", "suspended", "provisioning", "initializing"] as const) {
      for await (const db of client.devboxes.list({ status, limit: 100 })) {
        const meta = db.metadata ?? {};
        if (meta[MANAGED_BY_KEY] !== MANAGED_BY_VALUE) continue;
        devboxes.push({
          name: meta[NAME_KEY] ?? db.id,
          id: db.id,
          status: db.status,
        });
      }
    }

    if (devboxes.length === 0) {
      console.log("\n  No managed devboxes found. Try option b or c instead.");
      rl.close();
      return;
    }

    console.log();
    for (let i = 0; i < devboxes.length; i++) {
      const db = devboxes[i];
      console.log(`  ${i + 1}) ${db.name} (${db.status})`);
    }
    console.log();

    let idx: number;
    while (true) {
      const answer = await ask(`  Pick a machine [1-${devboxes.length}]: `);
      idx = parseInt(answer, 10);
      if (idx >= 1 && idx <= devboxes.length) break;
      console.log(`  Please enter a number between 1 and ${devboxes.length}.`);
    }

    const picked = devboxes[idx - 1];
    devboxId = picked.id;
    devboxName = picked.name;

    // Resume if suspended
    if (picked.status === "suspended") {
      console.log(`\n  Resuming ${devboxName}...`);
      await client.devboxes.resume(devboxId);
      try {
        await client.devboxes.awaitRunning(devboxId);
        console.log("  Devbox is running.");
      } catch {
        console.log("  WARNING: Timed out waiting for devbox to resume.");
      }
    }
  } else if (choice === "b") {
    // Create from snapshot
    const defaultSnap = getDefaultSnapshot();
    const snapPrompt = defaultSnap
      ? `  Snapshot name or ID [${defaultSnap}]: `
      : "  Snapshot name or ID: ";
    let snapInput = await ask(snapPrompt);
    if (!snapInput && defaultSnap) snapInput = defaultSnap;
    if (!snapInput) {
      console.log("  No snapshot specified. Aborting.");
      rl.close();
      return;
    }

    devboxName = generateName();
    console.log(`\n  Creating devbox '${devboxName}' from snapshot '${snapInput}'...`);
    devboxId = await createDevbox({ name: devboxName, snapshotId: snapInput });
  } else {
    // Fresh create
    devboxName = generateName();
    console.log(`\n  Creating devbox '${devboxName}' (fresh)...`);
    devboxId = await createDevbox({ name: devboxName, fresh: true });
  }

  // --- Step 2: Snapshot name ---
  console.log();
  console.log("Step 2: Choose a name for the snapshot");
  console.log("  This is what the final snapshot will be saved as.");
  const currentDefault = getDefaultSnapshot();
  const snapNamePrompt = currentDefault
    ? `  Snapshot name [${currentDefault}]: `
    : "  Snapshot name: ";
  let snapshotName = await ask(snapNamePrompt);
  if (!snapshotName && currentDefault) snapshotName = currentDefault;
  if (!snapshotName) {
    snapshotName = await askRequired("  Snapshot name (required): ");
  }

  // --- Step 3: SSH in ---
  console.log();
  console.log("Step 3: SSH into the devbox");
  console.log("  Authenticate Claude Code, install tools, etc.");
  console.log("  When done, exit the SSH session (Ctrl-D or 'exit') to continue.");
  console.log();
  await ask("  Press Enter to connect...");

  // Close readline so SSH gets clean access to the terminal.
  // Without this, readline holds listeners on stdin that conflict with
  // SSH's PTY handling, breaking terminal control (issue #132).
  rl.close();

  console.log(`  Connecting to ${devboxName} (${devboxId})...`);
  await sshAndWait(devboxId);
  console.log();
  console.log("  SSH session ended.");

  // Recreate readline for remaining wizard steps.
  resetReadline();

  // --- Step 4: Snapshot + save as default ---
  console.log();
  console.log("Step 4: Snapshot and save");
  console.log();

  // Check if a snapshot with this name already exists
  const client = getClient();
  let existingSnapshotId: string | undefined;
  for await (const s of client.devboxes.diskSnapshots.list({ limit: 100 })) {
    if (s.name === snapshotName) {
      existingSnapshotId = s.id;
      break;
    }
  }

  if (existingSnapshotId) {
    const replace = await askYesNo(
      `  Snapshot '${snapshotName}' already exists (${existingSnapshotId}). Replace it?`,
    );
    if (!replace) {
      console.log("  Aborted. Devbox is still running — you can snapshot manually.");
      rl.close();
      return;
    }
    await replaceSnapshot(devboxName, snapshotName);
  } else {
    await snapshotDevbox(devboxName, snapshotName);
  }

  setDefaultSnapshot(snapshotName);

  console.log();
  console.log("=".repeat(60));
  console.log("Reauth complete!");
  console.log();
  console.log(`  Snapshot:  ${snapshotName}`);
  console.log(`  Default:   ${snapshotName} (set as default)`);
  console.log(`  Devbox:    ${devboxName} (still running)`);
  console.log();
  console.log("New thopters will use this snapshot automatically.");
  console.log("=".repeat(60));

  rl.close();
}
