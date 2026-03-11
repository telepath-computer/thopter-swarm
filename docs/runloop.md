# RunLoop Mode

RunLoop support still exists in the codebase, but it is not the primary documented or tested path. The active provider is currently hard-coded to DigitalOcean in [src/provider.ts](../src/provider.ts).

Use this document only if you intentionally want to operate the older RunLoop-backed path.

## Status

- Secondary / compatibility mode
- Not the default
- Not what the main README optimizes for
- Still present in setup and runtime code paths

## How To Use It

At the moment there is no user-facing provider flag. To use RunLoop mode, you must change the active provider in [src/provider.ts](../src/provider.ts):

```ts
const ACTIVE_PROVIDER: Provider = "runloop";
```

Then rebuild or run the CLI from source.

## Setup Requirements

In RunLoop mode, `thopter setup` will:

1. Prompt for `runloopApiKey`
2. Verify the RunLoop API key
3. Prompt for Redis and devbox env vars
4. Optionally configure `ntfy.sh`

The relevant local config key is:

- `runloopApiKey`

Example:

```json
{
  "runloopApiKey": "rl_api_abc123...",
  "envVars": {
    "GH_TOKEN": "ghp_abc123...",
    "THOPTER_REDIS_URL": "rediss://default:abc123@us1-example.upstash.io:6379"
  }
}
```

## Why This Is Secondary

This repository has been moved over to DigitalOcean droplets as the primary runtime target. RunLoop remains in the codebase mainly to preserve compatibility while the provider abstraction is still incomplete.

So if you are reading the rest of the repo and notice mixed terminology:

- README and setup docs are DigitalOcean-first
- `runloopApiKey` remains in config for this mode
- some CLI/help/package text still reflects the older naming

That is expected for now.
