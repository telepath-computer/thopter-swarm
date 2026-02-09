/**
 * Devbox lifecycle: create, list, destroy, ssh, exec, snapshot, fork.
 */

import { execSync, spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getClient } from "./client.js";
import { printTable } from "./output.js";
import {
  MANAGED_BY_KEY,
  MANAGED_BY_VALUE,
  NAME_KEY,
  OWNER_KEY,
  DEFAULT_RESOURCE_SIZE,
  DEFAULT_IDLE_TIMEOUT_SECONDS,
  getEnvVars,
  escapeEnvValue,
  getDefaultSnapshot,
  getClaudeMdPath,
  getUploads,
  getStopNotifications,
  getStopNotificationQuietPeriod,
} from "./config.js";

/** Tool installation script that runs inside the devbox on first create. */
const INIT_SCRIPT = `
set -e

# Install essential tools
sudo apt-get update -qq && sudo apt-get install -y -qq tmux wget curl jq redis-tools cron ripgrep fd-find htop tree unzip bat less strace lsof ncdu dnsutils net-tools iproute2 xvfb xauth > /dev/null
sudo /usr/sbin/cron 2>/dev/null || true

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

# Install Runloop CLI (for rli devbox ssh from inside devboxes)
npm i -g @runloop/rl-cli

# Install starship prompt (non-interactive)
curl -sS https://starship.rs/install.sh | sh -s -- -y

# Ensure ~/.local/bin is on PATH and set aliases
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
echo 'alias yolo-claude="claude --dangerously-skip-permissions"' >> ~/.bashrc
echo 'alias attach-or-launch-tmux-cc="tmux -CC attach || tmux -CC"' >> ~/.bashrc

# Source thopter identity env vars (written by create command after boot)
echo '. ~/.thopter-env' >> ~/.bashrc

# Activate starship prompt
echo 'eval "$(starship init bash)"' >> ~/.bashrc

echo "Devbox init complete"
`.trim();

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = resolve(__dirname, "..", "scripts");

function readScript(name: string): string {
  return readFileSync(resolve(SCRIPTS_DIR, name), "utf-8");
}

/**
 * Upload thopter-status scripts and install cron heartbeat on a running devbox.
 */
async function installThopterScripts(
  devboxId: string,
  name: string,
  redisUrl?: string,
): Promise<void> {
  const client = getClient();

  // Upload scripts
  await client.devboxes.writeFileContents(devboxId, {
    file_path: "/tmp/thopter-status",
    contents: readScript("thopter-status.sh"),
  });
  await client.devboxes.writeFileContents(devboxId, {
    file_path: "/tmp/thopter-heartbeat",
    contents: readScript("thopter-heartbeat.sh"),
  });
  await client.devboxes.writeFileContents(devboxId, {
    file_path: "/tmp/thopter-cron-install.sh",
    contents: readScript("thopter-cron-install.sh"),
  });

  // Neovim options (OSC 52 clipboard, etc.)
  await client.devboxes.writeFileContents(devboxId, {
    file_path: "/home/user/.config/nvim/lua/options.lua",
    contents: readScript("nvim-options.lua"),
  });

  // Starship prompt config
  await client.devboxes.writeFileContents(devboxId, {
    file_path: "/home/user/.config/starship.toml",
    contents: readScript("starship.toml"),
  });

  // tmux config (Ctrl-a prefix, etc.)
  await client.devboxes.writeFileContents(devboxId, {
    file_path: "/home/user/.tmux.conf",
    contents: readScript("tmux.conf"),
  });

  // CLAUDE.md — use custom path if configured, otherwise default
  const claudeMdPath = getClaudeMdPath();
  const claudeMdContents = claudeMdPath
    ? readFileSync(claudeMdPath, "utf-8")
    : readScript("thopter-claude-md.md");
  await client.devboxes.writeFileContents(devboxId, {
    file_path: "/home/user/.claude/CLAUDE.md",
    contents: claudeMdContents,
  });

  // Claude Code hooks for redis status updates
  const hookFiles: Record<string, string> = {
    "claude-hook-stop.sh": "on-stop.sh",
    "claude-hook-prompt.sh": "on-prompt.sh",
    "claude-hook-notification.sh": "on-notification.sh",
    "claude-hook-session-start.sh": "on-session-start.sh",
    "claude-hook-session-end.sh": "on-session-end.sh",
    "claude-hook-tool-use.sh": "on-tool-use.sh",
  };
  for (const [src, dest] of Object.entries(hookFiles)) {
    await client.devboxes.writeFileContents(devboxId, {
      file_path: `/home/user/.claude/hooks/${dest}`,
      contents: readScript(src),
    });
  }
  // Transcript parser for Stop hook (extracts last assistant message)
  await client.devboxes.writeFileContents(devboxId, {
    file_path: "/tmp/thopter-last-message.mjs",
    contents: readScript("thopter-last-message.mjs"),
  });

  // Transcript push script for thopter tail (streams entries to Redis)
  await client.devboxes.writeFileContents(devboxId, {
    file_path: "/tmp/thopter-transcript-push.mjs",
    contents: readScript("thopter-transcript-push.mjs"),
  });

  // Installer merges hooks into existing settings.json (idempotent)
  await client.devboxes.writeFileContents(devboxId, {
    file_path: "/tmp/install-claude-hooks.mjs",
    contents: readScript("install-claude-hooks.mjs"),
  });

  // Install scripts to /usr/local/bin, make hooks executable, register hooks, set up cron
  await client.devboxes.executeAsync(devboxId, {
    command: "sudo install -m 755 /tmp/thopter-status /usr/local/bin/thopter-status && sudo install -m 755 /tmp/thopter-heartbeat /usr/local/bin/thopter-heartbeat && sudo install -m 755 /tmp/thopter-last-message.mjs /usr/local/bin/thopter-last-message && sudo install -m 755 /tmp/thopter-transcript-push.mjs /usr/local/bin/thopter-transcript-push && chmod +x /home/user/.claude/hooks/*.sh && node /tmp/install-claude-hooks.mjs && bash /tmp/thopter-cron-install.sh",
  });
}

