# Git Proxy MCP Server Implementation Plan

## High-Level Summary

**BREAKING CHANGE**: This plan implements a complete replacement of the existing git authentication system. There is NO backwards compatibility. All existing thopters and golden claudes will be broken and must be recreated.

This plan implements a secure git proxy system as described in `spec.md`. The goal is to remove Claude's direct access to GitHub PATs while maintaining its ability to fetch and push code changes. This is achieved through a root-owned MCP server that acts as a controlled gateway for git operations.

### Key Requirements
- Claude works on a non-privileged copy of the repository
- Git operations are proxied through a root-owned MCP server
- Only two operations allowed: fetch from GitHub and push to a specific branch
- All operations are logged for audit purposes

### Keep in Mind
- **NO BACKWARDS COMPATIBILITY** - This completely replaces the existing git system
- All existing thopters and golden claudes will be broken and must be recreated
- The MCP server needs to run as root but be accessible to the thopter user
- Environment variables (WORK_BRANCH, GITHUB_PAT, GITHUB_REPOSITORY) are critical for configuration
- This is a prototype replacement - simplicity over sophistication
- Manual testing only, no automated tests required
- We can break anything - there are no existing users to worry about

---

## Phase 1: Create MCP Server Implementation

### Summary
Develop the core MCP server that will handle git proxy operations. This server will run as root and provide two tools: fetch and push.

### Phase Relationships
- **Dependencies**: None - this is the foundational component
- **Enables**: Phase 2 (Docker/PM2 integration) and Phase 3 (init script modifications)

### Success Criteria
- MCP server script created and syntactically valid
- Server implements both fetch and push tools
- TypeScript compiles without errors
- Server can be manually tested locally (outside thopter environment)

### Keep in Mind
- Use the MCP SDK's createSdkMcpServer pattern from Claude Code documentation
- Server must be HTTP-based for cross-user communication
- Keep it simple - just execute git commands and return output
- No sophisticated error handling needed - pass through git's output
- Branch name comes from WORK_BRANCH environment variable

### Steps

1. **Create the MCP server script file**
   - **File to create**: `/thopter/scripts/git-proxy-mcp.js` (new file in repo)
   - Import required dependencies (@modelcontextprotocol/sdk, child_process, http)
   - Define server configuration with name "git-proxy" and version "1.0.0"
   - **Dependency Strategy**: Since this runs as root and MCP SDK needs to be available:
     - Option A (Preferred): Install MCP SDK globally in Dockerfile (`npm install -g @modelcontextprotocol/sdk`)
     - Option B: Bundle dependencies directly in the script using a build step
     - Option C: Install to a root-accessible location like `/opt/mcp-deps` and require from there
   - For this prototype, use Option A (global install) for simplicity

2. **Implement the fetch tool (in git-proxy-mcp.js)**
   - **File being modified**: `/thopter/scripts/git-proxy-mcp.js`
   - Tool name: `fetch` (becomes `mcp__git_proxy__fetch`)
   - No parameters required
   - Execute `git fetch` in `/root/thopter-repo`
   - Return stdout and stderr as text content

3. **Implement the push tool (in git-proxy-mcp.js)**
   - **File being modified**: `/thopter/scripts/git-proxy-mcp.js`
   - Tool name: `push` (becomes `mcp__git_proxy__push`)
   - No parameters required
   - Read WORK_BRANCH from environment
   - Execute `git push origin ${WORK_BRANCH}` in `/root/thopter-repo`
   - Return stdout and stderr as text content

4. **Add HTTP server setup (in git-proxy-mcp.js)**
   - **File being modified**: `/thopter/scripts/git-proxy-mcp.js`
   - Configure server to listen on port 8777 (unique and greppable)
   - Add basic logging to stdout for pm2 capture
   - Ensure server stays running and handles multiple requests

5. **Add basic validation (in git-proxy-mcp.js)**
   - **File being modified**: `/thopter/scripts/git-proxy-mcp.js`
   - Check that `/root/thopter-repo` exists before operations
   - Verify WORK_BRANCH is set for push operations
   - Log all operations with timestamps

