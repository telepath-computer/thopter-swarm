# Git Proxy MCP Server Specification

## Overview
Create a secure git proxy system where Claude works on a non-privileged copy of the repository and must request git operations through a root-owned MCP server that enforces strict limitations on what operations are allowed.

**IMPORTANT**: This is a breaking change with NO backwards compatibility. This completely replaces the existing git authentication system. All existing thopters will need to be recreated after this change is deployed.

## Problem Statement
Currently, Claude has direct access to a GitHub Personal Access Token (PAT) with full read-write access to repositories. This requires complex GitHub branch rulesets and administrative overhead to prevent destructive operations. The goal is to remove Claude's direct access to the PAT and limit it to only safe operations.

## Golden Claude Support

Golden Claude instances are template machines used to create thopter instances. They don't have associated GitHub issues and shouldn't perform git operations. The system handles this through:

1. **Environment Detection**: The `IS_GOLDEN_CLAUDE` environment variable identifies golden claude instances
2. **Conditional Setup**: When `IS_GOLDEN_CLAUDE="true"`, all git-related setup is skipped
3. **MCP Idle Mode**: The MCP server runs but returns friendly messages instead of performing operations
4. **Clean Logs**: No error messages about missing repositories or configuration in golden claude mode

This design ensures golden claudes remain clean templates without git state, while the same image supports full git operations for regular thopters.

## Solution Architecture

### Components

1. **Root-owned bare repository** (`/data/root/thopter-repo`)
   - Bare git repository owned by root
   - Located in `/data/root` for high-performance volume access
   - Contains the GitHub PAT in its git config
   - Directory permissions: 700 (only accessible by root)
   - The `/data/root` directory is a secure enclave within the performance-optimized `/data` volume

2. **Claude's working repository** (`/data/thopter/workspace/{repoName}`)
   - Regular git repository owned by thopter user
   - Has the root-owned bare repo as its origin
   - No direct access to GitHub or the PAT

3. **MCP Server** (TypeScript/Node.js)
   - Runs as root via pm2
   - Provides two simple git operations via MCP tools
   - HTTP-based server (not stdio) for cross-user communication
   - Logs to stdout (captured by pm2)

### Git Operations Flow

1. **Initial Setup (during thopter-init.sh)**
   - Root clones from GitHub into bare repo using PAT
   - Configure bare repo with GitHub as origin and PAT for auth
   - Thopter user clones from bare repo into working directory
   - Work branch name available via environment variable

2. **Fetch Operation**
   - Claude requests fetch via MCP tool
   - MCP server executes `git fetch` in bare repo
   - Returns git command output
   - Claude then pulls from bare repo locally

3. **Push Operation**
   - Claude commits and pushes to bare repo locally
   - Claude requests push via MCP tool
   - MCP server executes `git push origin ${WORK_BRANCH}` in bare repo
   - Returns git command output

## Implementation Details

### Environment Variables
#### Passed by provisioner during machine creation:
- `IS_GOLDEN_CLAUDE` - Set to "true" for golden claude instances (template machines)
  - When true, all git operations are skipped
  - MCP server runs in idle mode without errors
  - No repository cloning or git configuration occurs
- `GITHUB_REPO_PAT` - The GitHub personal access token (for root only)
  - Not required for golden claude instances
  - Only used when IS_GOLDEN_CLAUDE is not "true"
- `REPOSITORY` - The repository to clone (e.g., "owner/repo")
  - Not required for golden claude instances
- `ISSUE_NUMBER` - The GitHub issue number (required for branch construction)
  - Not provided for golden claude instances
  - Required for normal thopter operation

#### Available from Fly.io runtime:
- `FLY_MACHINE_ID` - The Fly machine ID (automatically set by Fly.io)

#### Constructed by thopter-init.sh:
- `WORK_BRANCH` - Built from `ISSUE_NUMBER` and `FLY_MACHINE_ID` as `thopter/{issueNumber}--{machineId}`
  - Example: `thopter/123--4d891912a52228`
  - Must be constructed early in init script
  - Must be exported to PM2 config for MCP server
  - Must be added to thopter user's environment
  - **Not constructed for golden claude instances**

