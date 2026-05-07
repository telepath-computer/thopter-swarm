# Phase 03 — Base apt packages

Goal: install the OS-level tools every thopter needs.

## Add the GitHub CLI apt repo

`gh` isn't in the default Ubuntu repos:

```bash
ssh user@${HOST_IP} bash <<'EOF'
set -euo pipefail
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg 2>/dev/null
sudo chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
EOF
```

## Install packages

```bash
ssh user@${HOST_IP} '
  set -euo pipefail
  sudo apt-get update -qq
  sudo apt-get install -y -qq \
    git tmux wget curl jq redis-tools cron \
    ripgrep fd-find htop tree unzip bat less \
    strace lsof ncdu dnsutils net-tools iproute2 \
    xvfb xauth bash-completion gh
  sudo /usr/sbin/cron 2>/dev/null || true
'
```

Notes:
- `redis-tools` provides `redis-cli` — required for status reporting and the heartbeat.
- `xvfb` + `xauth` are present for Claude Code workflows that use a virtual display (e.g., headless browsers). ~30MB; keep them.
- `cron` doesn't auto-start on some Hetzner cloud images; the explicit `sudo /usr/sbin/cron` force-starts it.
- `bat` installs as `batcat` on Ubuntu — fine, nothing depends on the binary name.
- `fd-find` installs as `fdfind`.

## Verification

```bash
ssh user@${HOST_IP} '
  set -e
  for cmd in git tmux jq redis-cli rg htop gh curl; do
    command -v "$cmd" >/dev/null || { echo "MISSING: $cmd"; exit 1; }
  done
  pgrep -x cron >/dev/null && echo "cron: running" || echo "cron: NOT running"
'
```
