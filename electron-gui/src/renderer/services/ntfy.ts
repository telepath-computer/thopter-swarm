// ntfy.sh SSE subscription helper for real-time notifications.

import type { NtfyNotification, Unsubscribe } from './types';

/**
 * Subscribe to a ntfy.sh channel via Server-Sent Events.
 * Returns an unsubscribe function that closes the connection.
 */
export function subscribeNtfy(
  channel: string,
  onNotification: (n: NtfyNotification) => void,
): Unsubscribe {
  const url = `https://ntfy.sh/${encodeURIComponent(channel)}/sse`;
  const source = new EventSource(url);

  source.addEventListener('message', (event) => {
    try {
      const data = JSON.parse(event.data);
      // ntfy sends keepalive events with event: "open" — skip non-message events
      if (data.event !== 'message') return;

      const notification: NtfyNotification = {
        id: data.id ?? crypto.randomUUID(),
        time: data.time ?? Math.floor(Date.now() / 1000),
        event: data.event,
        topic: data.topic ?? channel,
        title: data.title,
        message: data.message ?? '',
        tags: data.tags,
        thopterName: data.title || undefined, // Hook sends THOPTER_NAME as Title header
      };

      onNotification(notification);
    } catch {
      // Ignore malformed events
    }
  });

  source.addEventListener('error', () => {
    // EventSource auto-reconnects; no action needed
  });

  return () => {
    source.close();
  };
}

/**
 * Mock ntfy subscription that generates fake notifications periodically.
 * Used when running with MockThopterService.
 */
export function subscribeMockNtfy(
  onNotification: (n: NtfyNotification) => void,
): Unsubscribe {
  const MOCK_THOPTERS = ['eager-falcon', 'calm-horizon', 'bright-nebula', 'swift-current', 'quiet-ember'];

  const MOCK_MESSAGES = [
    'Claude session stopped after completing task.',
    'Finished: "Implementing auth middleware for API routes"',
    'npm run build failed with exit code 1',
    'Created PR #42: "Add rate limiting to API endpoints"',
    'All 24 tests passing after fix.',
  ];

  let counter = 0;

  const interval = setInterval(() => {
    const idx = counter % MOCK_THOPTERS.length;
    const thopterName = MOCK_THOPTERS[idx];
    const notification: NtfyNotification = {
      id: `mock_ntfy_${Date.now()}_${counter}`,
      time: Math.floor(Date.now() / 1000),
      event: 'message',
      topic: 'thopter-mock',
      title: thopterName,
      message: MOCK_MESSAGES[idx],
      thopterName,
    };
    counter++;
    onNotification(notification);
  }, randomBetween(15_000, 30_000));

  return () => {
    clearInterval(interval);
  };
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
