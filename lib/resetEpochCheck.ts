/**
 * Reset Epoch Check
 *
 * Detects when the backend database has been reset (all users deleted)
 * and clears ONLY demo-related local storage to prevent stale demo data.
 *
 * IMPORTANT: This system does NOT:
 * - Clear auth-storage or SecureStore tokens
 * - Trigger logout or session loss
 * - Clear onboarding state
 * - Block UI rendering
 *
 * How it works:
 * 1. Backend bumps resetEpoch when resetAllUsers is executed
 * 2. On app startup, fetch server resetEpoch (non-blocking)
 * 3. Compare with locally stored lastSeenResetEpoch
 * 4. If match: skip entirely (fast path)
 * 5. If mismatch: clear only demo stores, update local epoch
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { isDemoMode } from '@/config/demo';

const RESET_EPOCH_KEY = 'mira:resetEpoch';

/**
 * Keys for DEMO stores that should be cleared on reset
 * SAFE TO CLEAR: These are demo-only and don't affect real user sessions
 *
 * NOT cleared (preserved across resets):
 * - auth-storage (user session)
 * - onboarding-storage (onboarding completion)
 * - All real user data stores
 */
const DEMO_STORE_KEYS = [
  'demo-storage',
  'demo-dm-storage',
  'demo-chatroom-storage',
];

/**
 * Get the locally stored reset epoch
 */
export async function getLocalResetEpoch(): Promise<number> {
  try {
    const value = await AsyncStorage.getItem(RESET_EPOCH_KEY);
    return value ? parseInt(value, 10) : 0;
  } catch (error) {
    console.error('[RESET_EPOCH] Failed to read local resetEpoch:', error);
    return 0;
  }
}

/**
 * Set the locally stored reset epoch
 */
export async function setLocalResetEpoch(epoch: number): Promise<void> {
  try {
    await AsyncStorage.setItem(RESET_EPOCH_KEY, epoch.toString());
    console.log(`[RESET_EPOCH] Local epoch updated to ${epoch}`);
  } catch (error) {
    console.error('[RESET_EPOCH] Failed to store local resetEpoch:', error);
  }
}

/**
 * Clear only demo-related stores
 * SAFE: Does not touch auth, onboarding, or real user data
 */
export async function clearDemoStores(): Promise<void> {
  console.log('[RESET_EPOCH] Clearing demo stores only...');

  try {
    // Clear only demo store keys - preserves auth and user data
    const clearPromises = DEMO_STORE_KEYS.map(async (key) => {
      try {
        await AsyncStorage.removeItem(key);
        console.log(`[RESET_EPOCH] Cleared demo store: ${key}`);
      } catch (error) {
        console.error(`[RESET_EPOCH] Failed to clear ${key}:`, error);
      }
    });

    await Promise.all(clearPromises);

    console.log('[RESET_EPOCH] Demo stores cleared (auth/onboarding preserved)');
  } catch (error) {
    console.error('[RESET_EPOCH] Error during demo store clearing:', error);
  }
}

/**
 * Purge demo mode stores if demo mode is disabled
 * This prevents demo data from leaking into live mode
 */
export async function purgeDemoStoresIfDisabled(): Promise<void> {
  if (isDemoMode) {
    // Demo mode is enabled, don't purge
    return;
  }

  console.log('[RESET_EPOCH] Demo mode disabled - purging demo stores...');

  const demoStoreKeys = [
    'demo-storage',
    'demo-dm-storage',
    'demo-chatroom-storage',
  ];

  try {
    for (const key of demoStoreKeys) {
      await AsyncStorage.removeItem(key);
      console.log(`[RESET_EPOCH] Purged demo store: ${key}`);
    }
  } catch (error) {
    console.error('[RESET_EPOCH] Error purging demo stores:', error);
  }
}

/**
 * Check reset epoch and clear demo caches if needed (non-blocking)
 *
 * SAFE BEHAVIOR:
 * - If epochs match: skip entirely (fast path)
 * - If mismatch: clear only demo stores, NO logout, NO session loss
 * - Auth and onboarding state are ALWAYS preserved
 *
 * @param serverEpoch - Reset epoch from Convex backend
 * @returns true if demo caches were cleared, false otherwise
 */
export async function checkAndHandleResetEpoch(serverEpoch: number): Promise<boolean> {
  const localEpoch = await getLocalResetEpoch();

  // FAST PATH: If epochs match, skip entirely - no work needed
  if (serverEpoch === localEpoch) {
    console.log(`[RESET_EPOCH] ✅ Epochs match (${serverEpoch}) - skipping`);
    return false;
  }

  console.log(`[RESET_EPOCH] Epoch mismatch: local=${localEpoch}, server=${serverEpoch}`);

  // Always purge demo stores if demo mode is disabled
  await purgeDemoStoresIfDisabled();

  // Clear only demo stores - preserves auth/onboarding/user data
  await clearDemoStores();

  // Update local epoch to match server
  await setLocalResetEpoch(serverEpoch);

  console.log('[RESET_EPOCH] ✅ Demo stores cleared, epoch synced (no logout)');
  return true;
}
