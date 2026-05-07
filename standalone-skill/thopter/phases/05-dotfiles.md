# Phase 05 — Dotfiles

Goal: copy the canonical config files from `${SKILL_DIR}/assets/dotfiles/` to the right places on the target. **Copy verbatim** — these files are tested against the dashboard's expectations.

## Files to copy

| Source (in `assets/dotfiles/`) | Destination on target |
|--------------------------------|----------------------|
| `tmux.conf` | `~/.tmux.conf` |
| `nvim/lua/options.lua` | `~/.config/nvim/lua/options.lua` |
| `nvim/lua/plugins/thopter.lua` | `~/.config/nvim/lua/plugins/thopter.lua` |
| `starship.toml` | `~/.config/starship.toml` |
| `CLAUDE.md` *or* operator's `claudeMdPath` | `~/.claude/CLAUDE.md` |
| (same as above) | `~/.codex/AGENTS.md` |

## Upload

```bash
ssh user@${HOST_IP} 'mkdir -p ~/.config/nvim/lua/plugins ~/.config ~/.claude ~/.codex'

scp ${SKILL_DIR}/assets/dotfiles/tmux.conf                    user@${HOST_IP}:.tmux.conf
scp ${SKILL_DIR}/assets/dotfiles/nvim/lua/options.lua          user@${HOST_IP}:.config/nvim/lua/options.lua
scp ${SKILL_DIR}/assets/dotfiles/nvim/lua/plugins/thopter.lua  user@${HOST_IP}:.config/nvim/lua/plugins/thopter.lua
scp ${SKILL_DIR}/assets/dotfiles/starship.toml                 user@${HOST_IP}:.config/starship.toml

# Pick the right CLAUDE.md
CLAUDE_MD="${CLAUDE_MD:-${SKILL_DIR}/assets/dotfiles/CLAUDE.md}"
scp "$CLAUDE_MD" user@${HOST_IP}:.claude/CLAUDE.md
scp "$CLAUDE_MD" user@${HOST_IP}:.codex/AGENTS.md
```

If intake found `claudeMdPath` in `~/.thopter.json`, use that file. Otherwise the skill's default at `assets/dotfiles/CLAUDE.md`.

## ~/.bashrc thopter block

This is the only file we *generate* rather than copy. Idempotent — re-runs safely.

```bash
ssh user@${HOST_IP} bash <<'EOF'
set -euo pipefail
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
EOF
```

This sources `~/.thopter-env` (created in phase 06). At this point in setup the file doesn't exist yet — bash will print a "No such file" warning, harmless.

## Verification

```bash
ssh user@${HOST_IP} '
  set -e
  test -f ~/.tmux.conf
  test -f ~/.config/nvim/lua/options.lua
  test -f ~/.config/starship.toml
  test -f ~/.claude/CLAUDE.md
  test -f ~/.codex/AGENTS.md
  grep -q "# --- thopter ---" ~/.bashrc
  echo OK
'
```

## Custom uploads from intake

If intake collected `uploads` (extra `{local, remote}` pairs from `~/.thopter.json`), copy them now after the canonical dotfiles, so they can override:

```bash
for entry in $UPLOADS; do
  scp $entry.local user@${HOST_IP}:$entry.remote
done
```
