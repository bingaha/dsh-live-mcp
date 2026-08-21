/**
 * Same-window pub/sub for “skills/MCP availability may have changed”.
 *
 * Settings (ticket 03) publishes after a list mutation; the conversation
 * status bar (ticket 02) subscribes and reloads. In-memory only — no timers,
 * no BroadcastChannel, no storage events, no SSE.
 * @module
 */

const listeners = new Set<() => void>()

/** Notify the current window that skills/MCP availability may have changed. */
export function notifyCapabilityChange(): void {
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch {
      // One subscriber must not prevent the rest from running.
    }
  }
}

/** Subscribe to same-window capability changes. Returns an unsubscribe function. */
export function subscribeCapabilityChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
