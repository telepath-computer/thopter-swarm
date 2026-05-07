# Phase 02 — User account and SSH

Goal: a Linux user named `user` exists on the target, has `NOPASSWD` sudo, and has the operator's SSH key in `~/.ssh/authorized_keys`. After this phase you'll switch to SSH'ing in as `user`.

## Skip if

`${SSH_USER}` is already `user` and `sudo -n` works. Just verify (bottom of doc) and move on.

## Create the user

SSH'd in as root (or any sudoer):

```bash
ssh ${SSH_USER}@${HOST_IP} "sudo bash -s" <<'EOF'
set -euo pipefail
if ! id -u user >/dev/null 2>&1; then
  useradd -m -s /bin/bash -G sudo user
fi
echo "user ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/thopter-user
chmod 440 /etc/sudoers.d/thopter-user
mkdir -p /home/user/.ssh
if [ -f /root/.ssh/authorized_keys ]; then
  cp /root/.ssh/authorized_keys /home/user/.ssh/authorized_keys
fi
chown -R user:user /home/user/.ssh
chmod 700 /home/user/.ssh
chmod 600 /home/user/.ssh/authorized_keys || true
EOF
```

If `${SSH_USER}` is a non-root sudoer, the `cp /root/.ssh/authorized_keys` line won't apply — copy from `~${SSH_USER}/.ssh/authorized_keys` instead.

## Switch to user

From now on, all SSH should be as `user`:

```bash
SSH_USER=user
ssh user@${HOST_IP} 'whoami; sudo -n whoami'
# expected: user / root
```

If the second `sudo -n whoami` fails, re-check the sudoers file. Don't proceed until passwordless sudo works.

## Verification

```bash
ssh user@${HOST_IP} '
  set -e
  test "$(whoami)" = user
  test -d "$HOME"
  sudo -n true
  echo OK
'
```
