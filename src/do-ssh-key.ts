import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function doctlJson(args: string[]): unknown {
  const raw = execFileSync("doctl", [...args, "-o", "json"], { encoding: "utf-8" });
  return JSON.parse(raw);
}

export function getLocalRSAPrivateKeyPath(): string {
  const home = process.env.HOME ?? "";
  const keyPath = resolve(home, ".ssh", "id_rsa");
  if (!existsSync(keyPath)) {
    throw new Error("DigitalOcean mode requires ~/.ssh/id_rsa to exist.");
  }
  return keyPath;
}

export function getLocalRSAPublicKeyPath(): string {
  const home = process.env.HOME ?? "";
  const keyPath = resolve(home, ".ssh", "id_rsa.pub");
  if (!existsSync(keyPath)) {
    throw new Error("DigitalOcean mode requires ~/.ssh/id_rsa.pub to exist.");
  }
  return keyPath;
}

function normalizePublicKey(value: string): string {
  const parts = value.trim().split(/\s+/);
  if (parts.length < 2) return value.trim();
  return `${parts[0]} ${parts[1]}`;
}

function findMatchingFingerprint(localNormalizedPublicKey: string): string | null {
  const raw = doctlJson(["compute", "ssh-key", "list"]);
  if (!Array.isArray(raw)) {
    throw new Error("Failed to list DigitalOcean SSH keys.");
  }
  for (const entry of raw) {
    const obj = entry as Record<string, unknown>;
    const publicKey = normalizePublicKey(String(obj.public_key ?? obj.PublicKey ?? ""));
    if (publicKey && publicKey === localNormalizedPublicKey) {
      return String(obj.fingerprint ?? obj.Fingerprint ?? "");
    }
  }
  return null;
}

/**
 * Ensure ~/.ssh/id_rsa.pub exists in DigitalOcean SSH keys.
 * Returns the matching fingerprint (existing or newly imported).
 */
export function ensureDOFingerprintForLocalRSAPub(): string {
  const pubPath = getLocalRSAPublicKeyPath();
  const localPub = normalizePublicKey(readFileSync(pubPath, "utf-8"));
  const existing = findMatchingFingerprint(localPub);
  if (existing) return existing;

  const keyName = `thopter-id-rsa-${Date.now()}`;
  execFileSync(
    "doctl",
    ["compute", "ssh-key", "import", keyName, "--public-key-file", pubPath],
    { stdio: "inherit" },
  );

  const afterImport = findMatchingFingerprint(localPub);
  if (!afterImport) {
    throw new Error(
      "Imported ~/.ssh/id_rsa.pub but could not find it in DigitalOcean SSH keys.",
    );
  }
  return afterImport;
}

