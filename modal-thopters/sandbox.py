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
    list_snapshots,
    save_snapshot,
)
from image import build_base_image


def _resolve_sandbox(name_or_id: str) -> modal.Sandbox:
    """Resolve a sandbox by name or ID, returning a live Sandbox object."""
    if name_or_id.startswith("sb-"):
        return modal.Sandbox.from_id(name_or_id)
    try:
        return modal.Sandbox.from_name(APP_NAME, name_or_id)
    except modal.exception.NotFoundError:
        raise SystemExit(f"No running sandbox named '{name_or_id}'")


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
            name=name,
            secrets=secrets,
            app=app,
            timeout=SANDBOX_TIMEOUT,
            idle_timeout=SANDBOX_IDLE_TIMEOUT,
            cpu=SANDBOX_CPU,
            memory=SANDBOX_MEMORY,
            # IS_SANDBOX=1 allows Claude Code to run in --dangerously-skip-permissions
            # mode as root without additional prompts
            env={"IS_SANDBOX": "1"},
        )

    sandbox_id = sb.object_id
    print(f"Sandbox created: {sandbox_id}")
    if name:
        sb.set_tags({"name": name})
        print(f"Named: {name}")

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
    sb = _resolve_sandbox(sandbox_ref)

    p = sb.exec(*command, timeout=timeout)
    for line in p.stdout:
        print(line, end="")
    for line in p.stderr:
        print(line, end="")
    p.wait()
    return p.returncode


def interactive_shell(sandbox_ref: str) -> None:
    """Attach an interactive shell to a sandbox.

    Wraps `modal shell` with a local escape sequence handler.
    Press Enter then ~. to force-disconnect (like SSH).
    Enter ~? for help.
    """
    import fcntl
    import os
    import pty
    import select
    import signal
    import struct
    import termios
    import tty

    ESCAPE_CHAR = ord("~")
    ESCAPE_HELP = (
        "\r\nSupported escape sequences:\r\n"
        "  ~.  Disconnect (kill the session)\r\n"
        "  ~~  Send literal ~\r\n"
        "  ~?  Show this help\r\n"
    )

    def copy_winsize(from_fd, to_fd):
        """Copy terminal dimensions from one fd to another."""
        try:
            winsize = fcntl.ioctl(from_fd, termios.TIOCGWINSZ, b"\x00" * 8)
            fcntl.ioctl(to_fd, termios.TIOCSWINSZ, winsize)
        except OSError:
            pass

    sb = _resolve_sandbox(sandbox_ref)
    sandbox_id = sb.object_id
    print(f"Attaching shell to {sandbox_id}...")
    print("(Use 'exit' or Ctrl-D to detach, Enter ~. to force-disconnect)")

    child_pid, master_fd = pty.fork()

    if child_pid == 0:
        # Child: exec modal shell
        os.execvp("modal", ["modal", "shell", sandbox_id])

    # Set child PTY to match our real terminal size
    copy_winsize(0, master_fd)

    # Propagate terminal resizes to the child PTY
    def handle_winch(signum, frame):
        copy_winsize(0, master_fd)

    old_sigwinch = signal.signal(signal.SIGWINCH, handle_winch)

    # Parent: proxy I/O with escape sequence detection
    old_settings = termios.tcgetattr(0)
    try:
        tty.setraw(0)

        after_newline = True  # start of session counts as after newline
        in_escape = False

        while True:
            try:
                rlist, _, _ = select.select([0, master_fd], [], [], 0.5)
            except select.error:
                break

            if master_fd in rlist:
                try:
                    data = os.read(master_fd, 4096)
                except OSError:
                    break
                if not data:
                    break
                os.write(1, data)

            if 0 in rlist:
                try:
                    data = os.read(0, 4096)
                except OSError:
                    break
                if not data:
                    break

                out = bytearray()
                for byte in data:
                    if in_escape:
                        in_escape = False
                        if byte == ord("."):
                            # ~. = disconnect
                            os.write(1, b"\r\nDisconnected.\r\n")
                            os.kill(child_pid, signal.SIGKILL)
                            os.waitpid(child_pid, 0)
                            return
                        elif byte == ord("?"):
                            # ~? = help
                            os.write(1, ESCAPE_HELP.encode())
                            continue
                        elif byte == ESCAPE_CHAR:
                            # ~~ = literal ~
                            out.append(byte)
                            after_newline = False
                            continue
                        else:
                            # Not a recognized escape; send the ~ we swallowed
                            out.append(ESCAPE_CHAR)
                            out.append(byte)
                            after_newline = byte in (ord("\r"), ord("\n"))
                            continue
                    elif after_newline and byte == ESCAPE_CHAR:
                        in_escape = True
                        continue
                    else:
                        after_newline = byte in (ord("\r"), ord("\n"))
                        out.append(byte)

                if out:
                    os.write(master_fd, bytes(out))

            # Check if child exited
            pid, status = os.waitpid(child_pid, os.WNOHANG)
            if pid != 0:
                break

    finally:
        termios.tcsetattr(0, termios.TCSAFLUSH, old_settings)
        signal.signal(signal.SIGWINCH, old_sigwinch)
        # Clean up child if still running
        try:
            os.kill(child_pid, signal.SIGTERM)
            os.waitpid(child_pid, 0)
        except (OSError, ChildProcessError):
            pass


def snapshot_sandbox(sandbox_ref: str, label: str | None = None) -> str:
    """Snapshot a sandbox's filesystem. Returns the image ID."""
    sb = _resolve_sandbox(sandbox_ref)

    print(f"Snapshotting {sb.object_id}...")
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
    sb = _resolve_sandbox(sandbox_ref)

    print(f"Terminating {sb.object_id}...")
    sb.terminate()
    print("Done")


def show_list(show_sandboxes: bool = True, show_snapshots: bool = True) -> None:
    """List sandboxes and/or snapshots."""
    if show_sandboxes:
        app = _get_app()
        print("Sandboxes:")
        found = False
        for sb in modal.Sandbox.list(app_id=app.app_id):
            tags = sb.get_tags()
            name = tags.pop("name", "")
            header = f"  {name} ({sb.object_id})" if name else f"  {sb.object_id}"
            print(header)
            for k, v in sorted(tags.items()):
                print(f"    {k}: {v}")
            found = True
        if not found:
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


def get_tags(sandbox_ref: str) -> None:
    """Show tags on a sandbox."""
    sb = _resolve_sandbox(sandbox_ref)
    tags = sb.get_tags()
    if tags:
        for k, v in sorted(tags.items()):
            print(f"{k}: {v}")
    else:
        print("(no tags)")


def set_tags(sandbox_ref: str, tags: dict[str, str]) -> None:
    """Set tags on a sandbox (merges with existing)."""
    sb = _resolve_sandbox(sandbox_ref)
    existing = sb.get_tags()
    existing.update(tags)
    sb.set_tags(existing)
    print(f"Set {len(tags)} tag(s) on {sb.object_id}")


def remove_tags(sandbox_ref: str, keys: list[str]) -> None:
    """Remove tags from a sandbox by key."""
    sb = _resolve_sandbox(sandbox_ref)
    existing = sb.get_tags()
    removed = []
    for key in keys:
        if key in existing:
            del existing[key]
            removed.append(key)
    if removed:
        sb.set_tags(existing)
        print(f"Removed: {', '.join(removed)}")
    else:
        print("No matching tags found")
