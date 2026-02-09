/**
 * `thopter run` — create a devbox and launch Claude with a prompt.
 */

import { createInterface } from "node:readline";
import { createDevbox } from "./devbox.js";
import { getClient } from "./client.js";
import { getDefaultSnapshot } from "./config.js";
import { generateName } from "./names.js";

function buildRunPrompt(opts: {
  repo: string;
  branch?: string;
  userPrompt: string;
}): string {
  const branchInfo = opts.branch
    ? `You should work on the \`${opts.branch}\` branch.`
    : `Work on the repository's default branch.`;

  return `You are running on a thopter devbox. The repository \`${opts.repo}\` has been cloned to your home directory.

${branchInfo}

IMPORTANT: You can only push to branches prefixed with \`thopter/\`. Create a \`thopter/\` branch for your work. You cannot push to \`main\` or \`master\` directly. If you want to propose changes, push to a \`thopter/\` branch and create a pull request.

Your task:
${opts.userPrompt}`;
}

const REPO_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const BRANCH_PATTERN = /^[A-Za-z0-9/_.-]+$/;

function validateRepo(repo: string): string {
  const cleaned = repo.replace(/\.git$/, "");
  if (!REPO_PATTERN.test(cleaned)) {
    console.error(`Error: Invalid repository format '${repo}'. Expected: owner/repo`);
    process.exit(1);
  }
  return cleaned;
}

function validateBranch(branch: string): void {
  if (!BRANCH_PATTERN.test(branch)) {
    console.error(`Error: Invalid branch name '${branch}'.`);
    process.exit(1);
  }
}

function ask(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

export async function runThopter(opts: {
  prompt: string;
  repo?: string;
  branch?: string;
  name?: string;
  snapshot?: string;
  idleTimeout?: number;
}): Promise<void> {
  // Snapshot is required for run
  const snapshotId = opts.snapshot ?? getDefaultSnapshot();
  if (!snapshotId) {
    console.error("Error: No snapshot configured. thopter run requires a snapshot.");
    console.error("  Set a default: thopter snapshot default <name>");
    console.error("  Or specify one: thopter run --snapshot <id> ...");
    process.exit(1);
  }

  // Interactive prompting if --repo not given
  let repo = opts.repo;
  let branch = opts.branch;
  if (!repo) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    repo = await ask(rl, "Repository (owner/repo): ");
    if (!repo) {
      rl.close();
      console.error("Error: Repository is required.");
      process.exit(1);
    }
    if (!branch) {
      const answer = await ask(rl, "Branch (enter for default): ");
      if (answer) branch = answer;
    }
    rl.close();
  }

  // Validate repo and branch to prevent shell injection
  repo = validateRepo(repo);
  if (branch) validateBranch(branch);

  const repoName = repo.split("/")[1];
  const thopterName = opts.name ?? generateName();

  // Step 1: Create devbox from snapshot
  const devboxId = await createDevbox({
    name: thopterName,
    snapshotId,
    idleTimeout: opts.idleTimeout ? opts.idleTimeout * 60 : undefined,
  });

  const client = getClient();

  // Step 2: Clone repo and checkout branch
  const cloneScript = [
    `cd /home/user`,
    `if [ ! -d "${repoName}" ]; then git clone "https://github.com/${repo}.git"; fi`,
    `cd "${repoName}"`,
    `git fetch --all`,
    branch ? `git checkout "${branch}" && git pull origin "${branch}" || true` : "",
  ].filter(Boolean).join(" && ");

  console.log(`Cloning ${repo}...`);
  const cloneExec = await client.devboxes.executeAsync(devboxId, { command: cloneScript });
  const cloneResult = await client.devboxes.executions.awaitCompleted(devboxId, cloneExec.execution_id);
  if (cloneResult.stdout) process.stdout.write(cloneResult.stdout);
  if (cloneResult.stderr) process.stderr.write(cloneResult.stderr);

  if (cloneResult.exit_status && cloneResult.exit_status !== 0) {
    console.error(`\nError: Repository setup failed (exit ${cloneResult.exit_status}).`);
    console.error(`  The devbox '${thopterName}' is still running. Debug with: thopter ssh ${thopterName}`);
    process.exit(1);
  }

  // Step 3: Write prompt file and launch Claude in tmux
  const fullPrompt = buildRunPrompt({ repo, branch, userPrompt: opts.prompt });
  const promptPath = "/home/user/thopter-run-prompt.txt";
  await client.devboxes.writeFileContents(devboxId, {
    file_path: promptPath,
    contents: fullPrompt,
  });

  const launchCmd = `tmux kill-session -t claude 2>/dev/null || true; cd /home/user/${repoName} && tmux new-session -d -s claude 'claude --dangerously-skip-permissions "Read the file ${promptPath}. Print a brief summary of the instructions you read, then proceed to follow them."'`;
  await client.devboxes.executeAsync(devboxId, { command: launchCmd });

  // Step 4: Print summary
  console.log(`\nThopter '${thopterName}' running.`);
  console.log(`  Repo:    ${repo}${branch ? ` (branch: ${branch})` : ""}`);
  let promptPreview = opts.prompt;
  if (promptPreview.length > 80) promptPreview = promptPreview.slice(0, 77) + "...";
  console.log(`  Prompt:  ${promptPreview}`);
  console.log(`  SSH:     thopter ssh ${thopterName}`);
  console.log(`  Attach:  thopter attach ${thopterName}`);
}