---

## Phase 2: Update Docker and PM2 Configuration

### Summary
Integrate the MCP server into the thopter container build and process management system.

### Phase Relationships
- **Dependencies**: Phase 1 (MCP server implementation)
- **Enables**: Phase 3 (init script can now start the MCP server)

### Success Criteria
- Dockerfile includes MCP SDK dependencies
- PM2 config includes git-proxy-mcp server entry
- Server script is copied to correct location during build
- Build completes without errors

### Keep in Mind
- MCP SDK needs to be installed globally or in a location accessible to root
- PM2 config must specify user as root for the MCP server
- Log files should go to appropriate location for debugging

### Steps

1. **Update Dockerfile to include MCP SDK**
   - **File to modify**: `/thopter/Dockerfile`
   - Add after line 83 (after Claude CLI installation):
     `RUN npm install -g @modelcontextprotocol/sdk`
   - This makes the SDK available globally for the root user
   - Verify the package name and installation works during Docker build

2. **Copy MCP server script in Dockerfile**
   - **File to modify**: `/thopter/Dockerfile`
   - Add after line 127 (after other script copies):
     `COPY scripts/git-proxy-mcp.js /usr/local/bin/git-proxy-mcp.js`
   - Add after line 128:
     `RUN chmod +x /usr/local/bin/git-proxy-mcp.js`

3. **Update pm2.config.js**
   - **File to modify**: `/thopter/scripts/pm2.config.js`
   - Add new app entry to the apps array for 'git-proxy-mcp'
   - Set user to 'root' (critical!)
   - Configure log files to `/data/thopter/logs/git-proxy.*.log`
   - Set working directory to `/root`
   - Pass through WORK_BRANCH environment variable

4. **Rename start-observer.sh to start-services.sh**
   - **Files to modify**:
     - Rename `/thopter/scripts/start-observer.sh` to `/thopter/scripts/start-services.sh`
     - Update `/thopter/Dockerfile` line 122 to reference new name
     - Update `/thopter/scripts/thopter-init.sh` line 160 to call new script name

5. **Build and verify Docker image**
   - **Command location**: Run from repo root
   - Run `npm run build` in `/hub` to check TypeScript compilation
   - Build Docker image locally to verify no syntax errors
   - Check that all files are in expected locations

---

## Phase 3: Modify Initialization Process

### Summary
Update the thopter initialization script to set up the dual-repository system and configure Claude's MCP settings.

### Phase Relationships
- **Dependencies**: Phase 1 (MCP server) and Phase 2 (Docker/PM2 setup)
- **Enables**: Phase 4 (full system testing)

### Success Criteria
- Root-owned bare repository is created and configured
- Claude's repository uses bare repo as origin
- MCP server starts successfully via PM2
- Claude's MCP settings include git-proxy server
- Environment variables are properly set

### Keep in Mind
- Initialization happens as root before switching to thopter user
- PAT must not be accessible to thopter user at all (complete isolation)
- Repository names come from existing provisioning logic (can modify if needed)
- Work branch is already generated - need to export as WORK_BRANCH
- Completely replace all existing git clone/setup logic - no preservation of old approach
- Break anything needed - this is a full replacement

### Steps

1. **Update provisioner to pass WORK_BRANCH environment variable**
   - **File to modify**: `/hub/src/lib/provisioner.ts`
   - Add WORK_BRANCH to environment variables when creating machine (around line 280):
     ```typescript
     '--env', `WORK_BRANCH=${branchName}`,
     ```
   - Comment out or remove git clone operations around lines 320-380
   - Keep PAT passing but rename to be clear it's for root only

2. **Update thopter-init to use environment variables**
   - **File to modify**: `/thopter/scripts/thopter-init.sh`
   - WORK_BRANCH, REPOSITORY, and GITHUB_REPO_PAT are now available as env vars
   - Add after line 95 to export WORK_BRANCH for thopter user:
     ```bash
     echo "export WORK_BRANCH='$WORK_BRANCH'" >> /data/thopter/.bashrc
     ```

