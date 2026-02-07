"""Configuration and state management for modal-thopters."""

import json
from pathlib import Path

# Modal app name
APP_NAME = "modal-thopters"

# Modal secret name (create via `modal secret create` or dashboard)
SECRET_NAME = "thopter-secrets"

# Sandbox defaults
SANDBOX_TIMEOUT = 24 * 60 * 60  # 24 hours (max)
SANDBOX_IDLE_TIMEOUT = 60 * 60  # 1 hour
SANDBOX_CPU = 4
SANDBOX_MEMORY = 8192  # MB

# State file location
STATE_DIR = Path.home() / ".modal-thopters"
STATE_FILE = STATE_DIR / "state.json"


def _load_state() -> dict:
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {"snapshots": {}}


def _save_state(state: dict) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2) + "\n")


def save_snapshot(label: str, image_id: str) -> None:
    state = _load_state()
    state["snapshots"][label] = image_id
    _save_state(state)


def get_snapshot(label_or_id: str) -> str:
    """Resolve a snapshot label to an image ID. If it looks like an image ID, return as-is."""
    if label_or_id.startswith("im-"):
        return label_or_id
    state = _load_state()
    snapshots = state.get("snapshots", {})
    if label_or_id not in snapshots:
        raise KeyError(f"No snapshot with label '{label_or_id}'. Available: {list(snapshots.keys())}")
    return snapshots[label_or_id]


def list_snapshots() -> dict[str, str]:
    return _load_state().get("snapshots", {})
