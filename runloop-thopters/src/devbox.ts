/**
 * Devbox lifecycle: create, list, destroy, ssh, exec, snapshot, fork.
 */

import { execSync, spawn } from "node:child_process";
import { getClient } from "./client.js";
import { printTable } from "./output.js";
import {
  MANAGED_BY_KEY,
  MANAGED_BY_VALUE,
  NAME_KEY,
  DEFAULT_RESOURCE_SIZE,
  DEFAULT_IDLE_TIMEOUT_SECONDS,
  SECRET_MAPPINGS,
  getDefaultSnapshot,
} from "./config.js";

/** Git setup script that runs inside the devbox on first create. */
const INIT_SCRIPT = `
set -e

# Configure git credentials using PAT from environment
if [ -n "$GITHUB_PAT" ]; then
    git config --global credential.helper store
    echo "https://thopterbot:\${GITHUB_PAT}@github.com" > ~/.git-credentials
    git config --global user.name "ThopterBot"
    git config --global user.email "thopterbot@telepath.computer"
    echo "Git configured with PAT credentials"
else
    echo "WARNING: GITHUB_PAT not set, git push/pull to private repos won't work"
fi

# Install essential tools
sudo apt-get update -qq && sudo apt-get install -y -qq tmux wget curl jq > /dev/null

# Install Neovim (latest stable, NvChad requires 0.10+)
NVIM_ARCH=$(uname -m | sed 's/aarch64/arm64/;s/x86_64/x86_64/')
curl -fsSL "https://github.com/neovim/neovim/releases/latest/download/nvim-linux-\${NVIM_ARCH}.tar.gz" | sudo tar xz -C /opt
sudo ln -sf /opt/nvim-linux-\${NVIM_ARCH}/bin/nvim /usr/local/bin/nvim

# Install NvChad
git clone https://github.com/NvChad/starter ~/.config/nvim 2>/dev/null || true

# Install Claude Code
curl -fsSL https://claude.ai/install.sh | bash

# Install OpenAI Codex
npm i -g @openai/codex

# Ensure ~/.local/bin is on PATH and set yolo-claude alias
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
echo 'alias yolo-claude="claude --dangerously-skip-permissions"' >> ~/.bashrc

echo "Devbox init complete"
`.trim();

/**
 * Resolve a snapshot by name or ID.
 */
