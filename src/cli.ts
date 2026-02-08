#!/usr/bin/env node

/**
 * CLI entrypoint for runloop-thopters.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";

// Load .env.local from package root (won't override existing env vars)
{
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const envPath = resolve(__dirname, "..", ".env.local");
  try {
    const contents = readFileSync(envPath, "utf-8");
    for (const line of contents.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // No .env.local, that's fine
  }
}

const program = new Command();

program
  .name("runloop-thopters")
  .description("Manage Runloop devboxes for Claude Code development.")
  .addHelpText(
    "after",
    `
lifecycle:
  setup → create → ssh/exec → snapshot create → destroy
                                     ↓
                        create --snapshot → ssh/exec → ...

examples:
  runloop-thopters setup                          First-time auth & secret config
  runloop-thopters create dev                     Create a devbox
  runloop-thopters create --snapshot golden        Create from a snapshot
  runloop-thopters ssh dev                        SSH into the devbox
  runloop-thopters exec dev -- uname -a           Run a one-off command
  runloop-thopters snapshot create dev golden      Snapshot a devbox
  runloop-thopters snapshot list                  List snapshots
  runloop-thopters snapshot destroy golden         Delete a snapshot
  runloop-thopters snapshot default golden         Set default snapshot
  runloop-thopters snapshot default               View default snapshot
  runloop-thopters snapshot default --clear        Clear default snapshot
  runloop-thopters list                           Show running devboxes
  runloop-thopters status                         Overview of all thopters from redis
  runloop-thopters status dev                     Detailed status + logs for a thopter
  runloop-thopters keepalive dev                   Reset idle timer for a devbox
  runloop-thopters suspend dev                    Suspend a devbox
  runloop-thopters resume dev                     Resume a suspended devbox
  runloop-thopters destroy dev                    Shut down a devbox`,
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
        console.log("  Set one with: runloop-thopters snapshot default <name-or-id>");
      }
    }
  });

// --- config ---
const configCmd = program
  .command("config")
  .description("Manage local configuration (~/.runloop-thopters/config.json)");

configCmd
  .command("set")
  .description("Set a config value")
  .argument("<key>", "Config key (ntfyChannel)")
  .argument("<value>", "Config value")
  .action(async (key: string, value: string) => {
    const { setNtfyChannel, setDefaultSnapshot } = await import("./config.js");
    switch (key) {
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
        console.error("Available keys: ntfyChannel, defaultSnapshotId");
        process.exit(1);
    }
  });

configCmd
  .command("get")
  .description("Get a config value")
  .argument("[key]", "Config key (omit to show all)")
  .action(async (key?: string) => {
    const { getNtfyChannel, getDefaultSnapshot } = await import("./config.js");
    if (!key) {
      console.log(`ntfyChannel:       ${getNtfyChannel() ?? "(not set)"}`);
      console.log(`defaultSnapshotId: ${getDefaultSnapshot() ?? "(not set)"}`);
    } else {
      switch (key) {
        case "ntfyChannel":
          console.log(getNtfyChannel() ?? "(not set)");
          break;
        case "defaultSnapshotId":
          console.log(getDefaultSnapshot() ?? "(not set)");
          break;
        default:
          console.error(`Unknown config key: ${key}`);
          console.error("Available keys: ntfyChannel, defaultSnapshotId");
          process.exit(1);
      }
    }
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
