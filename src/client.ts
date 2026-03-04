/**
 * Runloop SDK client factory.
 */

import Runloop from "@runloop/api-client";
import { isDigitalOceanProvider } from "./provider.js";

let _client: Runloop | undefined;

export function getClient(): Runloop {
  if (isDigitalOceanProvider()) {
    throw new Error(
      "Runloop client requested while provider is set to DigitalOcean. This operation is not migrated yet.",
    );
  }
  if (_client) return _client;

  const apiKey = process.env.RUNLOOP_API_KEY;
  if (!apiKey) {
    console.error("ERROR: Runloop API key not configured.");
    console.error("  Set it with: thopter config set runloopApiKey <your-key>");
    process.exit(1);
  }

  _client = new Runloop({ bearerToken: apiKey });
  return _client;
}
