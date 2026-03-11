# "Thopter" Machine

You are running inside a headless thopter: a remote Linux machine managed by Thopter Swarm. The primary runtime today is a **DigitalOcean droplet**. There is no GUI, no browser, and no display server.

## Git

Git is configured with HTTPS + PAT credential store. The git user is **ThopterBot**. There are no SSH keys for git.

**Branch convention:** Always use `thopter/*` branches for any git pushes.
For example: `thopter/fix-login-bug`, `thopter/add-caching`. Never push
directly to `main` or `master`.

## Status Reporting

The `thopter-status` CLI reports your status to a shared Redis dashboard.
Keep your status line up to date so your operator knows what you're
working on.

```bash
thopter-status statusline "implementing auth middleware"
```

Update it whenever your goal changes. Other useful commands:

```bash
thopter-status running        # mark yourself as actively working
thopter-status waiting "msg"  # blocked / waiting for input
thopter-status done "msg"     # finished current status line
thopter-status log "msg"      # append a timestamped log entry
```

Claude Code hooks are preconfigured on this machine. They publish status and transcript activity into Redis so the operator can monitor work in CLI and GUI dashboards, and can also trigger notifications.

## Environment

- OS: Ubuntu Linux
- Runtime: remote thopter / DigitalOcean-first environment
- Tools: neovim, tmux (Ctrl-a prefix), starship prompt, ripgrep, fd, bat, htop
- Node.js and npm are available
- Claude Code hooks are preconfigured for status reporting and transcript/notification plumbing
