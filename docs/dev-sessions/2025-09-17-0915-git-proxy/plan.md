# Git Proxy MCP Server Implementation Plan

## High-Level Summary

**BREAKING CHANGE**: This plan implements a complete replacement of the existing git authentication system. There is NO backwards compatibility. All existing thopters and golden claudes will be broken and must be recreated.

This plan implements a secure git proxy system as described in `spec.md`. The goal is to remove Claude's direct access to GitHub PATs while maintaining its ability to fetch and push code changes. This is achieved through a root-owned MCP server that acts as a controlled gateway for git operations.

### Implementation Constraints and Strategy

**IMPORTANT**: Claude (the AI assistant) has the following constraints during implementation:
- **Cannot run Docker builds** - Can only write Dockerfiles and verify syntax
- **Cannot deploy to Fly.io** - Can only write deployment scripts
- **Cannot execute the MCP server** - Can only write and verify JavaScript/TypeScript syntax
- **Cannot test the full integration** - Can only ensure code compiles without errors

**Implementation Strategy**:
1. Claude will write all necessary code files and modifications
2. Claude will run `npm run build` to verify TypeScript compilation
3. Claude will ensure all syntax is valid and follows best practices
4. User will perform manual Docker builds, deployments, and testing
5. User will provide feedback on any issues for Claude to fix

This division of labor ensures clean code delivery while acknowledging the execution boundaries.

### Key Requirements
- Claude works on a non-privileged copy of the repository
- Git operations are proxied through a root-owned MCP server
- Only two operations allowed: fetch from GitHub and push to a specific branch
- All operations are logged for audit purposes

### Keep in Mind
- **NO BACKWARDS COMPATIBILITY** - This completely replaces the existing git system
- All existing thopters and golden claudes will be broken and must be recreated
- **GOLDEN CLAUDE SUPPORT**: Use `IS_GOLDEN_CLAUDE` env var to skip git operations for template machines
- The MCP server needs to run as root but be accessible to the thopter user
- **PERFORMANCE CRITICAL**: Bare repository must be in `/data/root` not `/root` for volume performance
- The `/data/root` directory is a secure enclave with 700 permissions within the `/data` volume
- Environment variables (WORK_BRANCH, GITHUB_PAT, GITHUB_REPOSITORY) are critical for configuration
- `IS_GOLDEN_CLAUDE` environment variable controls whether git operations are performed
- This is a prototype replacement - simplicity over sophistication
- Manual testing only, no automated tests required
- We can break anything - there are no existing users to worry about

### CRITICAL Implementation Constraint
**Linux Permission Issue**: Thopter user cannot write to root-owned bare repository.

**Problem**: The original design assumed thopter could push to `/data/root/thopter-repo`, but Linux filesystem permissions prevent this (thopter user cannot write to root:root 700-permission directory).

**Solution**: 
1. **Thopter repository is LOCAL-ONLY** (no remote origin after initial clone)
2. **MCP server handles bidirectional sync**: 
   - **Push**: MCP server syncs thopter commits to bare repo, then pushes to GitHub
   - **Fetch**: MCP server fetches from GitHub to bare repo, then syncs to thopter repo
3. **Root privilege leverage**: MCP server (running as root) can read thopter-owned files and write to root-owned bare repo
4. **Command used**: `git fetch /path/to/source/repo branch:branch` for local sync operations

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
- All git command output is logged to stdout for pm2 capture
- Logging includes timestamps, commands, and full output

### Keep in Mind
- Use the MCP SDK's createSdkMcpServer pattern from Claude Code documentation
- Server must be HTTP-based for cross-user communication
- **CRITICAL**: Server MUST be resilient to all failures and never crash
- Wrap all operations in try-catch blocks
- Return errors as tool results, not exceptions
- Server must continue running even if:
  - Repository doesn't exist
  - Permissions are wrong
  - Network is unavailable
  - Environment variables are missing
- Log all errors clearly for debugging
- Branch name comes from WORK_BRANCH environment variable

### Steps

