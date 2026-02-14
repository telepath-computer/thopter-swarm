/**
 * SyncThing integration for file sync between laptop and devboxes.
 *
 * Configuration lives in ~/.thopter.json under the "syncthing" key:
 *   {
 *     "syncthing": {
 *       "deviceId": "MFZWI3D-...",      // laptop's SyncThing device ID
 *       "folderName": "my-sync-folder"   // ~/folderName on all machines
 *     }
 *   }
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getClient } from "./client.js";
import { getSyncthingConfig, type SyncthingConfig } from "./config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = resolve(__dirname, "..", "scripts");

const SYNCTHING_API = "http://localhost:8384";

/**
 * Install and configure SyncThing on a running devbox.
 * Passes the laptop device ID, folder ID, and remote path as arguments
 * to the install script. Returns the devbox's SyncThing device ID.
 */
export async function installSyncthingOnDevbox(
  devboxId: string,
  syncConfig: SyncthingConfig,
): Promise<string | null> {
  const client = getClient();

  // Upload the install script
  const script = readFileSync(
    resolve(SCRIPTS_DIR, "install-syncthing.sh"),
    "utf-8",
  );
  await client.devboxes.writeFileContents(devboxId, {
    file_path: "/tmp/install-syncthing.sh",
    contents: script,
  });

  // Run it with config as arguments
  console.log("Installing SyncThing on devbox...");
  const cmd = [
    "bash /tmp/install-syncthing.sh",
    JSON.stringify(syncConfig.deviceId),
    JSON.stringify(syncConfig.folderName),
    JSON.stringify(`~/${syncConfig.folderName}`),
    "2>&1",
  ].join(" ");

  const execution = await client.devboxes.executeAsync(devboxId, {
    command: cmd,
  });

  const result = await client.devboxes.executions.awaitCompleted(
    devboxId,
    execution.execution_id,
  );

  const output = result.stdout ?? "";
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  // Extract the device ID from the last line
  const match = output.match(/SYNCTHING_DEVBOX_DEVICE_ID=(\S+)/);
  if (match) {
    const deviceId = match[1];
    console.log(`Devbox SyncThing device ID: ${deviceId}`);
    return deviceId;
  }

  // Print output for debugging if we couldn't extract the device ID
  console.log(output);
  console.log("WARNING: Could not extract SyncThing device ID from devbox.");
  return null;
}

/** SyncThing device IDs are 7 groups of 7 uppercase alphanumeric chars separated by dashes. */
const DEVICE_ID_RE = /^[A-Z0-9]{7}(-[A-Z0-9]{7}){7}$/;

const ST_HOME_EXPR = "$(echo ~)/.local/state/syncthing";

/**
 * Ensure the laptop is configured as a peer on the devbox.
 * Runs the SyncThing CLI commands to add the laptop device and share the folder.
 * Idempotent — safe to run even if already configured.
 */
export async function ensurePeerOnDevbox(
  devboxId: string,
  syncConfig: SyncthingConfig,
): Promise<void> {
  const client = getClient();

  const cmds = [
    // Add laptop device (ignore "already exists" errors)
    `syncthing cli --home="${ST_HOME_EXPR}" config devices add --device-id "${syncConfig.deviceId}" --name "laptop" 2>/dev/null || true`,
    // Share folder with laptop
    `syncthing cli --home="${ST_HOME_EXPR}" config folders "${syncConfig.folderName}" devices add --device-id "${syncConfig.deviceId}" 2>/dev/null || true`,
    // Auto-accept folders from laptop
    `syncthing cli --home="${ST_HOME_EXPR}" config devices "${syncConfig.deviceId}" auto-accept-folders set true 2>/dev/null || true`,
  ];

  const execution = await client.devboxes.executeAsync(devboxId, {
    command: cmds.join(" && "),
  });

  const result = await client.devboxes.executions.awaitCompleted(
    devboxId,
    execution.execution_id,
  );

  if (result.exit_status && result.exit_status !== 0) {
    console.log("WARNING: Could not configure laptop peer on devbox.");
    if (result.stderr) process.stderr.write(result.stderr);
  }
}

/**
 * Get a devbox's SyncThing device ID by running syncthing device-id.
 */
export async function getDevboxDeviceId(
  devboxId: string,
): Promise<string | null> {
  const client = getClient();

  const execution = await client.devboxes.executeAsync(devboxId, {
    command: "syncthing device-id --home=$(echo ~)/.local/state/syncthing 2>&1",
  });

  const result = await client.devboxes.executions.awaitCompleted(
    devboxId,
    execution.execution_id,
  );

  const id = (result.stdout ?? "").trim();
  // Validate it looks like a real device ID, not an error message
  return DEVICE_ID_RE.test(id) ? id : null;
}

/**
 * Get the local SyncThing API key from the config file.
 */
function getLocalApiKey(): string | null {
  const configPaths = [
    resolve(process.env.HOME ?? "", ".local/state/syncthing/config.xml"),
    resolve(process.env.HOME ?? "", ".config/syncthing/config.xml"),
    resolve(
      process.env.HOME ?? "",
      "Library/Application Support/Syncthing/config.xml",
    ),
  ];

  for (const p of configPaths) {
    try {
      const xml = readFileSync(p, "utf-8");
      const match = xml.match(/<apikey>([^<]+)<\/apikey>/);
      if (match) return match[1];
    } catch {
      // Try next path
    }
  }
  return null;
}

/**
 * Register a sync folder with the local SyncThing instance.
 * Idempotent — if the folder already exists, does nothing.
 * Returns true if SyncThing was reachable and the folder is registered.
 */
