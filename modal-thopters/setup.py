"""Interactive setup: Modal auth preflight + secret configuration."""

import getpass
import sys

from config import SECRET_NAME

# Secrets we need, with human-readable descriptions
REQUIRED_SECRETS = [
    ("ANTHROPIC_API_KEY", "Anthropic API key (for Claude Code)"),
    ("GITHUB_PAT", "GitHub personal access token (repo read/write — the agentCoder PAT, NOT the issues PAT)"),
]

OPTIONAL_SECRETS = [
    ("OPENAI_API_KEY", "OpenAI API key"),
    ("FIRECRAWL_API_KEY", "Firecrawl API key"),
]


def check_modal_auth() -> bool:
    """Verify that Modal CLI is authenticated."""
    print("Checking Modal authentication...")
    try:
        import modal

        # Attempting to hydrate any secret reference will exercise the auth path.
        # A NotFoundError means auth works but the secret doesn't exist (that's fine).
        # An AuthError or connection error means we're not authed.
        s = modal.Secret.from_name("__modal-auth-check-probe__")
        s.hydrate()
    except Exception as e:
        ename = type(e).__name__
        if "NotFound" in ename:
            print("  Authenticated to Modal.")
            return True
        if "Auth" in ename or "Unauthenticated" in ename:
            print(f"  ERROR: Not authenticated to Modal ({ename}).")
            print("  Run: uv run modal setup")
            return False
        # Some other error — could be network, etc. Treat auth as OK-ish
        # but warn the user.
        print(f"  WARNING: Unexpected error checking auth: {ename}: {e}")
        print("  Proceeding anyway — if things fail, try: uv run modal setup")
        return True
    # If hydrate somehow succeeds (shouldn't with a garbage name), auth is fine
    print("  Authenticated to Modal.")
    return True


def check_existing_secret() -> dict[str, str] | None:
    """Check if thopter-secrets already exists. Returns the secret ID or None."""
    import modal

    try:
        s = modal.Secret.from_name(SECRET_NAME)
        s.hydrate()
        return s.object_id
    except Exception:
        return None


def prompt_secret(name: str, description: str, required: bool) -> str | None:
    """Prompt the user for a secret value. Returns the value or None if skipped."""
    label = "(required)" if required else "(optional, Enter to skip)"
    print(f"\n  {description}")
    value = getpass.getpass(f"  {name} {label}: ").strip()
    if not value:
        if required:
            print(f"  ERROR: {name} is required.")
            return prompt_secret(name, description, required)
        return None
    return value


def run_setup():
    """Run the interactive setup flow."""
    print("=" * 60)
    print("Modal Thopters Setup")
    print("=" * 60)
    print()

    # Step 1: Auth preflight
    if not check_modal_auth():
        sys.exit(1)

    # Step 2: Check existing secret
    existing = check_existing_secret()
    if existing:
        print(f"\n  Secret '{SECRET_NAME}' already exists ({existing}).")
        answer = input("  Overwrite with new values? [y/N]: ").strip().lower()
        if answer != "y":
            print("  Keeping existing secret. Setup complete.")
            return

    # Step 3: Collect secrets
    print(f"\nConfiguring Modal secret: {SECRET_NAME}")
    print("Values are entered securely (not echoed to terminal).")

    env_dict = {}

    for name, description in REQUIRED_SECRETS:
        value = prompt_secret(name, description, required=True)
        env_dict[name] = value

    for name, description in OPTIONAL_SECRETS:
        value = prompt_secret(name, description, required=False)
        if value:
            env_dict[name] = value

    # Step 4: Create/update the secret
    print(f"\nCreating Modal secret '{SECRET_NAME}' with {len(env_dict)} keys...")
    import modal

    modal.Secret.create_deployed(SECRET_NAME, env_dict, overwrite=True)
    print(f"  Secret '{SECRET_NAME}' saved to your Modal workspace.")

    # Summary
    print("\nSetup complete. Configured keys:")
    for name in env_dict:
        print(f"  - {name}")
    print(f"\nThese will be injected as environment variables into every sandbox.")