async function resolveSnapshotId(nameOrId: string): Promise<string> {
  if (nameOrId.startsWith("snp_")) return nameOrId;

  const client = getClient();
  const matches: string[] = [];
  for await (const s of client.devboxes.diskSnapshots.list({ limit: 100 })) {
    if (s.name === nameOrId) matches.push(s.id);
  }

  if (matches.length === 0) {
    throw new Error(
      `No snapshot named '${nameOrId}'. Use 'snapshot list' to see available snapshots.`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous: ${matches.length} snapshots named '${nameOrId}' (${matches.join(", ")}). Use a snapshot ID instead.`,
    );
  }
  return matches[0];
}

/**
 * Resolve a devbox by name or ID. Searches our managed devboxes by metadata.
 */
async function resolveDevbox(
  nameOrId: string,
): Promise<{ id: string; name?: string }> {
  const client = getClient();

  // If it looks like a devbox ID, return directly
  if (nameOrId.startsWith("dvbx_") || nameOrId.startsWith("dbx_")) {
    return { id: nameOrId };
  }

  // Search all non-shutdown devboxes by name in metadata
  for (const status of ["running", "provisioning", "initializing", "suspended"] as const) {
    for await (const db of client.devboxes.list({ status, limit: 100 })) {
      const meta = db.metadata ?? {};
      if (
        meta[MANAGED_BY_KEY] === MANAGED_BY_VALUE &&
        meta[NAME_KEY] === nameOrId
      ) {
        return { id: db.id, name: nameOrId };
      }
    }
  }

  throw new Error(
    `No devbox named '${nameOrId}'. Use 'list' to see available devboxes.`,
  );
}

export async function createDevbox(opts: {
  name: string;
  snapshotId?: string;
  task?: string;
  idleTimeout?: number;
}): Promise<string> {
  const client = getClient();

  // Determine snapshot (resolve name → ID if needed)
  let snapshotId = opts.snapshotId
    ? await resolveSnapshotId(opts.snapshotId)
    : undefined;
  if (!snapshotId) {
    const defaultSnap = getDefaultSnapshot();
    if (defaultSnap) {
      snapshotId = await resolveSnapshotId(defaultSnap);
      console.log(`Using default snapshot: ${snapshotId}`);
    }
  }

  // Build metadata
  const metadata: Record<string, string> = {
    [MANAGED_BY_KEY]: MANAGED_BY_VALUE,
    [NAME_KEY]: opts.name,
  };
  if (opts.task) {
    metadata.task = opts.task;
  }

  const createParams = {
    name: opts.name,
    snapshot_id: snapshotId,
    metadata,
    secrets: SECRET_MAPPINGS,
    launch_parameters: {
      resource_size_request: DEFAULT_RESOURCE_SIZE,
      after_idle: {
        idle_time_seconds: opts.idleTimeout ?? DEFAULT_IDLE_TIMEOUT_SECONDS,
        on_idle: "suspend" as const,
      },
      launch_commands: snapshotId ? undefined : [INIT_SCRIPT],
    },
  };

  console.log(
    snapshotId
      ? `Creating devbox '${opts.name}' from snapshot ${snapshotId}...`
      : `Creating devbox '${opts.name}' (fresh)...`,
  );
  console.log("Waiting for devbox to be ready...");

  try {
    const devbox = await client.devboxes.createAndAwaitRunning(createParams);
    console.log(`Devbox created: ${devbox.id}`);
    console.log("Devbox is running.");
    return devbox.id;
  } catch (e) {
    // If it failed after creation, try to extract the ID from the error or re-fetch
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`WARNING: Devbox may not have reached running state: ${msg}`);
    console.log("  Check status with: runloop-thopters list");

    // Try to find the devbox we just created by name
    for await (const db of client.devboxes.list({ limit: 50 })) {
      const meta = db.metadata ?? {};
      if (meta[NAME_KEY] === opts.name && meta[MANAGED_BY_KEY] === MANAGED_BY_VALUE) {
        console.log(`Devbox ID: ${db.id} (status: ${db.status})`);
        return db.id;
      }
    }
    throw e;
  }
}

export async function listDevboxes(): Promise<void> {
  const client = getClient();

  console.log("Devboxes:");
  const rows: string[][] = [];
  const liveStatuses = ["provisioning", "initializing", "running", "suspending", "suspended", "resuming"] as const;
  for (const status of liveStatuses) {
    for await (const db of client.devboxes.list({ status, limit: 100 })) {
      const meta = db.metadata ?? {};
      if (meta[MANAGED_BY_KEY] !== MANAGED_BY_VALUE) continue;
      const name = meta[NAME_KEY] ?? "";
      const task = meta.task ?? "";
      const created = db.create_time_ms
        ? new Date(db.create_time_ms).toLocaleString()
        : "";
      rows.push([name, db.id, db.status, task, created]);
    }
  }

  printTable(["NAME", "ID", "STATUS", "TASK", "CREATED"], rows);
}

export async function listSnapshotsCmd(): Promise<void> {
  const client = getClient();

  const rows: string[][] = [];
  for await (const s of client.devboxes.diskSnapshots.list({ limit: 100 })) {
    const name = s.name ?? "";
    const source = s.source_devbox_id ?? "";
    const created = s.create_time_ms
      ? new Date(s.create_time_ms).toLocaleString()
      : "";
    rows.push([name, s.id, source, created]);
  }

  printTable(["NAME", "ID", "SOURCE DEVBOX", "CREATED"], rows);

  const defaultSnap = getDefaultSnapshot();
  if (defaultSnap) {
    console.log(`\nDefault snapshot: ${defaultSnap}`);
  }
}

export async function deleteSnapshot(nameOrId: string): Promise<void> {
  const snapshotId = await resolveSnapshotId(nameOrId);
  const client = getClient();

  console.log(`Deleting snapshot ${snapshotId}...`);
  await client.devboxes.diskSnapshots.delete(snapshotId);
  console.log("Done.");
}

export async function destroyDevbox(nameOrId: string): Promise<void> {
  const { id } = await resolveDevbox(nameOrId);

  console.log(`Shutting down devbox ${id}...`);
  const client = getClient();
  await client.devboxes.shutdown(id);
  console.log("Done.");
}

export async function suspendDevbox(nameOrId: string): Promise<void> {
  const { id } = await resolveDevbox(nameOrId);

  console.log(`Suspending devbox ${id}...`);
  const client = getClient();
  await client.devboxes.suspend(id);
  console.log("Suspended. Resume with: ./rt resume " + (nameOrId));
}

export async function resumeDevbox(nameOrId: string): Promise<void> {
  const { id } = await resolveDevbox(nameOrId);

  console.log(`Resuming devbox ${id}...`);
  const client = getClient();
  await client.devboxes.resume(id);
  try {
    await client.devboxes.awaitRunning(id);
    console.log("Devbox is running.");
  } catch {
    console.log("WARNING: Timed out waiting for devbox to reach running state.");
    console.log("  Check status with: ./rt list");
  }
}

export async function sshDevbox(nameOrId: string): Promise<void> {
  const { id } = await resolveDevbox(nameOrId);

  console.log(`Connecting to ${id} via rli...`);

  // Check rli is available
  try {
    execSync("which rli", { stdio: "ignore" });
  } catch {
    console.error("ERROR: 'rli' CLI not found.");
    console.error("  Install it with: npm install -g @runloop/rl-cli");
    process.exit(1);
  }

  const child = spawn("rli", ["devbox", "ssh", id], {
    stdio: "inherit",
  });

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}

export async function execDevbox(
  nameOrId: string,
  command: string[],
): Promise<void> {
  const { id } = await resolveDevbox(nameOrId);
  const client = getClient();

  const cmd = command.join(" ");
  console.log(`Executing in ${id}: ${cmd}`);

  const execution = await client.devboxes.executeAsync(id, { command: cmd });
  const execId = execution.execution_id;

  // Wait for completion
  const result = await client.devboxes.executions.awaitCompleted(id, execId);

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  const exitCode = result.exit_status ?? 0;
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

export async function snapshotDevbox(
  nameOrId: string,
  snapshotName?: string,
): Promise<string> {
  const { id } = await resolveDevbox(nameOrId);
  const client = getClient();

  // Check for duplicate snapshot name
  if (snapshotName) {
    for await (const s of client.devboxes.diskSnapshots.list({ limit: 100 })) {
      if (s.name === snapshotName) {
        throw new Error(
          `A snapshot named '${snapshotName}' already exists (${s.id}). Choose a different name or delete the existing one first.`,
        );
      }
    }
  }

  console.log(`Snapshotting devbox ${id}...`);
  const snapshot = await client.devboxes.snapshotDisk(id, {
    name: snapshotName,
    metadata: {
      [MANAGED_BY_KEY]: MANAGED_BY_VALUE,
    },
  });

  console.log(`Snapshot created: ${snapshot.id}`);
  if (snapshotName) {
    console.log(`Named: ${snapshotName}`);
  }

  return snapshot.id;
}

