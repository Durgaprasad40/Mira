/**
 * Reset Epoch Check
 *
 * Detects when the backend database has been reset (all users deleted)
 * and clears local persisted storage to prevent stale data from showing in the UI.
 *
 * How it works:
 * 1. Backend bumps resetEpoch when resetAllUsers is executed
 * 2. On app startup, fetch server resetEpoch
 * 3. Compare with locally stored lastSeenResetEpoch
 * 4. If mismatch, clear all persisted stores and local caches
 * 5. Update local resetEpoch to match server
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { isDemoMode } from '@/config/demo';

const RESET_EPOCH_KEY = 'mira:resetEpoch';

/**
 * Keys for all persisted stores that need to be cleared on reset
 * These stores can contain user-specific data that becomes stale after database reset
 */
const PERSISTED_STORE_KEYS = [
  // User/auth stores
  'auth-storage',
  'onboarding-storage',

  // Demo mode stores (should never load when demo mode is disabled)
  'demo-storage',
  'demo-dm-storage',
  'demo-chatroom-storage',

  // Profile/privacy stores
  'photo-blur-storage',
  'privacy-storage',
  'verification-storage',
  'private-profile-storage',

  // Chat/messaging stores
  'chat-room-session-storage',
  'chat-room-profile-storage',
  'chat-room-dm-storage',
  'private-chat-storage',
  'preferred-chat-room-storage',

  // Discovery/matching stores
  'discover-storage',
  'filter-storage',
  'subscription-storage',

  // Other user-specific stores
  'confession-storage',
  'confess-preview-storage',
  'location-storage',
  'incognito-storage',
  'tod-identity-storage',
  'media-view-storage',
  'block-storage',
  'interaction-storage',
  'chat-tod-storage',

  // Boot caches (these cache onboarding status and can cause incorrect routing)
  'auth-boot-cache',
  'boot-cache',
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
 * Clear all persisted stores and local caches
 * This removes stale user data that would show incorrect UI after database reset
 */
export async function clearAllPersistedData(): Promise<void> {
  console.log('[RESET_EPOCH] Clearing all persisted stores...');

  try {
    // Clear all persisted store keys
    const clearPromises = PERSISTED_STORE_KEYS.map(async (key) => {
      try {
        await AsyncStorage.removeItem(key);
        console.log(`[RESET_EPOCH] Cleared: ${key}`);
      } catch (error) {
        console.error(`[RESET_EPOCH] Failed to clear ${key}:`, error);
      }
    });

    await Promise.all(clearPromises);

    console.log('[RESET_EPOCH] All persisted stores cleared');
  } catch (error) {
    console.error('[RESET_EPOCH] Error during cache clearing:', error);
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
 * Check reset epoch and clear caches if needed
 *
 * @param serverEpoch - Reset epoch from Convex backend
 * @returns true if caches were cleared, false otherwise
 */
export async function checkAndHandleResetEpoch(serverEpoch: number): Promise<boolean> {
  console.log('[RESET_EPOCH] Checking reset epoch...');
  console.log(`[RESET_EPOCH] Server epoch: ${serverEpoch}`);

  const localEpoch = await getLocalResetEpoch();
  console.log(`[RESET_EPOCH] Local epoch: ${localEpoch}`);

  // Always purge demo stores if demo mode is disabled
  await purgeDemoStoresIfDisabled();

  if (serverEpoch !== localEpoch) {
    console.log('[RESET_EPOCH] ⚠️  MISMATCH DETECTED - Database was reset!');
    console.log('[RESET_EPOCH] Clearing all local caches to prevent stale data...');

    // Clear all persisted data
    await clearAllPersistedData();

    // Update local epoch to match server
    await setLocalResetEpoch(serverEpoch);

    console.log('[RESET_EPOCH] ✅ Cache clearing complete. App will start fresh.');
    return true;
  }

  console.log('[RESET_EPOCH] ✅ Epochs match - no cache clearing needed');
  return false;
}
