/**
 * Devbox lifecycle: create, list, destroy, ssh, exec, snapshot, fork.
 */

import { execFileSync, execSync, spawn, spawnSync } from "node:child_process";
import { copyFileSync, readFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { getClient } from "./client.js";
import { printTable } from "./output.js";
import { isDigitalOceanProvider } from "./provider.js";
import {
  ensureDOFingerprintForLocalRSAPub,
  getLocalRSAPrivateKeyPath,
} from "./do-ssh-key.js";
import {
  MANAGED_BY_KEY,
  MANAGED_BY_VALUE,
  NAME_KEY,
  OWNER_KEY,
  DEFAULT_RESOURCE_SIZE,
  DEFAULT_KEEP_ALIVE_SECONDS,
  getEnvVars,
  escapeEnvValue,
  getDefaultSnapshot,
  getClaudeMdPath,
  getUploads,
  getStopNotifications,
  getStopNotificationQuietPeriod,
} from "./config.js";

/** Tool installation script that runs inside the devbox on first create. */
const INIT_SCRIPT = `
set -euo pipefail

THOPTER_INIT_LOG="$HOME/thopter-init.log"
THOPTER_INIT_WARN="$HOME/.thopter-init-warnings"
mkdir -p "$(dirname "$THOPTER_INIT_LOG")"
: > "$THOPTER_INIT_WARN"
exec > >(tee -a "$THOPTER_INIT_LOG") 2>&1

redis_safe() {
  if [ -z "\${THOPTER_REDIS_URL:-}" ] || [ -z "\${THOPTER_NAME:-}" ]; then
    return 0
  fi
  redis-cli --tls -u "$THOPTER_REDIS_URL" "$@" >/dev/null 2>&1 || true
}

progress() {
  local stage="$1"
  local message="$2"
  local now
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "[thopter-init][$stage] $message"
  redis_safe SETEX "thopter:$THOPTER_NAME:create:stage" 3600 "$stage"
  redis_safe SETEX "thopter:$THOPTER_NAME:create:message" 3600 "$message"
  redis_safe SETEX "thopter:$THOPTER_NAME:create:timestamp" 3600 "$now"
  redis_safe RPUSH "thopter:$THOPTER_NAME:create:logs" "$now [$stage] $message"
  redis_safe LTRIM "thopter:$THOPTER_NAME:create:logs" -200 -1
  redis_safe EXPIRE "thopter:$THOPTER_NAME:create:logs" 3600
}

echo "[thopter-init] starting at $(date -Is)"
progress "start" "thopter cloud-init started"

run_optional() {
  local label="$1"
  shift
  progress "optional:$label" "starting optional step"
  if "$@"; then
    echo "[thopter-init] OK(optional): $label"
    progress "optional:$label" "optional step complete"
    return 0
  fi
  echo "[thopter-init] WARN(optional): $label"
  echo "$label" >> "$THOPTER_INIT_WARN"
  progress "optional:$label" "optional step failed (continuing)"
  return 0
}

# Install essential tools
progress "apt" "installing base packages"
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg 2>/dev/null && sudo chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
sudo apt-get update -qq && sudo apt-get install -y -qq git tmux wget curl jq redis-tools cron ripgrep fd-find htop tree unzip bat less strace lsof ncdu dnsutils net-tools iproute2 xvfb xauth bash-completion gh > /dev/null
sudo /usr/sbin/cron 2>/dev/null || true

# Install Neovim (latest stable, NvChad requires 0.10+)
progress "nvim" "installing neovim"
NVIM_ARCH=$(uname -m | sed 's/aarch64/arm64/;s/x86_64/x86_64/')
curl -fsSL "https://github.com/neovim/neovim/releases/latest/download/nvim-linux-\${NVIM_ARCH}.tar.gz" | sudo tar xz -C /opt
sudo ln -sf /opt/nvim-linux-\${NVIM_ARCH}/bin/nvim /usr/local/bin/nvim

# Install Node.js via NVM (Node 22) and make it default
progress "node" "installing node via nvm"
export NVM_DIR="$HOME/.nvm"
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
. "$NVM_DIR/nvm.sh"
nvm install 22
nvm alias default 22
nvm use 22
NODE_BIN_DIR="$NVM_DIR/versions/node/$(nvm version 22)/bin"
sudo ln -sf "$NODE_BIN_DIR/node" /usr/local/bin/node
sudo ln -sf "$NODE_BIN_DIR/npm" /usr/local/bin/npm
sudo ln -sf "$NODE_BIN_DIR/npx" /usr/local/bin/npx

# Ensure canonical working directory exists for automated runs.
mkdir -p "$HOME/workspace"

# Install NvChad starter (fresh installs only)
if [ ! -d ~/.config/nvim ]; then
  run_optional "clone NvChad starter" git clone https://github.com/NvChad/starter ~/.config/nvim
fi

# Install Claude Code with retries and health check
progress "claude" "installing claude code"
export PATH="$HOME/.local/bin:$PATH"
install_claude() {
  local attempts=3
  local i=1
  while [ "$i" -le "$attempts" ]; do
    # Clear previous installer artifacts/payloads so retries always start clean.
    rm -f "$HOME/.claude/downloads/claude-"* 2>/dev/null || true
    rm -f "$HOME/.local/bin/claude" 2>/dev/null || true
    rm -rf "$HOME/.local/share/claude" 2>/dev/null || true
    hash -r || true
    if curl -fsSL https://claude.ai/install.sh | bash; then
      if command -v claude >/dev/null 2>&1; then
        CLAUDE_BIN="$(command -v claude)"
        if [ -x "$CLAUDE_BIN" ] && "$CLAUDE_BIN" --version >/dev/null 2>&1; then
          return 0
        fi
      fi
      if [ -x "$HOME/.local/bin/claude" ] && "$HOME/.local/bin/claude" --version >/dev/null 2>&1; then
        return 0
      fi
    fi
    echo "Claude install/verify failed (attempt $i/$attempts), retrying..."
    sleep 5
    i=$((i + 1))
  done
  echo "ERROR: Claude installation failed after $attempts attempts."
  return 1
}
install_claude

# Install OpenAI Codex
progress "codex" "installing openai codex"
run_optional "install @openai/codex" npm i -g @openai/codex

# Install Runloop CLI (for rli devbox ssh from inside devboxes)
progress "rl-cli" "installing runloop cli"
run_optional "install @runloop/rl-cli" npm i -g @runloop/rl-cli

# Install git-delta pager
progress "git-delta" "installing git-delta"
DELTA_ARCH=$(dpkg --print-architecture)
run_optional "install git-delta" bash -lc "curl -fL https://github.com/dandavison/delta/releases/download/0.18.2/git-delta_0.18.2_\${DELTA_ARCH}.deb -o /tmp/git-delta.deb && sudo PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin dpkg -i /tmp/git-delta.deb && rm /tmp/git-delta.deb && git config --global core.pager delta && git config --global interactive.diffFilter 'delta --color-only' && git config --global delta.side-by-side true && git config --global delta.navigate true && git config --global delta.line-numbers true"

# Install starship prompt (non-interactive)
progress "starship" "installing starship"
run_optional "install starship" bash -lc "curl -sS https://starship.rs/install.sh | sh -s -- -y -b $HOME/.local/bin"

# Append thopter bashrc block (idempotent — skip if already present)
if ! grep -q '# --- thopter ---' ~/.bashrc 2>/dev/null; then
cat >> ~/.bashrc << 'THOPTERRC'

# --- thopter ---
export PATH="$HOME/.local/bin:$PATH"
alias yolo-claude="claude --dangerously-skip-permissions"
alias attach-or-launch-tmux-cc="tmux -CC attach || tmux -CC"
. ~/.thopter-env
[ -f /usr/share/bash-completion/bash_completion ] && . /usr/share/bash-completion/bash_completion
if [ "$TERM" != "dumb" ]; then
  eval "$(starship init bash)"
fi
# --- end thopter ---
THOPTERRC
fi

echo "[thopter-init] complete at $(date -Is)"
progress "done" "thopter cloud-init completed"
if [ -s "$THOPTER_INIT_WARN" ]; then
  echo "[thopter-init] completed with optional warnings:"
  cat "$THOPTER_INIT_WARN"
fi
touch "$HOME/.thopter-init-complete"
`.trim();

/** Fast reconcile script for snapshot-based boots (no full reinstall). */
const SNAPSHOT_INIT_SCRIPT = `
set -euo pipefail

THOPTER_INIT_LOG="$HOME/thopter-init.log"
THOPTER_INIT_WARN="$HOME/.thopter-init-warnings"
mkdir -p "$(dirname "$THOPTER_INIT_LOG")"
: > "$THOPTER_INIT_WARN"
exec > >(tee -a "$THOPTER_INIT_LOG") 2>&1

redis_safe() {
  if [ -z "\${THOPTER_REDIS_URL:-}" ] || [ -z "\${THOPTER_NAME:-}" ]; then
    return 0
  fi
  redis-cli --tls -u "$THOPTER_REDIS_URL" "$@" >/dev/null 2>&1 || true
}

progress() {
  local stage="$1"
  local message="$2"
  local now
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "[thopter-init][$stage] $message"
  redis_safe SETEX "thopter:$THOPTER_NAME:create:stage" 3600 "$stage"
  redis_safe SETEX "thopter:$THOPTER_NAME:create:message" 3600 "$message"
  redis_safe SETEX "thopter:$THOPTER_NAME:create:timestamp" 3600 "$now"
  redis_safe RPUSH "thopter:$THOPTER_NAME:create:logs" "$now [$stage] $message"
  redis_safe LTRIM "thopter:$THOPTER_NAME:create:logs" -200 -1
  redis_safe EXPIRE "thopter:$THOPTER_NAME:create:logs" 3600
}

echo "[thopter-init] snapshot reconcile starting at $(date -Is)"
progress "start" "thopter cloud-init started (snapshot mode)"

progress "snapshot-reconcile" "ensuring baseline runtime state"
mkdir -p "$HOME/workspace"
sudo /usr/sbin/cron 2>/dev/null || true
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
hash -r || true

if ! command -v node >/dev/null 2>&1 || ! node -v >/dev/null 2>&1; then
  echo "ERROR: node is missing or unhealthy in snapshot image."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1 || ! npm -v >/dev/null 2>&1; then
  echo "ERROR: npm is missing or unhealthy in snapshot image."
  exit 1
fi

if ! command -v claude >/dev/null 2>&1 || ! claude --version >/dev/null 2>&1; then
  echo "ERROR: claude is missing or unhealthy in snapshot image."
  exit 1
fi

echo "[thopter-init] snapshot reconcile complete at $(date -Is)"
progress "done" "thopter cloud-init completed (snapshot mode)"
touch "$HOME/.thopter-init-complete"
`.trim();

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = resolve(__dirname, "..", "scripts");

function readScript(name: string): string {
  return readFileSync(resolve(SCRIPTS_DIR, name), "utf-8");
}

function thopterBashrcEnsureCommand(): string {
  const block = [
    "",
    "# --- thopter ---",
    "export PATH=\"$HOME/.local/bin:$PATH\"",
    "alias yolo-claude=\"claude --dangerously-skip-permissions\"",
    "alias attach-or-launch-tmux-cc=\"tmux -CC attach || tmux -CC\"",
    ". ~/.thopter-env",
    "[ -f /usr/share/bash-completion/bash_completion ] && . /usr/share/bash-completion/bash_completion",
    "if [ \"$TERM\" != \"dumb\" ]; then",
    "  eval \"$(starship init bash)\"",
    "fi",
    "# --- end thopter ---",
    "",
  ].join("\\n");
  return `grep -q '# --- thopter ---' ~/.bashrc 2>/dev/null || printf '%b' '${block}' >> ~/.bashrc`;
}

function requireRunloopFeature(feature: string): void {
  if (isDigitalOceanProvider()) {
    throw new Error(
      `${feature} is not implemented in DigitalOcean mode yet.`,
    );
  }
}

const DO_MANAGED_TAG = "managed-by:thopter";
const DO_DEFAULT_IMAGE = "ubuntu-24-04-x64";
const DO_DEFAULT_SIZE = "s-4vcpu-8gb";
const DO_DEFAULT_REGION = "sfo3";

interface DODroplet {
  id: string;
  name: string;
  status: string;
  tags: string[];
}

interface DOSnapshot {
  id: string;
  name: string;
  sourceId: string;
  createdAt: string;
}

type LogFn = (message: string) => void;

function makeTimedLogger(startMs: number): LogFn {
  return (message: string) => {
    const ts = new Date().toISOString();
    const elapsedSeconds = ((Date.now() - startMs) / 1000).toFixed(1);
    console.log(`[${ts} +${elapsedSeconds}s] ${message}`);
  };
}

function printPostCreateChecklist(log: LogFn): void {
  log("Recommended next steps:");
  log("  1. SSH in and enter the workspace: cd ~/workspace");
  log("  2. Launch Claude in YOLO mode (e.g. yolo-claude), accept trust/permission dialogs, authenticate, then verify with a short back-and-forth prompt.");
  log("  3. In ~/workspace, launch Codex in YOLO mode, authenticate, verify it responds, then quit.");
  log("  4. Clone/check out your common repos under ~/workspace and verify access works.");
  log("  5. Run npm installs (or other dependency installs) for your day-to-day repos.");
}

export interface RemoteCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function doctlJson(args: string[]): unknown {
  const raw = execFileSync("doctl", [...args, "-o", "json"], { encoding: "utf-8" });
  return JSON.parse(raw);
}

function normalizeDODroplet(raw: unknown): DODroplet {
  const obj = raw as Record<string, unknown>;
  const idValue = obj.id ?? obj.ID;
  const nameValue = obj.name ?? obj.Name;
  const statusValue = obj.status ?? obj.Status;
  const tagsValue = obj.tags ?? obj.Tags;
  const tags = Array.isArray(tagsValue)
    ? tagsValue.filter((t): t is string => typeof t === "string")
    : [];
  return {
    id: String(idValue ?? ""),
    name: String(nameValue ?? ""),
    status: String(statusValue ?? ""),
    tags,
  };
}

function parseDOTagValue(tags: string[], key: string): string | undefined {
  const prefix = `${key}:`;
  const tag = tags.find((t) => t.startsWith(prefix));
  return tag ? tag.slice(prefix.length) : undefined;
}

function coerceTagValue(input: string): string {
  const lowered = input.toLowerCase();
  const whitespace = lowered.replace(/\s+/g, "-");
  const sanitized = whitespace.replace(/[^a-z0-9:_-]/g, "-");
  const collapsed = sanitized.replace(/-+/g, "-");
  const trimmed = collapsed.replace(/^[-:]+|[-:]+$/g, "");
  const out = trimmed || "unknown";
  return out.slice(0, 220);
}

function coerceHostname(input: string): string {
  const base = coerceTagValue(input).replace(/[:_]/g, "-");
  const trimmed = base.replace(/^-+|-+$/g, "");
  const host = trimmed || "thopter";
  return host.slice(0, 63);
}

function mapDOStatus(status: string): string {
  switch (status) {
    case "active":
      return "running";
    case "off":
      return "suspended";
    case "new":
      return "provisioning";
    case "archive":
      return "shutdown";
    default:
      return status || "unknown";
  }
}

function listManagedDODroplets(): DODroplet[] {
  const raw = doctlJson([
    "compute",
    "droplet",
    "list",
    "--tag-name",
    DO_MANAGED_TAG,
  ]);
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeDODroplet);
}

