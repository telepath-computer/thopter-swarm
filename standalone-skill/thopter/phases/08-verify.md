# Phase 08 — Verify

Goal: confirm the thopter is alive end-to-end. Each prior phase had its own quick check; this is the round-trip.

## 1. Identity & env

```bash
ssh user@${HOST_IP} 'bash -lc "
  echo \"name:   \$THOPTER_NAME\"
  echo \"id:     \$THOPTER_ID\"
  echo \"owner:  \$THOPTER_OWNER\"
  echo \"redis:  \$(echo \$THOPTER_REDIS_URL | sed s/:.*@/:REDACTED@/)\"
  echo \"ntfy:   \${THOPTER_NTFY_CHANNEL:-(none)}\"
  hostname
"'
```

Hostname should match `THOPTER_NAME` (or its hostname-coerced form).

## 2. Redis round-trip

```bash
ssh user@${HOST_IP} 'bash -lc "
  redis-cli --tls -u \$THOPTER_REDIS_URL ping
  thopter-status statusline \"thopter setup verification\"
  redis-cli --tls -u \$THOPTER_REDIS_URL GET \"thopter:\${THOPTER_NAME}:status_line\"
"'
```

Expect:
- `PONG` from the ping
- No error from `thopter-status statusline`
- The exact string `thopter setup verification` returned by GET

If GET returns `(nil)` or an error, the status pipeline is broken. Most common cause: `~/.thopter-env` isn't being sourced. Check `bash -lc 'env | grep THOPTER'` shows all the vars.

## 3. Heartbeat cron

```bash
ssh user@${HOST_IP} 'bash -lc "
  /usr/local/bin/thopter-heartbeat &
  sleep 12
  redis-cli --tls -u \$THOPTER_REDIS_URL GET \"thopter:\${THOPTER_NAME}:heartbeat\"
"'
```

Expect a recent ISO-8601 timestamp. Cron will run this once a minute on its own.

## 4. Claude hooks (smoke test)

Fire a hook manually to confirm it executes without error:

```bash
ssh user@${HOST_IP} 'bash -lc "
  echo \"{}\" | ~/.claude/hooks/on-session-start.sh
  redis-cli --tls -u \$THOPTER_REDIS_URL GET \"thopter:\${THOPTER_NAME}:status\"
"'
```

The hook should run without error. Exact Redis effects depend on the hook; you mainly want to confirm the script executes without `command not found` or missing-env errors.

A more thorough test: launch Claude Code on the box and watch the dashboard:

```bash
ssh user@${HOST_IP} -t 'tmux new-session -A -s claude "cd ~/workspace && claude"'
```

If the operator has Redis-backed dashboards, the new session should appear there.

## 5. Git / GitHub

```bash
ssh user@${HOST_IP} 'bash -lc "
  git config --global user.name
  gh auth status
"'
```

`gh auth status` reads `GH_TOKEN` directly from env. If it errors with "not logged in", confirm `~/.thopter-env` is sourced (`bash -lc` is required).

## 6. Final checks

Print a summary the user can hand to the dashboard:

```
Thopter:    ${THOPTER_NAME}
Owner:      ${THOPTER_OWNER}
IP:         ${HOST_IP}
SSH:        ssh user@${HOST_IP}
Status key: thopter:${THOPTER_NAME}:status
Redis:      ${THOPTER_REDIS_URL%%@*}@<redacted>
```

Recommend the user try:

```bash
ssh user@${HOST_IP} -t 'tmux new-session -A -s claude "cd ~/workspace && claude --dangerously-skip-permissions"'
```

…then check their dashboard for activity.

## When verification fails

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `redis-cli ping` fails | `THOPTER_REDIS_URL` wrong, or TLS issue | Re-check the URL in `~/.thopter-env`; try without `--tls` if your redis isn't TLS |
| Hooks don't fire when Claude runs | `settings.json` missing them, or wrong paths | Re-run the jq merge from phase 07 step 3 |
| `thopter-status` writes but heartbeat key is stale | Cron not running, or env not loaded by cron | `pgrep cron`; tail `/var/log/syslog` for cron entries |
| `claude --version` works as user but not from cron | PATH issue | Symlink: `sudo ln -sf ~/.local/bin/claude /usr/local/bin/claude` |
| `gh auth status` fails with "not logged in" | `GH_TOKEN` not in env at the moment of running gh | Use `bash -lc` so `~/.bashrc` sources `~/.thopter-env` |

If anything is off and you can't fix it in two attempts, surface to the user with what you've checked.

---

## Optional: write `~/.thopter.json`

If intake didn't have one, offer to write a `~/.thopter.json` on the operator's machine for next time:

```bash
cat > ~/.thopter.json <<EOF
{
  "envVars": {
    "GH_TOKEN": "...",
    "THOPTER_REDIS_URL": "...",
    "THOPTER_NTFY_CHANNEL": "..."
  }
}
EOF
chmod 600 ~/.thopter.json
```

Don't write it without asking — the operator may already have one with extra fields, or have a deliberate reason for not having one.
