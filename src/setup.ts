/**
 * Interactive first-time setup wizard.
 */

import { createInterface } from "node:readline";
import { execSync } from "node:child_process";
import { getClient } from "./client.js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  getRunloopApiKey,
  setRunloopApiKey,
  getEnvVars,
  setEnvVar,
  loadConfigIntoEnv,
} from "./config.js";

/** Ensure the docs key exists in the config file. */
function seedDocsKey(): void {
  const configFile = join(homedir(), ".thopter.json");
  let config: Record<string, unknown> = {};
  if (existsSync(configFile)) {
    try { config = JSON.parse(readFileSync(configFile, "utf-8")); } catch { /* ignore */ }
  }
  if (!config.docs) {
    config = { docs: "See thopter-json-reference.md for all config options.", ...config };
    writeFileSync(configFile, JSON.stringify(config, null, 2) + "\n");
  }
}

const rl = createInterface({ input: process.stdin, output: process.stdout });

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

async function askWithDefault(prompt: string, current: string | undefined): Promise<string> {
  if (current) {
    const answer = await ask(`${prompt} [keep current] `);
    return answer || current;
  }
  return askRequired(`${prompt} `);
}

export async function runSetup(): Promise<void> {
  seedDocsKey();

  console.log("=".repeat(60));
  console.log("Thopter Swarm Setup");
  console.log("=".repeat(60));
  console.log();

  // --- Step 1: Runloop API key ---
  console.log("Step 1: Runloop API Key");
  console.log("  Get yours from the Runloop dashboard.");
  const currentApiKey = getRunloopApiKey();
  if (currentApiKey) {
    console.log("  (already configured)");
    const newKey = await ask("  Runloop API key [keep current]: ");
    if (newKey) {
      setRunloopApiKey(newKey);
      console.log("  Updated.");
    }
  } else {
    const apiKey = await askRequired("  Runloop API key: ");
    setRunloopApiKey(apiKey);
    console.log("  Saved.");
  }
  // Reload env so getClient() works
  loadConfigIntoEnv();

  // Verify auth
  console.log("  Verifying...");
  try {
    const client = getClient();
    await client.devboxes.list({ limit: 1 });
    console.log("  Authenticated to Runloop.");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`  ERROR: Authentication failed: ${msg}`);
    console.log("  Check your API key and try again.");
    rl.close();
    process.exit(1);
  }
  console.log();

  // --- Step 2: Redis URL ---
  console.log("Step 2: Redis URL");
  console.log("  Upstash Redis URL for status reporting.");
  const currentRedisUrl = getEnvVars().THOPTER_REDIS_URL;
  const redisUrl = await askWithDefault("  Redis URL:", currentRedisUrl);
  setEnvVar("THOPTER_REDIS_URL", redisUrl);
  loadConfigIntoEnv();
  console.log("  Saved.");
  console.log();

  // --- Step 3: Devbox environment variables ---
  console.log("Step 3: Devbox Environment Variables");
  console.log("  These are injected into every new devbox via ~/.thopter-env.");
  console.log("  Stored locally in ~/.thopter.json (not in the Runloop platform).");
  const currentEnv = getEnvVars();
  const envKeys = Object.keys(currentEnv);
  if (envKeys.length > 0) {
    console.log("\n  Already configured:");
    for (const k of envKeys) {
      console.log(`    - ${k}`);
    }
    console.log();
  }

  // GH_TOKEN (required)
  if (!currentEnv.GH_TOKEN) {
    console.log("  GH_TOKEN (required)");
    console.log("  Used for git clone/push and the gh CLI.");
    const token = await askRequired("  GitHub token (ghp_... or fine-grained): ");
    setEnvVar("GH_TOKEN", token);
    console.log("  Saved.");
  }

  // CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
  if (!currentEnv.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS) {
    console.log();
    console.log("  Claude Code Agent Teams (optional)");
    console.log("  Enables the experimental agent teams feature in Claude Code.");
    const enableTeams = await ask("  Enable CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1? [Y/n]: ");
    if (!enableTeams || enableTeams.toLowerCase() === "y" || enableTeams.toLowerCase() === "yes") {
      setEnvVar("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1");
      console.log("  Enabled.");
    } else {
      console.log("  Skipped. Enable later with: thopter env set CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS 1");
    }
  }

  // Additional env vars
  while (true) {
    console.log();
    const name = await ask("  Add another env var? Enter name (or enter to skip): ");
    if (!name) break;
    const value = await askRequired(`  Value for ${name}: `);
    setEnvVar(name, value);
    console.log(`  Saved ${name}.`);
  }
  console.log();

  // --- Step 4: ntfy.sh ---
  console.log("Step 4: Push Notifications (ntfy.sh)");
  console.log("  Get notified on your phone when Claude stops or needs input.");
  console.log("  Pick a unique channel name and subscribe at https://ntfy.sh/<channel>");
  const currentNtfy = getEnvVars().THOPTER_NTFY_CHANNEL;
  if (currentNtfy) {
    console.log(`  Current channel: ${currentNtfy}`);
    const newNtfy = await ask("  ntfy channel [keep current]: ");
    if (newNtfy) {
      setEnvVar("THOPTER_NTFY_CHANNEL", newNtfy);
      console.log(`  Updated. Subscribe at: https://ntfy.sh/${newNtfy}`);
    }
  } else {
    const ntfy = await ask("  ntfy channel (enter to skip): ");
    if (ntfy) {
      setEnvVar("THOPTER_NTFY_CHANNEL", ntfy);
      console.log(`  Saved. Subscribe at: https://ntfy.sh/${ntfy}`);
    } else {
      console.log("  Skipped. Set later with: thopter env set THOPTER_NTFY_CHANNEL <channel>");
    }
  }
  console.log();

  // --- Step 5: Owner identity ---
  console.log("Step 5: Owner Identity");
  let ownerName = "";
  try {
    ownerName = execSync("git config --get user.name", { encoding: "utf-8" }).trim();
  } catch {
    // ignore
  }
  if (ownerName) {
    console.log(`  Git user.name: ${ownerName}`);
    console.log("  This will be used as the owner tag on your thopters.");
  } else {
    console.log("  WARNING: git user.name is not configured.");
    console.log("  Set it with: git config --global user.name 'Your Name'");
    console.log("  This is required before you can create thopters.");
  }
  console.log();

  // --- Done ---
  console.log("=".repeat(60));
  console.log("Setup complete!");
  console.log();
  console.log("Next steps:");
  console.log("");
  console.log("  1. Create a devbox:        thopter create jw/hello --fresh");
  console.log("     (note that thopter names are up to you or can be left blank and");
  console.log("     a random one is assigned. But using $initials/$purpose is good");
  console.log("     convention when working in a team)");
  console.log("");
  console.log("  2. SSH in:                 thopter ssh jw/hello");
  console.log("");
  console.log("  3. Authenticate claude & codex, clone common repos, run npm installs,");
  console.log("     and generally set up your 'golden' environment. You can always do");
  console.log("     more of this later and recreate an updated snapshot.");
  console.log("");
  console.log("  4. Snapshot it:            thopter snapshot create jw/hello jw/golden");
  console.log("");
  console.log("  5. Set as default:         thopter snapshot default jw/golden");
  console.log("");
  console.log("  6. Stamp out a worker:     thopter create jw/featureXYZ");
  console.log("     (without --fresh, create uses your default snapshot for fast boot)");
  console.log("");
  console.log("  7. SSH in and yolo! (built-in `yolo-claude` alias for `claude --dangerously-skip-permissions`)");
  console.log("");
  console.log("Manage env vars later with: thopter env {list,set,delete}");
  console.log("");
  console.log("A couple things to keep in mind:");
  console.log("  - Thopters shut down after 12 hours. Reset the timer with:");
  console.log("    thopter keepalive <name> ");
  console.log("    A suspended thopter can be resumed with: thopter resume <name>");
  console.log("  - Thopter github credentials can only modify branches starting with");
  console.log("    'thopter/' and can create, but not merge, PRs to other branches.");
  console.log("");
  console.log("=".repeat(60));

  rl.close();
}