function normalizeDOSnapshot(raw: unknown): DOSnapshot {
  const obj = raw as Record<string, unknown>;
  return {
    id: String(obj.id ?? obj.ID ?? ""),
    name: String(obj.name ?? obj.Name ?? ""),
    sourceId: String(obj.resource_id ?? obj.ResourceID ?? ""),
    createdAt: String(obj.created_at ?? obj.CreatedAt ?? ""),
  };
}

function listDOSnapshots(): DOSnapshot[] {
  const raw = doctlJson(["compute", "snapshot", "list"]);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s) => s as Record<string, unknown>)
    .filter((s) => String(s.resource_type ?? s.ResourceType ?? "") === "droplet")
    .map(normalizeDOSnapshot);
}

async function waitForDOSnapshotIdByName(name: string, maxAttempts = 30): Promise<string> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const matches = listDOSnapshots().filter((s) => s.name === name);
    if (matches.length === 1) return matches[0].id;
    if (matches.length > 1) {
      throw new Error(
        `Ambiguous: ${matches.length} snapshots named '${name}'. Use snapshot ID instead.`,
      );
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Snapshot '${name}' not found after creation wait.`);
}

function getDODropletPublicIPv4(dropletId: string): string {
  const raw = doctlJson(["compute", "droplet", "get", dropletId]);
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`Could not load droplet ${dropletId} details from DigitalOcean.`);
  }
  const obj = raw[0] as Record<string, unknown>;
  const networks = (obj.networks ?? obj.Networks) as Record<string, unknown> | undefined;
  const v4 = (networks?.v4 ?? networks?.V4) as unknown;
  if (!Array.isArray(v4)) {
    throw new Error(`Droplet ${dropletId} has no IPv4 network data.`);
  }
  for (const rowRaw of v4) {
    const row = rowRaw as Record<string, unknown>;
    if (String(row.type ?? row.Type ?? "") === "public") {
      return String(row.ip_address ?? row.IPAddress ?? "");
    }
  }
  throw new Error(`Droplet ${dropletId} has no public IPv4 address.`);
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function doExecSync(
  dropletId: string,
  command: string,
  opts?: { user?: string; retryMax?: number; inheritIO?: boolean },
): { stdout: string; stderr: string; status: number } {
  const ip = getDODropletPublicIPv4(dropletId);
  const wrappedCommand = [
    "export PATH=\"$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH\"",
    "hash -r || true",
    command,
  ].join("; ");
  const args = [
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=/dev/null",
    "-o", "ConnectTimeout=5",
    "-i", getLocalRSAPrivateKeyPath(),
    `${opts?.user ?? "user"}@${ip}`,
    `bash -lc ${shellSingleQuote(wrappedCommand)}`,
  ];
  const result = spawnSync("ssh", args, {
    encoding: "utf-8",
    stdio: opts?.inheritIO ? "inherit" : "pipe",
  });
  return {
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
    status: result.status ?? 0,
  };
}

function doWriteFile(
  dropletId: string,
  remotePath: string,
  contents: string,
  opts?: { user?: string; retryMax?: number },
): void {
  const b64 = Buffer.from(contents, "utf-8").toString("base64");
  const pathQuoted = shellSingleQuote(remotePath);
  const b64Quoted = shellSingleQuote(b64);
  const command = [
    `mkdir -p "$(dirname ${pathQuoted})"`,
    `printf '%s' ${b64Quoted} | base64 -d > ${pathQuoted}`,
  ].join(" && ");
  const result = doExecSync(dropletId, command, opts);
  if (result.status !== 0) {
    throw new Error(result.stderr || `failed to write ${remotePath}`);
  }
}

function doScpToDroplet(
  dropletId: string,
  localPath: string,
  remotePath: string,
  opts?: { user?: string },
): void {
  const ip = getDODropletPublicIPv4(dropletId);
  const args = [
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=/dev/null",
    "-o", "ConnectTimeout=5",
    "-i", getLocalRSAPrivateKeyPath(),
    localPath,
    `${opts?.user ?? "user"}@${ip}:${remotePath}`,
  ];
  const result = spawnSync("scp", args, { encoding: "utf-8" });
  if ((result.status ?? 1) !== 0) {
    throw new Error(result.stderr || `failed to scp ${localPath} to ${remotePath}`);
  }
}

type DOAssetBundleEntry =
  | { archivePath: string; contents: string }
  | { archivePath: string; sourcePath: string };

function createDOAssetsBundle(files: DOAssetBundleEntry[]): {
  tarPath: string;
  cleanup: () => void;
} {
  const root = mkdtempSync(join(tmpdir(), "thopter-assets-"));
  const stage = join(root, "stage");
  mkdirSync(stage, { recursive: true });

  for (const file of files) {
    const rel = file.archivePath.replace(/^\/+/, "");
    const dest = join(stage, rel);
    mkdirSync(dirname(dest), { recursive: true });
    if ("sourcePath" in file) {
      copyFileSync(file.sourcePath, dest);
    } else {
      writeFileSync(dest, file.contents, "utf-8");
    }
  }

  const tarPath = join(root, "assets.tgz");
  execFileSync("tar", ["-czf", tarPath, "-C", stage, "."], {
    stdio: "pipe",
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
  return {
    tarPath,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function archivePathForDORemote(remotePath: string): string | null {
  if (remotePath.startsWith("/home/user/")) {
    return `home/${remotePath.slice("/home/user/".length)}`;
  }
  if (remotePath === "/home/user") {
    return "home";
  }
  if (remotePath.startsWith("/tmp/")) {
    return `tmp/${remotePath.slice("/tmp/".length)}`;
  }
  if (remotePath === "/tmp") {
    return "tmp";
  }
  return null;
}

function uploadBundleToDO(
  dropletId: string,
  files: DOAssetBundleEntry[],
  log: LogFn,
): void {
  const bundle = createDOAssetsBundle(files);
  try {
    log(`  Packaging ${files.length} assets...`);
    log("  Uploading assets bundle...");
    doScpToDroplet(dropletId, bundle.tarPath, "/tmp/thopter-assets.tgz");
    log("  Extracting assets bundle...");
    const extract = doExecSync(
      dropletId,
      [
        "rm -rf /home/user/.thopter-staging",
        "mkdir -p /home/user/.thopter-staging",
        "tar xzf /tmp/thopter-assets.tgz -C /home/user/.thopter-staging --no-same-owner --no-same-permissions --warning=no-unknown-keyword",
        "mkdir -p /home/user/.claude/hooks /home/user/.codex /home/user/.config/nvim/lua/plugins /home/user/.config/starship",
        "cp -R /home/user/.thopter-staging/home/. /home/user/ 2>/dev/null || true",
        "cp -R /home/user/.thopter-staging/tmp/. /tmp/ 2>/dev/null || true",
        "rm -rf /home/user/.thopter-staging /tmp/thopter-assets.tgz",
      ].join(" && "),
      { retryMax: 60 },
    );
    if (extract.status !== 0) {
      throw new Error(extract.stderr || "failed to extract assets bundle");
    }
  } finally {
    bundle.cleanup();
  }
}

function doUploadFileToRemotePath(
  dropletId: string,
  localPath: string,
  remotePath: string,
  opts?: { user?: string },
): void {
  const tempName = `/tmp/thopter-upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  doScpToDroplet(dropletId, localPath, tempName, opts);
  const remoteQuoted = shellSingleQuote(remotePath);
  const tmpQuoted = shellSingleQuote(tempName);
  const cmd = [
    `mkdir -p "$(dirname ${remoteQuoted})"`,
    `mv ${tmpQuoted} ${remoteQuoted}`,
  ].join(" && ");
  const result = doExecSync(dropletId, cmd, { user: opts?.user });
  if (result.status !== 0) {
    throw new Error(result.stderr || `failed to place upload at ${remotePath}`);
  }
}

