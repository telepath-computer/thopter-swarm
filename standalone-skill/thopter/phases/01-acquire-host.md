# Phase 01 — Acquire host

Goal: end this phase with `HOST_IP`, `SSH_USER`, and `SSH_KEY` filled in, and a working `ssh ${SSH_USER}@${HOST_IP}` that returns a shell.

Skip this phase if the user already gave you an IP + SSH login during intake.

## Path A: DigitalOcean (via `doctl`)

User must have `doctl` installed and authenticated. Their public SSH key must be registered with DigitalOcean (`doctl compute ssh-key list`).

```bash
doctl compute droplet create thopter-${THOPTER_NAME} \
  --image ubuntu-24-04-x64 \
  --region sfo3 \
  --size s-2vcpu-4gb \
  --ssh-keys $(doctl compute ssh-key list --format ID --no-header | head -1) \
  --wait \
  --output json
```

Pull the public IPv4 from the response. Then wait for SSH:

```bash
until ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 root@${HOST_IP} true 2>/dev/null; do
  echo "waiting for ssh..."; sleep 5
done
```

`SSH_USER=root`, `SSH_KEY=~/.ssh/id_rsa` (or whichever local key matches the registered DO fingerprint).

## Path B: Hetzner / bare metal / "I made it in the web UI"

The user already has the IP. Confirm:

- They installed Ubuntu 22.04 or 24.04. (Other distros may work but the apt list in phase 03 assumes Debian/Ubuntu.)
- Their SSH public key is in `/root/.ssh/authorized_keys` on the target.
- The box has at least 4GB RAM and 20GB disk (Claude + Node + npm caches eat space).

Verify SSH:

```bash
ssh -o ConnectTimeout=5 root@${HOST_IP} 'uname -a; cat /etc/os-release | head -3'
```

`SSH_USER=root` for a fresh Hetzner box.

## Path C: Existing host with non-root user

User has an Ubuntu box where they already have a personal account with sudo. Confirm passwordless sudo works:

```bash
ssh ${SSH_USER}@${HOST_IP} 'sudo -n true && echo OK || echo NEEDS_PASSWORD'
```

If `NEEDS_PASSWORD`, ask the user to add `${SSH_USER} ALL=(ALL) NOPASSWD:ALL` to `/etc/sudoers.d/thopter-user` (chmod 440) before continuing. Non-interactive sudo is required for everything that follows.

In this path, all canonical paths (`/home/user/.claude/hooks/...`, `~/.thopter-env`, etc.) assume the username is literally `user`. If the existing username is different, **create a separate `user` account anyway** in phase 02 and use that — adapting paths is more error-prone than just having a dedicated user.

## Verification

```bash
ssh ${SSH_USER}@${HOST_IP} 'whoami; sudo -n whoami; uname -a'
```

Expect: a username, `root` (from sudo), a Linux kernel string. Move to phase 02.