1. **Create the MCP server script file**
   - **File to create**: `/thopter/scripts/git-proxy-mcp.js` (new file in repo)
   - Import required dependencies (@modelcontextprotocol/sdk, child_process, http)
   - Define server configuration with name "git-proxy" and version "1.0.0"
   - **Golden Claude Detection**: Check `IS_GOLDEN_CLAUDE` environment variable on startup
     - If `IS_GOLDEN_CLAUDE="true"`, log "Running in golden claude mode - git operations disabled"
     - Set internal flag to return idle responses for all operations
   - **Dependency Strategy**: Since this runs as root and MCP SDK needs to be available:
     - Option A (Preferred): Install MCP SDK globally in Dockerfile (`npm install -g @modelcontextprotocol/sdk`)
     - Option B: Bundle dependencies directly in the script using a build step
     - Option C: Install to a root-accessible location like `/opt/mcp-deps` and require from there
   - For this prototype, use Option A (global install) for simplicity

2. **Implement the fetch tool (in git-proxy-mcp.js)**
   - **File being modified**: `/thopter/scripts/git-proxy-mcp.js`
   - Tool name: `fetch` (becomes `mcp__git_proxy__fetch`)
   - No parameters required
   - **Golden Claude Check**: If in golden claude mode, return "Git operations are disabled in golden claude mode"
   - Wrap git execution in try-catch
   - Check if repository exists before executing
   - Execute `git fetch` in `/data/root/thopter-repo`
   - **ALWAYS log to console**: `[timestamp] Executing: git fetch` (except in golden claude mode)
   - **ALWAYS log git stdout/stderr to console** (success or failure, except in golden claude mode)
   - Return stdout and stderr as text content on success
   - Return error message as text content on failure
   - PM2 will capture all console output for audit trail

3. **Implement the push tool (in git-proxy-mcp.js)**
   - **File being modified**: `/thopter/scripts/git-proxy-mcp.js`
   - Tool name: `push` (becomes `mcp__git_proxy__push`)
   - No parameters required
   - **Golden Claude Check**: If in golden claude mode, return "Git operations are disabled in golden claude mode"
   - Wrap git execution in try-catch
   - Read WORK_BRANCH from environment (return error if missing, except in golden claude mode)
   - Check if repository exists before executing
   - Execute `git push origin ${WORK_BRANCH}` in `/data/root/thopter-repo`
   - **ALWAYS log to console**: `[timestamp] Executing: git push origin ${WORK_BRANCH}`
   - **ALWAYS log git stdout/stderr to console** (success or failure)
   - Return stdout and stderr as text content on success
   - Return error message as text content on failure
   - PM2 will capture all console output for audit trail

4. **Add HTTP server setup (in git-proxy-mcp.js)**
   - **File being modified**: `/thopter/scripts/git-proxy-mcp.js`
   - Configure server to listen on port 8777 (unique and greppable)
   - Log server startup: `[timestamp] Git proxy MCP server started on port 8777`
   - Log each incoming request: `[timestamp] Received request for tool: {toolName}`
   - Ensure ALL output goes to stdout for pm2 capture
   - Ensure server stays running and handles multiple requests

5. **Add error resilience and comprehensive logging (in git-proxy-mcp.js)**
   - **File being modified**: `/thopter/scripts/git-proxy-mcp.js`
   - Wrap entire server initialization in try-catch
   - Gracefully handle missing `/root/thopter-repo`
   - Gracefully handle missing WORK_BRANCH for push
   - Never let an error crash the server process
   - **Comprehensive logging requirements**:
     - Log all operations with ISO timestamps
     - Log git command before execution
     - Log git command output (stdout AND stderr)
     - Log success/failure status
     - Format: `[YYYY-MM-DD HH:mm:ss] message`
   - Use process.on('uncaughtException') with logging
   - Use process.on('unhandledRejection') with logging
   - All logs go to stdout for pm2 capture

---

## Phase 2: Update Docker and PM2 Configuration

### Summary
Integrate the MCP server into the thopter container build and process management system. Update all logging paths to use centralized `/data/logs` directory.

### Phase Relationships
- **Dependencies**: Phase 1 (MCP server implementation)
- **Enables**: Phase 3 (init script can now start the MCP server)

