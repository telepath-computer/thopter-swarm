# Mouse Scroll in xterm.js + tmux (via SSH)

This document covers the full chain of how mouse scroll works in the Electron
GUI's live terminal view when connected to a devbox running tmux over SSH.
Two independent bugs had to be fixed for scrolling to work. Future agents
modifying the terminal or tmux configuration should understand both.

## Architecture: the signal chain

```
User scrolls mouse wheel in Electron
  │
  ▼
DOM "wheel" event fires on .xterm-screen element
  │
  ▼
Custom wheel handler in LiveTerminalView.tsx
  │  (xterm.js does NOT handle this — see Problem 1)
  │
  ▼
Generates SGR mouse escape sequence: \e[<64;col;rowM (scroll-up)
                                  or \e[<65;col;rowM (scroll-down)
  │
  ▼
Routes through xterm.js triggerDataEvent → onData callback → pty.write()
  │
  ▼
node-pty writes to PTY master fd
  │
  ▼
SSH client reads from PTY slave, sends through encrypted tunnel
  │
  ▼
SSH server on devbox writes to remote PTY
  │
  ▼
tmux client reads mouse event from terminal input, parses SGR format
  │
  ▼
tmux server receives WheelUpPane/WheelDownPane event
  │
  ▼
Root key table binding fires: enters copy-mode, forwards mouse event
  │  (tmux 3.3a has NO default binding — see Problem 2)
  │
  ▼
Copy-mode WheelUpPane binding: scroll-up N lines
```

## Problem 1: xterm.js drops wheel events silently

**Component:** `electron-gui/src/renderer/components/detail/LiveTerminalView.tsx`

xterm.js (v6) has two internal subsystems that handle mouse input:

- **CoreMouseService** — handles clicks (mousedown/mouseup/mousemove) on the
  `.xterm-screen` DOM element. When an application enables mouse tracking
  (e.g., tmux sends `\e[?1000h`), the CoreMouseService generates SGR escape
  sequences for click events and emits them through `term.onData()`. **This
  works correctly.**

- **Viewport** — handles wheel/scroll events on a separate scrollable `<div>`.
  In normal buffer mode, it scrolls the xterm.js scrollback. In the alternate
  screen buffer (used by tmux, vim, less, etc.):
  - Without mouse tracking: converts wheel to arrow keys (`\e[A` / `\e[B`)
  - With mouse tracking enabled: **does nothing**. It correctly suppresses the
    arrow key conversion but fails to generate mouse protocol events.

This means wheel events are silently consumed with no output when mouse
tracking is active. This was confirmed by adding `onData` logging: click
events produced `\e[<0;col;rowM` sequences, but scroll produced nothing.

### The fix

A custom `wheel` event listener on `.xterm-screen` (where wheel events
actually fire, confirmed via `event.target`) that:

1. Checks if the terminal is in the alternate buffer
   (`term.buffer.active === term.buffer.alternate`)
2. Converts the mouse pixel position to 1-based terminal cell coordinates
   (tmux uses these to target the correct pane in split layouts)
3. Generates SGR mouse sequences: `\e[<64;col;rowM` (up) / `\e[<65;col;rowM` (down)
4. Routes through `term._core.coreService.triggerDataEvent(seq, true)` — the
   exact same internal code path that CoreMouseService uses for click events.
   Direct `pty.write()` also works but triggerDataEvent was chosen for
   consistency with the proven click path.

### Why triggerDataEvent instead of direct pty.write()

During debugging, both paths were tested. Both ultimately call `ptyProcess.write()`
on the same node-pty instance. Either works. `triggerDataEvent` was retained because
it mirrors the exact flow of working click events and fires the `onData` event
(useful for debugging).

### Why refs instead of closure variables

The handler uses `termRef.current` instead of the closure-captured `term` variable.
In React development mode (StrictMode), effects run twice: mount → unmount → mount.
The first mount's terminal gets disposed, but if its wheel listener still references
the original `term` via closure, accessing `term.buffer` on a disposed terminal
throws `DisposableStore` errors. Using refs always accesses the live terminal.

### The onBinary handler

`term.onBinary()` is wired in addition to `term.onData()`. Some mouse protocols
(non-SGR) encode button/coordinate bytes above 0x7F, which xterm.js emits through
`onBinary` instead of `onData`. While the custom scroll handler uses SGR (text-based),
the `onBinary` handler ensures other mouse interactions using older protocols also
work correctly.

## Problem 2: tmux 3.3a has no WheelUpPane binding

**Config files:** `scripts/tmux.conf`, `~/.tmux.conf`

Even with perfectly-formed SGR scroll sequences arriving at tmux, nothing happened.
The root cause was found by inspecting tmux's key tables:

```bash
$ tmux list-keys -T root | grep -i wheel
bind-key -T root WheelUpStatus    previous-window
bind-key -T root WheelDownStatus  next-window
```

