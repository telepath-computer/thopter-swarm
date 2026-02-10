/**
 * `thopter tell` — send a message to a running Claude session on a devbox.
 */

import { resolveDevbox } from "./devbox.js";
import { getClient } from "./client.js";
import { tailTranscript } from "./tail.js";

export async function tellThopter(
  name: string,
  message: string,
  opts: { interrupt?: boolean },
): Promise<void> {
  const { id: devboxId } = await resolveDevbox(name);
  const client = getClient();

  // Write message to a temp file on the devbox (avoids shell escaping issues)
  await client.devboxes.writeFileContents(devboxId, {
    file_path: "/tmp/thopter-tell-msg",
    contents: message,
  });

  // Build the tmux command sequence targeting the primary Claude pane
  const parts: string[] = [];

  if (opts.interrupt) {
    // Send Escape to interrupt Claude's current activity
    parts.push("tmux send-keys -t claude:0.0 Escape");
    parts.push("sleep 0.5");
  }

  // Load message into a tmux buffer and paste it into the target pane,
  // then press Enter to submit. This avoids any shell escaping issues.
  parts.push("tmux load-buffer -b tell /tmp/thopter-tell-msg");
  parts.push("tmux paste-buffer -b tell -t claude:0.0 -d");
  parts.push("tmux send-keys -t claude:0.0 Enter");

  const cmd = parts.join(" && ");

  console.log(
    opts.interrupt
      ? `Interrupting and sending message to '${name}'...`
      : `Sending message to '${name}'...`,
  );

  const execution = await client.devboxes.executeAsync(devboxId, {
    command: cmd,
  });
  const result = await client.devboxes.executions.awaitCompleted(
    devboxId,
    execution.execution_id,
  );

  if (result.exit_status && result.exit_status !== 0) {
    console.error("Failed to send message.");
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(1);
  }

  console.log("Message sent. Tailing transcript...\n");

  // Enter tail -f mode so the user sees Claude's response
  await tailTranscript(name, { follow: true, lines: 5 });
}