3. **Set up root-owned bare repository**
   - **File to modify**: `/thopter/scripts/thopter-init.sh`
   - Add after line 95 (after firewall setup), as root:
     ```bash
     # Clone bare repo as root with PAT
     thopter_log "Setting up root-owned bare repository..."
     rm -rf /root/thopter-repo
     git clone --bare https://${GITHUB_REPO_PAT}@github.com/${REPOSITORY} /root/thopter-repo
     ```
   - The PAT will be embedded in the remote URL in the git config

4. **Start MCP server via PM2**
   - **File to modify**: `/thopter/scripts/start-services.sh` (renamed from start-observer.sh)
   - The PM2 config already updated in Phase 2 will start the MCP server
   - Ensure WORK_BRANCH is exported before PM2 starts

5. **Replace thopter repository setup entirely**
   - **File to modify**: `/thopter/scripts/thopter-init.sh`
   - Add after setting up bare repo (still as root):
     ```bash
     # Clone from bare repo for thopter user
     REPO_NAME=$(echo $REPOSITORY | cut -d'/' -f2)
     git clone /root/thopter-repo /data/thopter/workspace/$REPO_NAME
     chown -R thopter:thopter /data/thopter/workspace/$REPO_NAME
     ```

6. **Configure Claude's MCP settings**
   - **File to modify**: `/thopter/scripts/thopter-init.sh`
   - Add after line 165 (after chown, before switching to thopter user):
     ```bash
     # Configure Claude's MCP settings as thopter user
     runuser -u thopter -- claude mcp add --transport http git-proxy http://localhost:8777
     ```
   - This adds the MCP server to Claude's user configuration

7. **Update prompts to use MCP tools**
   - **File to modify**: `/hub/templates/prompts/default.md`
   - Replace direct git push instructions with:
     ```markdown
     6. Push your changes using the MCP tool: Use the `mcp__git_proxy__push` tool
     7. To fetch updates: Use the `mcp__git_proxy__fetch` tool
     ```

---

## Initialization Sequence Recapitulation

This section describes the complete flow of how a thopter is initialized with the new git proxy system, from Docker build through to operational state.

### 1. Docker Build Time (Dockerfile)
- **MCP SDK installed globally**: `npm install -g @modelcontextprotocol/sdk` (available to root)
- **Scripts copied to image**:
  - `/usr/local/bin/git-proxy-mcp.js` - The MCP server
  - `/usr/local/bin/start-services.sh` - Renamed from start-observer.sh
  - `/usr/local/bin/pm2.config.js` - Updated with git-proxy-mcp entry

### 2. Hub Provisioning (hub/src/lib/provisioner.ts)
- **Machine creation**: Fly machine created with environment variables:
  - `GITHUB_REPO_PAT` - The personal access token (for root only)
  - `REPOSITORY` - The repository to clone (e.g., "owner/repo")
  - `ISSUE_NUMBER` - The GitHub issue number
  - **NEW: `WORK_BRANCH`** - Pre-computed branch name (e.g., "thopter/123--machine-id")
- **Context files uploaded** (AFTER init completes):
  - `issue.json` - Contains `workBranch` field with branch name
  - `prompt.md` - Updated to reference MCP tools instead of direct git commands
- **NO git clone performed** - This is now handled by thopter-init.sh

### 3. Container Startup (thopter-init.sh as root)
The init script runs as root (PID 1) and performs these steps in order:

#### Early Setup (lines 1-95)
- Mount point readiness check
- Workspace directory creation
- Firewall setup

#### Git Repository Setup (NEW - after line 95)

```bash
# WORK_BRANCH is already set as environment variable by provisioner
# REPOSITORY and GITHUB_REPO_PAT are also set by provisioner

# Clone bare repo as root with PAT
rm -rf /root/thopter-repo
git clone --bare https://${GITHUB_REPO_PAT}@github.com/${REPOSITORY} /root/thopter-repo

# Clone from bare repo for thopter user
REPO_NAME=$(echo $REPOSITORY | cut -d'/' -f2)
git clone /root/thopter-repo /data/thopter/workspace/$REPO_NAME

# Export WORK_BRANCH for thopter user
echo "export WORK_BRANCH='$WORK_BRANCH'" >> /data/thopter/.bashrc
```

