# DigitalOcean Setup Notes

Minimal setup for the current DigitalOcean-backed thopter workflow.

## Install and Authenticate `doctl`

```bash
brew install doctl
doctl auth init --context thopters
doctl auth switch --context thopters
doctl auth list
```

`thopter setup` expects `doctl auth list` to show a current context.

## Ensure Local SSH Keys Exist

The current DigitalOcean path expects:

```bash
ls ~/.ssh/id_rsa ~/.ssh/id_rsa.pub
```

If those files do not exist, create or symlink them before running setup.

## Run Thopter Setup

```bash
thopter setup
```

In DigitalOcean mode this will:

1. Verify `doctl` auth
2. Verify `~/.ssh/id_rsa` and `~/.ssh/id_rsa.pub`
3. Ensure `~/.ssh/id_rsa.pub` is imported into DigitalOcean SSH keys
4. Prompt for Redis and thopter env vars
5. Optionally configure `ntfy.sh`

## Useful Checks

```bash
thopter provider
doctl compute droplet list
doctl compute snapshot list
```

At the time of writing, `thopter provider` should print:

```text
digitalocean
```

## Notes

- The project still contains RunLoop-era naming in places, but DigitalOcean is the active backend.
- Droplet snapshots are the current replacement for the old golden-image workflow.
- `suspend`, `resume`, and `keepalive` are not supported in DigitalOcean mode.
