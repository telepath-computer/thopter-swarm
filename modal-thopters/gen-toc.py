#!/usr/bin/env python3
"""Generate a table of contents from llms-full.txt.

Extracts markdown headers while skipping lines inside fenced code blocks
(``` ... ```) so Python/bash comments don't leak into the TOC.
"""

import re
import sys
from pathlib import Path

HEADER_RE = re.compile(r"^(#{1,6})\s+(.+)$")
FENCE_RE = re.compile(r"^```")


def generate_toc(filepath: Path) -> list[tuple[int, int, str]]:
    """Return list of (line_number, depth, title) for each markdown header."""
    entries = []
    in_code_block = False

    with open(filepath) as f:
        for lineno, line in enumerate(f, start=1):
            line = line.rstrip("\n")

            if FENCE_RE.match(line):
                in_code_block = not in_code_block
                continue

            if in_code_block:
                continue

            m = HEADER_RE.match(line)
            if m:
                depth = len(m.group(1))
                title = m.group(2)
                entries.append((lineno, depth, title))

    return entries


def main():
    filepath = Path(__file__).parent / "llms-full.txt"
    if not filepath.exists():
        print(f"File not found: {filepath}", file=sys.stderr)
        sys.exit(1)

    entries = generate_toc(filepath)

    for lineno, depth, title in entries:
        indent = "  " * (depth - 1)
        print(f"{lineno:>6}  {indent}{title}")


if __name__ == "__main__":
    main()
