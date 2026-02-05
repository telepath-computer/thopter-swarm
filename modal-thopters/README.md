# modal-thopters

Experimental Modal.com sandbox environment for running Claude Code agents.

## Setup

This project uses [uv](https://docs.astral.sh/uv/) for Python dependency management. A uv environment is already initialized in this directory.

```bash
cd modal-thopters
uv sync
```

To run scripts:

```bash
uv run python gen-toc.py
uv run python cli.py create
```