### Success Criteria
- Dockerfile includes MCP SDK dependencies
- PM2 config includes git-proxy-mcp server entry
- All PM2 log paths updated to `/data/logs/`
- Server script is copied to correct location during build
- Build completes without errors

### Keep in Mind
- MCP SDK needs to be installed globally or in a location accessible to root
- PM2 config must specify user as root for the MCP server
- **CRITICAL**: All log files must go to `/data/logs/` for performance
- The `/data/logs` directory will be created by init script, not Dockerfile
- PM2 logs must be accessible to both root and thopter users

### Steps

1. **Update Dockerfile to include MCP SDK and remove old log setup**
   - **File to modify**: `/thopter/Dockerfile`
   - Add after line 83 (after Claude CLI installation):
     `RUN npm install -g @modelcontextprotocol/sdk`
   - This makes the SDK available globally for the root user
   - **Remove old log file creation** (around line 147):
     - Remove: `touch /thopter/log && chmod 666 /thopter/log`
     - No longer needed as logs go to `/data/logs/init.log`
   - Verify the package name and installation works during Docker build

2. **Copy MCP server script in Dockerfile**
   - **File to modify**: `/thopter/Dockerfile`
   - Add after line 127 (after other script copies):
     `COPY scripts/git-proxy-mcp.js /usr/local/bin/git-proxy-mcp.js`
   - Add after line 128:
     `RUN chmod +x /usr/local/bin/git-proxy-mcp.js`

3. **Update pm2.config.js with centralized logging**
   - **File to modify**: `/thopter/scripts/pm2.config.js`
   - Add new app entry to the apps array for 'git-proxy-mcp'
   - Set user to 'root' (critical!)
   - **Update ALL log paths to use `/data/logs/`**:
     - `session-observer`: `/data/logs/observer.*.log`
     - `claude-log-generator`: `/data/logs/claude-log.*.log`
     - `claude-log-webserver`: `/data/logs/webserver.*.log`
     - `git-proxy-mcp`: `/data/logs/git-proxy.*.log`
   - Set working directory to `/root` for git-proxy-mcp
   - Pass through WORK_BRANCH environment variable

4. **Rename start-observer.sh to start-services.sh**
   - **Files to modify**:
     - Rename `/thopter/scripts/start-observer.sh` to `/thopter/scripts/start-services.sh`
     - Update `/thopter/Dockerfile` line 122 to reference new name
     - Update `/thopter/scripts/thopter-init.sh` line 160 to call new script name

5. **Verify code compilation**
   - **Command location**: Run from repo root
   - Run `npm run build` in `/hub` to check TypeScript compilation
   - Verify all JavaScript files have valid syntax
   - Note: Docker build and deployment will be done by user manually

---

## Phase 3: Modify Initialization Process

### Summary
Update the thopter initialization script to set up the dual-repository system, configure Claude's MCP settings, and implement centralized logging.

### Phase Relationships
- **Dependencies**: Phase 1 (MCP server) and Phase 2 (Docker/PM2 setup)
- **Enables**: Phase 4 (full system testing)

### Success Criteria
- Centralized logging directory `/data/logs` created early with proper permissions
- All logs write to `/data/logs/` instead of scattered locations
- Root-owned bare repository is created and configured
- Claude's repository uses bare repo as origin
- MCP server starts successfully via PM2
- Claude's MCP settings include git-proxy server
- Environment variables are properly set

### Keep in Mind
- Initialization happens as root before switching to thopter user
- PAT must not be accessible to thopter user at all (complete isolation)
- **CRITICAL**: Must create `/data/root` directory with 700 permissions for performance
- Bare repository goes in `/data/root/thopter-repo` NOT `/root/thopter-repo`
- Permission fixing at end of script must preserve root ownership of `/data/root`
- Repository names come from existing provisioning logic (can modify if needed)
- Work branch is already generated - need to export as WORK_BRANCH
- Completely replace all existing git clone/setup logic - no preservation of old approach
- Break anything needed - this is a full replacement

### Steps

