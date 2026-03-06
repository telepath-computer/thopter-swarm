# DigitalOcean Migration Proposal

## Goal

Replace the current Runloop-backed runtime management with DigitalOcean while preserving thopter workflows (`create`, `run`, `status`, `tell`, `snapshot`, `reauth`, `sync`) as closely as practical.

## Locked Decisions

1. `owner` metadata source is local git identity (`git config --get user.name`) and is coerced to a DO-safe tag value.
2. DO droplets must run thopters as a non-root `user` account (created/configured at bootstrap).
3. Snapshot references must be provider-neutral at the CLI boundary (provider-specific IDs stay internal).
4. In DO mode, `suspend`, `resume`, and `keepalive` always throw explicit unsupported errors.
5. Missing metadata tags are treated as missing metadata values; no fallback store is required.
6. Provider pivot can start with a hard-coded selector in code for initial migration.

## Current Runloop Surface Area

Runloop is currently used for these capabilities:

1. Provision runtime from base image or snapshot and wait for running state.
2. Apply metadata (`managed_by`, `thopter_name`, `thopter_owner`) for lookup/filtering.
3. Execute remote commands and wait for completion with stdout/stderr/exit code.
4. Write files directly to remote paths.
5. Snapshot disk, list snapshots, delete snapshots, query snapshot status.
6. Lifecycle actions: shutdown, suspend, resume, keepalive timer reset.
7. List runtimes by status and metadata.
8. SSH/connect via `rli`.

Primary code locations:

- `/src/devbox.ts`
- `/src/run.ts`
- `/src/tell.ts`
- `/src/sync.ts`
- `/src/reauth.ts`
- `/src/status.ts`
- `/src/client.ts`

## DigitalOcean Capabilities (via doctl)

Available primitives:

1. Droplet create/list/get/delete.
2. Droplet actions: shutdown, power-off, power-on, reboot, snapshot, etc.
3. Snapshot/image management (`compute snapshot`, `compute image`).
4. SSH with optional one-shot command (`doctl compute ssh --ssh-command`).
5. Tagging droplets.

Important differences from Runloop:

1. No suspend/resume concept equivalent to Runloop disk-preserving suspend.
2. No keepalive primitive.
3. No API primitive equivalent to Runloop `writeFileContents`.
4. No API primitive equivalent to Runloop async execution with execution IDs.
5. Droplet states differ (`new`, `active`, `off`, `archive`) from current status model.
6. Powered-off droplets remain billable.

## Mapping Proposal

### Provisioning

Runloop:

- `createAndAwaitRunning(snapshot_id, launch_parameters, metadata)`

DigitalOcean mapping:

- `doctl compute droplet create ... --image <snapshot-or-base-image> --size <slug> --region <slug> --tag-names thopter,managed-by-thopter --user-data-file <cloud-init> --wait`

Notes:

1. Use cloud-init for first-boot init script (`INIT_SCRIPT`) and user bootstrap.
2. Cloud-init must ensure a non-root `user` account exists and is SSH-accessible.
3. Use a default image slug for fresh creates; snapshot/image ID for snapshot creates.
4. Keep a provider config for `region`, `size`, `vpc`, optional project ID.

### Remote command execution

Runloop:

- `executeAsync` + `awaitCompleted`

DigitalOcean mapping:

- `doctl compute ssh <droplet-id> --ssh-command "<cmd>"`

Notes:

1. Treat execution as synchronous in provider adapter and return `stdout/stderr/exit`.
2. For streaming commands (like attach), use interactive SSH.

### Remote file writes

Runloop:

- `writeFileContents(devboxId, { file_path, contents })`

DigitalOcean mapping:

- Use SSH-based writer helper:
  - `cat <<'EOF' > /tmp/file && sudo install ...` for text files, or
  - base64 upload over SSH for safer quoting.

Notes:

1. This is required by `installThopterScripts`, `run`, `tell`, and `sync`.
2. Implement one reusable helper in provider layer to keep command quoting centralized.

### Snapshots

Runloop:

- create/list/delete/query status by ID

DigitalOcean mapping:

1. Create: `doctl compute droplet-action snapshot <id> --snapshot-name <name> --wait`
2. List: `doctl compute snapshot list` or `doctl compute image list-user` filtered to snapshots.
3. Delete: `doctl compute snapshot delete <snapshot-id>` (or image delete path if needed).

Notes:

1. Snapshot consistency is better if machine is powered off first.
2. Proposal: default to "safe snapshot" flow:
   - `shutdown` -> wait for `off` (with timeout) -> snapshot -> optionally power on if previously running.

### Lifecycle

Runloop -> DigitalOcean:

1. `destroy` -> droplet delete
2. `resume` -> power-on
3. `shutdown` -> shutdown (fallback power-off if timeout)
4. `suspend` -> unsupported in DigitalOcean mode (throw explicit error)
5. `keepalive` -> unsupported in DigitalOcean mode (throw explicit error)

Behavior changes:

1. `suspend`, `resume`, and `keepalive` should fail fast in DigitalOcean mode with a clear message.
2. Message should explain that DO does not provide cost-saving suspend/keepalive semantics in this workflow.

### Status/list/filter

Runloop:

