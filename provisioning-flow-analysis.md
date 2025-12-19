# Thopter Provisioning Flow Analysis

NOTE: This is ai generated and I have not reviewed this for correctness yet. -JW

This document provides a comprehensive, detailed analysis of the complete provisioning flow for a thopter in the Thopter Swarm system, from GitHub issue detection through to a fully operational autonomous Claude Code agent.

## Overview

The thopter provisioning process transforms a `/thopter` command in a GitHub issue into a fully autonomous Claude Code instance that can work on the issue. The system involves multiple components working together: the hub server (TypeScript/Express), Fly.io machine orchestration, Docker containers, and various monitoring and logging systems.

## Phase 1: GitHub Issue Scanning & Request Creation

### 1. GitHub Polling Loop
**Location:** `hub/src/lib/github-polling-manager.ts:98-173`

- Runs every 30 seconds by default (configurable via `GITHUB_ISSUES_POLLING_INTERVAL`)
- Polls all configured repositories for open issues
- Fetches issues updated since last poll (with 1-minute safety overlap to handle timing issues)
- For each issue, fetches all comments in parallel for efficiency

### 2. Command Detection
**Location:** `hub/src/lib/github-polling-manager.ts:224-325`

- Searches issue body and all comments for `/thopter` commands
- Only processes the first `/thopter` command if multiple exist in the same text block
- Parses command arguments using minimist:
  - `--gc` or `-g`: Specifies golden claude template name
  - `--prompt` or `-p`: Specifies prompt template to use
- Checks if command was already acknowledged (prevents duplicate processing)
- Uses HTML comment markers to track acknowledgments: `<!-- thopter-ack:{instance} -->`

### 3. Provision Request Creation
**Location:** `hub/src/lib/agent-manager.ts:256-278`

Creates a `ProvisionRequest` object containing:
- Request ID (unique identifier)
- Repository details (owner/repo format)
- Full GitHub context:
  - Issue number, title, body, URL
  - Issue author and mention author
  - Complete comment thread with timestamps
- Golden Claude preference (defaults to 'default' if not specified)
- Prompt template preference (defaults to 'default.md' if not specified)
- Work branch name (will be `thopter/{issueNumber}--{machineId}`)

The request is added to the state manager's pending queue and GitHub is notified with an acknowledgment comment including the dashboard URL.

## Phase 2: Request Processing & Machine Creation

### 4. Agent Manager Processing Loop
**Location:** `hub/src/lib/agent-manager.ts:42-102`

- Runs continuously with 100ms intervals
- Processes requests in priority order (destroy requests before provision requests)
- Checks capacity constraints (`MAX_THOPTERS` environment variable, default 10)
- Updates request status from "pending" to "processing"
- Handles only one provision request per cycle (serial processing)

### 5. Provisioner Initialization
**Location:** `hub/src/lib/provisioner.ts:142-218`

- Validates GitHub configuration exists for the repository
- Retrieves thopter Docker image tag from metadata service
- Ensures an available volume exists in the pool:
  - Checks for unattached volumes in `thopter_data` pool
  - Creates new volume if none available (default 10GB)

### 6. Fly Machine Creation
**Location:** `hub/src/lib/provisioner.ts:261-383`

Machine creation involves:
- Generating unique machine name: `thopter-{issueNumber}-{randomId}`
- Executing `fly machine run` with:
  - Docker image from metadata service
  - Volume mount: `thopter_data:/data`
  - VM size: configurable, defaults to `shared-cpu-1x`
  - Region: from environment configuration
  - Autostop disabled (machine runs continuously)
  - Environment variables:
    - `METADATA_SERVICE_HOST`: For service discovery
    - `APP_NAME`: Fly app name
    - `WEB_TERMINAL_PORT`: Usually 7681
    - `HUB_STATUS_PORT`: Usually 8081
    - `GITHUB_REPO_PAT`: Repository access token
    - `REPOSITORY`: Full repository name
    - `ISSUE_NUMBER`: GitHub issue number
    - `GIT_USER_NAME`, `GIT_USER_EMAIL`: Git identity
    - `DANGEROUSLY_SKIP_FIREWALL`: Firewall control
    - `ALLOWED_DOMAINS`: Additional allowed domains
  - Optional files uploaded if present:
    - `/tmp/.env.thopters`: Developer environment variables
    - `/tmp/post-checkout.sh`: Post-checkout setup script
