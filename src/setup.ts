/**
 * Interactive first-time setup wizard.
 */

import { createInterface } from "node:readline";
import { execSync } from "node:child_process";
import { getClient } from "./client.js";
import { listSecrets, createOrUpdateSecret } from "./secrets.js";
import {
  getRunloopApiKey,
  setRunloopApiKey,
  getRedisUrl,
  setRedisUrl,
  getNtfyChannel,
  setNtfyChannel,
  loadConfigIntoEnv,
} from "./config.js";

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
    await client.secrets.list({ limit: 1 });
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
  const redisUrl = await askWithDefault("  Redis URL:", getRedisUrl());
  setRedisUrl(redisUrl);
  loadConfigIntoEnv();
  console.log("  Saved.");

  // Ensure REDIS_URL is also in Runloop platform secrets (devboxes need it)
  const secrets = await listSecrets();
  const hasRedisSecret = secrets.some((s) => s.name === "REDIS_URL");
  if (!hasRedisSecret) {
    console.log("  Adding REDIS_URL to Runloop platform secrets (so devboxes get it)...");
    await createOrUpdateSecret("REDIS_URL", redisUrl);
    console.log("  Done.");
  } else {
    const update = await ask("  REDIS_URL already exists in Runloop secrets. Update it? [y/N] ");
    if (update.toLowerCase() === "y") {
      await createOrUpdateSecret("REDIS_URL", redisUrl);
      console.log("  Updated.");
    }
  }
  console.log();

  // --- Step 3: Platform secrets ---
  console.log("Step 3: Devbox Secrets");
  console.log("  These are injected as env vars into every devbox.");
  console.log("  All secrets in the Runloop platform are shared across all devboxes.");
  const refreshedSecrets = await listSecrets();
  if (refreshedSecrets.length > 0) {
    console.log("\n  Already configured in Runloop:");
    for (const s of refreshedSecrets) {
      console.log(`    - ${s.name}`);
    }
    console.log();
  }

  // GITHUB_PAT (required)
  const hasGithub = refreshedSecrets.some((s) => s.name === "GITHUB_PAT");
  if (!hasGithub) {
    console.log("  GITHUB_PAT (required)");
    console.log("  Used for git clone/push and as GH_TOKEN for the gh CLI.");
    const pat = await askRequired("  GitHub personal access token: ");
    await createOrUpdateSecret("GITHUB_PAT", pat);
    console.log("  Saved.");
  }

  // ANTHROPIC_API_KEY
  const hasAnthropic = refreshedSecrets.some((s) => s.name === "ANTHROPIC_API_KEY");
  if (!hasAnthropic) {
    console.log("\n  ANTHROPIC_API_KEY (optional — needed for Claude Code on devboxes)");
    const anthropicKey = await ask("  Anthropic API key (enter to skip): ");
    if (anthropicKey) {
      await createOrUpdateSecret("ANTHROPIC_API_KEY", anthropicKey);
      console.log("  Saved.");
    }
  }

  // OPENAI_API_KEY
  const hasOpenai = refreshedSecrets.some((s) => s.name === "OPENAI_API_KEY");
  if (!hasOpenai) {
    console.log("\n  OPENAI_API_KEY (optional — needed for Codex CLI on devboxes)");
    const openaiKey = await ask("  OpenAI API key (enter to skip): ");
    if (openaiKey) {
      await createOrUpdateSecret("OPENAI_API_KEY", openaiKey);
      console.log("  Saved.");
    }
  }

  // Additional secrets
  while (true) {
    console.log();
    const name = await ask("  Add another secret? Enter name (or enter to skip): ");
    if (!name) break;
    const value = await askRequired(`  Value for ${name}: `);
    await createOrUpdateSecret(name, value);
    console.log(`  Saved ${name}.`);
  }
  console.log();

  // --- Step 4: ntfy.sh ---
  console.log("Step 4: Push Notifications (ntfy.sh)");
  console.log("  Get notified on your phone when Claude stops or needs input.");
  console.log("  Pick a unique channel name and subscribe at https://ntfy.sh/<channel>");
  const currentNtfy = getNtfyChannel();
  if (currentNtfy) {
    console.log(`  Current channel: ${currentNtfy}`);
    const newNtfy = await ask("  ntfy channel [keep current]: ");
    if (newNtfy) {
      setNtfyChannel(newNtfy);
      console.log(`  Updated. Subscribe at: https://ntfy.sh/${newNtfy}`);
    }
  } else {
    const ntfy = await ask("  ntfy channel (enter to skip): ");
    if (ntfy) {
      setNtfyChannel(ntfy);
      console.log(`  Saved. Subscribe at: https://ntfy.sh/${ntfy}`);
    } else {
      console.log("  Skipped. Set later with: ./thopter config set ntfyChannel <channel>");
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
  console.log("  1. Create a devbox:          ./thopter create my-thopter --fresh");
  console.log("  2. SSH in and configure:     ./thopter ssh my-thopter");
  console.log("  3. Auth Claude & Codex, set up your environment");
  console.log("  4. Snapshot it:              ./thopter snapshot create my-thopter golden");
  console.log("  5. Set as default:           ./thopter snapshot default golden");
  console.log("  6. Stamp out workers:        ./thopter create worker-1");
  console.log("=".repeat(60));

  rl.close();
}
