/**
 * `thopter tell` — send a message to a running Claude session on a devbox.
 */

import { resolveDevbox } from "./devbox.js";
import { getClient } from "./client.js";
import { tailTranscript } from "./tail.js";

/**
 * Find the tmux pane running a `claude` process by checking which pane's
 * shell PID is the parent of a claude process. Returns a target like "0:0.0".
 */
const FIND_CLAUDE_PANE_SCRIPT = `
pane_target=""
for line in $(tmux list-panes -a -F '#{session_name}:#{window_index}.#{pane_index}:#{pane_pid}'); do
  target="\${line%:*}"
  pid="\${line##*:}"
  if ps --ppid "$pid" -o comm= 2>/dev/null | grep -q '^claude$'; then
    pane_target="$target"
    break
  fi
done
if [ -z "$pane_target" ]; then
  echo "ERROR: No tmux pane running claude found" >&2
  exit 1
fi
echo "$pane_target"
`.trim();

export async function tellThopter(
  name: string,
  message: string,
  opts: { interrupt?: boolean },
): Promise<void> {
  const { id: devboxId } = await resolveDevbox(name);
  const client = getClient();

  // Find the tmux pane running Claude
  const findExec = await client.devboxes.executeAsync(devboxId, {
    command: FIND_CLAUDE_PANE_SCRIPT,
  });
  const findResult = await client.devboxes.executions.awaitCompleted(
    devboxId,
    findExec.execution_id,
  );

  if (findResult.exit_status && findResult.exit_status !== 0) {
    console.error("No running Claude session found on this thopter.");
    if (findResult.stderr) process.stderr.write(findResult.stderr);
    process.exit(1);
  }

  const paneTarget = (findResult.stdout ?? "").trim();
  if (!paneTarget) {
    console.error("No running Claude session found on this thopter.");
    process.exit(1);
  }

  // Write message to a temp file on the devbox (avoids shell escaping issues)
  await client.devboxes.writeFileContents(devboxId, {
    file_path: "/tmp/thopter-tell-msg",
    contents: message,
  });

  // Build the tmux command sequence targeting the discovered pane
  const parts: string[] = [];

  if (opts.interrupt) {
    // Send Escape to interrupt Claude's current activity
    parts.push(`tmux send-keys -t '${paneTarget}' Escape`);
    parts.push("sleep 0.5");
  }

  // Load message into a tmux buffer and paste it into the target pane,
  // then press Enter to submit. This avoids any shell escaping issues.
  parts.push("tmux load-buffer -b tell /tmp/thopter-tell-msg");
  parts.push(`tmux paste-buffer -b tell -t '${paneTarget}' -d`);
  parts.push(`tmux send-keys -t '${paneTarget}' Enter`);

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
