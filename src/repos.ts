/**
 * Predefined repos: interactive chooser and management helpers.
 */

import { createInterface } from "node:readline";
import { getRepos, setRepos, addRepo, type RepoConfig } from "./config.js";
import { printTable } from "./output.js";

function ask(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

function formatEntry(entry: RepoConfig): string {
  return entry.branch ? `${entry.repo} (${entry.branch})` : `${entry.repo} (any branch)`;
}

/** Result of the interactive mode chooser. */
export type ModeChoice =
  | { kind: "repo"; repo: string; branch: string }
  | { kind: "home"; checkouts: Array<{ repo: string; branch: string }> };

/**
 * Interactive mode chooser used by `thopter run` when no flags are given.
 * Shows "Home directory" as option 1, then predefined repos, then custom entry.
 */
export async function chooseMode(
  rl: ReturnType<typeof createInterface>,
): Promise<ModeChoice> {
  const repos = getRepos();

  console.log("\nWorking directory:");
  console.log("  1. Home directory (/home/user)");
  if (repos.length > 0) {
    for (let i = 0; i < repos.length; i++) {
      console.log(`  ${i + 2}. ${formatEntry(repos[i])}`);
    }
  }
  const customIdx = repos.length + 2;
  console.log(`  ${customIdx}. Enter a different repo`);

  const choice = await ask(rl, `\nChoose [1-${customIdx}]: `);
  const idx = parseInt(choice, 10);

  if (idx === 1) {
    // Home directory mode — optionally add repos to pre-checkout
    const checkouts = await askCheckouts(rl, repos);
    return { kind: "home", checkouts };
  }

  let repo: string;
  let branch: string | undefined;

  if (idx >= 2 && idx <= repos.length + 1) {
    const entry = repos[idx - 2];
    repo = entry.repo;
    branch = entry.branch;
  } else {
    // Custom entry or invalid input
    repo = await ask(rl, "Repository (owner/repo): ");
    if (!repo) {
      rl.close();
      console.error("Error: Repository is required.");
      process.exit(1);
    }
  }

  // If no pinned branch, prompt for one
  if (!branch) {
    const answer = await ask(rl, "Branch [main]: ");
    branch = answer || "main";
  }

  return { kind: "repo", repo, branch };
}

/**
 * Iterative loop to collect repos to pre-checkout in home-dir mode.
 * Shows predefined repos as numbered choices, allows custom entry.
 * Press Enter on empty line to finish.
 */
async function askCheckouts(
  rl: ReturnType<typeof createInterface>,
  repos: RepoConfig[],
): Promise<Array<{ repo: string; branch: string }>> {
  const checkouts: Array<{ repo: string; branch: string }> = [];
  const addedRepos = new Set<string>();

  console.log("\nPre-checkout repositories (optional, press Enter to skip):");

  while (true) {
    // Filter out already-added repos
    const available = repos.filter((r) => !addedRepos.has(r.repo));

    if (available.length > 0) {
      for (let i = 0; i < available.length; i++) {
        console.log(`  ${i + 1}. ${formatEntry(available[i])}`);
      }
      console.log(`  ${available.length + 1}. Enter a custom repo`);
    }

    const prompt = available.length > 0
      ? `Add repo [1-${available.length + 1}] or Enter to finish: `
      : "Repository (owner/repo) or Enter to finish: ";

    const choice = await ask(rl, prompt);
    if (!choice) break;

    let repo: string;
    let branch: string | undefined;
    const idx = parseInt(choice, 10);

    if (available.length > 0 && idx >= 1 && idx <= available.length) {
      const entry = available[idx - 1];
      repo = entry.repo;
      branch = entry.branch;
    } else if (available.length > 0 && idx === available.length + 1) {
      repo = await ask(rl, "Repository (owner/repo): ");
      if (!repo) continue;
    } else if (available.length === 0) {
      repo = choice;
    } else {
      continue; // invalid input
    }

    if (!branch) {
      const answer = await ask(rl, `Branch for ${repo} [main]: `);
      branch = answer || "main";
    }

    checkouts.push({ repo, branch });
    addedRepos.add(repo);

    // Show current checkout list
    console.log(`\n  Checkouts:`);
    for (const c of checkouts) {
      console.log(`    - ${c.repo} (${c.branch})`);
    }
    console.log();
  }

  return checkouts;
}

/**
 * Interactive repo chooser used by `thopter run` when --repo is not given.
 * Returns { repo, branch } with branch always resolved (never undefined).
 */
export async function chooseRepo(
  rl: ReturnType<typeof createInterface>,
): Promise<{ repo: string; branch: string }> {
  const repos = getRepos();

  let repo: string;
  let branch: string | undefined;

  if (repos.length > 0) {
    console.log("\nPredefined repos:");
    for (let i = 0; i < repos.length; i++) {
      console.log(`  ${i + 1}. ${formatEntry(repos[i])}`);
    }
    console.log(`  ${repos.length + 1}. Enter a different repo`);

    const choice = await ask(rl, `\nChoose [1-${repos.length + 1}]: `);
    const idx = parseInt(choice, 10);

    if (idx >= 1 && idx <= repos.length) {
      const entry = repos[idx - 1];
      repo = entry.repo;
      branch = entry.branch;
    } else {
      // "Enter a different repo" or invalid input
      repo = await ask(rl, "Repository (owner/repo): ");
      if (!repo) {
        rl.close();
        console.error("Error: Repository is required.");
        process.exit(1);
      }
    }
  } else {
    console.log("\nNo predefined repos. Tip: run `thopter repos add` for faster workflow.");
    repo = await ask(rl, "Repository (owner/repo): ");
    if (!repo) {
      rl.close();
      console.error("Error: Repository is required.");
      process.exit(1);
    }
  }

  // If no pinned branch, prompt for one
  if (!branch) {
    const answer = await ask(rl, "Branch [main]: ");
    branch = answer || "main";
  }

  return { repo, branch };
}

/**
 * Interactive add: prompts for owner/repo and optional branch.
 */
export async function addRepoInteractive(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const repo = await ask(rl, "Repository (owner/repo): ");
  if (!repo) {
    console.log("Cancelled.");
    rl.close();
    return;
  }

  const branch = await ask(rl, "Branch (enter to leave unpinned): ");
  rl.close();

  const entry: RepoConfig = { repo };
  if (branch) entry.branch = branch;

  addRepo(entry);
  console.log(`Added: ${formatEntry(entry)}`);
}

/**
 * Interactive edit: pick from numbered list, then edit fields.
 */
export async function editRepoInteractive(): Promise<void> {
  const repos = getRepos();
  if (repos.length === 0) {
    console.log("No predefined repos configured.");
    console.log("  Add one with: thopter repos add");
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log("\nPredefined repos:");
  for (let i = 0; i < repos.length; i++) {
    console.log(`  ${i + 1}. ${formatEntry(repos[i])}`);
  }

  const choice = await ask(rl, `\nEdit which? [1-${repos.length}]: `);
  const idx = parseInt(choice, 10);
  if (isNaN(idx) || idx < 1 || idx > repos.length) {
    console.log("Cancelled.");
    rl.close();
    return;
  }

  const entry = repos[idx - 1];
  const newRepo = await ask(rl, `Repository [${entry.repo}]: `);
  const branchDefault = entry.branch ?? "(unpinned)";
  const newBranch = await ask(rl, `Branch [${branchDefault}]: `);
  rl.close();

  if (newRepo) entry.repo = newRepo;
  if (newBranch) {
    entry.branch = newBranch === "none" ? undefined : newBranch;
  }

  repos[idx - 1] = entry;
  setRepos(repos);
  console.log(`Updated: ${formatEntry(entry)}`);
}

/**
 * Interactive remove: pick from numbered list.
 */
export async function removeRepoInteractive(): Promise<void> {
  const repos = getRepos();
  if (repos.length === 0) {
    console.log("No predefined repos configured.");
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log("\nPredefined repos:");
  for (let i = 0; i < repos.length; i++) {
    console.log(`  ${i + 1}. ${formatEntry(repos[i])}`);
  }

  const choice = await ask(rl, `\nRemove which? [1-${repos.length}]: `);
  rl.close();

  const idx = parseInt(choice, 10);
  if (isNaN(idx) || idx < 1 || idx > repos.length) {
    console.log("Cancelled.");
    return;
  }

  const removed = repos.splice(idx - 1, 1)[0];
  setRepos(repos);
  console.log(`Removed: ${formatEntry(removed)}`);
}

/**
 * Print the list of predefined repos as a table.
 */
export function listRepos(): void {
  const repos = getRepos();
  if (repos.length === 0) {
    console.log("No predefined repos configured.");
    console.log("  Add one with: thopter repos add");
    return;
  }

  console.log("Predefined repos:");
  printTable(
    ["#", "REPO", "BRANCH"],
    repos.map((r, i) => [
      String(i + 1),
      r.repo,
      r.branch ?? "(any)",
    ]),
  );
}
