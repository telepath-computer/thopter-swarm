/**
 * `thopter run` — create a devbox and launch Claude with a prompt.
 */

import { createInterface } from "node:readline";
import { createDevbox } from "./devbox.js";
import { getClient } from "./client.js";
import { getDefaultSnapshot, getDefaultRepo, getDefaultBranch, getRepos } from "./config.js";
import { generateName } from "./names.js";
import { chooseMode } from "./repos.js";

// --- Types ---

export interface RepoCheckout {
  repo: string;
  branch: string;
}

export type RunMode =
  | { kind: "repo"; checkout: RepoCheckout }
  | { kind: "home"; checkouts: RepoCheckout[] };

// --- Prompt builders ---

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

function buildHomeDirPrompt(opts: {
  checkouts: RepoCheckout[];
  userPrompt: string;
}): string {
  let repoInfo = "";
  if (opts.checkouts.length > 0) {
    const repoList = opts.checkouts
      .map((c) => `- \`${c.repo}\` (branch: \`${c.branch}\`) — cloned to \`/home/user/${c.repo.split("/")[1]}\``)
      .join("\n");
    repoInfo = `\n\nThe following repositories have been pre-checked out:\n${repoList}`;
  }

  return `You are running on a thopter devbox. Your working directory is \`/home/user\`.${repoInfo}

IMPORTANT: You can only push to branches prefixed with \`thopter/\`. Create a \`thopter/\` branch for your work. You cannot push to \`main\` or \`master\` directly. If you want to propose changes, push to a \`thopter/\` branch and create a pull request.

Your task:
${opts.userPrompt}`;
}

// --- Validation ---

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

// --- Helpers ---

