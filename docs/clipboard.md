# Clipboard: Yank in NeoVim, Paste on macOS

Yanking text in NeoVim on a remote thopter and having it land in your local
macOS clipboard requires cooperation from four layers. If any one of them is
misconfigured, it silently fails.

## How it works

The clipboard travels via **OSC 52**, a terminal escape sequence that tells the
host terminal emulator to set the system clipboard. The path looks like:

```
NeoVim  →  tmux  →  SSH  →  iTerm2  →  macOS clipboard
 (OSC 52 escape sequence passes through each layer)
```

NeoVim emits the escape sequence. Tmux must be configured to pass it through
rather than swallowing it. SSH forwards it transparently. iTerm2 receives the
sequence and writes to the macOS pasteboard.

## Configuration across layers

### 1. NeoVim (`scripts/nvim-options.lua`)

Two settings are needed:

```lua
-- Route all yank/delete/put through the + register by default
vim.opt.clipboard = "unnamedplus"

-- Wire the + and * registers to OSC 52 (built into NeoVim 0.10+)
vim.g.clipboard = {
  name = "OSC 52",
  copy = {
    ["+"] = require("vim.ui.clipboard.osc52").copy("+"),
    ["*"] = require("vim.ui.clipboard.osc52").copy("*"),
  },
  paste = {
    ["+"] = require("vim.ui.clipboard.osc52").paste("+"),
    ["*"] = require("vim.ui.clipboard.osc52").paste("*"),
  },
}
```

- `clipboard = "unnamedplus"` makes plain `y` use the `+` register. Without
  this, you'd have to type `"+y` every time.
- `vim.g.clipboard` tells NeoVim to use OSC 52 for the `+` and `*` registers
  instead of looking for a clipboard binary like `xclip` (which doesn't exist
  in a headless devbox).

Deployed to: `/home/user/.config/nvim/lua/options.lua`

### 2. Tmux (`scripts/tmux.conf`)

```conf
set -g set-clipboard on
set -g allow-passthrough on
```

- `set-clipboard on` — tells tmux to handle OSC 52 sequences rather than
  silently dropping them.
- `allow-passthrough on` — lets escape sequences pass through tmux to the
  outer terminal. Required for OSC 52 to reach iTerm2.

Deployed to: `/home/user/.tmux.conf`

### 3. SSH

No special configuration needed. SSH forwards terminal escape sequences
transparently by default.

### 4. iTerm2 (local Mac — manual setting)

In iTerm2 preferences:

**Preferences → General → Selection → "Applications in terminal may access clipboard"**

This must be **enabled**. It is off by default. Without it, iTerm2 ignores
incoming OSC 52 sequences as a security measure.

Also recommended:
- enable "copy to clipboard on selection"
- enable "mirror tmux paste buffer to clipoard"

## Troubleshooting

If yank isn't reaching your clipboard:

1. **Check iTerm2 setting** — this is the most common issue, especially after
   iTerm2 updates which can reset preferences.
2. **Reload tmux config** — if you changed `tmux.conf` on a running devbox:
   `tmux source-file ~/.tmux.conf`
3. **Verify NeoVim clipboard** — inside NeoVim, run `:checkhealth` and look
   for the clipboard section. It should show "OSC 52".
4. **Test OSC 52 directly** — run this from the devbox shell (outside NeoVim/tmux)
   to test if the raw escape sequence works:
   ```bash
   printf '\e]52;c;%s\a' "$(echo -n 'hello' | base64)"
   ```
   Then try pasting on your Mac. If "hello" appears, the SSH + iTerm2 layers
   are fine and the issue is in tmux or NeoVim config.
5. **Test inside tmux** — run the same `printf` command inside tmux. If it
   doesn't work but the previous test did, the tmux config is the problem.

## Files involved

| Layer | Source file (repo) | Deployed to (devbox) |
|---|---|---|
| NeoVim | `scripts/nvim-options.lua` | `~/.config/nvim/lua/options.lua` |
| Tmux | `scripts/tmux.conf` | `~/.tmux.conf` |
| iTerm2 | n/a (manual preference) | n/a |
