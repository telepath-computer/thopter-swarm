#!/usr/bin/env node

/**
 * CLI entrypoint for thopter.
 */

import { Command } from "commander";
import { loadConfigIntoEnv } from "./config.js";

// Load API keys from ~/.thopter.json into process.env (won't override existing env vars)
loadConfigIntoEnv();

const program = new Command();

program
  .name("thopter")
  .description("Manage Runloop devboxes for Claude Code development.")
  .addHelpText(
    "after",
    `
lifecycle:
  setup → create → ssh/exec → snapshot create → destroy
                                     ↓
                        create --snapshot → ssh/exec → ...

examples:
  thopter setup                          First-time auth & secret config
  thopter create dev                     Create a devbox
  thopter create --snapshot golden        Create from a snapshot
  thopter ssh dev                        SSH into the devbox
  thopter attach dev                     Attach to tmux (iTerm2 -CC mode)
  thopter exec dev -- uname -a           Run a one-off command
  thopter snapshot create dev golden      Snapshot a devbox
  thopter snapshot list                  List snapshots
  thopter snapshot destroy golden         Delete a snapshot
  thopter snapshot default golden         Set default snapshot
  thopter snapshot default               View default snapshot
  thopter snapshot default --clear        Clear default snapshot
  thopter list                           Show running devboxes
  thopter sync init                      Set up SyncThing config (run on laptop)
  thopter sync show                      Show current SyncThing config
  thopter sync pair dev                  Install SyncThing on devbox & pair
  thopter sync unpair dev                Remove devbox from laptop SyncThing
  thopter status                         Overview of all thopters from redis
  thopter status dev                     Detailed status + logs for a thopter
  thopter keepalive dev                   Reset idle timer for a devbox
  thopter suspend dev                    Suspend a devbox
  thopter resume dev                     Resume a suspended devbox
  thopter destroy dev                    Shut down a devbox`,
  );

// --- setup ---
program
  .command("setup")
  .description("Check Runloop auth and interactively configure secrets")
  .action(async () => {
    const { runSetup } = await import("./setup.js");
    await runSetup();
  });

// --- create ---
program
  .command("create")
  .description("Create a new devbox")
  .argument("[name]", "Name for the devbox (auto-generated if omitted)")
  .option("--snapshot <id>", "Snapshot ID or label to restore from")
  .option("--fresh", "Create a fresh devbox, ignoring the default snapshot")
  .option("--idle-timeout <minutes>", "Idle timeout in minutes before auto-suspend (default: 720)", parseInt)
  .option("--no-sync", "Skip SyncThing artifact sync setup")
  .option("-a, --attach", "SSH into the devbox after creation")
  .action(async (name: string | undefined, opts: { snapshot?: string; fresh?: boolean; idleTimeout?: number; noSync?: boolean; attach?: boolean }) => {
    const { createDevbox, sshDevbox } = await import("./devbox.js");
    const { generateName } = await import("./names.js");
    const resolvedName = name ?? generateName();
    await createDevbox({
      name: resolvedName,
      snapshotId: opts.snapshot,
      fresh: opts.fresh,
      idleTimeout: opts.idleTimeout ? opts.idleTimeout * 60 : undefined,
      noSync: opts.noSync,
    });
    if (opts.attach) {
      await sshDevbox(resolvedName);
    }
  });

// --- list ---
program
  .command("list")
  .alias("ls")
  .description("List managed devboxes")
  .action(async () => {
    const { listDevboxes } = await import("./devbox.js");
    await listDevboxes();
  });

// --- status ---
program
  .command("status")
  .description("Show thopter status from redis")
  .argument("[name]", "Thopter name (omit for overview of all)")
  .option("-a, --all", "Show all thopters including stale ones")
  .action(async (name: string | undefined, opts: { all?: boolean }) => {
    const { showAllStatus, showThopterStatus } = await import("./status.js");
    if (name) {
      await showThopterStatus(name);
    } else {
      await showAllStatus({ all: opts.all });
    }
  });

// --- destroy ---
program
  .command("destroy")
  .alias("rm")
  .description("Shut down a devbox")
  .argument("<devbox>", "Devbox name or ID")
  .action(async (devbox: string) => {
    const { destroyDevbox } = await import("./devbox.js");
    await destroyDevbox(devbox);
  });

// --- suspend ---
program
  .command("suspend")
  .description("Suspend a devbox (preserves disk, can resume later)")
  .argument("<devbox>", "Devbox name or ID")
  .action(async (devbox: string) => {
    const { suspendDevbox } = await import("./devbox.js");
    await suspendDevbox(devbox);
  });

