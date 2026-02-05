"""Sandbox creation and management logic."""

import modal

from config import (
    APP_NAME,
    SANDBOX_CPU,
    SANDBOX_IDLE_TIMEOUT,
    SANDBOX_MEMORY,
    SANDBOX_TIMEOUT,
    SECRET_NAME,
    get_snapshot,
    list_sandboxes,
    list_snapshots,
    remove_sandbox,
    resolve_sandbox,
    save_sandbox,
    save_snapshot,
)
from image import build_base_image

# Git setup script that runs inside the sandbox on first create
INIT_SCRIPT = r"""
set -e

# Configure git credentials using PAT from environment
if [ -n "$GITHUB_PAT" ]; then
    git config --global credential.helper store
    echo "https://thopterbot:${GITHUB_PAT}@github.com" > ~/.git-credentials
    git config --global user.name "ThopterBot"
    git config --global user.email "thopterbot@telepath.computer"
    echo "Git configured with PAT credentials"
else
    echo "WARNING: GITHUB_PAT not set, git push/pull to private repos won't work"
fi

# Ensure uv is on PATH
export PATH="/root/.cargo/bin:$PATH"

echo "Sandbox init complete"
"""


def _get_app() -> modal.App:
    return modal.App.lookup(APP_NAME, create_if_missing=True)


def _get_secrets() -> list[modal.Secret]:
    """Load the thopter-secrets Modal Secret. Falls back gracefully."""
    try:
        return [modal.Secret.from_name(SECRET_NAME)]
    except modal.exception.NotFoundError:
        print(f"WARNING: Modal secret '{SECRET_NAME}' not found. Create it with:")
        print(f"  modal secret create {SECRET_NAME} ANTHROPIC_API_KEY=... GITHUB_PAT=...")
        return []


def create_sandbox(
    name: str | None = None,
    from_snapshot: str | None = None,
    skip_init: bool = False,
) -> str:
    """Create a new sandbox. Returns the sandbox ID."""
    app = _get_app()
    secrets = _get_secrets()

    if from_snapshot:
        image_id = get_snapshot(from_snapshot)
        image = modal.Image.from_id(image_id)
        print(f"Creating sandbox from snapshot: {from_snapshot} ({image_id})")
    else:
        image = build_base_image()
        print("Creating sandbox from base image (this may take a few minutes on first run)...")

    with modal.enable_output():
        sb = modal.Sandbox.create(
            image=image,
            secrets=secrets,
            app=app,
            timeout=SANDBOX_TIMEOUT,
            idle_timeout=SANDBOX_IDLE_TIMEOUT,
            cpu=SANDBOX_CPU,
            memory=SANDBOX_MEMORY,
        )

    sandbox_id = sb.object_id
    print(f"Sandbox created: {sandbox_id}")

    if name:
        save_sandbox(name, sandbox_id)
        print(f"Saved as: {name}")

    # Run init script unless skipped (e.g. when forking from snapshot that already ran it)
    if not skip_init:
        print("Running init script...")
        p = sb.exec("bash", "-c", INIT_SCRIPT, timeout=60)
        for line in p.stdout:
            print(f"  {line}", end="")
        p.wait()
        if p.returncode != 0:
            print(f"WARNING: Init script exited with code {p.returncode}")
            stderr = p.stderr.read()
            if stderr:
                print(f"  stderr: {stderr}")

    return sandbox_id


def exec_command(sandbox_ref: str, command: list[str], timeout: int = 300) -> int:
    """Run a command in a sandbox. Returns exit code."""
    sandbox_id = resolve_sandbox(sandbox_ref)
    sb = modal.Sandbox.from_id(sandbox_id)

    p = sb.exec(*command, timeout=timeout)
    for line in p.stdout:
        print(line, end="")
    for line in p.stderr:
        print(line, end="")
    p.wait()
    return p.returncode


def interactive_shell(sandbox_ref: str) -> None:
    """Attach an interactive shell to a sandbox using modal sandbox exec."""
    import os
    import subprocess

    sandbox_id = resolve_sandbox(sandbox_ref)
    print(f"Attaching shell to {sandbox_id}...")
    print("(Use 'exit' or Ctrl-D to detach)")
    # Use the modal CLI for interactive PTY support, since the Python SDK
    # exec doesn't give us a proper TTY.
    subprocess.run(
        ["modal", "sandbox", "exec", sandbox_id, "bash"],
        stdin=None,  # inherit
        stdout=None,  # inherit
        stderr=None,  # inherit
        env={**os.environ},
    )


def snapshot_sandbox(sandbox_ref: str, label: str | None = None) -> str:
    """Snapshot a sandbox's filesystem. Returns the image ID."""
    sandbox_id = resolve_sandbox(sandbox_ref)
    sb = modal.Sandbox.from_id(sandbox_id)

    print(f"Snapshotting {sandbox_id}...")
    image = sb.snapshot_filesystem()
    image_id = image.object_id
    print(f"Snapshot created: {image_id}")

    if label:
        save_snapshot(label, image_id)
        print(f"Saved as: {label}")

    return image_id


def fork_sandbox(snapshot_ref: str, name: str | None = None) -> str:
    """Create a new sandbox from a snapshot. Returns the sandbox ID."""
    return create_sandbox(name=name, from_snapshot=snapshot_ref, skip_init=True)


def destroy_sandbox(sandbox_ref: str) -> None:
    """Terminate a sandbox."""
    sandbox_id = resolve_sandbox(sandbox_ref)
    sb = modal.Sandbox.from_id(sandbox_id)

    print(f"Terminating {sandbox_id}...")
    sb.terminate()
    remove_sandbox(sandbox_ref)
    print("Done")


def show_list(show_sandboxes: bool = True, show_snapshots: bool = True) -> None:
    """List sandboxes and/or snapshots."""
    if show_sandboxes:
        sandboxes = list_sandboxes()
        print("Sandboxes:")
        if sandboxes:
            for name, sid in sandboxes.items():
                print(f"  {name}: {sid}")
        else:
            print("  (none)")
        print()

    if show_snapshots:
        snapshots = list_snapshots()
        print("Snapshots:")
        if snapshots:
            for label, iid in snapshots.items():
                print(f"  {label}: {iid}")
        else:
            print("  (none)")
