# Git Proxy MCP Server Specification

## Overview
Create a secure git proxy system where Claude works on a non-privileged copy of the repository and must request git operations through a root-owned MCP server that enforces strict limitations on what operations are allowed.

**IMPORTANT**: This is a breaking change with NO backwards compatibility. This completely replaces the existing git authentication system. All existing thopters will need to be recreated after this change is deployed.

## Problem Statement
Currently, Claude has direct access to a GitHub Personal Access Token (PAT) with full read-write access to repositories. This requires complex GitHub branch rulesets and administrative overhead to prevent destructive operations. The goal is to remove Claude's direct access to the PAT and limit it to only safe operations.

## Solution Architecture

### Components

1. **Root-owned bare repository** (`/root/thopter-repo`)
   - Bare git repository owned by root
   - Contains the GitHub PAT in its git config
   - Only accessible by root

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
- `GITHUB_REPO_PAT` - The GitHub personal access token (for root only)
- `REPOSITORY` - The repository to clone (e.g., "owner/repo")
- `ISSUE_NUMBER` - The GitHub issue number (required for branch construction)

#### Available from Fly.io runtime:
- `FLY_MACHINE_ID` - The Fly machine ID (automatically set by Fly.io)

#### Constructed by thopter-init.sh:
- `WORK_BRANCH` - Built from `ISSUE_NUMBER` and `FLY_MACHINE_ID` as `thopter/{issueNumber}--{machineId}`
  - Example: `thopter/123--4d891912a52228`
  - Must be constructed early in init script
  - Must be exported to PM2 config for MCP server
  - Must be added to thopter user's environment

### MCP Server Details
- **Server name**: `git-proxy`
- **Version**: `1.0.0`
- **Tools**:
  - `mcp__git_proxy__fetch` - Fetches from GitHub
  - `mcp__git_proxy__push` - Pushes to the whitelisted branch only
- **Transport**: HTTP server on port 8777
- **User**: Runs as root
- **Location**: Added to `/usr/local/bin/pm2.config.js`
- **Resilience Requirements**:
  - Server MUST NOT crash on any error condition
  - Server MUST handle missing repositories gracefully
  - Server MUST handle permission errors gracefully
  - Server MUST handle network failures gracefully
  - All errors should be logged and returned to caller
  - Server should remain running and available for future requests
- **Logging Requirements**:
  - ALL git command output (stdout and stderr) MUST be logged to console
  - Log output on both success AND failure cases
  - Include timestamps with each log entry
  - Include the git command being executed
  - Logs will be captured by pm2 for audit trail
  - Format: `[timestamp] Executing: {command}` followed by output

### File Locations
- Bare repo: `/root/thopter-repo`
- MCP server script: `/usr/local/bin/git-proxy-mcp.js`
- Claude's repo: `/data/thopter/workspace/{repoName}`

### Security Model
- Claude has no access to the GitHub PAT
- Claude can only trigger push to one predefined branch
- All git operations are logged via pm2 (complete stdout/stderr capture)
- Every git command execution is logged with full output for audit trail
- Root process validates branch name from environment variable
- No command injection possible (no user input in git commands)

## Modifications Required

### 1. thopter-init.sh (Complete Replacement of Git Setup)
- Remove all existing git clone logic for thopter user
- Set up bare repo as root
- Clone from GitHub with PAT embedded in URL (root only)
- Set WORK_BRANCH environment variable
- Start MCP server via pm2
- Clone from bare repo as thopter user (no GitHub access)
- Configure Claude's MCP settings: `claude mcp add --transport http git-proxy http://localhost:8777`
- Remove all PAT passing to thopter user
- Rename start-observer.sh to start-services.sh

### 2. pm2.config.js
- Add git-proxy-mcp server configuration running as root

### 3. New/Modified Files
- `/usr/local/bin/git-proxy-mcp.js` - The MCP server implementation (new)
- `/usr/local/bin/start-services.sh` - Renamed from start-observer.sh (modified)

### 4. Dockerfile
- Install MCP SDK globally for root user: `npm install -g @modelcontextprotocol/sdk`
- This is the only new npm dependency needed for the git proxy system

## Testing Requirements

### Manual Testing Steps
1. Deploy a test thopter with the new git proxy system
2. Verify Claude can fetch latest changes from GitHub
3. Verify Claude can push commits to the whitelisted branch
4. Verify Claude cannot push to other branches (command will fail)
5. Check pm2 logs for git operation audit trail
6. Verify PAT is not accessible from thopter user

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