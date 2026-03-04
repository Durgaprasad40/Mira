/**
 * memoryHandoff — In-memory synchronous data handoff between screens
 *
 * STORAGE POLICY: NO persistence. Data lives ONLY in memory for the current app session.
 * Use this for temporary screen-to-screen data passing (camera media, form drafts, etc.).
 *
 * Key lifecycle:
 * - setHandoff(): Store data
 * - getHandoff(): Read data (keeps it in memory)
 * - popHandoff(): Read data and immediately delete (one-time consumption)
 * - clearHandoff(): Explicitly delete
 *
 * All operations are synchronous. No AsyncStorage. No persistence.
 */

const handoffStore = new Map<string, any>();

/**
 * Store data for handoff (replaces AsyncStorage.setItem)
 */
export function setHandoff(key: string, value: any): void {
  handoffStore.set(key, value);
}

/**
 * Get data without removing it (replaces AsyncStorage.getItem)
 */
export function getHandoff<T = any>(key: string): T | undefined {
  return handoffStore.get(key);
}

/**
 * Get data and immediately remove it (one-time consumption)
 * Use this for camera media handoff, form drafts, etc.
 */
export function popHandoff<T = any>(key: string): T | undefined {
  const value = handoffStore.get(key);
  handoffStore.delete(key);
  return value;
}

/**
 * Explicitly remove data (replaces AsyncStorage.removeItem)
 */
export function clearHandoff(key: string): void {
  handoffStore.delete(key);
}

/**
 * Check if a key exists
 */
export function hasHandoff(key: string): boolean {
  return handoffStore.has(key);
}

/**
 * Clear all handoff data (useful for testing/logout)
 */
export function clearAllHandoff(): void {
  handoffStore.clear();
}