#### Service Startup (line 160)
- **start-services.sh** called (renamed from start-observer.sh)
- PM2 starts three services:
  1. `session-observer` (user: thopter) - Status reporting
  2. `claude-log-generator` (user: thopter) - Log HTML generation
  3. **`git-proxy-mcp` (user: root)** - NEW: MCP server on port 8777

#### MCP Configuration (NEW - after line 165)
```bash
# Configure Claude's MCP settings as thopter user
runuser -u thopter -- claude mcp add --transport http git-proxy http://localhost:8777
```

#### Final Setup (lines 166-175)
- Ownership fixed: `chown -R thopter:thopter /data`
- Switch to thopter user
- Launch tmux and gotty web terminal

### 4. Operational State
Once initialization is complete:

- **Root process** has:
  - Bare repository at `/root/thopter-repo` with PAT in URL
  - MCP server running on port 8777
  - Full access to push/fetch from GitHub

- **Thopter user** has:
  - Working repository at `/data/thopter/workspace/{repoName}`
  - Origin pointing to `/root/thopter-repo` (no GitHub access)
  - Claude configured with git-proxy MCP server
  - WORK_BRANCH environment variable set

- **Claude** can:
  - Commit and push to local bare repo
  - Request GitHub operations via MCP tools:
    - `mcp__git_proxy__fetch` - Fetch from GitHub
    - `mcp__git_proxy__push` - Push to `thopter/*` branch
  - No direct access to PAT or GitHub

### 5. Git Operation Flow
1. Claude makes commits in `/data/thopter/workspace/{repoName}`
2. Claude pushes to bare repo: `git push origin {branch}`
3. Claude calls `mcp__git_proxy__push` tool
4. MCP server (as root) executes: `git push origin ${WORK_BRANCH}` in bare repo
5. Changes reach GitHub on the whitelisted branch only

---

## Phase 4: Integration Testing and Validation

### Summary
Deploy and test the complete system to ensure all requirements are met.

### Phase Relationships
- **Dependencies**: All previous phases
- **Enables**: Production deployment

### Success Criteria
- Thopter provisions successfully with new system
- Claude can fetch updates from GitHub via MCP
- Claude can push to designated branch via MCP
- PAT is not accessible from thopter user
- All operations are logged in PM2

### Keep in Mind
- This is manual testing only
- Need to test both success and failure cases
- Should verify security boundaries are maintained
- This is a complete replacement - old functionality will be broken and that's expected
- All existing thopters will need to be recreated

### Steps

1. **Deploy test thopter**
   - Use fly/recreate-gc.sh to create new golden claude
   - Provision a test thopter with `/thopter` command
   - Monitor logs during provisioning

2. **Verify repository setup**
   - SSH into thopter and check repository structure
   - Confirm bare repo exists at `/root/thopter-repo`
   - Verify thopter repo origin points to bare repo
   - Check that PAT is not in thopter user environment

3. **Test fetch operation**
   - Make a change to the GitHub repository
   - Use Claude to request a fetch via MCP tool
   - Verify changes are pulled successfully
   - Check PM2 logs for operation record

4. **Test push operation**
   - Have Claude make a commit
   - Request push via MCP tool
   - Verify push succeeds to designated branch
   - Confirm push to other branches would fail

5. **Verify security boundaries**
   - As thopter user, attempt to access `/root/thopter-repo`
   - Try to read PAT from environment or git config
   - Ensure MCP server only responds to valid requests

6. **Check logging and audit trail**
   - Review PM2 logs for git-proxy-mcp
   - Verify all operations are logged with timestamps
   - Confirm output is useful for debugging

7. **Document any issues or limitations**
   - Note any unexpected behavior
   - Document workarounds if needed
   - Update spec if implementation differs

### Post-Phase Status
At the end of this phase, the system should be fully functional as a complete replacement for the existing git authentication. All old thopters will be broken - this is expected. New thopters created after deployment will use the new git proxy system exclusively. Any remaining issues should be documented for future enhancement.
