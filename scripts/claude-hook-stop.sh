#!/usr/bin/env bash
# Hook: Stop — Claude finished responding, waiting for user input.
# Pushes transcript to Redis (which also updates last_message).
# Sends ntfy notification if THOPTER_NTFY_CHANNEL is configured.

# read -t returns immediately when a line is available, with 1s safety timeout
read -t 1 INPUT || true
TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // empty')

thopter-status waiting "Claude stopped, waiting for input" 2>/dev/null || true

# Stream transcript entries to Redis for thopter tail (also updates last_message)
[ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ] && node /usr/local/bin/thopter-transcript-push "$TRANSCRIPT" 2>/dev/null || true

# Capture tmux screen and push to Redis for GUI terminal view
tmux capture-pane -p 2>/dev/null | redis-cli --tls -u "$THOPTER_REDIS_URL" -x SETEX "thopter:${THOPTER_NAME}:screen_dump" 120 >/dev/null 2>&1 || true

# Send ntfy notification (enabled by default; set THOPTER_STOP_NOTIFY=0 to disable)
# Suppress if there's a recent user message (user is actively engaged)
if [ -n "${THOPTER_NTFY_CHANNEL:-}" ] && [ "${THOPTER_STOP_NOTIFY:-1}" != "0" ]; then
    QUIET_PERIOD="${THOPTER_STOP_NOTIFY_QUIET_PERIOD:-30}"
    SUPPRESS=0
    if [ "$QUIET_PERIOD" != "0" ] && [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ]; then
        SUPPRESS=$(QUIET_PERIOD="$QUIET_PERIOD" TRANSCRIPT_PATH="$TRANSCRIPT" node -e '
            const fs = require("fs");
            const tp = process.env.TRANSCRIPT_PATH;
            const qp = parseInt(process.env.QUIET_PERIOD, 10) || 30;
            const stat = fs.statSync(tp);
            const readSize = Math.min(stat.size, 200 * 1024);
            const buf = Buffer.alloc(readSize);
            const fd = fs.openSync(tp, "r");
            fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
            fs.closeSync(fd);
            const lines = buf.toString("utf-8").split("\n").filter(l => l.trim());
            for (let i = lines.length - 1; i >= 0; i--) {
                try {
                    const entry = JSON.parse(lines[i]);
                    if (entry.type === "user") {
                        const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
                        if (ts && (Date.now() - ts) < qp * 1000) {
                            process.stdout.write("1");
                        } else {
                            process.stdout.write("0");
                        }
                        process.exit(0);
                    }
                } catch {}
            }
            process.stdout.write("0");
        ' 2>/dev/null || echo "0")
    fi

    if [ "$SUPPRESS" != "1" ]; then
        # Read last_message from Redis (already written by transcript-push)
        LAST_MSG=$(redis-cli --tls -u "$THOPTER_REDIS_URL" GET "thopter:${THOPTER_NAME}:last_message" 2>/dev/null || true)
        NTFY_MSG="Waiting for input"
        [ -n "$LAST_MSG" ] && NTFY_MSG=$(printf '%s' "$LAST_MSG" | head -c 500)
        curl -s -H "Title: ${THOPTER_NAME}" -d "$NTFY_MSG" "ntfy.sh/$THOPTER_NTFY_CHANNEL" &
    fi
fi

exit 0