- Verification that machine was actually created
- Returns machine ID for tracking

## Phase 3: Thopter Machine Initialization

### 7. Docker Container Startup
**Location:** `thopter/Dockerfile:164`

The container starts with `/usr/local/bin/thopter-init.sh` as the main command (CMD).

### 8. Init Script Execution
**Location:** `thopter/scripts/thopter-init.sh`

The initialization script performs several critical setup steps:

#### Volume Mount Verification (lines 26-48)
- Tests read/write capability on `/data` mount
- Creates test file with timestamp
- Verifies file creation and content
- Retries up to 30 times with 2-second intervals
- Fails initialization if mount not ready after 60 seconds

#### Data Cleanup (lines 56-70)
- Executes `rm -rf /data/*` to clear previous thopter data
- Required because volumes are reused across thopters
- **Known issue:** Can hang on cleaning uv cache directories

#### Environment Setup (lines 75-148)
- Creates `.bash_aliases` with `yolo-claude` alias for dangerous permissions
- Moves `.env.thopters` from `/tmp` to workspace if provided
- Sources environment variables in `.bashrc` with auto-export
- Moves `post-checkout.sh` script if provided and makes executable
- Configures uv package manager environment variables
- Sets up proper PATH and tool directories

### 9. Firewall Configuration
**Location:** `thopter/scripts/firewall.sh`

Implements egress filtering using nftables:
- Resolves allowed domains to IP addresses using dig
- Fetches GitHub API meta CIDRs for dynamic IPs
- Creates allowlist including:
  - GitHub (all subdomains and CDNs)
  - Package registries (NPM, PyPI)
  - Anthropic API endpoints
  - Ubuntu package repositories
  - Additional domains from `ALLOWED_DOMAINS` env var
- Blocks all other outbound traffic except:
  - Loopback interface
  - DNS queries (port 53)
  - ICMP/ICMPv6 (ping)
  - Local/private networks (RFC1918)
- Logs dropped packets with "THOPTER-DROP:" prefix
- Can be disabled with `DANGEROUSLY_SKIP_FIREWALL=I_UNDERSTAND`

### 10. Process Management Startup
**Location:** `thopter/scripts/thopter-init.sh:159-162`

Starts PM2 with configuration from `pm2.config.js`, managing three processes:

1. **session-observer** (`observer.js`)
   - Monitors tmux session activity
   - Reports status to hub every 3 seconds
   - Detects idle state after 60 seconds of inactivity

2. **claude-log-generator**
   - Uses claude-code-log tool
   - Generates HTML session logs every 30 seconds
   - Creates comprehensive transcript with collapsible tool calls

3. **claude-log-webserver**
   - Python HTTP server on port 7791
   - Serves generated HTML logs
   - Accessible via internal Fly network

### 11. Terminal Session Launch
**Location:** `thopter/scripts/thopter-init.sh:175`

Final initialization step:
- Switches from root to `thopter` user using `runuser`
- Preserves terminal environment variables
- Changes to `/data/thopter/workspace` directory
- Starts tmux session named "thopter"
- Launches gotty web terminal on port 7681
- Attaches tmux session to gotty for web access
- Accepts WebSocket connections from any origin (`--ws-origin '.*'`)

## Phase 4: Provisioner Configuration Steps

### 12. Wait for Machine Ready
**Location:** `hub/src/lib/provisioner.ts:436-466`

- Polls web terminal endpoint: `http://{machineId}.vm.{appName}.internal:7681/`
- Checks every 2 seconds for HTTP 200 response
- Waits maximum 120 seconds
- Logs progress to thopter's `/thopter/log` file

### 13. Golden Claude Data Copy
**Location:** `hub/src/lib/provisioner.ts:595-686`