1. **Set up centralized logging directory (VERY EARLY in init)**
   - **File to modify**: `/thopter/scripts/thopter-init.sh`
   - Add at the very beginning of the script (before line 5):
     ```bash
     # Create centralized logging directory on fast filesystem
     mkdir -p /data/logs
     chmod 755 /data/logs
     chown thopter:thopter /data/logs
     
     # Update logging function to use new location
     LOG_FILE="/data/logs/init.log"
     thopter_log() {
         local message="$(date '+%Y-%m-%d %H:%M:%S') [THOPTER-INIT] $*"
         echo "$message" | tee -a "$LOG_FILE"
     }
     ```
   - This ensures ALL initialization output goes to the fast filesystem
   - Directory is writable by both root (during init) and thopter (later operations)

2. **Update provisioner to use new log location and set IS_GOLDEN_CLAUDE**
   - **File to modify**: `/hub/src/lib/provisioner.ts`
   - **Critical log path changes**:
     - Update ALL references from `/thopter/log` to `/data/logs/init.log`
     - Search for all occurrences of `/thopter/log` in the file
     - Update log tailing commands (e.g., `tail -f /thopter/log` → `tail -f /data/logs/init.log`)
     - Update log extraction commands
     - Update any log monitoring or status checking
   - **Environment variable handling**:
     - For golden claude instances:
       ```typescript
       '--env', `IS_GOLDEN_CLAUDE=true`,
       ```
     - For regular thopters:
       ```typescript
       '--env', `ISSUE_NUMBER=${issueNumber}`,
       '--env', `IS_GOLDEN_CLAUDE=false`,  // Or omit since false is default
       ```
   - Comment out or remove git clone operations around lines 320-380
   - Keep PAT passing but rename to be clear it's for root only
   - Note: WORK_BRANCH will be constructed by init script using ISSUE_NUMBER + FLY_MACHINE_ID

3. **Check for golden claude mode and conditionally set up git**
   - **File to modify**: `/thopter/scripts/thopter-init.sh`
   - Add early in script (after line 10) to check golden claude mode:
     ```bash
     # Check if this is a golden claude instance
     if [ "$IS_GOLDEN_CLAUDE" = "true" ]; then
         thopter_log "Running in golden claude mode - git operations will be disabled"
         export GOLDEN_CLAUDE_MODE=true
     else
         # Construct work branch from issue number and machine ID
         if [ -n "$ISSUE_NUMBER" ] && [ -n "$FLY_MACHINE_ID" ]; then
             export WORK_BRANCH="thopter/${ISSUE_NUMBER}--${FLY_MACHINE_ID}"
             thopter_log "Constructed WORK_BRANCH: $WORK_BRANCH"
         else
             thopter_log "Warning: Cannot construct WORK_BRANCH - missing ISSUE_NUMBER or FLY_MACHINE_ID"
         fi
     fi
     ```
   - Only export WORK_BRANCH if not in golden claude mode:
     ```bash
     if [ "$IS_GOLDEN_CLAUDE" != "true" ] && [ -n "$WORK_BRANCH" ]; then
         echo "export WORK_BRANCH='$WORK_BRANCH'" >> /data/thopter/.bashrc
     fi
     ```

4. **Create secure root enclave and set up bare repository (skip for golden claude)**
   - **File to modify**: `/thopter/scripts/thopter-init.sh`
   - Add after line 95 (after firewall setup), as root:
     ```bash
     # Skip all git setup for golden claude instances
     if [ "$IS_GOLDEN_CLAUDE" != "true" ]; then
         # Create secure root enclave in /data for performance
         thopter_log "Creating secure root enclave..."
         mkdir -p /data/root
         chmod 700 /data/root
         chown root:root /data/root
         
         # Only proceed if we have required environment variables
         if [ -n "$REPOSITORY" ] && [ -n "$GITHUB_REPO_PAT" ]; then
             # Clone bare repo as root with PAT
             thopter_log "Setting up root-owned bare repository..."
             rm -rf /data/root/thopter-repo
             git clone --bare https://${GITHUB_REPO_PAT}@github.com/${REPOSITORY} /data/root/thopter-repo
         else
             thopter_log "Skipping git repository setup - missing REPOSITORY or GITHUB_REPO_PAT"
         fi
     else
         thopter_log "Skipping git setup in golden claude mode"
     fi
     ```
   - The PAT will be embedded in the remote URL in the git config
   - Using `/data/root` ensures high-performance I/O operations