The root key table had bindings for `WheelUpStatus` (scroll on the status bar)
but **zero bindings for `WheelUpPane` or `WheelDownPane`**. tmux 3.3a's built-in
default handler did not auto-enter copy-mode on scroll for this configuration.

The copy-mode tables DID have scroll bindings:
```
bind-key -T copy-mode WheelUpPane   select-pane \; send-keys -X -N 5 scroll-up
bind-key -T copy-mode WheelDownPane select-pane \; send-keys -X -N 5 scroll-down
```

But these only fire when already in copy-mode. With no root-table binding to
enter copy-mode in the first place, scroll events were silently dropped.

### The fix

Explicit bindings in the root key table:

```tmux
bind -T root WheelUpPane if-shell -Ft= '#{mouse_any_flag}' \
  'send-keys -M' 'copy-mode -e; send-keys -M'
bind -T root WheelDownPane if-shell -Ft= '#{mouse_any_flag}' \
  'send-keys -M' 'send-keys -M'
```

How these work:
- `if-shell -Ft= '#{mouse_any_flag}'` checks if the pane's application has
  its own mouse tracking enabled
- If yes (`mouse_any_flag` is set): forward the raw mouse event to the
  application via `send-keys -M`
- If no: enter `copy-mode -e` (the `-e` flag auto-exits copy-mode when
  scrolling back to the bottom) and then forward the event. The copy-mode
  table's `WheelUpPane` binding then handles the actual scrolling.

### Scroll speed tuning

The default copy-mode binding scrolls 5 lines per wheel event (`-N 5`). With
high-resolution scroll wheels sending many fine-grained events (deltaY of 1-2),
this compounds to 15+ lines per physical scroll tick. Override to 2 lines:

```tmux
bind -T copy-mode WheelUpPane select-pane \; send-keys -X -N 2 scroll-up
bind -T copy-mode WheelDownPane select-pane \; send-keys -X -N 2 scroll-down
bind -T copy-mode-vi WheelUpPane select-pane \; send-keys -X -N 2 scroll-up
bind -T copy-mode-vi WheelDownPane select-pane \; send-keys -X -N 2 scroll-down
```

## Full tmux mouse configuration

All of these settings are required in `scripts/tmux.conf` (deployed to devboxes):

```tmux
# Enable mouse support
set -g mouse on

# Root key table: enter copy-mode on scroll, or forward to app
bind -T root WheelUpPane if-shell -Ft= '#{mouse_any_flag}' 'send-keys -M' 'copy-mode -e; send-keys -M'
bind -T root WheelDownPane if-shell -Ft= '#{mouse_any_flag}' 'send-keys -M' 'send-keys -M'

# Copy-mode: scroll 2 lines per event (default 5 is too fast)
bind -T copy-mode WheelUpPane select-pane \; send-keys -X -N 2 scroll-up
bind -T copy-mode WheelDownPane select-pane \; send-keys -X -N 2 scroll-down
bind -T copy-mode-vi WheelUpPane select-pane \; send-keys -X -N 2 scroll-up
bind -T copy-mode-vi WheelDownPane select-pane \; send-keys -X -N 2 scroll-down

# Tell tmux the terminal supports SGR extended mouse encoding
set -as terminal-features 'xterm*:mouse'
```

## SGR mouse protocol reference

The SGR (mode 1006) mouse protocol encodes events as text-based escape sequences:

```
Press:   \e[<button;col;rowM
Release: \e[<button;col;rowm
```

Button values (decimal):
- `0` = left click
- `1` = middle click
- `2` = right click
- `64` = scroll up (button 4)
- `65` = scroll down (button 5)

Coordinates are 1-based (top-left is 1;1). tmux uses coordinates to determine
which pane the event targets in split layouts.

The SGR protocol is negotiated when tmux sends `\e[?1006h` to the terminal.
The `terminal-features 'xterm*:mouse'` setting ensures tmux uses SGR for
xterm-compatible terminals. Without it, tmux may fall back to the X10 protocol
which encodes values as raw bytes (problematic for coordinates > 95).

## Diagnostic techniques

If scroll breaks again, these techniques were used to isolate the problem:

1. **Log `onData` for mouse sequences:** Check if `\e[<` or `\e[M` prefixes
   appear. Clicks should show `\e[<0;col;rowM`. If scroll shows nothing,
   xterm.js is not generating events.

2. **Log wheel events on .xterm-screen:** Attach a passive wheel listener.
   If `defaultPrevented: false`, nothing is consuming the event.

3. **Check `tmux list-panes` flags:** `mouse_any_flag`, `alternate_on`,
   `pane_in_mode` — these determine how tmux routes mouse events.

4. **Check `tmux list-keys -T root | grep Wheel`:** If no WheelUpPane
   binding exists, scroll events are silently dropped.

5. **Compare click vs scroll paths:** If clicks work but scroll doesn't
   through the same `pty.write()`, the issue is the data content (button
   number) not the write path.