async function waitForDOSSHReady(
  dropletId: string,
  log: LogFn,
  user = "user",
  maxAttempts = 120,
): Promise<void> {
  log(`Waiting for SSH (${user})...`);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const probe = doExecSync(dropletId, "true", {
      user,
      retryMax: 1,
    });
    if (probe.status === 0) {
      log(`SSH ready after ${attempt} attempt${attempt === 1 ? "" : "s"}.`);
      return;
    }
    if (attempt % 10 === 0) {
      log(`Waiting for SSH (${user})... attempt ${attempt}/${maxAttempts}`);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`Timed out waiting for SSH (${user}) on droplet ${dropletId}.`);
}

function getDOCloudInitDiagnostics(dropletId: string): string {
  const diagnostics = doExecSync(
    dropletId,
    [
      "echo '--- cloud-init status --long ---'",
      "sudo cloud-init status --long || true",
      "echo '--- /var/log/cloud-init-output.log (tail 120) ---'",
      "sudo tail -n 120 /var/log/cloud-init-output.log || true",
      "echo '--- /var/log/cloud-init.log (tail 120) ---'",
      "sudo tail -n 120 /var/log/cloud-init.log || true",
      "echo '--- /home/user/thopter-init.log (tail 120) ---'",
      "tail -n 120 /home/user/thopter-init.log || true",
      "echo '--- /home/user/.thopter-init-warnings ---'",
      "cat /home/user/.thopter-init-warnings || true",
    ].join("; "),
    { user: "user", retryMax: 1 },
  );
  return [diagnostics.stdout, diagnostics.stderr].filter(Boolean).join("\n").trim();
}

async function startDOCreateRedisProgressLoop(
  log: LogFn,
  thopterName?: string,
  redisUrl?: string,
): Promise<() => Promise<void>> {
  if (!thopterName || !redisUrl) {
    return async () => {};
  }

  const { Redis } = await import("ioredis");
  const needsTls = redisUrl.startsWith("redis://");
  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    ...(needsTls ? { tls: {} } : {}),
    connectTimeout: 1500,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: () => 1000,
    reconnectOnError: () => false,
  });
  redis.on("error", () => {
    // Best-effort progress stream only.
  });

  const key = `thopter:${thopterName}:create:logs`;
  let stopped = false;
  let cursor = 0;
  let loop: Promise<void> | null = null;

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  loop = (async () => {
    while (!stopped) {
      try {
        if (redis.status !== "ready") {
          await redis.connect();
        }
        const len = await redis.llen(key);
        if (cursor > len) cursor = Math.max(0, len - 50);
        if (len > cursor) {
          const lines = await redis.lrange(key, cursor, len - 1);
          for (const line of lines) {
            log(`cloud-init log: ${line}`);
          }
          cursor = len;
        }
      } catch {
        // Keep trying; Redis telemetry must never block create.
      }
      await sleep(1000);
    }
  })();

  return async () => {
    stopped = true;
    if (loop) {
      try {
        await loop;
      } catch {
        // Ignore shutdown errors from best-effort loop.
      }
    }
    try {
      redis.disconnect();
    } catch {
      // Ignore close errors.
    }
  };
}

async function waitForDOInitComplete(
  dropletId: string,
  log: LogFn,
): Promise<void> {
  log("Waiting for cloud-init to finish...");
  const maxAttempts = 72; // 6 minutes at 5s intervals

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const statusResult = doExecSync(
      dropletId,
      "sudo cloud-init status --long || true",
      { user: "user", retryMax: 1 },
    );
    const statusText = `${statusResult.stdout}\n${statusResult.stderr}`;
    const statusMatch = statusText.match(/status:\s*([a-zA-Z-]+)/);
    const status = statusMatch ? statusMatch[1].toLowerCase() : "unknown";

    if (status === "done") {
      const marker = doExecSync(
        dropletId,
        "[ -f /home/user/.thopter-init-complete ] && command -v node >/dev/null 2>&1 && command -v claude >/dev/null 2>&1",
        { user: "user", retryMax: 1 },
      );
      if (marker.status === 0) {
        log("cloud-init finished and thopter init marker is present.");
        return;
      }
      const diag = getDOCloudInitDiagnostics(dropletId);
      throw new Error(
        `Droplet init failed: cloud-init completed but required tools/marker were missing.\n${diag}`,
      );
    }

    if (status === "error") {
      const diag = getDOCloudInitDiagnostics(dropletId);
      throw new Error(
        `Droplet init failed: cloud-init reported an error.\n${diag}`,
      );
    }

    if (attempt % 6 === 0) {
      log(`Waiting for cloud-init... attempt ${attempt}/${maxAttempts} (status: ${status})`);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }

  const diag = getDOCloudInitDiagnostics(dropletId);
  throw new Error(
    `Droplet init timed out after 6 minutes.\n${diag}`,
  );
}

function installThopterScriptsDO(
  dropletId: string,
  name: string,
  log: LogFn,
): void {
  void name;
  const files: Array<{ archivePath: string; contents: string }> = [
    { archivePath: "tmp/thopter-status", contents: readScript("thopter-status.sh") },
    { archivePath: "tmp/thopter-heartbeat", contents: readScript("thopter-heartbeat.sh") },
    { archivePath: "tmp/thopter-cron-install.sh", contents: readScript("thopter-cron-install.sh") },
    { archivePath: "home/.config/nvim/lua/options.lua", contents: readScript("nvim-options.lua") },
    { archivePath: "home/.config/nvim/lua/plugins/thopter.lua", contents: readScript("nvim-plugins.lua") },
    { archivePath: "home/.config/starship.toml", contents: readScript("starship.toml") },
    { archivePath: "home/.tmux.conf", contents: readScript("tmux.conf") },
  ];

  const claudeMdPath = getClaudeMdPath();
  const claudeMdContents = claudeMdPath
    ? readFileSync(claudeMdPath, "utf-8")
    : readScript("thopter-claude-md.md");
  files.push(
    { archivePath: "home/.claude/CLAUDE.md", contents: claudeMdContents },
    { archivePath: "home/.codex/AGENTS.md", contents: claudeMdContents },
  );

  const hookFiles: Record<string, string> = {
    "claude-hook-stop.sh": "on-stop.sh",
    "claude-hook-prompt.sh": "on-prompt.sh",
    "claude-hook-notification.sh": "on-notification.sh",
    "claude-hook-session-start.sh": "on-session-start.sh",
    "claude-hook-session-end.sh": "on-session-end.sh",
    "claude-hook-tool-use.sh": "on-tool-use.sh",
  };
  for (const [src, dest] of Object.entries(hookFiles)) {
    files.push({ archivePath: `home/.claude/hooks/${dest}`, contents: readScript(src) });
  }
  files.push(
    { archivePath: "tmp/thopter-transcript-push.mjs", contents: readScript("thopter-transcript-push.mjs") },
    { archivePath: "tmp/install-claude-hooks.mjs", contents: readScript("install-claude-hooks.mjs") },
  );

  uploadBundleToDO(dropletId, files, log);

  const installCmd =
    "sudo install -m 755 /tmp/thopter-status /usr/local/bin/thopter-status && " +
    "sudo install -m 755 /tmp/thopter-heartbeat /usr/local/bin/thopter-heartbeat && " +
    "sudo install -m 755 /tmp/thopter-transcript-push.mjs /usr/local/bin/thopter-transcript-push && " +
    "chmod +x /home/user/.claude/hooks/*.sh && node /tmp/install-claude-hooks.mjs && bash /tmp/thopter-cron-install.sh";
  log("  Installing uploaded scripts and hooks...");
  const result = doExecSync(dropletId, installCmd, { retryMax: 60 });
  if (result.status !== 0) {
    throw new Error(result.stderr || "failed to install thopter scripts");
  }
  log("  Ensuring thopter aliases in ~/.bashrc...");
  const bashrcResult = doExecSync(dropletId, thopterBashrcEnsureCommand(), { retryMax: 60 });
  if (bashrcResult.status !== 0) {
    throw new Error(bashrcResult.stderr || "failed to ensure thopter bashrc block");
  }
}