// --- resume ---
program
  .command("resume")
  .description("Resume a suspended devbox")
  .argument("<devbox>", "Devbox name or ID")
  .action(async (devbox: string) => {
    const { resumeDevbox } = await import("./devbox.js");
    await resumeDevbox(devbox);
  });

// --- keepalive ---
program
  .command("keepalive")
  .description("Send a keepalive to reset a devbox's idle timer")
  .argument("<devbox>", "Devbox name or ID")
  .action(async (devbox: string) => {
    const { keepaliveDevbox } = await import("./devbox.js");
    await keepaliveDevbox(devbox);
  });

// --- ssh ---
program
  .command("ssh")
  .description("SSH into a devbox (via rli)")
  .argument("<devbox>", "Devbox name or ID")
  .action(async (devbox: string) => {
    const { sshDevbox } = await import("./devbox.js");
    await sshDevbox(devbox);
  });

// --- attach ---
program
  .command("attach")
  .description("SSH into a devbox and attach to tmux in control mode (-CC)")
  .argument("<devbox>", "Devbox name or ID")
  .action(async (devbox: string) => {
    const { attachDevbox } = await import("./devbox.js");
    await attachDevbox(devbox);
  });

// --- exec ---
program
  .command("exec")
  .description("Run a command in a devbox")
  .argument("<devbox>", "Devbox name or ID")
  .argument("<command...>", "Command and arguments")
  .action(async (devbox: string, command: string[]) => {
    const { execDevbox } = await import("./devbox.js");
    await execDevbox(devbox, command);
  });

// --- snapshot (subcommand) ---
const snapshotCmd = program
  .command("snapshot")
  .description("Manage disk snapshots");

snapshotCmd
  .command("list")
  .alias("ls")
  .description("List disk snapshots")
  .action(async () => {
    const { listSnapshotsCmd } = await import("./devbox.js");
    await listSnapshotsCmd();
  });

snapshotCmd
  .command("create")
  .description("Take a disk snapshot of a devbox")
  .argument("<devbox>", "Devbox name or ID")
  .argument("[name]", "Name/label for the snapshot")
  .action(async (devbox: string, name?: string) => {
    const { snapshotDevbox } = await import("./devbox.js");
    await snapshotDevbox(devbox, name);
  });

snapshotCmd
  .command("replace")
  .description("Replace an existing snapshot with a fresh one from a devbox")
  .argument("<devbox>", "Devbox name or ID")
  .argument("<name>", "Name of the snapshot to replace")
  .action(async (devbox: string, name: string) => {
    const { replaceSnapshot } = await import("./devbox.js");
    await replaceSnapshot(devbox, name);
  });

snapshotCmd
  .command("destroy")
  .alias("rm")
  .description("Delete a snapshot")
  .argument("<snapshot>", "Snapshot name or ID")
  .action(async (snapshot: string) => {
    const { deleteSnapshot } = await import("./devbox.js");
    await deleteSnapshot(snapshot);
  });

snapshotCmd
  .command("default")
  .description("View or set the default snapshot for new creates")
  .argument("[snapshot]", "Snapshot name or ID to set as default (omit to view current)")
  .option("--clear", "Clear the default snapshot")
  .action(async (snapshot: string | undefined, opts: { clear?: boolean }) => {
    const {
      getDefaultSnapshot,
      setDefaultSnapshot,
      clearDefaultSnapshot,
    } = await import("./config.js");

    if (opts.clear) {
      clearDefaultSnapshot();
      console.log("Default snapshot cleared.");
    } else if (snapshot) {
      setDefaultSnapshot(snapshot);
      console.log(`Default snapshot set to: ${snapshot}`);
    } else {
      const current = getDefaultSnapshot();
      if (current) {
        console.log(`Default snapshot: ${current}`);
      } else {
        console.log("No default snapshot set.");
        console.log("  Set one with: thopter snapshot default <name-or-id>");
      }
    }
  });

// --- config ---
const configCmd = program
  .command("config")
  .description("Manage local configuration (~/.thopter.json)");

configCmd
  .command("set")
  .description("Set a config value")
  .argument("<key>", "Config key")
  .argument("<value>", "Config value")
  .action(async (key: string, value: string) => {
    const { setRunloopApiKey, setRedisUrl, setNtfyChannel, setDefaultSnapshot } = await import("./config.js");
    switch (key) {
      case "runloopApiKey":
        setRunloopApiKey(value);
        console.log("Set runloopApiKey.");
        break;
      case "redisUrl":
        setRedisUrl(value);
        console.log("Set redisUrl.");
        break;
      case "ntfyChannel":
        setNtfyChannel(value);
        console.log(`Set ntfyChannel to: ${value}`);
        console.log(`Subscribe at: https://ntfy.sh/${value}`);
        break;
      case "defaultSnapshotId":
        setDefaultSnapshot(value);
        console.log(`Set defaultSnapshotId to: ${value}`);
        break;
      default:
        console.error(`Unknown config key: ${key}`);
        console.error("Available keys: runloopApiKey, redisUrl, ntfyChannel, defaultSnapshotId");
        process.exit(1);
    }
  });

