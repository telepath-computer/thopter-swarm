/**
 * First-time setup: auth check + secrets overview.
 */

import { getClient } from "./client.js";
import { listSecrets } from "./secrets.js";
import { getNtfyChannel } from "./config.js";

async function checkAuth(): Promise<boolean> {
  console.log("Checking Runloop authentication...");

  if (!process.env.RUNLOOP_API_KEY) {
    console.log("  ERROR: RUNLOOP_API_KEY environment variable is not set.");
    console.log("  Get your API key from the Runloop dashboard and set it in .env.local");
    return false;
  }

  try {
    const client = getClient();
    await client.secrets.list({ limit: 1 });
    console.log("  Authenticated to Runloop.");
    return true;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("401") || msg.includes("auth") || msg.includes("Unauthorized")) {
      console.log("  ERROR: Authentication failed. Check your RUNLOOP_API_KEY.");
      return false;
    }
    console.log(`  WARNING: Unexpected error checking auth: ${msg}`);
    console.log("  Proceeding anyway — if things fail, check your RUNLOOP_API_KEY.");
    return true;
  }
}

export async function runSetup(): Promise<void> {
  console.log("=".repeat(60));
  console.log("Thopter Swarm Setup");
  console.log("=".repeat(60));
  console.log();

  if (!(await checkAuth())) {
    process.exit(1);
  }

  // Show existing secrets
  const existing = await listSecrets();

  if (existing.length > 0) {
    console.log("\nSecrets configured in Runloop:");
    for (const s of existing) {
      console.log(`  - ${s.name}`);
    }
    console.log("\nAll secrets are auto-injected as env vars into every devbox.");
  } else {
    console.log("\nNo secrets configured yet.");
  }

  console.log("\nAdd secrets with:  ./thopter secrets set <NAME>");
  console.log("List secrets:      ./thopter secrets list");
  console.log("Delete secrets:    ./thopter secrets delete <NAME>");
  console.log(`
Common secrets you might want to add:
  GITHUB_PAT          GitHub personal access token (used by init script for git)
  ANTHROPIC_API_KEY   Anthropic API key (for Claude Code)
  REDIS_URL           Redis URL for status reporting from inside devboxes

The secret name becomes the env var name in your devboxes.`);

  // ntfy.sh notifications
  const ntfyChannel = getNtfyChannel();
  console.log("\n--- Notifications (ntfy.sh) ---");
  if (ntfyChannel) {
    console.log(`  Channel: ${ntfyChannel}`);
    console.log(`  Subscribe: https://ntfy.sh/${ntfyChannel}`);
  } else {
    console.log("  No ntfy.sh channel configured.");
    console.log("  Set one with: ./thopter config set ntfyChannel <channel-name>");
    console.log("  Then subscribe on your phone/desktop at https://ntfy.sh/<channel-name>");
  }

  console.log("\nSetup complete.");
}