Complex multi-step process:
1. Finds specified golden claude machine (falls back to gc-default)
2. Creates tarball on golden claude:
   - Includes all of `/data/thopter`
   - Excludes `.bashrc` (would conflict with init script)
   - Excludes `.claude/projects` (session-specific)
3. Downloads tarball to hub machine
4. Uploads tarball to new thopter via SFTP
5. Extracts on thopter and fixes permissions
6. Cleans up temporary files

This step is optional - provisioning continues if no golden claude is available.

### 14. Git Repository Setup
**Location:** `hub/src/lib/provisioner.ts:688-812`

Repository configuration steps:
1. Configures git global user identity
2. Creates workspace directory (if not exists)
3. Clones repository with PAT authentication:
   - URL format: `https://{PAT}@github.com/{owner}/{repo}.git`
   - Clones into `/data/thopter/workspace/{repoName}`
4. Note: Branch creation is handled by Claude per prompt instructions

Each step tracks success independently, allowing partial completion.

### 15. Context Files Creation
**Location:** `hub/src/lib/provisioner.ts:387-555`

Three critical files are created and copied:

#### issue.md (Human-readable context)
```markdown
# GitHub Issue
**Repository:** {repository}
**Id:** {issueNumber}
**Title:** {issue title}
**URL:** {issue URL}
**Author:** {issue author}

## Issue Description
{issue body}

## Conversation Thread
[All comments with authors and dates]
```

#### prompt.md (Task instructions)
- Loaded from `hub/templates/prompts/{name}.md`
- Variable substitution:
  - `{{repository}}`: Full repository name
  - `{{repoName}}`: Repository name only
  - `{{issueNumber}}`: Issue number
  - `{{workBranch}}`: Branch name
  - `{{machineId}}`: Machine identifier

#### issue.json (Structured data for observer)
```json
{
  "source": "github",
  "repository": "owner/repo",
  "workBranch": "thopter/{issue}--{machine}",
  "github": {
    "issueNumber": "123",
    "issueTitle": "...",
    "issueBody": "...",
    "comments": [...]
  }
}
```

Files are transferred via SFTP to `/data/thopter/workspace/`.

### 16. Post-Checkout Script Execution
**Location:** `hub/src/lib/provisioner.ts:813-868`

If `post-checkout.sh` was provided:
- Changes to repository directory
- Makes script executable
- Executes with output logged to `/thopter/log`
- Continues even if script fails

### 17. Claude Launch
**Location:** `hub/src/lib/provisioner.ts:813-868`

Final provisioning step:
- Sends command via tmux to thopter session
- Base64 encodes complex command to avoid escaping issues
- Launches Claude with:
  ```bash
  claude --dangerously-skip-permissions "read ./prompt.md for your instructions"
  ```
- Claude starts in repository directory
- Initial message directs Claude to read prompt file

## Phase 5: Ongoing Operation & Monitoring

### 18. Observer Status Reporting
**Location:** `thopter/scripts/observer.js`

Continuous monitoring every 3 seconds:
- Captures tmux pane content using `tmux capture-pane`
- Compares with previous capture to detect changes
- Determines state:
  - **active**: Screen content changed
  - **idle**: No changes for 60+ seconds
- Checks Claude process status with `pgrep -x claude`
- Posts comprehensive status to hub:
  ```json
  {
    "thopterId": "...",
    "tmuxState": "active|idle",
    "claudeProcess": "running|notFound",
    "screenDump": "...",
    "lastActivity": "ISO timestamp",
    "spawnedAt": "ISO timestamp",
    "repository": "...",
    "github": {...},
    "idleSince": "ISO timestamp if idle"
  }
  ```

### 19. Session Log Generation
**Location:** PM2 managed process via `claude-log-generator.js`

- Runs every 30 seconds
- Uses claude-code-log tool (installed via uv)
- Generates comprehensive HTML logs with:
  - Full conversation transcript
  - Tool calls in collapsible sections
  - Timestamps and metadata
- Output saved to `/data/thopter/.claude/projects/`
- Served at `http://{machine-id}.vm.{app-name}.internal:7791`

