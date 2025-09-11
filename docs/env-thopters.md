# .env.thopters - Developer Environment Variables

The `.env.thopters` file allows developers to define environment variables that will be automatically loaded in all thopter containers at runtime. This enables sharing of development-specific configuration like API tokens, service URLs, or other environment settings across all thopter agents.

## Overview

When a `.env.thopters` file is present in the project root:
1. It's uploaded to the hub during hub creation or manually via `fly/upload-env-thopters.sh`
2. Each new thopter automatically receives a copy during provisioning
3. The variables are sourced into the thopter user's shell environment
4. Claude Code agents inherit these environment variables

## Usage

### Creating the File

Create a `.env.thopters` file in your project root:

```bash
# Example .env.thopters
ANTHROPIC_API_KEY=sk-ant-api03-...
MY_SERVICE_URL=https://dev.example.com
NODE_ENV=development
DEBUG=true
```

### File Format

- Use standard bash environment variable syntax: `KEY=value`
- One variable per line
- Comments starting with `#` are allowed
- Values with spaces should be quoted: `MY_VAR="value with spaces"`
- No commands or scripts allowed (only variable assignments)

### Uploading to Hub

The file is automatically uploaded when creating a new hub:
```bash
./fly/recreate-hub.sh
```

To update the file on an existing hub:
```bash
./fly/upload-env-thopters.sh
```

### Validation

The preflight script validates the file format:
```bash
./fly/preflight.sh
```

## Security Considerations

⚠️ **Important Security Notes:**

- **Never include production credentials** in `.env.thopters`
- This file is for development environment variables only
- The file is copied to all thopter containers
- `.env.thopters` is gitignored by default to prevent accidental commits
- The file is validated to prevent command execution

## How It Works

1. **Hub Storage**: The file is stored in `/data/thopter-env/.env.thopters` on the hub
2. **Provisioning**: During thopter creation, the provisioner copies the file from hub to thopter
3. **Shell Integration**: The thopter init script adds sourcing to `.bashrc`:
   ```bash
   if [ -f ~/.env.thopters ]; then
       set -a  # Mark all new variables for export
       source ~/.env.thopters
       set +a  # Turn off auto-export
   fi
   ```
4. **Inheritance**: All processes started by the thopter user inherit these variables

## Troubleshooting

### File Not Loading

If variables aren't available in thopters:
1. Check the file exists on hub: `fly ssh console --machine <hub-id> -C "ls -la /data/thopter-env/"`
2. Verify upload succeeded: `./fly/upload-env-thopters.sh`
3. Check thopter received the file during provisioning (check hub logs)

### Validation Errors

If the file fails validation:
- Ensure it contains only `KEY=value` pairs
- Remove any commands or script logic
- Check for proper quoting of values with spaces
- Verify it can be sourced: `bash -c "source .env.thopters"`

### Updating Variables

To update environment variables:
1. Edit `.env.thopters` locally
2. Run `./fly/upload-env-thopters.sh` to update the hub
3. New thopters will receive the updated file
4. Existing thopters keep their current variables (recreate them to update)

## Example Workflow

1. Create `.env.thopters` with your development variables:
   ```bash
   echo 'MY_API_KEY=dev-key-123' > .env.thopters
   echo 'SERVICE_URL=https://dev.myservice.com' >> .env.thopters
   ```

2. Deploy the hub (automatically uploads the file):
   ```bash
   ./fly/recreate-hub.sh
   ```

3. When thopters are created, they automatically have access to these variables:
   ```bash
   # Inside a thopter container:
   echo $MY_API_KEY  # outputs: dev-key-123
   ```

4. Update variables as needed:
   ```bash
   echo 'NEW_VAR=value' >> .env.thopters
   ./fly/upload-env-thopters.sh
   ```

## Best Practices

1. **Keep it minimal**: Only include necessary development variables
2. **Use descriptive names**: Clear variable names help other developers
3. **Document variables**: Add comments explaining what each variable is for
4. **Regular cleanup**: Remove unused variables periodically
5. **Team coordination**: Communicate changes to team members
6. **Secure storage**: Store sensitive values in a password manager, reference them in documentation