# Phase 04 — Runtimes and dev tools

Goal: install Neovim, Node 22 (via nvm), Claude Code, OpenAI Codex, git-delta, starship, and the NvChad starter. This is the gnarliest phase — most network surface.

Run each block as `user` (not root).

## Neovim (latest stable)

```bash
ssh user@${HOST_IP} bash <<'EOF'
set -euo pipefail
NVIM_ARCH=$(uname -m | sed 's/aarch64/arm64/;s/x86_64/x86_64/')
curl -fsSL "https://github.com/neovim/neovim/releases/latest/download/nvim-linux-${NVIM_ARCH}.tar.gz" \
  | sudo tar xz -C /opt
sudo ln -sf /opt/nvim-linux-${NVIM_ARCH}/bin/nvim /usr/local/bin/nvim
nvim --version | head -1
EOF
```

NvChad requires neovim ≥0.10. The release tarball gives ≥0.11.

## Node 22 via nvm

```bash
ssh user@${HOST_IP} bash <<'EOF'
set -euo pipefail
export NVM_DIR="$HOME/.nvm"
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
. "$NVM_DIR/nvm.sh"
nvm install 22
nvm alias default 22
nvm use 22
NODE_BIN_DIR="$NVM_DIR/versions/node/$(nvm version 22)/bin"
sudo ln -sf "$NODE_BIN_DIR/node" /usr/local/bin/node
sudo ln -sf "$NODE_BIN_DIR/npm"  /usr/local/bin/npm
sudo ln -sf "$NODE_BIN_DIR/npx"  /usr/local/bin/npx
node -v && npm -v
EOF
```

The `/usr/local/bin` symlinks matter: cron and other non-interactive contexts won't have nvm in PATH but `/usr/local/bin` is on the default `secure_path`.

## Claude Code (with retries)

`claude.ai/install.sh` occasionally drops a half-broken binary. Retry up to 3 times:

```bash
ssh user@${HOST_IP} bash <<'EOF'
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
attempts=3
i=1
while [ "$i" -le "$attempts" ]; do
  rm -f "$HOME/.claude/downloads/claude-"* 2>/dev/null || true
  rm -f "$HOME/.local/bin/claude" 2>/dev/null || true
  rm -rf "$HOME/.local/share/claude" 2>/dev/null || true
  hash -r || true
  if curl -fsSL https://claude.ai/install.sh | bash; then
    if "$HOME/.local/bin/claude" --version >/dev/null 2>&1; then
      echo "Claude installed: $($HOME/.local/bin/claude --version)"
      break
    fi
  fi
  echo "Claude install/verify failed (attempt $i/$attempts), retrying..."
  sleep 5
  i=$((i + 1))
done
"$HOME/.local/bin/claude" --version
EOF
```

If this fails 3 times, **stop and report**.

## OpenAI Codex (optional)

```bash
ssh user@${HOST_IP} 'bash -lc "npm i -g @openai/codex && codex --version"'
```

If it fails, log a warning and continue — Codex is nice-to-have.

## git-delta

```bash
ssh user@${HOST_IP} bash <<'EOF'
set -euo pipefail
DELTA_ARCH=$(dpkg --print-architecture)
curl -fL "https://github.com/dandavison/delta/releases/download/0.18.2/git-delta_0.18.2_${DELTA_ARCH}.deb" \
  -o /tmp/git-delta.deb
sudo dpkg -i /tmp/git-delta.deb
rm /tmp/git-delta.deb
git config --global core.pager delta
git config --global interactive.diffFilter 'delta --color-only'
git config --global delta.side-by-side true
git config --global delta.navigate true
git config --global delta.line-numbers true
EOF
```

## Starship prompt

```bash
ssh user@${HOST_IP} 'bash -lc "curl -sS https://starship.rs/install.sh | sh -s -- -y -b \$HOME/.local/bin"'
```

The `~/.bashrc` thopter block (phase 05) calls `starship init bash`.

## NvChad starter (optional)

```bash
ssh user@${HOST_IP} '
  if [ ! -d ~/.config/nvim ]; then
    git clone https://github.com/NvChad/starter ~/.config/nvim
  fi
'
```

## Verification

```bash
ssh user@${HOST_IP} 'bash -lc "
  set -e
  nvim --version | head -1
  node -v
  npm -v
  claude --version
  starship --version
  delta --version | head -1
"'
```