/**
 * Upload thopter-status scripts and install cron heartbeat on a running devbox.
 */
async function installThopterScripts(
  devboxId: string,
  name: string,
  redisUrl?: string,
): Promise<void> {
  const client = getClient();

  // Upload scripts
  await client.devboxes.writeFileContents(devboxId, {
    file_path: "/tmp/thopter-status",
    contents: readScript("thopter-status.sh"),
  });
  await client.devboxes.writeFileContents(devboxId, {
    file_path: "/tmp/thopter-heartbeat",
    contents: readScript("thopter-heartbeat.sh"),
  });
  await client.devboxes.writeFileContents(devboxId, {
    file_path: "/tmp/thopter-cron-install.sh",
    contents: readScript("thopter-cron-install.sh"),
  });

  // Neovim options (OSC 52 clipboard, tab/indent, wrapping, keybindings, etc.)
  await client.devboxes.writeFileContents(devboxId, {
    file_path: "/home/user/.config/nvim/lua/options.lua",
    contents: readScript("nvim-options.lua"),
  });

  // Neovim plugins (gitsigns, scrollview)
  await client.devboxes.writeFileContents(devboxId, {
    file_path: "/home/user/.config/nvim/lua/plugins/thopter.lua",
    contents: readScript("nvim-plugins.lua"),
  });

  // Starship prompt config
  await client.devboxes.writeFileContents(devboxId, {
    file_path: "/home/user/.config/starship.toml",
    contents: readScript("starship.toml"),
  });

  // tmux config (Ctrl-a prefix, etc.)
  await client.devboxes.writeFileContents(devboxId, {
    file_path: "/home/user/.tmux.conf",
    contents: readScript("tmux.conf"),
  });

  // CLAUDE.md — use custom path if configured, otherwise default
  const claudeMdPath = getClaudeMdPath();
  const claudeMdContents = claudeMdPath
    ? readFileSync(claudeMdPath, "utf-8")
    : readScript("thopter-claude-md.md");
  await client.devboxes.writeFileContents(devboxId, {
    file_path: "/home/user/.claude/CLAUDE.md",
    contents: claudeMdContents,
  });
  // Also deploy as Codex AGENTS.md
  await client.devboxes.writeFileContents(devboxId, {
    file_path: "/home/user/.codex/AGENTS.md",
    contents: claudeMdContents,
  });

  // Claude Code hooks for redis status updates
  const hookFiles: Record<string, string> = {
    "claude-hook-stop.sh": "on-stop.sh",
    "claude-hook-prompt.sh": "on-prompt.sh",
    "claude-hook-notification.sh": "on-notification.sh",
    "claude-hook-session-start.sh": "on-session-start.sh",
    "claude-hook-session-end.sh": "on-session-end.sh",
    "claude-hook-tool-use.sh": "on-tool-use.sh",
  };
  for (const [src, dest] of Object.entries(hookFiles)) {
    await client.devboxes.writeFileContents(devboxId, {
      file_path: `/home/user/.claude/hooks/${dest}`,
      contents: readScript(src),
    });
  }
  // Transcript push script for thopter tail (streams entries to Redis, updates last_message)
  await client.devboxes.writeFileContents(devboxId, {
    file_path: "/tmp/thopter-transcript-push.mjs",
    contents: readScript("thopter-transcript-push.mjs"),
  });

  // Installer merges hooks into existing settings.json (idempotent)
  await client.devboxes.writeFileContents(devboxId, {
    file_path: "/tmp/install-claude-hooks.mjs",
    contents: readScript("install-claude-hooks.mjs"),
  });

  // Install scripts to /usr/local/bin, make hooks executable, register hooks, set up cron
  await client.devboxes.executeAsync(devboxId, {
    command: "sudo install -m 755 /tmp/thopter-status /usr/local/bin/thopter-status && sudo install -m 755 /tmp/thopter-heartbeat /usr/local/bin/thopter-heartbeat && sudo install -m 755 /tmp/thopter-transcript-push.mjs /usr/local/bin/thopter-transcript-push && chmod +x /home/user/.claude/hooks/*.sh && node /tmp/install-claude-hooks.mjs && bash /tmp/thopter-cron-install.sh",
  });
  await client.devboxes.executeAsync(devboxId, {
    command: thopterBashrcEnsureCommand(),
  });
}

/**
 * Resolve a snapshot by name or ID.
 */
