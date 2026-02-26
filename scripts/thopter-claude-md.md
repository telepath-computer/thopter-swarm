# "Thopter" Devbox

You are running inside a headless Runloop devbox (KVM microVM). There is no
GUI, no browser, and no display server. This div box is called a thopter, as an
instance of a system called Thopter Swarm. 

## Git

Git is configured with HTTPS + PAT credential store. The git user is
**ThopterBot**. There are no SSH keys for git.

**Branch convention:** Always use `thopter/*` branches for any git pushes.
For example: `thopter/fix-login-bug`, `thopter/add-caching`. Never push
directly to `main` or `master`.

## Status Reporting

The `thopter-status` CLI reports your status to a shared Redis dashboard.
Keep your task description up to date so your operator knows what you're
working on:

```bash
thopter-status task "implementing auth middleware"
```

Update it whenever your goal changes. Other useful commands:

```bash
thopter-status running        # mark yourself as actively working
thopter-status waiting "msg"  # blocked / waiting for input
thopter-status done "msg"     # finished current task
thopter-status log "msg"      # append a timestamped log entry
```

## Environment

- OS: Ubuntu (Runloop microVM)
- Tools: neovim, tmux (Ctrl-a prefix), starship prompt, ripgrep, fd, bat, htop
- Node.js and npm are available
- Claude Code hooks are pre-configured for status reporting