### 20. Hub State Management
**Location:** `hub/src/lib/state-manager.ts`

Maintains comprehensive state for each thopter:
- Machine state from Fly API (started, stopped, destroyed)
- Session state from observer (active, idle, error)
- GitHub context (repository, issue, comments)
- Activity timestamps and idle duration
- Kill requests and lifecycle events

### 21. Dashboard Visibility
**Location:** `hub/src/dashboard/`

Web dashboard at `http://1.hub.kv._metadata.{app}.internal:8080` displays:
- All active thopters with current status
- GitHub issue context and links
- Time since last activity
- Quick access buttons:
  - Web terminal (gotty interface)
  - Session logs (HTML viewer)
  - Kill button for termination
- Color coding for states (active=green, idle=yellow)

## File System Layout in Running Thopter

```
/data/thopter/                  # Home directory (persistent volume mount)
├── .claude/                    # Claude configuration (from golden claude)
│   ├── config/                # User preferences and settings
│   └── projects/              # Session logs generated and served here
├── workspace/
│   ├── .env.thopters          # Developer environment variables
│   ├── post-checkout.sh       # Custom setup script (optional)
│   ├── issue.md               # Human-readable issue context
│   ├── issue.json             # Structured issue data for observer
│   ├── prompt.md              # Initial task instructions for Claude
│   └── {repoName}/            # Cloned repository
│       └── [repository files]
├── .bashrc                    # User configuration (sources .env.thopters)
├── .bash_aliases              # Contains yolo-claude alias
├── .bash_profile              # Sources .bashrc for login shells
└── logs/                      # PM2 process logs
    ├── observer.out.log
    ├── observer.err.log
    ├── claude-log.out.log
    ├── claude-log.err.log
    ├── webserver.out.log
    └── webserver.err.log

/thopter/log                    # System-wide initialization and provisioning log

/opt/uv/                        # UV package manager installation
├── tools/                      # Installed tools (claude-code-log)
├── cache/                      # Package cache
├── pys/                        # Python installations
└── bin/                        # Binary directory
```

## Error Handling & Resilience

The provisioning system is designed to be resilient:

1. **Optional Steps**: Golden claude copy and git clone are optional - provisioning continues if they fail
2. **Logging**: Extensive logging at every step to `/thopter/log` for debugging
3. **Retries**: Network operations include timeouts and retries where appropriate
4. **State Recovery**: Hub rebuilds state from Fly API if restarted
5. **Graceful Degradation**: Thopter remains accessible via web terminal even if Claude fails to launch

## Security Considerations

1. **Egress Firewall**: Strict allowlist prevents data exfiltration
2. **PAT Isolation**: Separate tokens for issue access vs repository access
3. **Branch Restrictions**: Thopters typically restricted to `thopter/*` branches
4. **No Root Access**: Claude runs as unprivileged `thopter` user
5. **Volume Isolation**: Each thopter gets isolated volume mount

## Performance Characteristics

- **Provisioning Time**: Typically 30-60 seconds from request to Claude launch
- **Golden Claude Copy**: Adds 10-30 seconds depending on size
- **Repository Clone**: Varies with repository size
- **Status Updates**: 3-second granularity for activity detection
- **Log Generation**: 30-second intervals for HTML logs

## Known Issues & Limitations

1. **Volume Cleanup Hang**: `rm -rf /data/*` can hang on uv cache directories
2. **PAT Expiration**: GitHub tokens expire and need manual refresh
3. **Golden Claude State**: Must not have Claude running during snapshot
4. **Single Command**: Only first `/thopter` per comment is processed
5. **Capacity Limits**: Hard limit on concurrent thopters (MAX_THOPTERS)

## Summary

The thopter provisioning flow successfully transforms a simple `/thopter` command into a fully autonomous development environment with:
- Authenticated repository access
- Complete issue context and requirements
- Egress-firewalled network environment
- Continuous status reporting to hub
- Web-based terminal and log access
- Centralized dashboard management

The system prioritizes resilience over perfection, allowing developers to diagnose and fix issues through the web terminal when automated steps fail, while maintaining security through multiple layers of isolation and access control.