- list by status + metadata filter

DigitalOcean mapping:

1. List droplets by tag (`thopter`/`managed-by-thopter`).
2. Map droplet states:
   - `active` -> `running`
   - `off` -> `suspended` (compat alias) or `powered_off` (preferred new term)
   - `new` -> `provisioning`
   - `archive` -> hidden/terminal
3. Keep Redis annotations unchanged (statusline, heartbeat, last_message, etc.).

### SSH / attach

Runloop:

- `rli devbox ssh`

DigitalOcean mapping:

1. `thopter ssh`: `doctl compute ssh <id-or-name>`
2. `thopter attach`: SSH remote command `tmux -CC attach \; refresh-client || tmux -CC`

## Non-1:1 Gaps and Decisions

### 1) Suspend semantics

Gap:

- Runloop suspend is a first-class feature; DO has power-off only.

Decision:

- Keep command names for compatibility, but throw explicit "unsupported in DigitalOcean mode" errors.
- Update docs/help text accordingly.

### 2) Keepalive

Gap:

- No DO keepalive timer reset primitive.

Decision:

- Do not emulate keepalive on DO.
- Throw explicit "unsupported in DigitalOcean mode" errors.

### 3) Metadata

Gap:

- DO offers tags, not arbitrary key-value metadata on droplets.

Decision:

- Store all metadata as tags in DO mode (no Redis metadata fallback):
  - `managed-by:thopter`
  - `owner:<coerced-owner>`
  - `thopter-name:<coerced-thopter-name>`
- Keep droplet name provider-safe, but do not rely on it as the sole metadata source.
- Discovery/filtering should use the `managed-by:thopter` tag, then parse other tags.

### 4) Name constraints

Gap:

- Existing thopter naming may include characters not accepted by droplet names.

Decision:

- Introduce provider-safe droplet name encoding (e.g. `thopter-<slug>-<shortid>`).
- Preserve user-facing logical thopter name in `thopter-name:*` tag.

### 5) Tag coercion rules

DO tags allow only letters, numbers, `:`, `-`, `_` (no spaces, no `.` or `=`).

Deterministic coercion for any input string:

1. Lowercase.
2. Replace whitespace with `-`.
3. Replace any char not in `[a-z0-9:_-]` with `-`.
4. Collapse multiple `-` to one.
5. Trim leading/trailing `-` and `:`.
6. If empty after coercion, use `unknown`.
7. Truncate to fit DO tag limits (255 chars total per tag).

Examples:

- `Josh Whiting` -> `josh-whiting`
- `red banana` -> `red-banana`
- `jw/dev#42` -> `jw-dev-42`

### 6) Snapshot abstraction

Decision:

- Keep CLI snapshot UX provider-neutral (`snapshot create/list/destroy/default`).
- Introduce provider-neutral snapshot model in code:
  - `id` (opaque provider ID)
  - `name` (user-facing label)
  - `provider` (`runloop` | `digitalocean`)
  - optional `sourceMachineId`, `createdAt`
- Resolve snapshot names within active provider only.

## Architecture Change Recommended

Introduce a provider abstraction and isolate cloud-specific behavior:

1. `src/providers/types.ts`:
   - `createMachine`, `listMachines`, `getMachine`, `destroyMachine`
   - `runCommand`, `writeFile`
   - `createSnapshot`, `listSnapshots`, `deleteSnapshot`
   - `powerOn`, `powerOff`, `shutdown`
2. `src/providers/runloop.ts` (current behavior, moved from direct calls)
3. `src/providers/digitalocean.ts` (new)
4. `src/provider.ts` selector from config/env (`provider=runloop|digitalocean`)

This lets us ship DigitalOcean incrementally while preserving existing behavior for current users.

For initial migration, provider selection may be hard-coded in `src/provider.ts` (e.g. `const ACTIVE_PROVIDER = "digitalocean"`), then generalized later.

## Migration Plan

### Phase 1: Compatibility foundation

1. Add provider abstraction and migrate existing Runloop calls behind it.
2. Start with hard-coded provider selector to reduce moving parts.

### Phase 2: DigitalOcean MVP

1. Implement create/list/destroy/ssh/exec/snapshot for DO.
2. Implement explicit unsupported errors for `suspend`, `resume`, and `keepalive` in DO mode.
3. Implement SSH-based `writeFile`.
4. Update setup to support DO token/context validation (`doctl auth list`).

### Phase 3: UX parity + docs

1. Update CLI text/docs to mark `suspend`, `resume`, `keepalive` as unsupported in DO mode.
3. Validate `run`, `tell`, `reauth`, and `sync` flows end-to-end.

### Phase 4: Cleanup

1. Rename `runloopApiKey` config field to provider-neutral + migration shim.
2. Remove `@runloop/api-client` dependency once DO path is stable.
3. Update docs and Electron GUI labels.

## Immediate Open Questions

1. Should we preserve exact command names (`suspend`) or rename to `poweroff` and keep aliases?
2. Should we keep these commands visible in `--help` for DO mode, or hide them dynamically?
3. Do we require strict snapshot consistency (always power off before snapshot), or allow fast snapshots while running?
4. Do we want DO-only now, or dual-provider support during rollout?
