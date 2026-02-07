/**
 * Runloop SDK client factory.
 */

import Runloop from "@runloop/api-client";

let _client: Runloop | undefined;

export function getClient(): Runloop {
  if (_client) return _client;

  const apiKey = process.env.RUNLOOP_API_KEY;
  if (!apiKey) {
    console.error("ERROR: RUNLOOP_API_KEY environment variable is not set.");
    console.error("  Set it with: export RUNLOOP_API_KEY=your-key");
    console.error("  Or run: runloop-thopters setup");
    process.exit(1);
  }

  _client = new Runloop({ bearerToken: apiKey });
  return _client;
}
