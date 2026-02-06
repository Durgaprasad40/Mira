/**
 * Debug Event Logger — Demo/Dev only
 *
 * Stores the last 30 important events in memory for debugging.
 * Never appears in production non-demo mode.
 */

import { isDemoMode } from '@/hooks/useConvex';

// Event types for type safety
export type DebugEventType =
  | 'MATCH_CREATED'
  | 'CONFESSION_CREATED'
  | 'CONFESSION_TAGGED'
  | 'TAG_NOTIFICATION'
  | 'CHAT_UNLOCKED'
  | 'CHAT_EXPIRED'
  | 'NEARBY_CROSSED'
  | 'BLOCK_OR_REPORT';

export interface DebugEvent {
  type: DebugEventType;
  time: number;
  message: string;
}

// In-memory store (max 30 events, newest first)
const MAX_EVENTS = 30;
let events: DebugEvent[] = [];

// Subscribers for reactive updates
type Subscriber = () => void;
const subscribers = new Set<Subscriber>();

function notifySubscribers() {
  subscribers.forEach((fn) => fn());
}

/**
 * Log a debug event (only in demo/dev mode).
 * No-op in production.
 */
export function logDebugEvent(type: DebugEventType, message: string): void {
  // Guard: only log in demo/dev
  if (!isDemoMode && !__DEV__) return;

  const event: DebugEvent = {
    type,
    time: Date.now(),
    message,
  };

  // Prepend (newest first) and trim to max
  events = [event, ...events].slice(0, MAX_EVENTS);
  notifySubscribers();
}

/**
 * Get all stored debug events (newest first).
 */
export function getDebugEvents(): DebugEvent[] {
  return [...events];
}

/**
 * Clear all stored debug events.
 */
export function clearDebugEvents(): void {
  events = [];
  notifySubscribers();
}

/**
 * Subscribe to event changes (for reactive UI).
 * Returns unsubscribe function.
 */
export function subscribeToDebugEvents(callback: Subscriber): () => void {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

/**
 * Human-readable labels for event types.
 */
export const EVENT_TYPE_LABELS: Record<DebugEventType, string> = {
  MATCH_CREATED: 'Match',
  CONFESSION_CREATED: 'Confession',
  CONFESSION_TAGGED: 'Tagged',
  TAG_NOTIFICATION: 'Tag Notif',
  CHAT_UNLOCKED: 'Chat Unlock',
  CHAT_EXPIRED: 'Chat Expired',
  NEARBY_CROSSED: 'Crossed',
  BLOCK_OR_REPORT: 'Block/Report',
};