5. **Start MCP server via PM2**
   - **File to modify**: `/thopter/scripts/start-services.sh` (renamed from start-observer.sh)
   - The PM2 config already updated in Phase 2 will start the MCP server
   - Ensure WORK_BRANCH is exported before PM2 starts

6. **Replace thopter repository setup entirely**
   - **File to modify**: `/thopter/scripts/thopter-init.sh`
   - Add after setting up bare repo (still as root):
     ```bash
     # Clone from bare repo for thopter user
     REPO_NAME=$(echo $REPOSITORY | cut -d'/' -f2)
     git clone /data/root/thopter-repo /data/thopter/workspace/$REPO_NAME
     chown -R thopter:thopter /data/thopter/workspace/$REPO_NAME
     ```

7. **Configure Claude's MCP settings**
   - **File to modify**: `/thopter/scripts/thopter-init.sh`
   - Add BEFORE the blanket chown but after services start:
     ```bash
     # Configure Claude's MCP settings as thopter user
     runuser -u thopter -- claude mcp add --transport http git-proxy http://localhost:8777
     ```
   - This adds the MCP server to Claude's user configuration

8. **Fix permissions while preserving root enclave and logs**
   - **File to modify**: `/thopter/scripts/thopter-init.sh`
   - Replace the blanket chown at line 165 with:
     ```bash
     # Fix all ownership but preserve root enclave and shared logs
     thopter_log "chown -R thopter:thopter /data"
     chown -R thopter:thopter /data
     
     # Restore root ownership of the secure enclave
     if [ -d "/data/root" ]; then
         chown -R root:root /data/root
         chmod 700 /data/root
     fi
     
     # Keep logs directory accessible to both root and thopter
     chmod 755 /data/logs
     ```
   - This ensures the root enclave remains secure and logs remain accessible

9. **Update prompts to use MCP tools**
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
  - **For Golden Claude**:
    - `IS_GOLDEN_CLAUDE=true` - Identifies this as a template machine
    - No `ISSUE_NUMBER` provided
    - May omit `REPOSITORY` and `GITHUB_REPO_PAT`
  - **For Regular Thopters**:
    - `IS_GOLDEN_CLAUDE=false` (or omitted)
    - `GITHUB_REPO_PAT` - The personal access token (for root only)
    - `REPOSITORY` - The repository to clone (e.g., "owner/repo")
    - `ISSUE_NUMBER` - The GitHub issue number (MUST be passed for branch construction)
  - Note: `FLY_MACHINE_ID` is automatically set by Fly.io at runtime
- **Context files uploaded** (AFTER init completes):
  - `issue.json` - Contains `workBranch` field with branch name (not for golden claude)
  - `prompt.md` - Updated to reference MCP tools instead of direct git commands
- **NO git clone performed** - This is now handled by thopter-init.sh

### 3. Container Startup (thopter-init.sh as root)
The init script runs as root (PID 1) and performs these steps in order:

#### Very Early Setup (lines 1-10)
- **Create `/data/logs` directory** (755 permissions, thopter:thopter ownership)
- **Update logging function** to write to `/data/logs/init.log` instead of `/thopter/log`
- All subsequent logging goes to fast filesystem

#### Early Setup (lines 11-95)
- Mount point readiness check
- Workspace directory creation
- Firewall setup

#### Git Repository Setup (NEW - after line 95)