configCmd
  .command("get")
  .description("Get a config value")
  .argument("[key]", "Config key (omit to show all)")
  .action(async (key?: string) => {
    const { getRunloopApiKey, getRedisUrl, getNtfyChannel, getDefaultSnapshot, getSyncthingConfig } = await import("./config.js");
    if (!key) {
      console.log(`runloopApiKey:     ${getRunloopApiKey() ? "(set)" : "(not set)"}`);
      console.log(`redisUrl:          ${getRedisUrl() ? "(set)" : "(not set)"}`);
      console.log(`ntfyChannel:       ${getNtfyChannel() ?? "(not set)"}`);
      console.log(`defaultSnapshotId: ${getDefaultSnapshot() ?? "(not set)"}`);
      const st = getSyncthingConfig();
      console.log(`syncthing:         ${st ? `${st.folderId} → ${st.localPath}` : "(not set)"}`);
    } else {
      switch (key) {
        case "runloopApiKey":
          console.log(getRunloopApiKey() ? "(set)" : "(not set)");
          break;
        case "redisUrl":
          console.log(getRedisUrl() ? "(set)" : "(not set)");
          break;
        case "ntfyChannel":
          console.log(getNtfyChannel() ?? "(not set)");
          break;
        case "defaultSnapshotId":
          console.log(getDefaultSnapshot() ?? "(not set)");
          break;
        default:
          console.error(`Unknown config key: ${key}`);
          console.error("Available keys: runloopApiKey, redisUrl, ntfyChannel, defaultSnapshotId");
          process.exit(1);
      }
    }
  });

// --- sync ---
const syncCmd = program
  .command("sync")
  .description("Manage SyncThing file sync between laptop and devboxes");

syncCmd
  .command("init")
  .description("Initialize SyncThing config (run on laptop)")
  .option("--device-id <id>", "SyncThing device ID (auto-detected if SyncThing is running)")
  .option("--folder-id <id>", "SyncThing folder ID")
  .option("--local-path <path>", "Path on the laptop")
  .option("--remote-path <path>", "Path on devboxes")
  .action(async (opts: { deviceId?: string; folderId?: string; localPath?: string; remotePath?: string }) => {
    const { createInterface } = await import("node:readline");
    const { getSyncthingConfig, setSyncthingConfig } = await import("./config.js");

    const existing = getSyncthingConfig();
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q: string, def?: string): Promise<string> =>
      new Promise((resolve) => {
        const prompt = def ? `${q} [${def}]: ` : `${q}: `;
        rl.question(prompt, (answer) => resolve(answer.trim() || def || ""));
      });

    // Auto-detect device ID from local SyncThing if running
    let detectedId = opts.deviceId ?? "";
    if (!detectedId) {
      try {
        const { execSync } = await import("node:child_process");
        detectedId = execSync("syncthing --device-id 2>/dev/null", { encoding: "utf-8" }).trim();
      } catch { /* not installed or not running */ }
    }

    console.log("SyncThing sync configuration");
    console.log("This configures ~/.thopter.json so devboxes know how to sync with your laptop.\n");

    const deviceId = await ask("Your laptop's SyncThing device ID", detectedId || existing?.deviceId);
    if (!deviceId) {
      console.error("Device ID is required. Install and start SyncThing first.");
      rl.close();
      process.exit(1);
    }

    const folderId = opts.folderId ?? await ask("SyncThing folder ID", existing?.folderId || "jw-artifact-stash");
    const localPath = opts.localPath ?? await ask("Local path (on your laptop)", existing?.localPath || `~/jw-artifact-stash`);
    const remotePath = opts.remotePath ?? await ask("Remote path (on devboxes)", existing?.remotePath || localPath);

    rl.close();

    setSyncthingConfig({ deviceId, folderId, localPath, remotePath });

    console.log("\nSaved to ~/.thopter.json:");
    console.log(`  deviceId:   ${deviceId}`);
    console.log(`  folderId:   ${folderId}`);
    console.log(`  localPath:  ${localPath}`);
    console.log(`  remotePath: ${remotePath}`);
    console.log("\nNew devboxes created with 'thopter create' will auto-configure SyncThing.");
    console.log("To pair an existing devbox: thopter sync pair <name>");
  });

