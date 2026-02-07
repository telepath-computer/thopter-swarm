#!/usr/bin/env python3
"""CLI for managing Modal sandboxes for thopter development."""

import argparse
import sys


class HelpFormatter(argparse.RawDescriptionHelpFormatter):
    """Formatter that preserves description whitespace and widens help columns."""

    def __init__(self, prog, **kwargs):
        kwargs.setdefault("max_help_position", 40)
        super().__init__(prog, **kwargs)


def cmd_setup(args):
    from setup import run_setup

    run_setup()


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


def cmd_tag(args):
    action = getattr(args, "tag_action", None)
    if action == "get":
        from sandbox import get_tags

        get_tags(args.sandbox)
    elif action == "set":
        from sandbox import set_tags

        tags = {}
        for item in args.tags:
            if "=" not in item:
                raise SystemExit(f"Invalid tag format: '{item}' (expected key=value)")
            k, v = item.split("=", 1)
            tags[k] = v
        set_tags(args.sandbox, tags)
    elif action == "rm":
        from sandbox import remove_tags

        remove_tags(args.sandbox, args.keys)
    else:
        args._parser.print_help()
        raise SystemExit(1)


def main():
    parser = argparse.ArgumentParser(
        prog="modal-thopters",
        formatter_class=HelpFormatter,
        description="Manage Modal sandboxes for Claude Code development.",
        epilog="""\
lifecycle:
  setup   → create → shell/exec → snapshot → destroy
                                     ↓
                                    fork → shell/exec → ...

examples:
  %(prog)s setup                              First-time auth & secret config
  %(prog)s create -n dev                      Create a sandbox named "dev"
  %(prog)s shell dev                          Open an interactive shell
  %(prog)s exec dev -- uname -a               Run a one-off command
  %(prog)s snapshot dev -l checkpoint-1        Save filesystem state
  %(prog)s fork checkpoint-1 -n dev2          Branch from a snapshot
  %(prog)s tag set dev branch=main             Tag a sandbox
  %(prog)s list                               Show running sandboxes & snapshots
  %(prog)s destroy dev                        Tear down a sandbox""",
    )
    sub = parser.add_subparsers(
        dest="command",
        required=True,
        title="commands",
        metavar="<command>",
    )

    # setup
    p = sub.add_parser(
        "setup",
        formatter_class=HelpFormatter,
        help="Check Modal auth and configure secrets",
        description="Verify Modal authentication and interactively configure\n"
        "the thopter-secrets secret (ANTHROPIC_API_KEY, GITHUB_PAT, etc.).",
    )
    p.set_defaults(func=cmd_setup)

    # create
    p = sub.add_parser(
        "create",
        formatter_class=HelpFormatter,
        help="Create a new sandbox",
        description="Spin up a new Modal sandbox. Builds the base image on first\n"
        "run (slow), then reuses the cached image for subsequent creates.",
        epilog="""\
examples:
  %(prog)s -n dev                        Fresh sandbox from base image
  %(prog)s -n dev2 -s checkpoint-1       Sandbox from a named snapshot
  %(prog)s -n dev3 -s im-abc123          Sandbox from a raw image ID""",
    )
    p.add_argument("--name", "-n", required=True, metavar="NAME", help="Name for the sandbox (must be unique within the app)")
    p.add_argument("--from-snapshot", "-s", metavar="REF", help="Snapshot label or image ID to restore from")
    p.set_defaults(func=cmd_create)

    # shell
    p = sub.add_parser(
        "shell",
        formatter_class=HelpFormatter,
        help="Open an interactive shell in a sandbox",
        description="Attach an interactive bash session to a running sandbox.\n"
        "Uses the Modal CLI under the hood for full PTY support.\n"
        "\n"
        "escape sequences (after Enter):\n"
        "  ~.  Force-disconnect (like SSH)\n"
        "  ~~  Send a literal ~\n"
        "  ~?  Show escape help",
        epilog="""\
examples:
  %(prog)s dev                           By name
  %(prog)s sb-abc123xyz                  By sandbox ID""",
    )
    p.add_argument("sandbox", metavar="SANDBOX", help="Sandbox name or ID (sb-...)")
    p.set_defaults(func=cmd_shell)

    # exec
    p = sub.add_parser(
        "exec",
        formatter_class=HelpFormatter,
        help="Run a command in a sandbox",
        description="Execute a command inside a running sandbox and stream\n"
        "stdout/stderr. Exits with the command's exit code.",
        epilog="""\
examples:
  %(prog)s dev -- ls /root
  %(prog)s dev -- bash -c 'echo $PATH'
  %(prog)s dev -t 60 -- python train.py""",
    )
    p.add_argument("sandbox", metavar="SANDBOX", help="Sandbox name or ID (sb-...)")
    p.add_argument("command", nargs="+", metavar="CMD", help="Command and arguments to run")
    p.add_argument("--timeout", "-t", type=int, default=300, metavar="SEC", help="Timeout in seconds (default: 300)")
    p.set_defaults(func=cmd_exec)

    # snapshot
    p = sub.add_parser(
        "snapshot",
        formatter_class=HelpFormatter,
        help="Snapshot a sandbox's filesystem",
        description="Capture the current filesystem state of a sandbox as a\n"
        "Modal image. The sandbox keeps running after the snapshot.",
        epilog="""\
examples:
  %(prog)s dev -l checkpoint-1           Snapshot with a label
  %(prog)s dev                           Snapshot (image ID only, no label)""",
    )
    p.add_argument("sandbox", metavar="SANDBOX", help="Sandbox name or ID (sb-...)")
    p.add_argument("--label", "-l", metavar="LABEL", help="Human-readable label for the snapshot")
    p.set_defaults(func=cmd_snapshot)

    # fork
    p = sub.add_parser(
        "fork",
        formatter_class=HelpFormatter,
        help="Create a new sandbox from a snapshot",
        description="Create a fresh sandbox whose filesystem starts from a\n"
        "previous snapshot. The init script is skipped (already ran).",
        epilog="""\
examples:
  %(prog)s checkpoint-1 -n dev2          Fork by snapshot label
  %(prog)s im-abc123 -n dev3             Fork by raw image ID""",
    )
    p.add_argument("snapshot", metavar="SNAPSHOT", help="Snapshot label or image ID (im-...)")
    p.add_argument("--name", "-n", metavar="NAME", help="Name for the new sandbox")
    p.set_defaults(func=cmd_fork)

    # list
    p = sub.add_parser(
        "list",
        aliases=["ls"],
        formatter_class=HelpFormatter,
        help="List running sandboxes and saved snapshots",
        description="Query the Modal API for running sandboxes and show locally\n"
        "saved snapshot labels. Only live sandboxes are shown.",
    )
    p.add_argument("--sandboxes", dest="sandboxes_only", action="store_true", help="Show only sandboxes")
    p.add_argument("--snapshots", dest="snapshots_only", action="store_true", help="Show only snapshots")
    p.set_defaults(func=cmd_list)

    # tag
    p = sub.add_parser(
        "tag",
        formatter_class=HelpFormatter,
        help="View or manage tags on a sandbox",
        description="Tags are key=value pairs stored on the sandbox via the\n"
        "Modal API. They show up in 'list' output and can be used\n"
        "to annotate sandboxes with purpose, owner, branch, etc.",
        epilog="""\
examples:
  %(prog)s get dev                       Show all tags
  %(prog)s set dev branch=main           Set one tag
  %(prog)s set dev env=staging gpu=a100  Set multiple tags
  %(prog)s rm dev branch gpu             Remove tags by key""",
    )
    tag_sub = p.add_subparsers(dest="tag_action", title="actions", metavar="<action>")
    p.set_defaults(func=cmd_tag, _parser=p)

    tp = tag_sub.add_parser(
        "get",
        formatter_class=HelpFormatter,
        help="Show tags on a sandbox",
    )
    tp.add_argument("sandbox", metavar="SANDBOX", help="Sandbox name or ID (sb-...)")
    tp.set_defaults(func=cmd_tag, tag_action="get")

    tp = tag_sub.add_parser(
        "set",
        formatter_class=HelpFormatter,
        help="Set tags (key=value pairs) on a sandbox",
        description="Merge key=value pairs into the sandbox's tags.\n"
        "Existing tags with the same key are overwritten.",
    )
    tp.add_argument("sandbox", metavar="SANDBOX", help="Sandbox name or ID (sb-...)")
    tp.add_argument("tags", nargs="+", metavar="KEY=VALUE", help="Tags to set")
    tp.set_defaults(func=cmd_tag, tag_action="set")

    tp = tag_sub.add_parser(
        "rm",
        formatter_class=HelpFormatter,
        help="Remove tags from a sandbox by key",
    )
    tp.add_argument("sandbox", metavar="SANDBOX", help="Sandbox name or ID (sb-...)")
    tp.add_argument("keys", nargs="+", metavar="KEY", help="Tag keys to remove")
    tp.set_defaults(func=cmd_tag, tag_action="rm")

    # destroy
    p = sub.add_parser(
        "destroy",
        aliases=["rm"],
        formatter_class=HelpFormatter,
        help="Terminate a running sandbox",
        description="Terminate a sandbox. This is immediate and irreversible.\n"
        "Snapshot first if you want to preserve the filesystem.",
        epilog="""\
examples:
  %(prog)s dev                           Destroy by name
  %(prog)s sb-abc123xyz                  Destroy by sandbox ID""",
    )
    p.add_argument("sandbox", metavar="SANDBOX", help="Sandbox name or ID (sb-...)")
    p.set_defaults(func=cmd_destroy)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