async function resolveSnapshotId(nameOrId: string): Promise<string> {
  if (isDigitalOceanProvider()) {
    if (/^\d+$/.test(nameOrId)) return nameOrId;
    const raw = doctlJson(["compute", "snapshot", "list"]);
    if (!Array.isArray(raw)) {
      throw new Error("Failed to list snapshots from DigitalOcean.");
    }
    const snapshots = raw
      .map((s) => s as Record<string, unknown>)
      .filter((s) => (s.resource_type ?? s.ResourceType) === "droplet");
    const matches = snapshots.filter((s) => (s.name ?? s.Name) === nameOrId);
    if (matches.length === 0) {
      throw new Error(`No snapshot named '${nameOrId}'. Use 'snapshot list' to see available snapshots.`);
    }
    if (matches.length > 1) {
      const ids = matches.map((m) => String(m.id ?? m.ID ?? ""));
      throw new Error(`Ambiguous: ${matches.length} snapshots named '${nameOrId}' (${ids.join(", ")}). Use a snapshot ID instead.`);
    }
    return String(matches[0].id ?? matches[0].ID ?? "");
  }
  const client = getClient();

  // Direct ID — validate it still exists via queryStatus (single API call)
  if (nameOrId.startsWith("snp_")) {
    try {
      const status = await client.devboxes.diskSnapshots.queryStatus(nameOrId);
      if (status.status === "deleted") {
        throw new Error(`Snapshot '${nameOrId}' has been deleted.`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("deleted")) throw e;
      throw new Error(`Snapshot '${nameOrId}' not found.`);
    }
    return nameOrId;
  }
  const matches: string[] = [];
  for await (const s of client.devboxes.diskSnapshots.list({ limit: 100 })) {
    if (s.name === nameOrId) matches.push(s.id);
  }

  if (matches.length === 0) {
    throw new Error(
      `No snapshot named '${nameOrId}'. Use 'snapshot list' to see available snapshots.`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous: ${matches.length} snapshots named '${nameOrId}' (${matches.join(", ")}). Use a snapshot ID instead.`,
    );
  }
  return matches[0];
}

/**
 * Resolve a devbox by name or ID. Searches our managed devboxes by metadata.
 */
export async function resolveDevbox(
  nameOrId: string,
): Promise<{ id: string; name?: string }> {
  if (isDigitalOceanProvider()) {
    if (/^\d+$/.test(nameOrId)) return { id: nameOrId };
    const droplets = listManagedDODroplets();
    const matches = droplets.filter((d) => {
      const thopterName = parseDOTagValue(d.tags, "thopter-name");
      return thopterName === nameOrId || d.name === nameOrId || d.id === nameOrId;
    });
    if (matches.length === 0) {
      throw new Error(`No managed droplet named '${nameOrId}'. Use 'list' to see available machines.`);
    }
    if (matches.length > 1) {
      throw new Error(
        `Ambiguous: ${matches.length} droplets match '${nameOrId}' (${matches.map((m) => m.id).join(", ")}). Use an ID.`,
      );
    }
    const match = matches[0];
    return { id: match.id, name: parseDOTagValue(match.tags, "thopter-name") ?? match.name };
  }
  const client = getClient();

  // If it looks like a devbox ID, return directly
  if (nameOrId.startsWith("dvbx_") || nameOrId.startsWith("dbx_")) {
    return { id: nameOrId };
  }

  // Search all non-shutdown devboxes by name in metadata
  for (const status of ["running", "provisioning", "initializing", "suspended"] as const) {
    for await (const db of client.devboxes.list({ status, limit: 100 })) {
      const meta = db.metadata ?? {};
      if (
        meta[MANAGED_BY_KEY] === MANAGED_BY_VALUE &&
        meta[NAME_KEY] === nameOrId
      ) {
        return { id: db.id, name: nameOrId };
      }
    }
  }

  throw new Error(
    `No devbox named '${nameOrId}'. Use 'list' to see available devboxes.`,
  );
}

export async function createDevbox(opts: {
  name: string;
  snapshotId?: string;
  fresh?: boolean;
  keepAlive?: number;
}): Promise<string> {
  const log = makeTimedLogger(Date.now());

  // Get owner from operator's git config (required)
  let ownerName: string;
  try {
    ownerName = execSync("git config --get user.name", { encoding: "utf-8" }).trim();
  } catch {
    ownerName = "";
  }
  if (!ownerName) {
    throw new Error(
      "Git user.name not configured. Set it with: git config --global user.name 'Your Name'",
    );
  }

  // Validate local files exist before creating anything
  const claudeMdPath = getClaudeMdPath();
  if (claudeMdPath && !existsSync(claudeMdPath)) {
    throw new Error(`Custom CLAUDE.md not found: ${claudeMdPath}`);
  }
  const uploads = getUploads();
  for (const entry of uploads) {
    if (!existsSync(entry.local)) {
      throw new Error(`Upload file not found: ${entry.local}`);
    }
  }
  const envVars = getEnvVars();

  // Determine snapshot (resolve name → ID if needed)
  let snapshotId = opts.snapshotId
    ? await resolveSnapshotId(opts.snapshotId)
    : undefined;
  if (!snapshotId && !opts.fresh) {
    const defaultSnap = getDefaultSnapshot();
    if (defaultSnap) {
      try {
        snapshotId = await resolveSnapshotId(defaultSnap);
        log(`Using default snapshot: ${defaultSnap}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(
          `${msg}\nThis is the default snapshot. To clear it: thopter snapshot default --clear`,
        );
      }
    }
  }

  if (isDigitalOceanProvider()) {
    const image = snapshotId ?? DO_DEFAULT_IMAGE;
    const ownerTag = `owner:${coerceTagValue(ownerName)}`;
    const thopterTag = `thopter-name:${coerceTagValue(opts.name)}`;
    const dropletName = `thopter-${coerceTagValue(opts.name).slice(0, 48)}`;
    const redisUrlForCreate = envVars.THOPTER_REDIS_URL?.trim();
    const initEnvForUser = [`THOPTER_NAME=${shellSingleQuote(opts.name)}`];
    if (redisUrlForCreate) {
      initEnvForUser.push(`THOPTER_REDIS_URL=${shellSingleQuote(redisUrlForCreate)}`);
    }
    const userInitCmd = `${initEnvForUser.join(" ")} bash /tmp/thopter-init.sh`;
    const initScript = snapshotId ? SNAPSHOT_INIT_SCRIPT : INIT_SCRIPT;
    if (snapshotId) {
      log("Using snapshot-optimized cloud-init profile.");
    } else {
      log("Using full cloud-init profile.");
    }
    const cloudInit = [
      "#!/bin/bash",
      "set -euo pipefail",
      "if ! id -u user >/dev/null 2>&1; then useradd -m -s /bin/bash -G sudo user; fi",
      "echo 'user ALL=(ALL) NOPASSWD:ALL' >/etc/sudoers.d/thopter-user",
      "chmod 440 /etc/sudoers.d/thopter-user",
      "mkdir -p /home/user/.ssh",
      "if [ -f /root/.ssh/authorized_keys ]; then cp /root/.ssh/authorized_keys /home/user/.ssh/authorized_keys; fi",
      "chown -R user:user /home/user/.ssh",
      "chmod 700 /home/user/.ssh || true",
      "chmod 600 /home/user/.ssh/authorized_keys || true",
      "cat >/tmp/thopter-init.sh <<'THOPTER_INIT'",
      initScript,
      "THOPTER_INIT",
      "chown user:user /tmp/thopter-init.sh",
      "chmod +x /tmp/thopter-init.sh",
      `su - user -c ${shellSingleQuote(userInitCmd)}`,
    ].join("\n");

    log(
      snapshotId
        ? `Creating droplet '${opts.name}' from snapshot ${snapshotId}...`
        : `Creating droplet '${opts.name}' (fresh)...`,
    );
    log("Waiting for droplet to be ready...");

    const createArgs = [
      "compute",
      "droplet",
      "create",
      dropletName,
      "--image",
      image,
      "--region",
      DO_DEFAULT_REGION,
      "--size",
      DO_DEFAULT_SIZE,
      "--tag-names",
      [DO_MANAGED_TAG, ownerTag, thopterTag].join(","),
      "--ssh-keys",
      ensureDOFingerprintForLocalRSAPub(),
      "--wait",
      "--user-data",
      cloudInit,
    ];
    const created = doctlJson(createArgs);
    if (!Array.isArray(created) || created.length === 0) {
      throw new Error("Failed to parse droplet create response.");
    }
    const droplet = normalizeDODroplet(created[0]);
    const dropletId = droplet.id;
    log(`Droplet created: ${dropletId}`);
    const stopProgress = await startDOCreateRedisProgressLoop(log, opts.name, redisUrlForCreate);
    try {
      await waitForDOSSHReady(dropletId, log, "user");
      await waitForDOInitComplete(dropletId, log);
      const hostName = coerceHostname(opts.name);
      log(`Setting hostname to '${hostName}'...`);
      const hostCmd = [
        `sudo hostnamectl set-hostname ${shellSingleQuote(hostName)}`,
        `echo ${shellSingleQuote(hostName)} | sudo tee /etc/hostname >/dev/null`,
      ].join(" && ");
      const hostResult = doExecSync(dropletId, hostCmd, { retryMax: 60 });
      if (hostResult.status !== 0) {
        throw new Error(hostResult.stderr || "failed to set hostname");
      }
      log("Provisioning runtime...");

      const envLines: string[] = [];
      envLines.push(`export THOPTER_NAME="${escapeEnvValue(opts.name)}"`);
      envLines.push(`export THOPTER_ID="${escapeEnvValue(dropletId)}"`);
      envLines.push(`export THOPTER_OWNER="${escapeEnvValue(ownerName)}"`);
      if (!getStopNotifications()) {
        envLines.push(`export THOPTER_STOP_NOTIFY=0`);
      }
      const quietPeriod = getStopNotificationQuietPeriod();
      envLines.push(`export THOPTER_STOP_NOTIFY_QUIET_PERIOD="${quietPeriod}"`);
      for (const [key, value] of Object.entries(envVars)) {
        envLines.push(`export ${key}="${escapeEnvValue(value)}"`);
      }
      log("Writing /home/user/.thopter-env...");
      doWriteFile(dropletId, "/home/user/.thopter-env", envLines.join("\n") + "\n", { retryMax: 60 });

      if (envVars.GH_TOKEN) {
        log("Configuring git credentials...");
        const gitCmd =
          "source ~/.thopter-env && " +
          "git config --global credential.helper store && " +
          "echo \"https://thopterbot:${GH_TOKEN}@github.com\" > ~/.git-credentials && " +
          "git config --global url.\"https://github.com/\".insteadOf \"git@github.com:\" && " +
          "git config --global user.name \"ThopterBot\" && " +
          "git config --global user.email \"thopterbot@telepath.computer\"";
        const result = doExecSync(dropletId, gitCmd, { retryMax: 60 });
        if (result.status !== 0) {
          throw new Error(result.stderr || "failed to configure git credentials");
        }
      }

      log("Installing thopter scripts...");
      installThopterScriptsDO(dropletId, opts.name, log);

      if (uploads.length > 0) {
        log(`Uploading ${uploads.length} custom file${uploads.length === 1 ? "" : "s"}...`);
        const bundleable: DOAssetBundleEntry[] = [];
        const fallback: typeof uploads = [];
        for (const entry of uploads) {
          const archivePath = archivePathForDORemote(entry.remote);
          if (archivePath) {
            bundleable.push({
              archivePath,
              sourcePath: entry.local,
            });
          } else {
            fallback.push(entry);
          }
        }
        if (bundleable.length > 0) {
          log(`  Uploading ${bundleable.length} custom file${bundleable.length === 1 ? "" : "s"} via bundle...`);
          uploadBundleToDO(dropletId, bundleable, log);
        }
        for (const entry of fallback) {
          log(`  Uploading ${entry.local} -> ${entry.remote} (direct binary fallback)...`);
          doUploadFileToRemotePath(dropletId, entry.local, entry.remote, { user: "user" });
        }
      }

      log(`Create complete: ${dropletId}`);
      printPostCreateChecklist(log);
      return dropletId;
    } finally {
      await stopProgress();
    }
  }

  const client = getClient();

  // Build metadata
  const metadata: Record<string, string> = {
    [MANAGED_BY_KEY]: MANAGED_BY_VALUE,
    [NAME_KEY]: opts.name,
    [OWNER_KEY]: ownerName,
  };

  const createParams = {
    name: opts.name,
    snapshot_id: snapshotId,
    metadata,
    launch_parameters: {
      resource_size_request: DEFAULT_RESOURCE_SIZE,
      keep_alive_time_seconds: opts.keepAlive ?? DEFAULT_KEEP_ALIVE_SECONDS,
      launch_commands: snapshotId ? undefined : [INIT_SCRIPT],
    },
  };

  log(
    snapshotId
      ? `Creating devbox '${opts.name}' from snapshot ${snapshotId}...`
      : `Creating devbox '${opts.name}' (fresh)...`,
  );
  log("Waiting for devbox to be ready...");

  try {
    const devbox = await client.devboxes.createAndAwaitRunning(createParams);
    log(`Devbox created: ${devbox.id}`);
    log("Devbox is running.");

    // Write ~/.thopter-env with all env vars from config + identity vars.
    // This is the single source of truth for devbox environment.
    // Sourced from .bashrc so interactive shells + cron both get these vars.
    // On snapshot creates, this overwrites stale values from the previous devbox.
    const envLines: string[] = [];
    // Identity vars (safe — generated by us, no user-controlled shell metacharacters)
    envLines.push(`export THOPTER_NAME="${escapeEnvValue(opts.name)}"`);
    envLines.push(`export THOPTER_ID="${escapeEnvValue(devbox.id)}"`);
    envLines.push(`export THOPTER_OWNER="${escapeEnvValue(ownerName)}"`);
    if (!getStopNotifications()) {
      envLines.push(`export THOPTER_STOP_NOTIFY=0`);
    }
    const quietPeriod = getStopNotificationQuietPeriod();
    envLines.push(`export THOPTER_STOP_NOTIFY_QUIET_PERIOD="${quietPeriod}"`);
    // User-configured env vars from ~/.thopter.json envVars section
    for (const [key, value] of Object.entries(envVars)) {
      envLines.push(`export ${key}="${escapeEnvValue(value)}"`);
    }
    await client.devboxes.writeFileContents(devbox.id, {
      file_path: "/home/user/.thopter-env",
      contents: envLines.join("\n") + "\n",
    });

    // Configure git credentials using GH_TOKEN (post-boot, after env file is written)
    if (envVars.GH_TOKEN) {
      log("Configuring git credentials...");
      await client.devboxes.executeAsync(devbox.id, {
        command: `source ~/.thopter-env && git config --global credential.helper store && echo "https://thopterbot:\${GH_TOKEN}@github.com" > ~/.git-credentials && git config --global url."https://github.com/".insteadOf "git@github.com:" && git config --global user.name "ThopterBot" && git config --global user.email "thopterbot@telepath.computer"`,
      });
    }

    // Upload and install thopter-status scripts + cron
    log("Installing thopter scripts...");
    await installThopterScripts(devbox.id, opts.name);

    // Upload custom files from config (last, so user files override defaults)
    if (uploads.length > 0) {
      log(`Uploading ${uploads.length} custom file${uploads.length === 1 ? "" : "s"}...`);
      for (const entry of uploads) {
        await client.devboxes.writeFileContents(devbox.id, {
          file_path: entry.remote,
          contents: readFileSync(entry.local, "utf-8"),
        });
      }
    }

    printPostCreateChecklist(log);
    return devbox.id;
  } catch (e) {
    // If it failed after creation, try to extract the ID from the error or re-fetch
    const msg = e instanceof Error ? e.message : String(e);
    log(`WARNING: Devbox may not have reached running state: ${msg}`);
    log("  Check status with: runloop-thopters list");

    // Try to find the devbox we just created by name
    for await (const db of client.devboxes.list({ limit: 50 })) {
      const meta = db.metadata ?? {};
      if (meta[NAME_KEY] === opts.name && meta[MANAGED_BY_KEY] === MANAGED_BY_VALUE) {
        log(`Devbox ID: ${db.id} (status: ${db.status})`);
        return db.id;
      }
    }
    throw e;
  }
}

