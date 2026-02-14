#!/usr/bin/env node

/**
 * CLI entrypoint for thopter.
 */

import { Command } from "commander";
import { loadConfigIntoEnv, resolveThopterName } from "./config.js";

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
  thopter setup                          First-time auth & env var config
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
  thopter use dev                        Set default thopter
  thopter use                            View current default
  thopter use --clear                    Clear default thopter
  thopter ssh .                          SSH into the default thopter
  thopter run --repo owner/repo "prompt"  Launch Claude with a task
  thopter reauth                         Re-authenticate and update snapshot
  thopter sync init                      Set up SyncThing config (run on laptop)
  thopter sync show                      Show current SyncThing config
  thopter sync pair dev                  Install SyncThing on devbox & pair
  thopter sync unpair dev                Remove devbox from laptop SyncThing
  thopter status                         Unified view of all thopters
  thopter status dev                     Detailed status + logs for a thopter
  thopter tail dev                       Show last 20 transcript entries
  thopter tail dev -f                    Follow transcript in real time
  thopter tail dev -n 50                 Show last 50 entries
  thopter tell dev "also fix the tests"  Send a message to Claude
  thopter tell dev -i "work on X now"    Interrupt Claude and redirect
  thopter repos list                     List predefined repos
  thopter repos add                      Add a predefined repo
  thopter repos remove                   Remove a predefined repo
  thopter keepalive dev                   Reset keep-alive timer for a devbox
  thopter suspend dev                    Suspend a devbox
  thopter resume dev                     Resume a suspended devbox
  thopter destroy dev                    Shut down a devbox`,
  );

// --- setup ---
program
  .command("setup")
  .description("Interactive first-time setup (API keys, env vars, notifications)")
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
  .option("--keep-alive <minutes>", "Keep-alive time in minutes before shutdown (default: 720)", parseInt)
  .option("--no-sync", "Skip SyncThing artifact sync setup")
  .option("-a, --attach", "SSH into the devbox after creation")
  .action(async (name: string | undefined, opts: { snapshot?: string; fresh?: boolean; keepAlive?: number; noSync?: boolean; attach?: boolean }) => {
    const { createDevbox, sshDevbox } = await import("./devbox.js");
    const { generateName } = await import("./names.js");
    const resolvedName = name ?? generateName();
    await createDevbox({
      name: resolvedName,
      snapshotId: opts.snapshot,
      fresh: opts.fresh,
      keepAlive: opts.keepAlive ? opts.keepAlive * 60 : undefined,
      noSync: opts.noSync,
    });
    if (opts.attach) {
      await sshDevbox(resolvedName);
    }
  });

// --- status (unified: Runloop API + Redis annotations) ---
program
  .command("status")
  .alias("list")
  .alias("ls")
  .description("Show thopter status (unified Runloop + Redis view)")
  .argument("[name]", "Thopter name (omit for overview of all)")
  .option("-f, --follow [interval]", "Re-render every N seconds (default: 10)")
  .option("-w, --wide", "Force wide (single-line) layout")
  .option("-n, --narrow", "Force narrow (multi-line) layout")
  .option("--json", "Output as JSON (for programmatic use)")
  .action(async (name: string | undefined, opts: { follow?: boolean | string; wide?: boolean; narrow?: boolean; json?: boolean }) => {
    const follow = opts.follow === true ? 10 : opts.follow ? Number(opts.follow) : undefined;
    const layout = opts.wide ? "wide" as const : opts.narrow ? "narrow" as const : undefined;
    if (name) {
      const { showThopterStatus } = await import("./status.js");
      await showThopterStatus(resolveThopterName(name));
    } else {
      const { listDevboxes } = await import("./devbox.js");
      await listDevboxes({ follow, layout, json: opts.json });
    }
  });

// --- tail ---
program
  .command("tail")
  .description("Tail a thopter's Claude transcript from Redis")
  .argument("<name>", "Thopter name")
  .option("-f, --follow", "Continuously poll for new entries")
  .option("-n, --lines <count>", "Number of entries to show (default: 20)", parseInt)
  .option("-s, --short", "Truncated single-line output (default: full messages)")
  .action(async (name: string, opts: { follow?: boolean; lines?: number; short?: boolean }) => {
    const { tailTranscript } = await import("./tail.js");
    await tailTranscript(resolveThopterName(name), { follow: opts.follow, lines: opts.lines, short: opts.short });
  });

// --- check ---
program
  .command("check")
  .description("Check if a thopter has tmux and Claude running")
  .argument("<name>", "Thopter name")
  .option("--json", "Output as JSON")
  .action(async (name: string, opts: { json?: boolean }) => {
    const { checkClaude } = await import("./tell.js");
    const result = await checkClaude(resolveThopterName(name));
    if (opts.json) {
      process.stdout.write(JSON.stringify(result) + "\n");
    } else {
      console.log(`tmux:   ${result.tmux ? "running" : "not running"}`);
      console.log(`claude: ${result.claude ? "running" : "not running"}`);
      if (!result.tmux) {
        console.log("\nNo tmux session. Claude needs to be launched.");
        console.log(`  SSH in and start Claude: thopter ssh ${name}`);
      } else if (!result.claude) {
        console.log("\ntmux is running but Claude is not in any pane.");
        console.log(`  SSH in and start Claude: thopter ssh ${name}`);
      }
    }
  });

// --- tell ---
program
  .command("tell")
  .description("Send a message to a running Claude session")
  .argument("<name>", "Thopter name")
  .argument("<message>", "Message to send to Claude")
  .option("-i, --interrupt", "Interrupt Claude first (send Escape), then deliver the message")
  .option("--no-tail", "Exit after sending (don't follow transcript)")
  .action(async (name: string, message: string, opts: { interrupt?: boolean; tail?: boolean }) => {
    const { tellThopter } = await import("./tell.js");
    await tellThopter(resolveThopterName(name), message, { interrupt: opts.interrupt, noTail: opts.tail === false });
  });

// --- run ---
function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

program
  .command("run")
  .description("Create a thopter and run Claude with a prompt")
  .argument("<prompt>", "The task/prompt to give Claude")
  .option("--repo <owner/repo>", "GitHub repository to clone")
  .option("--branch <name>", "Git branch to start from")
  .option("--home", "Use home directory as working directory (no single repo)")
  .option("--checkout <repo[:branch]>", "Pre-checkout a repo (repeatable, use with --home)", collect, [])
  .option("--name <name>", "Thopter name (auto-generated if omitted)")
  .option("--snapshot <id>", "Snapshot to use")
  .option("--keep-alive <minutes>", "Keep-alive time in minutes", parseInt)
  .action(async (prompt: string, opts: { repo?: string; branch?: string; home?: boolean; checkout?: string[]; name?: string; snapshot?: string; keepAlive?: number }) => {
    const { runThopter } = await import("./run.js");
    await runThopter({ prompt, homeDir: opts.home, checkout: opts.checkout, ...opts });
  });

// --- reauth ---
program
  .command("reauth")
  .description("Interactive wizard to re-authenticate Claude Code and update the default snapshot")
  .action(async () => {
    const { runReauth } = await import("./reauth.js");
    await runReauth();
  });

// --- use ---
program
  .command("use")
  .description("Set or view the default thopter (use '.' in commands to reference it)")
  .argument("[name]", "Thopter name to set as default (omit to view current)")
  .option("--clear", "Clear the default thopter")
  .action(async (name: string | undefined, opts: { clear?: boolean }) => {
    const {
      getDefaultThopter,
      setDefaultThopter,
      clearDefaultThopter,
    } = await import("./config.js");

    if (opts.clear) {
      clearDefaultThopter();
      console.log("Default thopter cleared.");
    } else if (name) {
      setDefaultThopter(name);
      console.log(`Default thopter set to: ${name}`);
      console.log("Use '.' as the name in any command to reference it.");
    } else {
      const current = getDefaultThopter();
      if (current) {
        console.log(`Default thopter: ${current}`);
      } else {
        console.log("No default thopter set.");
        console.log("  Set one with: thopter use <name>");
      }
    }
  });

// --- repos ---
const reposCmd = program
  .command("repos")
  .description("Manage predefined repositories for `thopter run`");

reposCmd
  .command("list")
  .alias("ls")
  .description("List predefined repos")
  .action(async () => {
    const { listRepos } = await import("./repos.js");
    listRepos();
  });

reposCmd
  .command("add")
  .description("Add a predefined repo (interactive)")
  .action(async () => {
    const { addRepoInteractive } = await import("./repos.js");
    await addRepoInteractive();
  });

reposCmd
  .command("remove")
  .alias("rm")
  .description("Remove a predefined repo (interactive)")
  .action(async () => {
    const { removeRepoInteractive } = await import("./repos.js");
    await removeRepoInteractive();
  });

reposCmd
  .command("edit")
  .description("Edit a predefined repo (interactive)")
  .action(async () => {
    const { editRepoInteractive } = await import("./repos.js");
    await editRepoInteractive();
  });

// --- destroy ---
program
  .command("destroy")
  .alias("rm")
  .alias("kill")
  .alias("shutdown")
  .description("Shut down a devbox")
  .argument("<devbox>", "Devbox name or ID")
  .action(async (devbox: string) => {
    const { destroyDevbox } = await import("./devbox.js");
    await destroyDevbox(resolveThopterName(devbox));
  });

// --- suspend ---
program
  .command("suspend")
  .description("Suspend a devbox (preserves disk, can resume later)")
  .argument("<devbox>", "Devbox name or ID")
  .action(async (devbox: string) => {
    const { suspendDevbox } = await import("./devbox.js");
    await suspendDevbox(resolveThopterName(devbox));
  });

// --- resume ---
program
  .command("resume")
  .description("Resume a suspended devbox")
  .argument("<devbox>", "Devbox name or ID")
  .action(async (devbox: string) => {
    const { resumeDevbox } = await import("./devbox.js");
    await resumeDevbox(resolveThopterName(devbox));
  });

// --- keepalive ---
program
  .command("keepalive")
  .description("Reset a devbox's keep-alive timer")
  .argument("<devbox>", "Devbox name or ID")
  .action(async (devbox: string) => {
    const { keepaliveDevbox } = await import("./devbox.js");
    await keepaliveDevbox(resolveThopterName(devbox));
  });

// --- ssh ---
program
  .command("ssh")
  .description("SSH into a devbox (via rli)")
  .argument("<devbox>", "Devbox name or ID")
  .action(async (devbox: string) => {
    const { sshDevbox } = await import("./devbox.js");
    await sshDevbox(resolveThopterName(devbox));
  });

// --- attach ---
program
  .command("attach")
  .description("SSH into a devbox and attach to tmux in control mode (-CC)")
  .argument("<devbox>", "Devbox name or ID")
  .action(async (devbox: string) => {
    const { attachDevbox } = await import("./devbox.js");
    await attachDevbox(resolveThopterName(devbox));
  });

// --- exec ---
program
  .command("exec")
  .description("Run a command in a devbox")
  .argument("<devbox>", "Devbox name or ID")
  .argument("<command...>", "Command and arguments")
  .action(async (devbox: string, command: string[]) => {
    const { execDevbox } = await import("./devbox.js");
    await execDevbox(resolveThopterName(devbox), command);
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
    await snapshotDevbox(resolveThopterName(devbox), name);
  });

snapshotCmd
  .command("replace")
  .description("Replace an existing snapshot with a fresh one from a devbox")
  .argument("<devbox>", "Devbox name or ID")
  .argument("<name>", "Name of the snapshot to replace")
  .action(async (devbox: string, name: string) => {
    const { replaceSnapshot } = await import("./devbox.js");
    await replaceSnapshot(resolveThopterName(devbox), name);
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
    const { setRunloopApiKey, setDefaultSnapshot, setDefaultRepo, setDefaultBranch, setStopNotifications, setStopNotificationQuietPeriod, setDefaultThopter } = await import("./config.js");
    switch (key) {
      case "runloopApiKey":
        setRunloopApiKey(value);
        console.log("Set runloopApiKey.");
        break;
      case "defaultSnapshotName":
      case "defaultSnapshotId": // Legacy alias
        setDefaultSnapshot(value);
        console.log(`Set defaultSnapshotName to: ${value}`);
        break;
      case "defaultRepo":
        setDefaultRepo(value);
        console.log(`Set defaultRepo to: ${value}`);
        break;
      case "defaultBranch":
        setDefaultBranch(value);
        console.log(`Set defaultBranch to: ${value}`);
        break;
      case "stopNotifications":
        setStopNotifications(value === "true" || value === "1");
        console.log(`Set stopNotifications to: ${value === "true" || value === "1"}`);
        break;
      case "stopNotificationQuietPeriod":
        setStopNotificationQuietPeriod(parseInt(value, 10));
        console.log(`Set stopNotificationQuietPeriod to: ${parseInt(value, 10)} seconds`);
        break;
      case "defaultThopter":
        setDefaultThopter(value);
        console.log(`Set defaultThopter to: ${value}`);
        break;
      default:
        console.error(`Unknown config key: ${key}`);
        console.error("Available keys: runloopApiKey, defaultSnapshotName, defaultRepo, defaultBranch, stopNotifications, stopNotificationQuietPeriod, defaultThopter");
        console.error("For env vars (THOPTER_REDIS_URL, THOPTER_NTFY_CHANNEL, etc.): thopter env set <KEY> <VALUE>");
        process.exit(1);
    }
  });

configCmd
  .command("get")
  .description("Get a config value")
  .argument("[key]", "Config key (omit to show all)")
  .action(async (key?: string) => {
    const { getRunloopApiKey, getDefaultSnapshot, getDefaultRepo, getDefaultBranch, getStopNotifications, getStopNotificationQuietPeriod, getEnvVars, getDefaultThopter, getRepos, getSyncthingConfig } = await import("./config.js");
    if (!key) {
      console.log(`runloopApiKey:                  ${getRunloopApiKey() ? "(set)" : "(not set)"}`);
      console.log(`defaultSnapshotName:             ${getDefaultSnapshot() ?? "(not set)"}`);
      console.log(`defaultRepo:                    ${getDefaultRepo() ?? "(not set)"}`);
      console.log(`defaultBranch:                  ${getDefaultBranch() ?? "(not set)"}`);
      console.log(`stopNotifications:              ${getStopNotifications()}`);
      console.log(`stopNotificationQuietPeriod:    ${getStopNotificationQuietPeriod()}s`);
      console.log(`defaultThopter:                 ${getDefaultThopter() ?? "(not set)"}`);
      const repos = getRepos();
      console.log(`repos:                          ${repos.length > 0 ? `${repos.length} configured (see: thopter repos list)` : "(none)"}`);
      const envVars = getEnvVars();
      const envCount = Object.keys(envVars).length;
      console.log(`envVars:                        ${envCount > 0 ? `${envCount} configured (see: thopter env list)` : "(none)"}`);
      const st = getSyncthingConfig();
      console.log(`syncthing:                      ${st ? `${st.folderId} → ${st.localPath}` : "(not set)"}`);

    } else {
      switch (key) {
        case "runloopApiKey":
          console.log(getRunloopApiKey() ? "(set)" : "(not set)");
          break;
        case "defaultSnapshotName":
        case "defaultSnapshotId": // Legacy alias
          console.log(getDefaultSnapshot() ?? "(not set)");
          break;
        case "defaultRepo":
          console.log(getDefaultRepo() ?? "(not set)");
          break;
        case "defaultBranch":
          console.log(getDefaultBranch() ?? "(not set)");
          break;
        case "stopNotifications":
          console.log(getStopNotifications());
          break;
        case "stopNotificationQuietPeriod":
          console.log(`${getStopNotificationQuietPeriod()}s`);
          break;
        case "defaultThopter":
          console.log(getDefaultThopter() ?? "(not set)");
          break;
        default:
          console.error(`Unknown config key: ${key}`);
          console.error("Available keys: runloopApiKey, defaultSnapshotName, defaultRepo, defaultBranch, stopNotifications, stopNotificationQuietPeriod, defaultThopter");
          console.error("For env vars: thopter env list");
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
      const { execSync } = await import("node:child_process");
      // Try the running daemon's REST API first, then fall back to direct command
      for (const cmd of [
        "syncthing cli show system 2>/dev/null | jq -r .myID",
        "syncthing --device-id 2>/dev/null",
      ]) {
        try {
          const result = execSync(cmd, { encoding: "utf-8" }).trim();
          if (result && result !== "null") { detectedId = result; break; }
        } catch { /* try next */ }
      }
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

    const { resolveDevbox } = await import("./devbox.js");
    const { installSyncthingOnDevbox, getDevboxDeviceId, pairDeviceLocally } = await import("./sync.js");
    const { id, name } = await resolveDevbox(resolveThopterName(devbox));

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
    const { resolveDevbox } = await import("./devbox.js");
    const { getDevboxDeviceId } = await import("./sync.js");
    const { id } = await resolveDevbox(resolveThopterName(devbox));

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
    const { resolveDevbox } = await import("./devbox.js");
    const { getDevboxDeviceId, unpairDeviceLocally } = await import("./sync.js");
    const { id } = await resolveDevbox(resolveThopterName(devbox));

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

// --- env ---
const envCmd = program
  .command("env")
  .description("Manage devbox environment variables (stored in ~/.thopter.json)");

envCmd
  .command("list")
  .alias("ls")
  .description("List configured env vars (values masked)")
  .action(async () => {
    const { getEnvVars } = await import("./config.js");
    const { printTable } = await import("./output.js");
    const envVars = getEnvVars();
    const entries = Object.entries(envVars);
    if (entries.length === 0) {
      console.log("No env vars configured.");
      console.log("  Set one with: thopter env set <KEY> <VALUE>");
      return;
    }
    console.log("Devbox environment variables:");
    printTable(
      ["NAME", "VALUE"],
      entries.map(([k, v]) => [k, v.length > 4 ? v.slice(0, 4) + "..." : "***"]),
    );
  });

envCmd
  .command("set")
  .description("Set a devbox environment variable (prompts for value if omitted)")
  .argument("<key>", "Variable name (e.g. GH_TOKEN)")
  .argument("[value]", "Variable value (omit to enter interactively)")
  .action(async (key: string, value?: string) => {
    const { setEnvVar } = await import("./config.js");

    if (!value) {
      // Interactive prompt — keeps sensitive values out of shell history
      const { createInterface } = await import("node:readline");
      const rl = createInterface({ input: process.stdin, terminal: true });
      process.stdout.write(`Value for ${key}: `);
      value = await new Promise<string>((resolve) => {
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
    }

    setEnvVar(key, value);
    console.log(`Set ${key}.`);
  });

envCmd
  .command("delete")
  .alias("rm")
  .description("Remove a devbox environment variable")
  .argument("<key>", "Variable name")
  .action(async (key: string) => {
    const { deleteEnvVar } = await import("./config.js");
    deleteEnvVar(key);
    console.log(`Deleted ${key}.`);
  });

// Parse and run
program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
