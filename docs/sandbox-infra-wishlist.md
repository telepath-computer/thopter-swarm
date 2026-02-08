Must Have

1. Persistent filesystem — survives idle/sleep. Installed packages, cloned repos, config files, Claude session transcripts all stay put.
2. Pause/resume (or equivalent) — stop billing when not in use, resume quickly with state intact. Whether that's native hibernation, snapshot+destroy+fork, or something else — but the workflow needs "come back
tomorrow, everything is here."
3. Fast cold starts — acquiring a ready instance needs to feel fast. Cold starts of 1-2s are great, 5s is tolerable, 30s+ is a dealbreaker.
4. SSH access — real SSH, not just a websocket exec channel. Required for: tmux attach (especially -CC for iTerm2), Mutagen file sync, standard tooling (scp, rsync, ssh-agent forwarding). This is the transport
layer for almost everything.
5. Command execution API — programmatic exec (run a command, get stdout/stderr/exit code) without needing an interactive terminal. For provisioning, health checks, state file reads.
6. Environment variable injection — set API keys and secrets at creation time or early in lifecycle. Either via a secrets manager or by writing to the filesystem.
7. List with status — API to list all VMs with current state (running/paused/hibernated) without waking them up.
8. Port forwarding / TCP proxy — tunnel a remote port to localhost for dev servers, databases, gotty, etc.
9. Reasonable storage — at least 20GB persistent. A cloned repo + node_modules + build artifacts + Claude session data adds up.

10. Shutdown/destroy suspended VMs — need to be able to delete a suspended devbox without resuming it first. If secrets have changed since the devbox was created, resume fails (Runloop re-injects secrets on resume, and missing/renamed secrets cause errors). This leaves the devbox stuck: can't resume, can't destroy. Must be able to force-destroy regardless of state.

Strongly Want

10. Per-sandbox metadata (assignable description or k/v metadata)
12. Naming — user-assigned names for VMs, usable as identifiers in API calls. Not just opaque IDs.
12. Non-root user option — ability to run as a regular user (not just root). Important for tools that refuse to run as root or behave differently.
13. Snapshots / checkpoints — save filesystem state, restore to it later. For "checkpoint before risky refactor" workflow. Scoped to the same VM is fine.
14. Cloning / forking — create a new VM from a snapshot of another. For "golden image" workflow: set up once, stamp out many. If VMs are truly long-lived and pausable, this is less critical — but still very
useful for spinning up parallel workers from a common base.
15. Non-Docker runtime (Firecracker or similar) — hardware-level isolation via microVM rather than container. Better security boundary for running untrusted code (Claude in yolo mode). Also avoids
Docker-in-Docker headaches.
16. Egress firewall / network policy — domain-level or IP-level control over outbound traffic. Prevents code/secrets exfiltration from prompt injection or agent mistakes. Allowlist mode (block everything except
explicitly allowed domains).
17. Configurable idle timeout — control how long a VM stays running before auto-hibernation. 30 seconds is aggressive (could kill Claude mid-thought during a slow build). Want at least 5-10 minutes configurable,
ideally disable-able.
18. Public URL — HTTPS endpoint routed to a port on the VM. For gotty web terminal, webhook receivers, sharing preview URLs. With auth toggle (private by default, optionally public).
19. Background services — ability to define persistent processes that auto-restart on wake (sshd, gotty, dev servers). Sprites' "services" concept is a good model.
20. Filesystem API — read/write files on the VM via REST without exec. For reading state files and metadata without waking into a full session, if possible.
21. Custom resource sizing — choose CPU cores, RAM, and storage per VM. Different workloads need different resources (quick script vs. heavy Playwright tests).
22. Python and/or Typescript SDK — first-class client library. Makes the CLI implementation much cleaner than shelling out to a CLI tool or hand-rolling HTTP calls.

Nice to Have

23. Memory snapshots — capture not just filesystem but running process state (like VM suspend/resume). Would let Claude Code survive hibernation without re-launch. Currently rare/alpha in most providers.
24. Custom base images
25. Webhooks / event callbacks
26. Programmatic billing/usage API
27. Team/org support — multiple users sharing a pool of VMs with access control. Single-user first, but this matters for team adoption.