/**
 * Fetch live thopters from Runloop API + Redis, returning structured data.
 * This is the single source of truth — Runloop determines which devboxes are
 * alive, Redis provides agent annotations (status, status line, heartbeat, etc.).
 */
export async function fetchThopters(): Promise<{
  name: string; owner: string; id: string; devboxStatus: string;
  status: string | null; statusLine: string | null; notes: string | null; heartbeat: string | null;
  alive: boolean; claudeRunning: boolean; lastMessage: string | null;
}[]> {
  const { getRedisInfoForNames } = await import("./status.js");

  if (isDigitalOceanProvider()) {
    const droplets = listManagedDODroplets();
    const devboxes = droplets.map((d) => ({
      id: d.id,
      name: parseDOTagValue(d.tags, "thopter-name") ?? d.name,
      owner: parseDOTagValue(d.tags, "owner") ?? "",
      status: mapDOStatus(d.status),
    }));
    const redisMap = await getRedisInfoForNames(devboxes.map((db) => db.name));
    return devboxes.map((db) => {
      const redis = redisMap.get(db.name);
      return {
        name: db.name,
        owner: db.owner,
        id: db.id,
        devboxStatus: db.status,
        status: redis?.status ?? null,
        statusLine: redis?.statusLine ?? null,
        notes: redis?.notes ?? null,
        heartbeat: redis?.heartbeat ?? null,
        alive: redis?.alive ?? false,
        claudeRunning: redis?.claudeRunning === "1",
        lastMessage: redis?.lastMessage ?? null,
      };
    });
  }

  const client = getClient();

  const devboxes: { name: string; owner: string; id: string; status: string }[] = [];
  const liveStatuses = ["running", "suspended", "provisioning", "initializing", "suspending", "resuming"] as const;
  for (const status of liveStatuses) {
    for await (const db of client.devboxes.list({ status, limit: 100 })) {
      const meta = db.metadata ?? {};
      if (meta[MANAGED_BY_KEY] !== MANAGED_BY_VALUE) continue;
      devboxes.push({
        name: meta[NAME_KEY] ?? "",
        owner: meta[OWNER_KEY] ?? "",
        id: db.id,
        status: db.status,
      });
    }
  }

  const redisMap = await getRedisInfoForNames(devboxes.map((db) => db.name));

  return devboxes.map((db) => {
    const redis = redisMap.get(db.name);
    return {
      name: db.name,
      owner: db.owner,
      id: db.id,
      devboxStatus: db.status,
      status: redis?.status ?? null,
      statusLine: redis?.statusLine ?? null,
      notes: redis?.notes ?? null,
      heartbeat: redis?.heartbeat ?? null,
      alive: redis?.alive ?? false,
      claudeRunning: redis?.claudeRunning === "1",
      lastMessage: redis?.lastMessage ?? null,
    };
  });
}

export async function listDevboxes(opts?: { follow?: number; layout?: "wide" | "narrow"; json?: boolean }): Promise<void> {
  if (isDigitalOceanProvider()) {
    if (opts?.json) {
      const thopters = await fetchThopters();
      process.stdout.write(JSON.stringify(thopters) + "\n");
      return;
    }

    const { relativeTime } = await import("./status.js");
    const { formatTable } = await import("./output.js");
    const render = async (): Promise<string> => {
      const thopters = await fetchThopters();
      if (thopters.length === 0) return "No managed droplets found.\n";
      const rows = thopters.map((t) => [
        t.name,
        t.owner || "-",
        t.devboxStatus,
        t.status ?? "-",
        t.statusLine ?? "-",
        t.claudeRunning ? "yes" : "no",
        t.heartbeat ? relativeTime(t.heartbeat) : "-",
        t.lastMessage ?? "-",
      ]);
      return formatTable(
        ["NAME", "OWNER", "MACHINE", "AGENT", "STATUS LINE", "CLAUDE", "HEARTBEAT", "LAST MSG"],
        rows,
        { maxWidth: process.stdout.columns || 120, flexColumns: [4, 7] },
      );
    };

    if (opts?.follow) {
      const interval = opts.follow;
      while (true) {
        const output = await render();
        process.stdout.write("\x1b[2J\x1b[H");
        process.stdout.write(`Refreshing every ${interval}s — Ctrl+C to exit  (${new Date().toLocaleTimeString()})\n\n`);
        process.stdout.write(output);
        await new Promise((r) => setTimeout(r, interval * 1000));
      }
    } else {
      process.stdout.write(await render());
    }
    return;
  }

  if (opts?.json) {
    const thopters = await fetchThopters();
    process.stdout.write(JSON.stringify(thopters) + "\n");
    return;
  }

  const client = getClient();
  const { getRedisInfoForNames, relativeTime } = await import("./status.js");
  const { formatTable } = await import("./output.js");

  function toInitials(name: string): string {
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 3);
    return parts.map((p) => p[0]).join("").toUpperCase();
  }

  const SHORT_STATUS: Record<string, string> = {
    running: "run",
    suspended: "susp",
    provisioning: "prov",
    initializing: "init",
    suspending: "susp…",
    resuming: "res…",
  };

  async function fetchAndRender(): Promise<string> {
    const devboxes: { name: string; owner: string; id: string; status: string }[] = [];
    const liveStatuses = ["running", "suspended", "provisioning", "initializing", "suspending", "resuming"] as const;
    for (const status of liveStatuses) {
      for await (const db of client.devboxes.list({ status, limit: 100 })) {
        const meta = db.metadata ?? {};
        if (meta[MANAGED_BY_KEY] !== MANAGED_BY_VALUE) continue;
        devboxes.push({
          name: meta[NAME_KEY] ?? "",
          owner: meta[OWNER_KEY] ?? "",
          id: db.id,
          status: db.status,
        });
      }
    }

    if (devboxes.length === 0) {
      return "No managed devboxes found.\n";
    }

    // Fetch Redis annotations for all devboxes using a single connection
    const redisMap = await getRedisInfoForNames(devboxes.map((db) => db.name));
    const cols = process.stdout.columns || 120;

    // Compute fixed-column width needed in wide mode (everything except STATUS LINE and LAST MSG)
    const wideFixedData = devboxes.map((db) => {
      const redis = redisMap.get(db.name);
      const claude = redis ? (redis.claudeRunning === "1" ? "yes" : redis.claudeRunning === "0" ? "no" : "-") : "-";
      const heartbeat = redis?.heartbeat ? relativeTime(redis.heartbeat) : "-";
      return [db.name, db.owner, db.status, redis?.status ?? "-", claude, heartbeat];
    });
    const wideFixedHeaders = ["NAME", "OWNER", "DEVBOX", "AGENT", "CLAUDE", "HEARTBEAT"];
    const wideFixedWidth = wideFixedHeaders.reduce((sum, h, i) => {
      const maxCell = Math.max(0, ...wideFixedData.map((r) => r[i].length));
      return sum + Math.max(h.length, maxCell);
    }, 0);
    // gaps between all 8 columns (7 × 2) + fixed cols width
    const wideOverhead = 7 * 2 + wideFixedWidth;
    // Explicit flag overrides auto-detection; otherwise need 60 chars for flex columns
    const tight = opts?.layout === "narrow" ? true
      : opts?.layout === "wide" ? false
      : wideOverhead > cols - 60;

    // Gray out suspended rows
    const DIM = "\x1b[90m";

    const collapse = (s: string) => s.replace(/\s+/g, " ").trim();
    const truncate = (s: string, max: number) => {
      if (s.length <= max) return s;
      return max <= 3 ? s.slice(0, max) : s.slice(0, max - 3) + "...";
    };

    if (tight) {
      // Multi-line layout: fixed columns, then indented Status line/Last message lines
      const indent = "  ";
      const statusLinePrefix = "Status line: ";
      const msgPrefix = "Last message: ";
      const statusLineMax = cols - indent.length - statusLinePrefix.length;
      const msgMax = cols - indent.length - msgPrefix.length;

      const fixedRows = devboxes.map((db) => {
        const redis = redisMap.get(db.name);
        const claude = redis ? (redis.claudeRunning === "1" ? "y" : redis.claudeRunning === "0" ? "n" : "-") : "-";
        const heartbeat = redis?.heartbeat ? relativeTime(redis.heartbeat).replace(/ ago$/, "") : "-";
        return [
          db.name,
          toInitials(db.owner),
          SHORT_STATUS[db.status] ?? db.status,
          redis?.status ?? "-",
          claude,
          heartbeat,
        ];
      });

      // Compute fixed column widths
      const numFixed = fixedRows[0].length;
      const fixedWidths = Array.from({ length: numFixed }, (_, i) =>
        Math.max(0, ...fixedRows.map((r) => r[i].length)),
      );

      const lines: string[] = [];
      for (let r = 0; r < devboxes.length; r++) {
        const db = devboxes[r];
        const redis = redisMap.get(db.name);
        const style = db.status === "suspended" ? DIM : null;
        const reset = style ? "\x1b[0m" : "";

        // Fixed columns line
        const fixedLine = fixedRows[r]
          .map((cell, i) => cell.padEnd(fixedWidths[i]))
          .join("  ");
        lines.push(style ? `${style}${fixedLine}${reset}` : fixedLine);

        // Status line (only if there's actual content)
        const sl = collapse(redis?.statusLine ?? "");
        if (sl && sl !== "-") {
          const slLine = `${indent}${statusLinePrefix}${truncate(sl, statusLineMax)}`;
          lines.push(style ? `${style}${slLine}${reset}` : slLine);
        }

        // Last message line (only if there's actual content)
        const msg = collapse(redis?.lastMessage ?? "");
        if (msg && msg !== "-") {
          const msgLine = `${indent}${msgPrefix}${truncate(msg, msgMax)}`;
          lines.push(style ? `${style}${msgLine}${reset}` : msgLine);
        }

        // Blank line between devboxes
        if (r < devboxes.length - 1) lines.push("");
      }
      return lines.join("\n") + "\n";
    } else {
      const rowStyles = devboxes.map((db) =>
        db.status === "suspended" ? DIM : null,
      );
      const rows: string[][] = devboxes.map((db) => {
        const redis = redisMap.get(db.name);
        const statusLine = collapse(redis?.statusLine ?? "-");
        const msg = collapse(redis?.lastMessage ?? "-");
        const claude = redis ? (redis.claudeRunning === "1" ? "yes" : redis.claudeRunning === "0" ? "no" : "-") : "-";
        const heartbeat = redis?.heartbeat ? relativeTime(redis.heartbeat) : "-";
        return [
          db.name,
          db.owner,
          db.status,
          redis?.status ?? "-",
          statusLine,
          claude,
          heartbeat,
          msg,
        ];
      });
      return formatTable(
        ["NAME", "OWNER", "DEVBOX", "AGENT", "STATUS LINE", "CLAUDE", "HEARTBEAT", "LAST MSG"],
        rows,
        { maxWidth: cols, flexColumns: [4, 7], rowStyles },
      );
    }
  }

  if (opts?.follow) {
    const interval = opts.follow;
    // Loop until Ctrl+C — compute output first, then clear and redraw
    while (true) {
      const output = await fetchAndRender();
      process.stdout.write("\x1b[2J\x1b[H");
      process.stdout.write(`Refreshing every ${interval}s — Ctrl+C to exit  (${new Date().toLocaleTimeString()})\n\n`);
      process.stdout.write(output);
      await new Promise((r) => setTimeout(r, interval * 1000));
    }
  } else {
    process.stdout.write(await fetchAndRender());
  }
}