export async function registerFolderLocally(
  folderName: string,
  folderPath: string,
): Promise<boolean> {
  const apiKey = getLocalApiKey();
  if (!apiKey) {
    console.log("WARNING: Could not find local SyncThing API key.");
    console.log("  Is SyncThing running? Check http://localhost:8384");
    return false;
  }

  const headers = {
    "X-API-Key": apiKey,
    "Content-Type": "application/json",
  };

  try {
    // Check if SyncThing is reachable
    const sysResp = await fetch(`${SYNCTHING_API}/rest/system/status`, { headers });
    if (!sysResp.ok) {
      throw new Error(`SyncThing API returned ${sysResp.status}`);
    }

    // Check if folder already exists
    const folderResp = await fetch(
      `${SYNCTHING_API}/rest/config/folders/${folderName}`,
      { headers },
    );
    if (folderResp.ok) {
      console.log(`Folder '${folderName}' already registered in SyncThing.`);
      return true;
    }

    // Add the folder
    const addResp = await fetch(`${SYNCTHING_API}/rest/config/folders`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        id: folderName,
        label: folderName,
        path: folderPath,
        devices: [],
        rescanIntervalS: 30,
        fsWatcherEnabled: true,
        fsWatcherDelayS: 1,
      }),
    });

    if (!addResp.ok) {
      const body = await addResp.text();
      console.log(`WARNING: Failed to register folder with SyncThing: ${body}`);
      return false;
    }

    console.log(`Registered folder '${folderName}' with local SyncThing.`);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
      console.log("WARNING: Could not connect to local SyncThing.");
      console.log("  Is SyncThing running? Start it with: brew services start syncthing");
    } else {
      console.log(`WARNING: SyncThing folder registration failed: ${msg}`);
    }
    return false;
  }
}

/**
 * Add a device to the local laptop's SyncThing instance via REST API.
 * Reads the folder ID from ~/.thopter.json syncthing config.
 */
export async function pairDeviceLocally(
  deviceId: string,
  deviceName: string,
): Promise<boolean> {
  const syncConfig = getSyncthingConfig();
  if (!syncConfig) {
    console.log("WARNING: No syncthing config in ~/.thopter.json.");
    console.log("  Run: thopter sync setup");
    return false;
  }

  const apiKey = getLocalApiKey();
  if (!apiKey) {
    console.log("WARNING: Could not find local SyncThing API key.");
    console.log("  Is SyncThing running on this machine? Check http://localhost:8384");
    console.log(`  To pair manually, add device ${deviceId} in the SyncThing web UI.`);
    return false;
  }

  const headers = {
    "X-API-Key": apiKey,
    "Content-Type": "application/json",
  };

  try {
    // Check if SyncThing is reachable
    const sysResp = await fetch(`${SYNCTHING_API}/rest/system/status`, {
      headers,
    });
    if (!sysResp.ok) {
      throw new Error(`SyncThing API returned ${sysResp.status}`);
    }

    // Add the device
    const addDeviceResp = await fetch(`${SYNCTHING_API}/rest/config/devices`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        deviceID: deviceId,
        name: deviceName,
        addresses: ["dynamic"],
        compression: "metadata",
        autoAcceptFolders: false,
      }),
    });

    if (!addDeviceResp.ok) {
      const body = await addDeviceResp.text();
      if (!body.includes("already exists")) {
        console.log(`WARNING: Failed to add device: ${body}`);
      }
    }

    // Share the folder with the device
    const folderResp = await fetch(
      `${SYNCTHING_API}/rest/config/folders/${syncConfig.folderName}`,
      { headers },
    );

    if (folderResp.ok) {
      const folder = (await folderResp.json()) as {
        devices: Array<{ deviceID: string }>;
        [key: string]: unknown;
      };

      const alreadyShared = folder.devices?.some(
        (d: { deviceID: string }) => d.deviceID === deviceId,
      );
      if (!alreadyShared) {
        folder.devices = [...(folder.devices ?? []), { deviceID: deviceId }];
        await fetch(
          `${SYNCTHING_API}/rest/config/folders/${syncConfig.folderName}`,
          {
            method: "PUT",
            headers,
            body: JSON.stringify(folder),
          },
        );
      }
    } else {
      console.log(
        `WARNING: Folder '${syncConfig.folderName}' not found in local SyncThing.`,
      );
      console.log("  Run: thopter sync setup");
      return false;
    }

    console.log(`Paired device '${deviceName}' (${deviceId}) with local SyncThing.`);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
      console.log("WARNING: Could not connect to local SyncThing API.");
      console.log("  Is SyncThing running? Start it with: syncthing --no-browser &");
    } else {
      console.log(`WARNING: SyncThing pairing failed: ${msg}`);
    }
    console.log(`  To pair manually, add device ${deviceId} in http://localhost:8384`);
    return false;
  }
}

/**
 * Remove a device from the local SyncThing instance.
 */
export async function unpairDeviceLocally(
  deviceId: string,
): Promise<boolean> {
  const apiKey = getLocalApiKey();
  if (!apiKey) {
    console.log("WARNING: Could not find local SyncThing API key.");
    return false;
  }

  const headers = {
    "X-API-Key": apiKey,
    "Content-Type": "application/json",
  };

  try {
    const resp = await fetch(
      `${SYNCTHING_API}/rest/config/devices/${deviceId}`,
      { method: "DELETE", headers },
    );
    if (resp.ok) {
      console.log(`Removed device ${deviceId} from local SyncThing.`);
      return true;
    }
    console.log(`WARNING: Could not remove device: ${resp.status}`);
    return false;
  } catch {
    console.log("WARNING: Could not connect to local SyncThing API.");
    return false;
  }
}
