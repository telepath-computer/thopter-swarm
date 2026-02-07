/**
 * Runloop secrets CRUD wrappers.
 */

import { getClient } from "./client.js";

export async function listSecrets(): Promise<
  Array<{ id: string; name: string }>
> {
  const client = getClient();
  const result = await client.secrets.list({ limit: 100 });
  return (result.secrets ?? []).map((s) => ({
    id: s.id,
    name: s.name,
  }));
}

export async function createOrUpdateSecret(
  name: string,
  value: string,
): Promise<void> {
  const client = getClient();
  const existing = await listSecrets();
  const found = existing.find((s) => s.name === name);

  if (found) {
    await client.secrets.update(name, { value });
  } else {
    await client.secrets.create({ name, value });
  }
}

export async function deleteSecret(name: string): Promise<void> {
  const client = getClient();
  await client.secrets.delete(name);
}