export async function listSnapshotsCmd(): Promise<void> {
  if (isDigitalOceanProvider()) {
    const rows = listDOSnapshots().map((s) => [
      s.name,
      s.id,
      s.sourceId,
      s.createdAt ? new Date(s.createdAt).toLocaleString() : "",
    ]);
    printTable(["NAME", "ID", "SOURCE DEVBOX", "CREATED"], rows);
    const defaultSnap = getDefaultSnapshot();
    if (defaultSnap) {
      console.log(`\nDefault snapshot: ${defaultSnap}`);
    }
    return;
  }

  const client = getClient();

  const rows: string[][] = [];
  for await (const s of client.devboxes.diskSnapshots.list({ limit: 100 })) {
    const name = s.name ?? "";
    const source = s.source_devbox_id ?? "";
    const created = s.create_time_ms
      ? new Date(s.create_time_ms).toLocaleString()
      : "";
    rows.push([name, s.id, source, created]);
  }

  printTable(["NAME", "ID", "SOURCE DEVBOX", "CREATED"], rows);

  const defaultSnap = getDefaultSnapshot();
  if (defaultSnap) {
    console.log(`\nDefault snapshot: ${defaultSnap}`);
  }
}

export async function deleteSnapshot(nameOrId: string): Promise<void> {
  const snapshotId = await resolveSnapshotId(nameOrId);

  console.log(`Deleting snapshot ${snapshotId}...`);
  if (isDigitalOceanProvider()) {
    execFileSync("doctl", ["compute", "snapshot", "delete", snapshotId, "--force"], {
      stdio: "inherit",
    });
  } else {
    const client = getClient();
    await client.devboxes.diskSnapshots.delete(snapshotId);
  }
  console.log("Done.");
}

export async function destroyDevbox(nameOrId: string): Promise<void> {
  const { id } = await resolveDevbox(nameOrId);

  if (isDigitalOceanProvider()) {
    console.log(`Deleting droplet ${id}...`);
    execFileSync("doctl", ["compute", "droplet", "delete", id, "--force"], {
      stdio: "inherit",
    });
    console.log("Done.");
    return;
  }

  console.log(`Shutting down devbox ${id}...`);
  const client = getClient();
  await client.devboxes.shutdown(id);
  console.log("Done.");
}

export async function suspendDevbox(nameOrId: string): Promise<void> {
  if (isDigitalOceanProvider()) {
    throw new Error(
      "suspend is not supported in DigitalOcean mode. DigitalOcean does not provide cost-saving suspend semantics for thopters.",
    );
  }
  const { id } = await resolveDevbox(nameOrId);

  console.log(`Suspending devbox ${id}...`);
  const client = getClient();
  await client.devboxes.suspend(id);
  console.log("Suspended. Resume with: thopter resume " + (nameOrId));
}

export async function resumeDevbox(nameOrId: string): Promise<void> {
  if (isDigitalOceanProvider()) {
    throw new Error(
      "resume is not supported in DigitalOcean mode. DigitalOcean does not provide thopter suspend/resume semantics.",
    );
  }
  const { id } = await resolveDevbox(nameOrId);

  console.log(`Resuming devbox ${id}...`);
  const client = getClient();
  await client.devboxes.resume(id);
  try {
    await client.devboxes.awaitRunning(id);
    console.log("Devbox is running.");
  } catch {
    console.log("WARNING: Timed out waiting for devbox to reach running state.");
    console.log("  Check status with: thopter list");
  }
}

export async function keepaliveDevbox(nameOrId: string): Promise<void> {
  if (isDigitalOceanProvider()) {
    throw new Error(
      "keepalive is not supported in DigitalOcean mode. DigitalOcean does not provide thopter keep-alive timer reset semantics.",
    );
  }
  const { id } = await resolveDevbox(nameOrId);
  const client = getClient();

  console.log(`Sending keepalive for ${nameOrId} (${id})...`);
  await client.devboxes.keepAlive(id);
  console.log("Done. Keep-alive timer reset.");
}

export interface SSHOptions {
  localForwards?: string[];
  remoteForwards?: string[];
  dynamicForwards?: string[];
  noCommand?: boolean;
  remoteCommand?: string;
}

function appendForwardArgs(args: string[], options: SSHOptions): void {
  for (const spec of options.localForwards ?? []) {
    args.push("-L", spec);
  }
  for (const spec of options.remoteForwards ?? []) {
    args.push("-R", spec);
  }
  for (const spec of options.dynamicForwards ?? []) {
    args.push("-D", spec);
  }
  if (options.noCommand) {
    args.push("-N");
  }
}

