#!/usr/bin/env python3
"""CLI for managing Modal sandboxes for thopter development."""

import argparse
import sys


def cmd_create(args):
    from sandbox import create_sandbox

    create_sandbox(
        name=args.name,
        from_snapshot=args.from_snapshot,
    )


def cmd_shell(args):
    from sandbox import interactive_shell

    interactive_shell(args.sandbox)


def cmd_exec(args):
    from sandbox import exec_command

    rc = exec_command(args.sandbox, args.command, timeout=args.timeout)
    sys.exit(rc)


def cmd_snapshot(args):
    from sandbox import snapshot_sandbox

    snapshot_sandbox(args.sandbox, label=args.label)


def cmd_fork(args):
    from sandbox import fork_sandbox

    fork_sandbox(args.snapshot, name=args.name)


def cmd_list(args):
    from sandbox import show_list

    show_sandboxes = not args.snapshots_only
    show_snapshots = not args.sandboxes_only
    show_list(show_sandboxes=show_sandboxes, show_snapshots=show_snapshots)


def cmd_destroy(args):
    from sandbox import destroy_sandbox

    destroy_sandbox(args.sandbox)


def main():
    parser = argparse.ArgumentParser(
        prog="modal-thopters",
        description="Manage Modal sandboxes for Claude Code development",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # create
    p = sub.add_parser("create", help="Create a new sandbox")
    p.add_argument("--name", "-n", help="Name for the sandbox")
    p.add_argument("--from-snapshot", "-s", help="Snapshot label or image ID to create from")
    p.set_defaults(func=cmd_create)

    # shell
    p = sub.add_parser("shell", help="Interactive bash shell in a sandbox")
    p.add_argument("sandbox", help="Sandbox name or ID")
    p.set_defaults(func=cmd_shell)

    # exec
    p = sub.add_parser("exec", help="Run a command in a sandbox")
    p.add_argument("sandbox", help="Sandbox name or ID")
    p.add_argument("command", nargs="+", help="Command to run")
    p.add_argument("--timeout", "-t", type=int, default=300, help="Timeout in seconds (default: 300)")
    p.set_defaults(func=cmd_exec)

    # snapshot
    p = sub.add_parser("snapshot", help="Snapshot a sandbox's filesystem")
    p.add_argument("sandbox", help="Sandbox name or ID")
    p.add_argument("--label", "-l", help="Label for the snapshot")
    p.set_defaults(func=cmd_snapshot)

    # fork
    p = sub.add_parser("fork", help="Create a new sandbox from a snapshot")
    p.add_argument("snapshot", help="Snapshot label or image ID")
    p.add_argument("--name", "-n", help="Name for the new sandbox")
    p.set_defaults(func=cmd_fork)

    # list
    p = sub.add_parser("list", help="List sandboxes and snapshots")
    p.add_argument("--sandboxes", dest="sandboxes_only", action="store_true", help="Show only sandboxes")
    p.add_argument("--snapshots", dest="snapshots_only", action="store_true", help="Show only snapshots")
    p.set_defaults(func=cmd_list)

    # destroy
    p = sub.add_parser("destroy", help="Terminate a sandbox")
    p.add_argument("sandbox", help="Sandbox name or ID")
    p.set_defaults(func=cmd_destroy)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