### MCP Server Details
- **Server name**: `git-proxy`
- **Version**: `1.0.0`
- **Tools**:
  - `mcp__git_proxy__fetch` - Fetches from GitHub
  - `mcp__git_proxy__push` - Pushes to the whitelisted branch only
- **Transport**: HTTP server on port 8777
- **User**: Runs as root
- **Location**: Added to `/usr/local/bin/pm2.config.js`
- **Golden Claude Mode**:
  - When `IS_GOLDEN_CLAUDE="true"`, server runs in idle mode
  - Returns friendly message for all operations: "Git operations are disabled in golden claude mode"
  - Does not log errors or warnings about missing configuration
  - Remains running but effectively inactive
- **Resilience Requirements**:
  - Server MUST NOT crash on any error condition
  - Server MUST handle missing repositories gracefully
  - Server MUST handle permission errors gracefully
  - Server MUST handle network failures gracefully
  - All errors should be logged and returned to caller (except in golden claude mode)
  - Server should remain running and available for future requests
- **Logging Requirements**:
  - ALL git command output (stdout and stderr) MUST be logged to console
  - Log output on both success AND failure cases
  - Include timestamps with each log entry
  - Include the git command being executed
  - Logs will be captured by pm2 for audit trail
  - Format: `[timestamp] Executing: {command}` followed by output

### File Locations
- Bare repo: `/data/root/thopter-repo`
- Root enclave: `/data/root` (700 permissions, root:root ownership)
- MCP server script: `/usr/local/bin/git-proxy-mcp.js`
- Claude's repo: `/data/thopter/workspace/{repoName}`

### Directory Structure
```
/data/                      # High-performance Fly.io volume
├── root/                   # Root-owned enclave (700 permissions)
│   └── thopter-repo/      # Bare repository with PAT
├── logs/                   # Centralized logging directory (755, thopter:thopter)
│   ├── init.log           # Initialization log (was /thopter/log)
│   ├── observer.out.log   # PM2 session observer stdout
│   ├── observer.err.log   # PM2 session observer stderr
│   ├── claude-log.out.log # PM2 claude log generator stdout
│   ├── claude-log.err.log # PM2 claude log generator stderr
│   ├── webserver.out.log  # PM2 webserver stdout
│   ├── webserver.err.log  # PM2 webserver stderr
│   ├── git-proxy.out.log  # PM2 git proxy stdout
│   └── git-proxy.err.log  # PM2 git proxy stderr
└── thopter/               # Thopter user space
    ├── workspace/
    │   └── {repoName}/    # Working repository
    └── .claude/
```

### Logging Architecture

All logs are centralized in `/data/logs/` for several critical reasons:

1. **Performance**: The `/data` volume is a high-performance Fly.io volume, while `/thopter` and other locations use slower VM filesystem
2. **Persistence**: Logs remain available across container restarts when using the volume
3. **Permissions**: `/data/logs` is owned by thopter:thopter with 755 permissions, allowing both root and thopter processes to write
4. **Early Access**: The directory is created very early in initialization (before mount checks) to capture all initialization output
5. **Unified Access**: All logs in one location simplifies debugging and monitoring

Key logging changes:
- `/thopter/log` → `/data/logs/init.log` - Initialization and provisioning logs
- PM2 logs previously in `/data/thopter/logs/` → `/data/logs/` - All PM2 service logs
- Log directory must be created and chowned before any logging begins in thopter-init.sh

### Security Model
- Claude has no access to the GitHub PAT
- Claude cannot access `/data/root` directory (700 permissions, root ownership)
- Claude can only trigger push to one predefined branch
- All git operations are logged via pm2 (complete stdout/stderr capture)
- Every git command execution is logged with full output for audit trail
- Root process validates branch name from environment variable
- No command injection possible (no user input in git commands)
- Permission isolation maintained even within the same `/data` volume

