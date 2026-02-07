/**
 * Interactive first-time setup: auth check + secret prompting.
 */

import { createInterface } from "node:readline";
import { getClient } from "./client.js";
import { createOrUpdateSecret, listSecrets } from "./secrets.js";
import { SECRETS } from "./config.js";

function prompt(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function checkAuth(): Promise<boolean> {
  console.log("Checking Runloop authentication...");

  if (!process.env.RUNLOOP_API_KEY) {
    console.log("  ERROR: RUNLOOP_API_KEY environment variable is not set.");
    console.log("  Get your API key from the Runloop dashboard and set it:");
    console.log("    export RUNLOOP_API_KEY=your-key");
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

async function promptSecret(
  name: string,
  description: string,
): Promise<string> {
  console.log(`\n  ${description}`);
  const value = await prompt(`  ${name}: `);
  if (!value) {
    console.log(`  ERROR: ${name} is required.`);
    return promptSecret(name, description);
  }
  return value;
}

export async function runSetup(): Promise<void> {
  console.log("=".repeat(60));
  console.log("Runloop Thopters Setup");
  console.log("=".repeat(60));
  console.log();

  if (!(await checkAuth())) {
    process.exit(1);
  }

  // Check existing secrets
  const existing = await listSecrets();
  const existingNames = new Set(existing.map((s) => s.name));
  const alreadyConfigured = SECRETS.filter((s) =>
    existingNames.has(s.runloopName),
  );

  if (alreadyConfigured.length > 0) {
    console.log("\nExisting thopter secrets found:");
    for (const s of alreadyConfigured) {
      console.log(`  - ${s.runloopName}`);
    }
    const answer = await prompt("  Overwrite with new values? [y/N]: ");
    if (answer.toLowerCase() !== "y") {
      console.log("  Keeping existing secrets. Setup complete.");
      return;
    }
  }

  // Collect and create secrets
  console.log("\nConfiguring Runloop secrets.");

  const created: string[] = [];

  for (const s of SECRETS) {
    const value = await promptSecret(s.runloopName, s.description);
    await createOrUpdateSecret(s.runloopName, value);
    created.push(s.runloopName);
  }

  console.log("\nSetup complete. Configured secrets:");
  for (const name of created) {
    console.log(`  - ${name}`);
  }
  console.log(
    "\nThese will be injected as environment variables into every devbox.",
  );
}