function getRunloopSSHConfig(devboxId: string): {
  hostname: string;
  identityFile: string;
  proxyCommand: string;
} {
  const configOutput = execSync(`rli devbox ssh --config-only ${devboxId}`, {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  const hostname = configOutput.match(/Hostname\s+(.+)/)?.[1]?.trim();
  const identityFile = configOutput.match(/IdentityFile\s+(.+)/)?.[1]?.trim();
  const proxyCommand = configOutput.match(/ProxyCommand\s+(.+)/)?.[1]?.trim();

  if (!hostname || !identityFile || !proxyCommand) {
    throw new Error("Failed to parse SSH config from rli.");
  }

  return { hostname, identityFile, proxyCommand };
}

function buildSSHSpawnFromTarget(
  target: string,
  baseArgs: string[],
  options: SSHOptions = {},
): { command: string; args: string[] } {
  const args = [...baseArgs];
  appendForwardArgs(args, options);
  args.push(target);
  if (options.remoteCommand) {
    args.push(options.remoteCommand);
  }
  return { command: "ssh", args };
}

export async function sshDevbox(nameOrId: string, options: SSHOptions = {}): Promise<void> {
  const { id } = await resolveDevbox(nameOrId);

  if (isDigitalOceanProvider()) {
    const ip = getDODropletPublicIPv4(id);
    const child = spawn(
      "ssh",
      buildSSHSpawnFromTarget(
        `user@${ip}`,
        [
          "-o",
          "StrictHostKeyChecking=no",
          "-o",
          "UserKnownHostsFile=/dev/null",
          "-i",
          getLocalRSAPrivateKeyPath(),
        ],
        options,
      ).args,
      {
        stdio: "inherit",
      },
    );
    child.on("exit", (code) => process.exit(code ?? 0));
    return;
  }

  const hasForwarding =
    (options.localForwards?.length ?? 0) > 0 ||
    (options.remoteForwards?.length ?? 0) > 0 ||
    (options.dynamicForwards?.length ?? 0) > 0 ||
    options.noCommand === true;
  if (hasForwarding) {
    const { hostname, identityFile, proxyCommand } = getRunloopSSHConfig(id);
    const child = spawn(
      "ssh",
      buildSSHSpawnFromTarget(
        `user@${hostname}`,
        [
          "-o",
          "StrictHostKeyChecking=no",
          "-o",
          `ProxyCommand=${proxyCommand}`,
          "-i",
          identityFile,
        ],
        options,
      ).args,
      { stdio: "inherit" },
    );
    child.on("exit", (code) => process.exit(code ?? 0));
    return;
  }

  console.log(`Connecting to ${id} via rli...`);
  rliSsh(id);
}

export async function getSSHSpawn(
  nameOrId: string,
  options: SSHOptions = {},
): Promise<{ command: string; args: string[] }> {
  const { id } = await resolveDevbox(nameOrId);

  if (isDigitalOceanProvider()) {
    const ip = getDODropletPublicIPv4(id);
    return buildSSHSpawnFromTarget(
      `user@${ip}`,
      [
        "-tt",
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "UserKnownHostsFile=/dev/null",
        "-o",
        "ConnectTimeout=5",
        "-i",
        getLocalRSAPrivateKeyPath(),
      ],
      options,
    );
  }

  const { hostname, identityFile, proxyCommand } = getRunloopSSHConfig(id);
  return buildSSHSpawnFromTarget(
    `user@${hostname}`,
    [
      "-tt",
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      `ProxyCommand=${proxyCommand}`,
      "-i",
      identityFile,
    ],
    options,
  );
}

export async function attachDevbox(nameOrId: string): Promise<void> {
  const { id } = await resolveDevbox(nameOrId);

  if (isDigitalOceanProvider()) {
    const ip = getDODropletPublicIPv4(id);
    const child = spawn(
      "ssh",
      [
        "-tt",
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "UserKnownHostsFile=/dev/null",
        "-i",
        getLocalRSAPrivateKeyPath(),
        `user@${ip}`,
        "tmux -CC attach \\; refresh-client || tmux -CC",
      ],
      { stdio: "inherit" },
    );
    child.on("exit", (code) => process.exit(code ?? 0));
    return;
  }

  console.log(`Attaching to tmux on ${id} via rli...`);
  rliSsh(id, "tmux -CC attach \\; refresh-client || tmux -CC");
}

function rliSsh(devboxId: string, command?: string): void {
  // Check rli is available
  try {
    execSync("which rli", { stdio: "ignore" });
  } catch {
    console.error("ERROR: 'rli' CLI not found.");
    console.error("  Install it with: npm install -g @runloop/rl-cli");
    process.exit(1);
  }

  // rli devbox ssh doesn't support passing remote commands, so when a command
  // is needed we extract the SSH config from rli and call ssh directly.
  if (command) {
    const configOutput = execSync(`rli devbox ssh --config-only ${devboxId}`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const hostname = configOutput.match(/Hostname\s+(.+)/)?.[1]?.trim();
    const identityFile = configOutput.match(/IdentityFile\s+(.+)/)?.[1]?.trim();
    const proxyCommand = configOutput.match(/ProxyCommand\s+(.+)/)?.[1]?.trim();

    if (!hostname || !identityFile || !proxyCommand) {
      console.error("ERROR: Failed to parse SSH config from rli.");
      process.exit(1);
    }

    const args = [
      "-tt",
      "-o", "StrictHostKeyChecking=no",
      "-o", `ProxyCommand=${proxyCommand}`,
      "-i", identityFile,
      `user@${hostname}`,
      command,
    ];

    const child = spawn("ssh", args, { stdio: "inherit" });
    child.on("exit", (code) => {
      process.exit(code ?? 0);
    });
  } else {
    const child = spawn("rli", ["devbox", "ssh", devboxId], {
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      process.exit(code ?? 0);
    });
  }
}

export async function execDevbox(
  nameOrId: string,
  command: string[],
): Promise<void> {
  const { id } = await resolveDevbox(nameOrId);
  const cmd = command.join(" ");
  console.log(`Executing in ${id}: ${cmd}`);
  const result = await executeCommandById(id, cmd);

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (result.exitCode !== 0) {
    process.exit(result.exitCode);
  }
}

export async function writeFileById(
  devboxId: string,
  filePath: string,
  contents: string,
): Promise<void> {
  if (isDigitalOceanProvider()) {
    doWriteFile(devboxId, filePath, contents, { retryMax: 60 });
    return;
  }
  const client = getClient();
  await client.devboxes.writeFileContents(devboxId, {
    file_path: filePath,
    contents,
  });
}

export async function executeCommandById(
  devboxId: string,
  command: string,
): Promise<RemoteCommandResult> {
  if (isDigitalOceanProvider()) {
    const result = doExecSync(devboxId, command, { retryMax: 5 });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.status,
    };
  }
  const client = getClient();
  const execution = await client.devboxes.executeAsync(devboxId, { command });
  const completed = await client.devboxes.executions.awaitCompleted(
    devboxId,
    execution.execution_id,
  );
  return {
    stdout: completed.stdout ?? "",
    stderr: completed.stderr ?? "",
    exitCode: completed.exit_status ?? 0,
  };
}

export async function snapshotDevbox(
  nameOrId: string,
  snapshotName?: string,
): Promise<string> {
  const { id } = await resolveDevbox(nameOrId);

  if (isDigitalOceanProvider()) {
    const effectiveName =
      snapshotName && snapshotName.trim()
        ? snapshotName.trim()
        : `thopter-snapshot-${coerceTagValue(nameOrId)}-${Date.now()}`;

    const existing = listDOSnapshots().filter((s) => s.name === effectiveName);
    if (existing.length > 0) {
      throw new Error(
        `A snapshot named '${effectiveName}' already exists (${existing.map((s) => s.id).join(", ")}). Choose a different name or delete the existing one first.`,
      );
    }

    console.log(`Snapshotting droplet ${id} as '${effectiveName}'...`);
    execFileSync(
      "doctl",
      [
        "compute",
        "droplet-action",
        "snapshot",
        id,
        "--snapshot-name",
        effectiveName,
        "--wait",
      ],
      { stdio: "inherit" },
    );
    const createdId = await waitForDOSnapshotIdByName(effectiveName);
    console.log(`Snapshot created: ${createdId}`);
    console.log(`Named: ${effectiveName}`);
    return createdId;
  }

  const client = getClient();

  // Check for duplicate snapshot name
  if (snapshotName) {
    for await (const s of client.devboxes.diskSnapshots.list({ limit: 100 })) {
      if (s.name === snapshotName) {
        throw new Error(
          `A snapshot named '${snapshotName}' already exists (${s.id}). Choose a different name or delete the existing one first.`,
        );
      }
    }
  }

  console.log(`Snapshotting devbox ${id}...`);
  const snapshot = await client.devboxes.snapshotDisk(id, {
    name: snapshotName,
    metadata: {
      [MANAGED_BY_KEY]: MANAGED_BY_VALUE,
    },
  });

  console.log(`Snapshot created: ${snapshot.id}`);
  if (snapshotName) {
    console.log(`Named: ${snapshotName}`);
  }

  return snapshot.id;
}

export async function replaceSnapshot(
  devboxNameOrId: string,
  snapshotName: string,
): Promise<string> {
  const { id: devboxId } = await resolveDevbox(devboxNameOrId);

  if (isDigitalOceanProvider()) {
    const old = listDOSnapshots().filter((s) => s.name === snapshotName);
    if (old.length === 0) {
      throw new Error(
        `No snapshot named '${snapshotName}' to replace. Use 'snapshot create' instead.`,
      );
    }
    for (const s of old) {
      console.log(`Deleting old snapshot ${s.id}...`);
      execFileSync("doctl", ["compute", "snapshot", "delete", s.id, "--force"], {
        stdio: "inherit",
      });
    }
    console.log(`Snapshotting droplet ${devboxId} as '${snapshotName}'...`);
    execFileSync(
      "doctl",
      [
        "compute",
        "droplet-action",
        "snapshot",
        devboxId,
        "--snapshot-name",
        snapshotName,
        "--wait",
      ],
      { stdio: "inherit" },
    );
    const createdId = await waitForDOSnapshotIdByName(snapshotName);
    console.log(`Replaced snapshot '${snapshotName}': ${createdId}`);
    return createdId;
  }

  const client = getClient();

  // Find existing snapshot(s) with this name
  const oldIds: string[] = [];
  for await (const s of client.devboxes.diskSnapshots.list({ limit: 100 })) {
    if (s.name === snapshotName) oldIds.push(s.id);
  }

  if (oldIds.length === 0) {
    throw new Error(
      `No snapshot named '${snapshotName}' to replace. Use 'snapshot create' instead.`,
    );
  }

  // Delete old snapshot(s), then create new with the same name
  for (const oldId of oldIds) {
    console.log(`Deleting old snapshot ${oldId}...`);
    await client.devboxes.diskSnapshots.delete(oldId);
  }

  console.log(`Snapshotting devbox ${devboxId}...`);
  const snapshot = await client.devboxes.snapshotDisk(devboxId, {
    name: snapshotName,
    metadata: { [MANAGED_BY_KEY]: MANAGED_BY_VALUE },
  });

  console.log(`Replaced snapshot '${snapshotName}': ${snapshot.id}`);
  return snapshot.id;
}
