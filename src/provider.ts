/**
 * Cloud provider selection.
 *
 * Initial migration strategy: hard-code active provider while we move
 * runtime operations behind provider abstractions.
 */

export type Provider = "runloop" | "digitalocean";

const ACTIVE_PROVIDER: Provider = "digitalocean";

export function getActiveProvider(): Provider {
  return ACTIVE_PROVIDER;
}

export function isDigitalOceanProvider(): boolean {
  return getActiveProvider() === "digitalocean";
}

