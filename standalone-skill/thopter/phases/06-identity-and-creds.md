# Phase 06 — Identity and credentials

Goal: set the hostname, write `~/.thopter-env` with all environment variables, and configure git to use `GH_TOKEN` for HTTPS pushes as `ThopterBot`.

## Hostname

```bash
HOST_NAME="${THOPTER_NAME}"  # must be valid: a-z 0-9 dashes, lowercase
ssh user@${HOST_IP} "
  sudo hostnamectl set-hostname '${HOST_NAME}'
  echo '${HOST_NAME}' | sudo tee /etc/hostname >/dev/null
"
```

If `THOPTER_NAME` has characters not valid in a hostname, lowercase and strip them first.

## ~/.thopter-env

This is **the** source of truth for the thopter's environment. Sourced by `~/.bashrc` (interactive shells) and explicitly by the heartbeat cron (non-interactive). Cron and Claude hooks both depend on it being present and correct.

Required lines:

```bash
export THOPTER_NAME="<thopter name>"
export THOPTER_ID="<provider id, or fall back to THOPTER_NAME>"
export THOPTER_OWNER="<owner name from git config>"
```

Then everything from the resolved `envVars` (intake), at minimum:

```bash
export GH_TOKEN="<github personal access token>"
export THOPTER_REDIS_URL="rediss://...:port"     # required or status reporting silently no-ops
export THOPTER_NTFY_CHANNEL="<channel>"          # optional, enables ntfy.sh
export ANTHROPIC_API_KEY="<key>"                 # optional, for API-key auth instead of OAuth
```

Plus optional stop-notify controls:

```bash
export THOPTER_STOP_NOTIFY=0                     # set if stopNotifications=false in intake
export THOPTER_STOP_NOTIFY_QUIET_PERIOD="<seconds>"
```

### Building and writing the file

Generate locally then scp. Use single-quotes around values to avoid shell metachar mishaps:

```bash
TMP=$(mktemp)
cat > $TMP <<EOF
export THOPTER_NAME='${THOPTER_NAME}'
export THOPTER_ID='${THOPTER_ID:-$THOPTER_NAME}'
export THOPTER_OWNER='${THOPTER_OWNER}'
export GH_TOKEN='${GH_TOKEN}'
export THOPTER_REDIS_URL='${THOPTER_REDIS_URL}'
EOF
# ... append remaining envVars ...

scp $TMP user@${HOST_IP}:.thopter-env
ssh user@${HOST_IP} 'chmod 600 ~/.thopter-env'
rm $TMP
```

`chmod 600` because this contains secrets.

If a value contains a single quote, escape it: `'value with '\''quote'\'' inside'`.

## Git credentials

With `GH_TOKEN` in env, configure git for HTTPS PAT auth and set the committer identity to `ThopterBot`:

```bash
ssh user@${HOST_IP} bash <<'EOF'
set -euo pipefail
. ~/.thopter-env
git config --global credential.helper store
echo "https://thopterbot:${GH_TOKEN}@github.com" > ~/.git-credentials
chmod 600 ~/.git-credentials
git config --global url."https://github.com/".insteadOf "git@github.com:"
git config --global user.name  "ThopterBot"
git config --global user.email "thopterbot@telepath.computer"
EOF
```

The `insteadOf` rewrite means even `git@github.com:owner/repo` clone URLs use HTTPS+PAT. Thopters have no SSH key for GitHub.

## Workspace dir

A few hooks/scripts assume `~/workspace` exists. Create it now:

```bash
ssh user@${HOST_IP} 'mkdir -p ~/workspace'
```

## Verification

```bash
ssh user@${HOST_IP} '
  set -e
  hostname  # should match $THOPTER_NAME
  test -f ~/.thopter-env
  bash -lc "echo \$THOPTER_NAME; echo \$THOPTER_REDIS_URL | sed s/:.*@/:REDACTED@/"
  git config --global user.name  # ThopterBot
  test -f ~/.git-credentials
  echo OK
'
```

End-to-end redis sanity check (first time `THOPTER_REDIS_URL` gets exercised):

```bash
ssh user@${HOST_IP} 'bash -lc "redis-cli --tls -u \$THOPTER_REDIS_URL ping"'
# expected: PONG
```

If `PONG`, move to phase 07. If not, recheck `THOPTER_REDIS_URL` in `~/.thopter-env` — phases 07 and 08 both depend on it.