function ask(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

/**
 * Parse a `--checkout` arg in "owner/repo" or "owner/repo:branch" format.
 */
export function parseCheckoutArg(arg: string): RepoCheckout {
  const colonIdx = arg.indexOf(":");
  if (colonIdx === -1) {
    return { repo: arg, branch: "main" };
  }
  return { repo: arg.slice(0, colonIdx), branch: arg.slice(colonIdx + 1) };
}

/**
 * Resolve CLI flags into a RunMode, or null if interactive prompting is needed.
 */
function resolveMode(opts: {
  repo?: string;
  branch?: string;
  homeDir?: boolean;
  checkout?: string[];
}): RunMode | null {
  if (opts.homeDir && opts.repo) {
    console.error("Error: --home and --repo are mutually exclusive.");
    process.exit(1);
  }

  if (opts.homeDir) {
    const checkouts = (opts.checkout ?? []).map(parseCheckoutArg);
    return { kind: "home", checkouts };
  }

  if (opts.repo) {
    return {
      kind: "repo",
      checkout: { repo: opts.repo, branch: opts.branch ?? "main" },
    };
  }

  // No explicit flags — need interactive prompting
  return null;
}

// --- Clone helper ---

async function cloneRepos(
  devboxId: string,
  checkouts: RepoCheckout[],
  thopterName: string,
): Promise<void> {
  const client = getClient();
  for (const checkout of checkouts) {
    const repo = validateRepo(checkout.repo);
    validateBranch(checkout.branch);
    const repoName = repo.split("/")[1];

    const cloneScript = [
      `cd /home/user`,
      `if [ ! -d "${repoName}" ]; then git clone "https://github.com/${repo}.git"; fi`,
      `cd "${repoName}"`,
      `git fetch origin`,
      `git checkout "${checkout.branch}"`,
      `git reset --hard "origin/${checkout.branch}"`,
    ].join(" && ");

    console.log(`Cloning ${repo}...`);
    const cloneExec = await client.devboxes.executeAsync(devboxId, { command: cloneScript });
    const cloneResult = await client.devboxes.executions.awaitCompleted(devboxId, cloneExec.execution_id);
    if (cloneResult.stdout) process.stdout.write(cloneResult.stdout);
    if (cloneResult.stderr) process.stderr.write(cloneResult.stderr);

    if (cloneResult.exit_status && cloneResult.exit_status !== 0) {
      console.error(`\nError: Repository setup failed for ${repo} (exit ${cloneResult.exit_status}).`);
      console.error(`  The devbox '${thopterName}' is still running. Debug with: thopter ssh ${thopterName}`);
      process.exit(1);
    }
  }
}

// --- Main entry point ---

export async function runThopter(opts: {
  prompt: string;
  repo?: string;
  branch?: string;
  homeDir?: boolean;
  checkout?: string[];
  name?: string;
  snapshot?: string;
  keepAlive?: number;
}): Promise<void> {
  // Snapshot is required for run
  const snapshotId = opts.snapshot ?? getDefaultSnapshot();
  if (!snapshotId) {
    console.error("Error: No snapshot configured. thopter run requires a snapshot.");
    console.error("  Set a default: thopter snapshot default <name>");
    console.error("  Or specify one: thopter run --snapshot <id> ...");
    process.exit(1);
  }

  // Resolve mode from flags or interactive prompt
  let mode = resolveMode(opts);

  if (!mode) {
    const repos = getRepos();
    if (repos.length > 0) {
      // Use the mode chooser (home dir + predefined repos + custom)
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const chosen = await chooseMode(rl);
      rl.close();

      if (chosen.kind === "home") {
        mode = { kind: "home", checkouts: chosen.checkouts };
      } else {
        mode = { kind: "repo", checkout: { repo: chosen.repo, branch: chosen.branch } };
      }
    } else {
      // Fall back to defaultRepo/defaultBranch for existing users without repos list
      const configDefaultRepo = getDefaultRepo();
      const configDefaultBranch = getDefaultBranch();
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const repoPrompt = configDefaultRepo
        ? `Repository (owner/repo) [${configDefaultRepo}]: `
        : "Repository (owner/repo): ";
      let repo = await ask(rl, repoPrompt);
      if (!repo && configDefaultRepo) {
        repo = configDefaultRepo;
        console.log(`  Using default repo: ${repo}`);
      }
      if (!repo) {
        rl.close();
        console.error("Error: Repository is required.");
        console.error("  Tip: set a default with: thopter config set defaultRepo owner/repo");
        process.exit(1);
      }
      let branch = opts.branch;
      if (!branch) {
        const branchPrompt = configDefaultBranch
          ? `Branch [${configDefaultBranch}]: `
          : "Branch [main]: ";
        const answer = await ask(rl, branchPrompt);
        if (answer) {
          branch = answer;
        } else if (configDefaultBranch) {
          branch = configDefaultBranch;
          console.log(`  Using default branch: ${branch}`);
        }
      }
      rl.close();
      if (!branch) branch = "main";
      mode = { kind: "repo", checkout: { repo, branch } };
    }
  }

  // Validate all checkouts
  const allCheckouts = mode.kind === "repo" ? [mode.checkout] : mode.checkouts;
  for (const c of allCheckouts) {
    c.repo = validateRepo(c.repo);
    validateBranch(c.branch);
  }

  const thopterName = opts.name ?? generateName();

  // Step 1: Create devbox from snapshot
  const devboxId = await createDevbox({
    name: thopterName,
    snapshotId,
    keepAlive: opts.keepAlive ? opts.keepAlive * 60 : undefined,
  });

  // Step 2: Clone repos
  if (allCheckouts.length > 0) {
    await cloneRepos(devboxId, allCheckouts, thopterName);
  }

  // Step 3: Write prompt file and launch Claude in tmux
  const client = getClient();
  let fullPrompt: string;
  let workingDir: string;

  if (mode.kind === "repo") {
    const repoName = mode.checkout.repo.split("/")[1];
    workingDir = `/home/user/${repoName}`;
    fullPrompt = buildRunPrompt({
      repo: mode.checkout.repo,
      branch: mode.checkout.branch,
      userPrompt: opts.prompt,
    });
  } else {
    workingDir = "/home/user";
    fullPrompt = buildHomeDirPrompt({
      checkouts: mode.checkouts,
      userPrompt: opts.prompt,
    });
  }

  const promptPath = "/home/user/thopter-run-prompt.txt";
  await client.devboxes.writeFileContents(devboxId, {
    file_path: promptPath,
    contents: fullPrompt,
  });

  // Write a launcher script that runs claude under bash. When claude exits,
  // `exec bash -l` replaces the script process with a fresh login shell so the
  // tmux session stays alive (see issue #137).
  const launcherPath = "/home/user/thopter-launch.sh";
  await client.devboxes.writeFileContents(devboxId, {
    file_path: launcherPath,
    contents: [
      `#!/bin/bash -l`,
      `cd ${workingDir}`,
      `claude --dangerously-skip-permissions "Read the file ${promptPath}. Print a brief summary of the instructions you read, then proceed to follow them."`,
      `exec bash -l`,
    ].join("\n"),
  });

  const launchCmd = `tmux kill-server 2>/dev/null || true; chmod +x ${launcherPath} && tmux new-session -d ${launcherPath}`;
  await client.devboxes.executeAsync(devboxId, { command: launchCmd });

  // Step 4: Print summary
  console.log(`\nThopter '${thopterName}' running.`);
  if (mode.kind === "repo") {
    console.log(`  Repo:    ${mode.checkout.repo} (branch: ${mode.checkout.branch})`);
  } else {
    console.log(`  Mode:    Home directory`);
    if (mode.checkouts.length > 0) {
      for (const c of mode.checkouts) {
        console.log(`  Repo:    ${c.repo} (branch: ${c.branch})`);
      }
    }
  }
  let promptPreview = opts.prompt;
  if (promptPreview.length > 80) promptPreview = promptPreview.slice(0, 77) + "...";
  console.log(`  Prompt:  ${promptPreview}`);
  console.log(`  SSH:     thopter ssh ${thopterName}`);
  console.log(`  Attach:  thopter attach ${thopterName}`);
}
