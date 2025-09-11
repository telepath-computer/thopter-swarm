# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

CRITICAL: Claude MUST READ, IN FULL, the entire root `README.md` file at the
start of any working session. It explains this project overall. Also, after a
conversation is compacted, do not rely on a summary: RE-READ THE ENTIRE FILE
into context. You MUST NOT do work without this ENTIRE FILE fully in context.

In addition to that, Claude should be mindful of where its local shell is
running and expect a different set of available local operations:

- Locally on a developer laptop? In this case, most likely the current shell
  has access to fly cli commands (`fly machines list --json` and such) and you
  can use those commands via the bash tool to inspect state on remote machines.
  You can also run the deployment management scripts in fly/* and the
  developer's laptop can be expected to be connected to the wireguard network.

- Inside a Thopter in Thopter Swarm? In this case, Claude does NOT have an
  authenticated fly client, and can really only manage files in its local repo,
  and do git operations. Outbound network access except for git, anthropic, and
  common packaging repos is blocked by an egress firewall.

In either case, the actual code for the hub server and the thopter machine
scripts are not currently runnable in a development environment. It's intended
to run only inside a properly provisioned fly machine. However, generally `npm
run build` does work and is critical to check for initial typescript issue or
other easily preventable code bugs before considering your work complete.