```bash
# Check if this is a golden claude instance
if [ "$IS_GOLDEN_CLAUDE" = "true" ]; then
    thopter_log "Running in golden claude mode - git operations will be disabled"
    # Skip all git setup for golden claude
else
    # Construct WORK_BRANCH from ISSUE_NUMBER and FLY_MACHINE_ID
    # ISSUE_NUMBER is set by provisioner, FLY_MACHINE_ID is set by Fly.io
    if [ -n "$ISSUE_NUMBER" ] && [ -n "$FLY_MACHINE_ID" ]; then
        export WORK_BRANCH="thopter/${ISSUE_NUMBER}--${FLY_MACHINE_ID}"
        thopter_log "Constructed WORK_BRANCH: $WORK_BRANCH"
    fi

    # REPOSITORY and GITHUB_REPO_PAT are set by provisioner
    if [ -n "$REPOSITORY" ] && [ -n "$GITHUB_REPO_PAT" ]; then
        # Create secure root enclave in /data volume for performance
        thopter_log "Creating secure root enclave..."
        mkdir -p /data/root
        chmod 700 /data/root
        chown root:root /data/root

        # Clone bare repo as root with PAT (using fast /data volume)
        rm -rf /data/root/thopter-repo
        git clone --bare https://${GITHUB_REPO_PAT}@github.com/${REPOSITORY} /data/root/thopter-repo

        # Clone from bare repo for thopter user
        REPO_NAME=$(echo $REPOSITORY | cut -d'/' -f2)
        git clone /data/root/thopter-repo /data/thopter/workspace/$REPO_NAME
        
        # CRITICAL: Remove origin remote to make repository local-only
        # This prevents permission denied errors when thopter tries to push to root-owned bare repo
        cd /data/thopter/workspace/$REPO_NAME
        git remote remove origin
        cd /

        # Export WORK_BRANCH for thopter user
        echo "export WORK_BRANCH='$WORK_BRANCH'" >> /data/thopter/.bashrc
    else
        thopter_log "Skipping git repository setup - missing REPOSITORY or GITHUB_REPO_PAT"
    fi
fi  # End of IS_GOLDEN_CLAUDE check
```

#### Service Startup (line 160)
- **start-services.sh** called (renamed from start-observer.sh)
- PM2 starts three services:
  1. `session-observer` (user: thopter) - Status reporting
  2. `claude-log-generator` (user: thopter) - Log HTML generation
  3. **`git-proxy-mcp` (user: root)** - NEW: MCP server on port 8777
     - Runs for both golden claude and regular thopters
     - In golden claude mode, returns idle responses

#### MCP Configuration (NEW - after line 165)
```bash
# Configure Claude's MCP settings as thopter user (both golden claude and regular)
if [ "$IS_GOLDEN_CLAUDE" != "true" ] && [ -d "/data/root/thopter-repo" ]; then
    runuser -u thopter -- claude mcp add --transport http git-proxy http://localhost:8777
elif [ "$IS_GOLDEN_CLAUDE" = "true" ]; then
    # Still configure MCP for golden claude, but it will return idle responses
    runuser -u thopter -- claude mcp add --transport http git-proxy http://localhost:8777
fi
```

#### Final Setup (lines 166-175)
- Ownership fixed: `chown -R thopter:thopter /data`
- **Root enclave restored**: `chown -R root:root /data/root && chmod 700 /data/root`
- **Logs directory kept accessible**: `chmod 755 /data/logs`
- Switch to thopter user
- Launch tmux and gotty web terminal

### 4. Operational State
Once initialization is complete:

#### Regular Thopter Mode (IS_GOLDEN_CLAUDE != "true")
- **Root process** has:
  - Secure enclave at `/data/root` (700 permissions)
  - Bare repository at `/data/root/thopter-repo` with PAT in URL
  - MCP server running on port 8777
  - Full access to push/fetch from GitHub
  - High-performance I/O via `/data` volume

- **Thopter user** has:
  - Working repository at `/data/thopter/workspace/{repoName}`
  - Origin pointing to `/data/root/thopter-repo` (no GitHub access)
  - Claude configured with git-proxy MCP server
  - WORK_BRANCH environment variable set
  - Cannot access `/data/root` directory (permission denied)

- **Claude** can:
  - Commit and push to local bare repo
  - Request GitHub operations via MCP tools:
    - `mcp__git_proxy__fetch` - Fetch from GitHub
    - `mcp__git_proxy__push` - Push to `thopter/*` branch
  - No direct access to PAT or GitHub

#### Golden Claude Mode (IS_GOLDEN_CLAUDE = "true")
- **Root process** has:
  - MCP server running on port 8777 in idle mode
  - No `/data/root` directory created
  - No bare repository

- **Thopter user** has:
  - No repository in workspace
  - Claude configured with git-proxy MCP server (returns idle responses)
  - No WORK_BRANCH environment variable

