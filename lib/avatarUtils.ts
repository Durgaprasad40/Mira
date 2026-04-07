/**
 * Avatar Utility Functions
 *
 * CACHE-BUST-FIX: Provides cache-busting for avatar URLs to ensure
 * updated avatars are displayed immediately after changes.
 *
 * The avatarVersion parameter (typically profile.updatedAt timestamp)
 * is appended as a query parameter to force image cache invalidation
 * when the avatar is updated.
 */

/**
 * Build a cache-busted avatar URL.
 * Appends version query param to force image cache invalidation.
 *
 * @param avatarUrl - The base avatar URL (can be undefined)
 * @param avatarVersion - Version timestamp for cache busting (typically profile.updatedAt)
 * @returns Cache-busted URL or undefined if no URL provided
 */
export function buildCacheBustedAvatarUrl(
  avatarUrl: string | undefined | null,
  avatarVersion?: number
): string | undefined {
  if (!avatarUrl) return undefined;

  // Only add cache-busting param if version is provided
  if (!avatarVersion || avatarVersion === 0) return avatarUrl;

  // Append version as query parameter
  const separator = avatarUrl.includes('?') ? '&' : '?';
  return `${avatarUrl}${separator}v=${avatarVersion}`;
}

/**
 * Type for presence user with avatar version
 */
export interface PresenceUserWithVersion {
  id: string;
  displayName: string;
  avatar?: string;
  avatarVersion?: number;
  age: number;
  gender: 'male' | 'female' | 'other' | '';
  bio?: string;
  role: 'owner' | 'admin' | 'member';
  lastHeartbeatAt: number;
  joinedAt: number;
}

/**
 * Type for active user with avatar version (for strip display)
 */
export interface ActiveUserWithVersion {
  id: string;
  avatar?: string;
  avatarVersion?: number;
  isOnline: boolean;
  joinedAt?: number;
}

/**
 * Transform presence users to include cache-busted avatar URLs
 */
export function transformPresenceUsersForDisplay(
  users: PresenceUserWithVersion[]
): PresenceUserWithVersion[] {
  return users.map(user => ({
    ...user,
    avatar: buildCacheBustedAvatarUrl(user.avatar, user.avatarVersion),
  }));
}

/**
 * Transform active users to include cache-busted avatar URLs
 */
export function transformActiveUsersForDisplay(
  users: ActiveUserWithVersion[]
): ActiveUserWithVersion[] {
  return users.map(user => ({
    ...user,
    avatar: buildCacheBustedAvatarUrl(user.avatar, user.avatarVersion),
  }));
}
