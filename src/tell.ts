/**
 * `thopter tell` — send a message to a running Claude session on a devbox.
 */

import { resolveDevbox } from "./devbox.js";
import { getClient } from "./client.js";
import { tailTranscript } from "./tail.js";

/**
 * Check whether tmux is running on the devbox.
 */
const CHECK_TMUX_SCRIPT = `tmux list-sessions >/dev/null 2>&1 && echo "ok" || echo "no"`;

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
  echo "NO_CLAUDE"
else
  echo "$pane_target"
fi
`.trim();

/**
 * Check if a devbox has tmux running and Claude in a tmux pane.
 * Returns { tmux: boolean, claude: boolean }.
 */
export async function checkClaude(name: string): Promise<{ tmux: boolean; claude: boolean }> {
  const { id: devboxId } = await resolveDevbox(name);
  const client = getClient();

  // Step 1: Check tmux
  const tmuxExec = await client.devboxes.executeAsync(devboxId, {
    command: CHECK_TMUX_SCRIPT,
  });
  const tmuxResult = await client.devboxes.executions.awaitCompleted(
    devboxId,
    tmuxExec.execution_id,
  );
  const hasTmux = (tmuxResult.stdout ?? "").trim() === "ok";
  if (!hasTmux) return { tmux: false, claude: false };

  // Step 2: Check Claude in tmux
  const claudeExec = await client.devboxes.executeAsync(devboxId, {
    command: FIND_CLAUDE_PANE_SCRIPT,
  });
  const claudeResult = await client.devboxes.executions.awaitCompleted(
    devboxId,
    claudeExec.execution_id,
  );
  const output = (claudeResult.stdout ?? "").trim();
  const hasClaude = output !== "" && output !== "NO_CLAUDE";

  return { tmux: true, claude: hasClaude };
}

export async function tellThopter(
  name: string,
  message: string,
  opts: { interrupt?: boolean; noTail?: boolean },
): Promise<void> {
  const { id: devboxId } = await resolveDevbox(name);
  const client = getClient();

  // Pre-flight: check tmux and Claude
  const tmuxExec = await client.devboxes.executeAsync(devboxId, {
    command: CHECK_TMUX_SCRIPT,
  });
  const tmuxResult = await client.devboxes.executions.awaitCompleted(
    devboxId,
    tmuxExec.execution_id,
  );
  const hasTmux = (tmuxResult.stdout ?? "").trim() === "ok";

  if (!hasTmux) {
    console.error("No tmux session found on this thopter.");
    console.error("  The devbox may have been resumed without relaunching Claude.");
    console.error("  SSH in and start Claude: thopter ssh " + name);
    process.exit(1);
  }

  // Find the tmux pane running Claude
  const findExec = await client.devboxes.executeAsync(devboxId, {
    command: FIND_CLAUDE_PANE_SCRIPT,
  });
  const findResult = await client.devboxes.executions.awaitCompleted(
    devboxId,
    findExec.execution_id,
  );

  const paneTarget = (findResult.stdout ?? "").trim();
  if (!paneTarget || paneTarget === "NO_CLAUDE") {
    console.error("tmux is running but no Claude process found in any pane.");
    console.error("  Claude may have exited or not been started after resume.");
    console.error("  SSH in and start Claude: thopter ssh " + name);
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

  console.log("Message sent.");

  if (!opts.noTail) {
    console.log("Tailing transcript...\n");
    // Enter tail -f mode so the user sees Claude's response
    await tailTranscript(name, { follow: true, lines: 5 });
  }
}