syncCmd
  .command("show")
  .description("Show current SyncThing config from ~/.thopter.json")
  .action(async () => {
    const { getSyncthingConfig } = await import("./config.js");
    const config = getSyncthingConfig();
    if (!config) {
      console.log("No SyncThing config set. Run: thopter sync init");
    } else {
      console.log(`deviceId:   ${config.deviceId}`);
      console.log(`folderId:   ${config.folderId}`);
      console.log(`localPath:  ${config.localPath}`);
      console.log(`remotePath: ${config.remotePath}`);
    }
  });

syncCmd
  .command("pair")
  .description("Install SyncThing on a devbox and pair with the laptop")
  .argument("<devbox>", "Devbox name or ID")
  .action(async (devbox: string) => {
    const { getSyncthingConfig } = await import("./config.js");
    const syncConfig = getSyncthingConfig();
    if (!syncConfig) {
      console.error("No SyncThing config. Run: thopter sync init");
      process.exit(1);
    }

    const { resolveDevboxPublic } = await import("./devbox.js");
    const { installSyncthingOnDevbox, getDevboxDeviceId, pairDeviceLocally } = await import("./sync.js");
    const { id, name } = await resolveDevboxPublic(devbox);

    // Check if SyncThing is already installed
    let deviceId = await getDevboxDeviceId(id);
    if (deviceId) {
      console.log(`SyncThing already installed. Device ID: ${deviceId}`);
    } else {
      deviceId = await installSyncthingOnDevbox(id, syncConfig);
      if (!deviceId) {
        console.error("Failed to install SyncThing on devbox.");
        process.exit(1);
      }
    }

    await pairDeviceLocally(deviceId, name ?? devbox);
  });

syncCmd
  .command("device-id")
  .description("Show a devbox's SyncThing device ID")
  .argument("<devbox>", "Devbox name or ID")
  .action(async (devbox: string) => {
    const { resolveDevboxPublic } = await import("./devbox.js");
    const { getDevboxDeviceId } = await import("./sync.js");
    const { id } = await resolveDevboxPublic(devbox);

    const deviceId = await getDevboxDeviceId(id);
    if (deviceId) {
      console.log(deviceId);
    } else {
      console.error("SyncThing is not installed on this devbox.");
      console.error("  Install it with: thopter sync pair " + devbox);
      process.exit(1);
    }
  });

syncCmd
  .command("unpair")
  .description("Remove a devbox from the laptop's SyncThing")
  .argument("<devbox>", "Devbox name or ID")
  .action(async (devbox: string) => {
    const { resolveDevboxPublic } = await import("./devbox.js");
    const { getDevboxDeviceId, unpairDeviceLocally } = await import("./sync.js");
    const { id } = await resolveDevboxPublic(devbox);

    const deviceId = await getDevboxDeviceId(id);
    if (!deviceId) {
      console.error("Could not get SyncThing device ID for this devbox.");
      process.exit(1);
    }

    await unpairDeviceLocally(deviceId);
  });

syncCmd
  .command("clear")
  .description("Remove SyncThing config from ~/.thopter.json")
  .action(async () => {
    const { clearSyncthingConfig } = await import("./config.js");
    clearSyncthingConfig();
    console.log("SyncThing config removed from ~/.thopter.json.");
  });

// --- secrets ---
const secretsCmd = program
  .command("secrets")
  .description("Manage Runloop secrets");

secretsCmd
  .command("list")
  .alias("ls")
  .description("List Runloop secrets")
  .action(async () => {
    const { listSecrets } = await import("./secrets.js");
    const { printTable } = await import("./output.js");
    const secrets = await listSecrets();
    console.log("Secrets:");
    printTable(
      ["NAME", "ID"],
      secrets.map((s) => [s.name, s.id]),
    );
  });

secretsCmd
  .command("set")
  .description("Create or update a secret (prompts for value)")
  .argument("<name>", "Secret name")
  .action(async (name: string) => {
    const { createInterface } = await import("node:readline");
    const rl = createInterface({
      input: process.stdin,
      terminal: true,
    });

    process.stdout.write(`Value for ${name}: `);
    const value = await new Promise<string>((resolve) => {
      rl.question("", (answer) => {
        rl.close();
        process.stdout.write("\n");
        resolve(answer.trim());
      });
    });

    if (!value) {
      console.log("No value provided. Aborting.");
      return;
    }

    const { createOrUpdateSecret } = await import("./secrets.js");
    await createOrUpdateSecret(name, value);
    console.log(`Secret '${name}' saved.`);
  });

secretsCmd
  .command("delete")
  .alias("rm")
  .description("Delete a secret")
  .argument("<name>", "Secret name")
  .action(async (name: string) => {
    const { deleteSecret } = await import("./secrets.js");
    await deleteSecret(name);
    console.log(`Secret '${name}' deleted.`);
  });

// Parse and run
program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
