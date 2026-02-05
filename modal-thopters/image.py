"""Base image definition for modal-thopter sandboxes."""

import modal


def build_base_image() -> modal.Image:
    """Build the base image with all system deps, Node, Claude Code, etc.

    Layers are ordered to maximize cache hits: stable system packages first,
    then Node/npm, then tools that change more often.
    """
    return (
        modal.Image.debian_slim(python_version="3.12")
        # System packages (mirrors thopter/Dockerfile)
        .apt_install(
            # Locale support
            "locales",
            # Version control
            "git",
            # Build tools
            "build-essential",
            "cmake",
            "pkg-config",
            # Python extras
            "python3-venv",
            # Core tools
            "curl",
            "wget",
            "vim",
            "tmux",
            "htop",
            "jq",
            # Search tools
            "ripgrep",
            # Browser support (headless)
            "xvfb",
        )
        # Generate locale (locale-gen + localedef to avoid setlocale warnings)
        .run_commands(
            "sed -i '/en_US.UTF-8/s/^# //g' /etc/locale.gen && locale-gen",
        )
        # Node.js 20
        .run_commands(
            "curl -fsSL https://deb.nodesource.com/setup_20.x | bash -",
            "apt-get install -y nodejs",
        )
        # Playwright browser deps (browsers installed on demand by user)
        .run_commands("npx playwright install-deps")
        # Claude Code CLI (global npm install)
        .run_commands("npm install -g @anthropic-ai/claude-code")
        # uv package manager
        .run_commands(
            "curl -LsSf https://astral.sh/uv/install.sh | sh",
        )
        # Environment
        .env({
            "LANG": "en_US.UTF-8",
            "LC_ALL": "en_US.UTF-8",
            "TERM": "xterm-256color",
            "COLORTERM": "truecolor",
            "FORCE_COLOR": "1",
            "NO_UPDATE_NOTIFIER": "1",
            "PATH": "/root/.local/bin:/root/.cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        })
    )