## Modifications Required

### 1. thopter-init.sh (Complete Replacement of Git Setup and Logging)
- **Very early in script (before mount checks)**:
  - Create `/data/logs` directory with 755 permissions
  - Set ownership to thopter:thopter for `/data/logs`
  - Update logging function to write to `/data/logs/init.log` instead of `/thopter/log`
- Check `IS_GOLDEN_CLAUDE` environment variable early in script
- If golden claude mode:
  - Skip all git-related operations
  - Log "Running in golden claude mode - git operations disabled"
  - MCP server still starts but runs in idle mode
- If normal thopter mode:
  - Create `/data/root` directory with 700 permissions (root only)
  - Remove all existing git clone logic for thopter user
  - Set up bare repo at `/data/root/thopter-repo` as root
  - Clone from GitHub with PAT embedded in URL (root only)
  - Set WORK_BRANCH environment variable
  - Start MCP server via pm2
  - Clone from bare repo as thopter user (no GitHub access)
  - Configure Claude's MCP settings: `claude mcp add --transport http git-proxy http://localhost:8777`
  - Remove all PAT passing to thopter user
- Rename start-observer.sh to start-services.sh
- Modify permission fixing to preserve root ownership of `/data/root`

### 2. pm2.config.js
- Add git-proxy-mcp server configuration running as root
- Update all log file paths from `/data/thopter/logs/` to `/data/logs/`:
  - observer.*.log → `/data/logs/observer.*.log`
  - claude-log.*.log → `/data/logs/claude-log.*.log`
  - webserver.*.log → `/data/logs/webserver.*.log`
  - git-proxy.*.log → `/data/logs/git-proxy.*.log`

### 3. New/Modified Files
- `/usr/local/bin/git-proxy-mcp.js` - The MCP server implementation (new)
- `/usr/local/bin/start-services.sh` - Renamed from start-observer.sh (modified)

### 4. Dockerfile
- Install MCP SDK globally for root user: `npm install -g @modelcontextprotocol/sdk`
- This is the only new npm dependency needed for the git proxy system
- Remove creation of `/thopter/log` file (no longer needed)
- Note: `/data/logs` will be created dynamically by init script

### 5. Provisioner (hub/src/lib/provisioner.ts)
- Update all references to `/thopter/log` to `/data/logs/init.log`
- Update log tailing commands to use new location
- Ensure log monitoring works with new centralized logging structure

## Testing Requirements

### Manual Testing Steps
1. Deploy a test thopter with the new git proxy system
2. Verify Claude can fetch latest changes from GitHub
3. Verify Claude can push commits to the whitelisted branch
4. Verify Claude cannot push to other branches (command will fail)
5. Check pm2 logs for git operation audit trail
6. Verify PAT is not accessible from thopter user

## Performance Considerations

The bare repository is intentionally placed at `/data/root/thopter-repo` rather than `/root/thopter-repo` because:
- `/data` is a Fly.io volume mount optimized for I/O performance
- `/root` resides on the VM's local filesystem which is significantly slower
- All git operations (fetch, push, clone) benefit from the faster storage
- The performance improvement is critical for large repositories

## Production Readiness
This is a prototype implementation that completely replaces the existing git authentication system. There is no migration path or backwards compatibility. All existing thopters and golden claudes must be recreated after deployment.

The MCP server MUST be resilient to failures and always remain running. Even if the bare repository doesn't exist, has wrong permissions, or encounters any other error, the server should:
- Log the error clearly
- Return an appropriate error message to Claude
- Continue running and be ready for the next request
- Never crash or become unavailable

Future enhancements could include:
- Metrics/monitoring of git operations
- Rate limiting
- Additional git operations if needed

## Success Criteria
- Complete replacement of existing git authentication system
- Claude has zero direct access to GitHub or PATs
- All git operations go through the MCP proxy server
- Push operations are restricted to the designated work branch
- All git operations are logged for audit purposes
- GitHub branch rulesets can be completely removed (no longer needed)