- **Claude** receives:
  - "Git operations are disabled in golden claude mode" for all MCP git operations
  - Clean environment without git state

### 5. Git Operation Flow

#### Regular Thopter:
1. Claude makes commits in `/data/thopter/workspace/{repoName}`
2. Claude pushes to bare repo: `git push origin {branch}`
3. Claude calls `mcp__git_proxy__push` tool
4. MCP server (as root) executes: `git push origin ${WORK_BRANCH}` in bare repo
5. Changes reach GitHub on the whitelisted branch only

#### Golden Claude:
1. Claude calls `mcp__git_proxy__fetch` or `mcp__git_proxy__push` tool
2. MCP server returns: "Git operations are disabled in golden claude mode"
3. No actual git operations are performed

---

## Phase 4: User Testing and Validation

### Summary
**This phase will be executed by the user**, not by Claude. After Claude completes code implementation and verifies compilation, the user will deploy and test the system.

### Phase Relationships
- **Dependencies**: All previous phases completed by Claude
- **Enables**: Production deployment

### Success Criteria
- Thopter provisions successfully with new system
- Golden claude provisions without git setup errors
- Regular thopters: Claude can fetch updates from GitHub via MCP
- Regular thopters: Claude can push to designated branch via MCP
- Golden claude: MCP returns friendly idle messages
- PAT is not accessible from thopter user
- All operations are logged in PM2 (except idle responses in golden claude mode)

### Keep in Mind
- **User will execute all steps in this phase**
- Claude will be available to fix any issues found
- This is manual testing only
- Need to test both success and failure cases
- Should verify security boundaries are maintained
- This is a complete replacement - old functionality will be broken and that's expected
- All existing thopters will need to be recreated

### Steps for User to Execute

1. **Deploy and test golden claude**
   - User runs: `./fly/recreate-gc.sh` to create new golden claude
   - Verify golden claude provisions without errors
   - SSH into golden claude and verify:
     - No `/data/root` directory exists
     - No repository in `/data/thopter/workspace`
     - `IS_GOLDEN_CLAUDE=true` in environment
   - Test MCP tools return "Git operations are disabled in golden claude mode"
   - Verify no errors in PM2 logs about missing git configuration

2. **Deploy test thopter from golden claude**
   - User provisions a test thopter with `/thopter` command
   - User monitors logs during provisioning

3. **Verify repository setup in thopter**
   - SSH into thopter and check repository structure
   - Confirm bare repo exists at `/data/root/thopter-repo`
   - Verify `/data/root` has 700 permissions and root ownership
   - Confirm thopter user cannot access `/data/root`
   - Verify thopter repo origin points to bare repo
   - Check that PAT is not in thopter user environment

4. **Test fetch operation in thopter**
   - Make a change to the GitHub repository
   - Use Claude to request a fetch via MCP tool
   - Verify changes are pulled successfully
   - Check PM2 logs for operation record

5. **Test push operation in thopter**
   - Have Claude make a commit
   - Request push via MCP tool
   - Verify push succeeds to designated branch
   - Confirm push to other branches would fail

6. **Verify security boundaries**
   - As thopter user, attempt to access `/data/root/thopter-repo`
   - Verify permission denied when trying to read `/data/root`
   - Try to read PAT from environment or git config
   - Ensure MCP server only responds to valid requests
   - Test that root enclave survives permission repairs

7. **Check logging and audit trail**
   - Review PM2 logs for git-proxy-mcp
   - Verify all operations are logged with timestamps
   - Confirm output is useful for debugging

8. **Document any issues or limitations**
   - Note any unexpected behavior
   - Document workarounds if needed
   - Update spec if implementation differs

### Post-Phase Status
At the end of this phase (executed by the user), the system should be fully functional as a complete replacement for the existing git authentication. All old thopters will be broken - this is expected. New thopters created after deployment will use the new git proxy system exclusively.

**Claude's role**: If the user encounters issues during testing, they will provide error messages and logs to Claude for debugging. Claude will then provide fixes for any issues found, which the user can deploy and test again. This iterative process continues until the system works correctly.