/**
 * Resolve a snapshot by name or ID.
 */
async function resolveSnapshotId(nameOrId: string): Promise<string> {
  const client = getClient();

  // Direct ID — validate it still exists via queryStatus (single API call)
  if (nameOrId.startsWith("snp_")) {
    try {
      const status = await client.devboxes.diskSnapshots.queryStatus(nameOrId);
      if (status.status === "deleted") {
        throw new Error(`Snapshot '${nameOrId}' has been deleted.`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("deleted")) throw e;
      throw new Error(`Snapshot '${nameOrId}' not found.`);
    }
    return nameOrId;
  }
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
  fresh?: boolean;
  idleTimeout?: number;
}): Promise<string> {
  const client = getClient();

  // Get owner from operator's git config (required)
  let ownerName: string;
  try {
    ownerName = execSync("git config --get user.name", { encoding: "utf-8" }).trim();
  } catch {
    ownerName = "";
  }
  if (!ownerName) {
    throw new Error(
      "Git user.name not configured. Set it with: git config --global user.name 'Your Name'",
    );
  }

  // Validate local files exist before creating anything
  const claudeMdPath = getClaudeMdPath();
  if (claudeMdPath && !existsSync(claudeMdPath)) {
    throw new Error(`Custom CLAUDE.md not found: ${claudeMdPath}`);
  }
  const uploads = getUploads();
  for (const entry of uploads) {
    if (!existsSync(entry.local)) {
      throw new Error(`Upload file not found: ${entry.local}`);
    }
  }

  // Determine snapshot (resolve name → ID if needed)
  let snapshotId = opts.snapshotId
    ? await resolveSnapshotId(opts.snapshotId)
    : undefined;
  if (!snapshotId && !opts.fresh) {
    const defaultSnap = getDefaultSnapshot();
    if (defaultSnap) {
      try {
        snapshotId = await resolveSnapshotId(defaultSnap);
        console.log(`Using default snapshot: ${defaultSnap}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(
          `${msg}\nThis is the default snapshot. To clear it: thopter snapshot default --clear`,
        );
      }
    }
  }

  // Build metadata
  const metadata: Record<string, string> = {
    [MANAGED_BY_KEY]: MANAGED_BY_VALUE,
    [NAME_KEY]: opts.name,
    [OWNER_KEY]: ownerName,
  };

  const createParams = {
    name: opts.name,
    snapshot_id: snapshotId,
    metadata,
    launch_parameters: {
      resource_size_request: DEFAULT_RESOURCE_SIZE,
      // i am still trying to figure out how idle and keepalive actually work on runloop.
      // trying keep alive for now. idle detection seems to not work or be
      // misconfigured, it will just suspend right in the middle of an active
      // ssh session running claude code...
      keep_alive_time_seconds: opts.idleTimeout ?? DEFAULT_IDLE_TIMEOUT_SECONDS,
      // after_idle: {
      //   idle_time_seconds: opts.idleTimeout ?? DEFAULT_IDLE_TIMEOUT_SECONDS,
      //   on_idle: "suspend" as const,
      // },
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

    // Write ~/.thopter-env with all env vars from config + identity vars.
    // This is the single source of truth for devbox environment.
    // Sourced from .bashrc so interactive shells + cron both get these vars.
    // On snapshot creates, this overwrites stale values from the previous devbox.
    const envVars = getEnvVars();
    const envLines: string[] = [];
    // Identity vars (safe — generated by us, no user-controlled shell metacharacters)
    envLines.push(`export THOPTER_NAME="${escapeEnvValue(opts.name)}"`);
    envLines.push(`export THOPTER_ID="${escapeEnvValue(devbox.id)}"`);
    envLines.push(`export THOPTER_OWNER="${escapeEnvValue(ownerName)}"`);
    if (getStopNotifications()) {
      envLines.push(`export THOPTER_STOP_NOTIFY=1`);
    }
    const quietPeriod = getStopNotificationQuietPeriod();
    envLines.push(`export THOPTER_STOP_NOTIFY_QUIET_PERIOD="${quietPeriod}"`);
    // User-configured env vars from ~/.thopter.json envVars section
    for (const [key, value] of Object.entries(envVars)) {
      envLines.push(`export ${key}="${escapeEnvValue(value)}"`);
    }
    await client.devboxes.writeFileContents(devbox.id, {
      file_path: "/home/user/.thopter-env",
      contents: envLines.join("\n") + "\n",
    });

    // Configure git credentials using GH_TOKEN (post-boot, after env file is written)
    if (envVars.GH_TOKEN) {
      console.log("Configuring git credentials...");
      await client.devboxes.executeAsync(devbox.id, {
        command: `source ~/.thopter-env && git config --global credential.helper store && echo "https://thopterbot:\${GH_TOKEN}@github.com" > ~/.git-credentials && git config --global url."https://github.com/".insteadOf "git@github.com:" && git config --global user.name "ThopterBot" && git config --global user.email "thopterbot@telepath.computer"`,
      });
    }

    // Upload and install thopter-status scripts + cron
    console.log("Installing thopter scripts...");
    await installThopterScripts(devbox.id, opts.name);

    // Upload custom files from config (last, so user files override defaults)
    if (uploads.length > 0) {
      console.log(`Uploading ${uploads.length} custom file${uploads.length === 1 ? "" : "s"}...`);
      for (const entry of uploads) {
        await client.devboxes.writeFileContents(devbox.id, {
          file_path: entry.remote,
          contents: readFileSync(entry.local, "utf-8"),
        });
      }
    }

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
  const { getRedisInfoForNames, relativeTime } = await import("./status.js");

  const devboxes: { name: string; owner: string; id: string; status: string }[] = [];
  const liveStatuses = ["running", "suspended", "provisioning", "initializing", "suspending", "resuming"] as const;
  for (const status of liveStatuses) {
    for await (const db of client.devboxes.list({ status, limit: 100 })) {
      const meta = db.metadata ?? {};
      if (meta[MANAGED_BY_KEY] !== MANAGED_BY_VALUE) continue;
      devboxes.push({
        name: meta[NAME_KEY] ?? "",
        owner: meta[OWNER_KEY] ?? "",
        id: db.id,
        status: db.status,
      });
    }
  }

  if (devboxes.length === 0) {
    console.log("No managed devboxes found.");
    return;
  }

  // Fetch Redis annotations for all devboxes using a single connection
  const redisMap = await getRedisInfoForNames(devboxes.map((db) => db.name));

  const rows: string[][] = devboxes.map((db) => {
    const redis = redisMap.get(db.name);
    let task = redis?.task ?? "-";
    if (task.length > 40) task = task.slice(0, 37) + "...";
    const claude = redis ? (redis.claudeRunning === "1" ? "yes" : redis.claudeRunning === "0" ? "no" : "-") : "-";
    const heartbeat = redis?.heartbeat ? relativeTime(redis.heartbeat) : "-";
    return [
      db.name,
      db.owner,
      db.status,
      redis?.status ?? "-",
      task,
      claude,
      heartbeat,
    ];
  });

  printTable(["NAME", "OWNER", "DEVBOX", "AGENT", "TASK", "CLAUDE", "HEARTBEAT"], rows);
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
  console.log("Suspended. Resume with: thopter resume " + (nameOrId));
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
    console.log("  Check status with: thopter list");
  }
}

export async function keepaliveDevbox(nameOrId: string): Promise<void> {
  const { id } = await resolveDevbox(nameOrId);
  const client = getClient();

  console.log(`Sending keepalive for ${nameOrId} (${id})...`);
  await client.devboxes.keepAlive(id);
  console.log("Done. Idle timer reset.");
}

export async function sshDevbox(nameOrId: string): Promise<void> {
  const { id } = await resolveDevbox(nameOrId);

  console.log(`Connecting to ${id} via rli...`);
  rliSsh(id);
}

export async function attachDevbox(nameOrId: string): Promise<void> {
  const { id } = await resolveDevbox(nameOrId);

  console.log(`Attaching to tmux on ${id} via rli...`);
  rliSsh(id, "tmux -CC attach \\; refresh-client || tmux -CC");
}

function rliSsh(devboxId: string, command?: string): void {
  // Check rli is available
  try {
    execSync("which rli", { stdio: "ignore" });
  } catch {
    console.error("ERROR: 'rli' CLI not found.");
    console.error("  Install it with: npm install -g @runloop/rl-cli");
    process.exit(1);
  }

  // rli devbox ssh doesn't support passing remote commands, so when a command
  // is needed we extract the SSH config from rli and call ssh directly.
  if (command) {
    const configOutput = execSync(`rli devbox ssh --config-only ${devboxId}`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const hostname = configOutput.match(/Hostname\s+(.+)/)?.[1]?.trim();
    const identityFile = configOutput.match(/IdentityFile\s+(.+)/)?.[1]?.trim();
    const proxyCommand = configOutput.match(/ProxyCommand\s+(.+)/)?.[1]?.trim();

    if (!hostname || !identityFile || !proxyCommand) {
      console.error("ERROR: Failed to parse SSH config from rli.");
      process.exit(1);
    }

    const args = [
      "-tt",
      "-o", "StrictHostKeyChecking=no",
      "-o", `ProxyCommand=${proxyCommand}`,
      "-i", identityFile,
      `user@${hostname}`,
      command,
    ];

    const child = spawn("ssh", args, { stdio: "inherit" });
    child.on("exit", (code) => {
      process.exit(code ?? 0);
    });
  } else {
    const child = spawn("rli", ["devbox", "ssh", devboxId], {
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      process.exit(code ?? 0);
    });
  }
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

export async function replaceSnapshot(
  devboxNameOrId: string,
  snapshotName: string,
): Promise<string> {
  const { id: devboxId } = await resolveDevbox(devboxNameOrId);
  const client = getClient();

  // Find existing snapshot(s) with this name
  const oldIds: string[] = [];
  for await (const s of client.devboxes.diskSnapshots.list({ limit: 100 })) {
    if (s.name === snapshotName) oldIds.push(s.id);
  }

  if (oldIds.length === 0) {
    throw new Error(
      `No snapshot named '${snapshotName}' to replace. Use 'snapshot create' instead.`,
    );
  }

  // Delete old snapshot(s), then create new with the same name
  for (const oldId of oldIds) {
    console.log(`Deleting old snapshot ${oldId}...`);
    await client.devboxes.diskSnapshots.delete(oldId);
  }

  console.log(`Snapshotting devbox ${devboxId}...`);
  const snapshot = await client.devboxes.snapshotDisk(devboxId, {
    name: snapshotName,
    metadata: { [MANAGED_BY_KEY]: MANAGED_BY_VALUE },
  });

  console.log(`Replaced snapshot '${snapshotName}': ${snapshot.id}`);
  return snapshot.id;
}

