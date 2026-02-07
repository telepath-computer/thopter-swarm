/**
 * Friendly name generator for devboxes.
 * Uses friendly-words from Glitch (https://github.com/glitchdotcom/friendly-words)
 */

// @ts-expect-error — friendly-words has no types
import friendlyWords from "friendly-words";

const { predicates, objects } = friendlyWords as {
  predicates: string[];
  objects: string[];
};

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateName(): string {
  return `${pick(predicates)}-${pick(objects)}`;
}
