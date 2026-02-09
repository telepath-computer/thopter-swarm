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
  thopter run --repo owner/repo "prompt"  Launch Claude with a task
  thopter status                         Unified view of all thopters
  thopter status dev                     Detailed status + logs for a thopter
  thopter tail dev                       Show last 20 transcript entries
  thopter tail dev -f                    Follow transcript in real time
  thopter tail dev -n 50                 Show last 50 entries
  thopter keepalive dev                   Reset idle timer for a devbox
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
  .option("--idle-timeout <minutes>", "Idle timeout in minutes before auto-suspend (default: 720)", parseInt)
  .option("-a, --attach", "SSH into the devbox after creation")
  .action(async (name: string | undefined, opts: { snapshot?: string; fresh?: boolean; idleTimeout?: number; attach?: boolean }) => {
    const { createDevbox, sshDevbox } = await import("./devbox.js");
    const { generateName } = await import("./names.js");
    const resolvedName = name ?? generateName();
    await createDevbox({
      name: resolvedName,
      snapshotId: opts.snapshot,
      fresh: opts.fresh,
      idleTimeout: opts.idleTimeout ? opts.idleTimeout * 60 : undefined,
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
  .action(async (name: string | undefined) => {
    if (name) {
      const { showThopterStatus } = await import("./status.js");
      await showThopterStatus(name);
    } else {
      const { listDevboxes } = await import("./devbox.js");
      await listDevboxes();
    }
  });

// --- tail ---
program
  .command("tail")
  .description("Tail a thopter's Claude transcript from Redis")
  .argument("<name>", "Thopter name")
  .option("-f, --follow", "Continuously poll for new entries")
  .option("-n, --lines <count>", "Number of entries to show (default: 20)", parseInt)
  .action(async (name: string, opts: { follow?: boolean; lines?: number }) => {
    const { tailTranscript } = await import("./tail.js");
    await tailTranscript(name, { follow: opts.follow, lines: opts.lines });
  });

// --- run ---
program
  .command("run")
  .description("Create a thopter and run Claude with a prompt")
  .argument("<prompt>", "The task/prompt to give Claude")
  .option("--repo <owner/repo>", "GitHub repository to clone")
  .option("--branch <name>", "Git branch to start from")
  .option("--name <name>", "Thopter name (auto-generated if omitted)")
  .option("--snapshot <id>", "Snapshot to use")
  .option("--idle-timeout <minutes>", "Idle timeout in minutes", parseInt)
  .action(async (prompt: string, opts: { repo?: string; branch?: string; name?: string; snapshot?: string; idleTimeout?: number }) => {
    const { runThopter } = await import("./run.js");
    await runThopter({ prompt, ...opts });
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
    const { setRunloopApiKey, setDefaultSnapshot, setStopNotifications } = await import("./config.js");
    switch (key) {
      case "runloopApiKey":
        setRunloopApiKey(value);
        console.log("Set runloopApiKey.");
        break;
      case "defaultSnapshotId":
        setDefaultSnapshot(value);
        console.log(`Set defaultSnapshotId to: ${value}`);
        break;
      case "stopNotifications":
        setStopNotifications(value === "true" || value === "1");
        console.log(`Set stopNotifications to: ${value === "true" || value === "1"}`);
        break;
      default:
        console.error(`Unknown config key: ${key}`);
        console.error("Available keys: runloopApiKey, defaultSnapshotId, stopNotifications");
        console.error("For env vars (THOPTER_REDIS_URL, THOPTER_NTFY_CHANNEL, etc.): thopter env set <KEY> <VALUE>");
        process.exit(1);
    }
  });

configCmd
  .command("get")
  .description("Get a config value")
  .argument("[key]", "Config key (omit to show all)")
  .action(async (key?: string) => {
    const { getRunloopApiKey, getDefaultSnapshot, getStopNotifications, getEnvVars } = await import("./config.js");
    if (!key) {
      console.log(`runloopApiKey:       ${getRunloopApiKey() ? "(set)" : "(not set)"}`);
      console.log(`defaultSnapshotId:   ${getDefaultSnapshot() ?? "(not set)"}`);
      console.log(`stopNotifications:   ${getStopNotifications()}`);
      const envVars = getEnvVars();
      const envCount = Object.keys(envVars).length;
      console.log(`envVars:             ${envCount > 0 ? `${envCount} configured (see: thopter env list)` : "(none)"}`);
    } else {
      switch (key) {
        case "runloopApiKey":
          console.log(getRunloopApiKey() ? "(set)" : "(not set)");
          break;
        case "defaultSnapshotId":
          console.log(getDefaultSnapshot() ?? "(not set)");
          break;
        case "stopNotifications":
          console.log(getStopNotifications());
          break;
        default:
          console.error(`Unknown config key: ${key}`);
          console.error("Available keys: runloopApiKey, defaultSnapshotId, stopNotifications");
          console.error("For env vars: thopter env list");
          process.exit(1);
      }
    }
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
