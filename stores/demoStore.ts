/**
 * demoStore — Central mutable Zustand store for all demo data.
 *
 * Holds mutable copies of DEMO_PROFILES, DEMO_MATCHES, DEMO_LIKES so the
 * Demo Test Panel (and future helpers) can add/remove/mutate demo entities
 * at runtime without touching the read-only constants in demoData.ts.
 *
 * Persisted via AsyncStorage so state survives app restarts.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEMO_PROFILES, DEMO_MATCHES, DEMO_LIKES, DEMO_CROSSED_PATHS, generateDemoCrossedPaths } from '@/lib/demoData';
import { useDemoDmStore } from '@/stores/demoDmStore';
// NOTE: useConfessionStore is imported lazily inside functions to break require cycle
import { useDemoNotifStore } from '@/hooks/useNotifications';
import { logDebugEvent } from '@/lib/debugEventLogger';
import { resetPhase2MatchSession } from '../lib/phase2MatchSession';
import { resetPrivateChatForTesting } from './privateChatStore';
import { useBlockStore } from './blockStore';
import { PRIVATE_INTENT_CATEGORIES } from '@/lib/privateConstants';
import { log } from '@/utils/logger';
import { markTiming } from '@/utils/startupTiming';

// Hydration timing: capture when store module loads
const DEMO_STORE_LOAD_TIME = Date.now();

// Seed retry tracking (CR-2: prevent silent failure when dependencies slow)
const SEED_RETRY_DELAY_MS = 250;
const SEED_MAX_RETRIES = 20; // 20 * 250ms = 5s max wait
let _seedRetryCount = 0;
let _seedRetryTimeoutId: ReturnType<typeof setTimeout> | null = null;

// ---------------------------------------------------------------------------
// Types — lightweight "Like" shapes matching the demo data constants
// ---------------------------------------------------------------------------

/** Match record for demo mode */
export interface DemoMatch {
  id: string;
  conversationId: string;
  otherUser: {
    id: string;
    name: string;
    photoUrl: string;
    lastActive: number;
    isVerified: boolean;
  };
  lastMessage: {
    content: string;
    type: string;
    senderId: string;
    createdAt: number;
  } | null;
  unreadCount: number;
  isPreMatch: boolean;
}

export interface DemoProfile {
  _id: string;
  name: string;
  age: number;
  gender: string;
  bio: string;
  isVerified: boolean;
  // 8A: Verification status for demo profiles (all demo profiles are 'verified')
  verificationStatus?: 'unverified' | 'pending_auto' | 'pending_manual' | 'verified' | 'rejected';
  city: string;
  distance: number;
  latitude: number;
  longitude: number;
  lastSeenArea?: string;
  relationshipIntent?: string[];
  activities?: string[];
  profilePrompts?: { question: string; answer: string }[];
  photos: { url: string }[];
  lastLocationUpdatedAt?: number;
  // Face 2 (Phase 2) only: intent category from PRIVATE_INTENT_CATEGORIES
  privateIntentKey?: string;
}


export interface DemoLike {
  likeId: string;
  userId: string;
  action: 'like' | 'super_like';
  message: string | null;
  createdAt: number;
  name: string;
  age: number;
  photoUrl: string;
  isBlurred: boolean;
}

/** Crossed path entry — someone who crossed paths with the user */
export interface DemoCrossedPath {
  id: string;
  otherUserId: string;
  crossedAt: number;
  seen: boolean;
  hidden?: boolean; // manual hide by user
  distance?: number; // approximate distance in meters when crossed
  name: string;
  age: number;
  photoUrl: string;
  // Location where paths crossed (required for map markers)
  // This is the CROSSING location, not current location (persists across travel)
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  // Area name for display (e.g., "Near Bandra West")
  areaName?: string;
  // Reason tags for compatibility match
  // Format: "interest:coffee", "lookingFor:long_term"
  reasonTags?: string[];
  // Human-readable reason for display
  reasonText?: string;
  // Expiration timestamp (30 days from creation)
  expiresAt?: number;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface DemoReport {
  userId: string;
  reason: string;
  description?: string;
  createdAt: number;
}

/**
 * 3A2: Simple hash for demo passwords (NOT cryptographically secure).
 * Used to avoid storing plain text in demo mode.
 * Production uses scrypt on the server.
 */
function hashDemoPassword(password: string): string {
  let hash = 0;
  for (let i = 0; i < password.length; i++) {
    const char = password.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return "demo_hash_" + Math.abs(hash).toString(36) + "_" + password.length;
}

/** A demo account credential record. */
export interface DemoAccount {
  email: string;
  passwordHash: string; // 3A2: store hash, not plain password
  userId: string;
}

/** The demo user's own profile — created via onboarding. */
export interface DemoUserProfile {
  name: string;
  handle?: string; // User's nickname/username
  photos: { url: string }[];
  bio?: string;
  gender?: string;
  dateOfBirth?: string;
  city?: string;
  height?: number | null;
  weight?: number | null;
  smoking?: string | null;
  drinking?: string | null;
  kids?: string | null;
  exercise?: string | null;
  pets?: string[];
  insect?: string | null;
  education?: string | null;
  religion?: string | null;
  jobTitle?: string;
  company?: string;
  school?: string;
  lookingFor?: string[];
  relationshipIntent?: string[];
  activities?: string[];
  profilePrompts?: { question: string; answer: string }[];
  minAge?: number;
  maxAge?: number;
  maxDistance?: number;
  // 8C: Consent timestamp
  consentAcceptedAt?: number;
}

interface DemoState {
  profiles: DemoProfile[];
  matches: DemoMatch[];
  likes: DemoLike[];
  crossedPaths: DemoCrossedPath[];
  seeded: boolean;
  crossedPathsSeeded: boolean; // Separate flag to avoid re-seeding after migration

  /** Multi-user demo accounts (email+password). */
  demoAccounts: DemoAccount[];
  /** Currently logged-in demo user id (null = not logged in). */
  currentDemoUserId: string | null;
  /** Per-user profiles keyed by userId. */
  demoProfiles: Record<string, DemoUserProfile>;
  /** Per-user onboarding completion flag keyed by userId. */
  demoOnboardingComplete: Record<string, boolean>;

  // Auth actions
  demoSignUp: (email: string, password: string) => string;
  demoSignIn: (email: string, password: string) => { userId: string; onboardingComplete: boolean };
  demoLogout: () => void;
  saveDemoProfile: (userId: string, data: Partial<DemoUserProfile>) => void;
  setDemoOnboardingComplete: (userId: string) => void;

  /** Hydration flag — true once AsyncStorage data has been restored. */
  _hasHydrated: boolean;
  setHasHydrated: (state: boolean) => void;

  // Safety (blockedUserIds moved to blockStore for cross-phase sharing)
  reportedUserIds: string[];
  reports: DemoReport[];

  // Nudge dismissals (keyed by screen: 'discover' | 'settings' | 'messages')
  dismissedNudges: string[];
  dismissNudge: (nudgeId: string) => void;

  /** Profile ID of the most recent match — drives the match celebration modal.
   *  Set by simulateMatch(), cleared when the user dismisses the modal. */
  newMatchUserId: string | null;
  setNewMatchUserId: (id: string | null) => void;

  /** 3B-1: Track swiped profile IDs to prevent repeated profiles */
  swipedProfileIds: string[];
  recordSwipe: (profileId: string) => void;

  seed: () => void;
  reset: () => void;
  addProfile: (p: DemoProfile) => void;
  removeProfile: (id: string) => void;
  clearProfiles: () => void;
  addMatch: (m: DemoMatch) => void;
  addLike: (l: DemoLike) => void;
  removeLike: (userId: string) => void;
  simulateMatch: (profileId: string) => void;

  // Crossed paths actions
  addCrossedPath: (cp: DemoCrossedPath) => void;
  removeCrossedPath: (otherUserId: string) => void;
  /** Hide a crossed path without deleting (can be unhidden) */
  hideCrossedPath: (otherUserId: string) => void;
  markCrossedPathSeen: (otherUserId: string) => void;
  getCrossedPathByUserId: (otherUserId: string) => DemoCrossedPath | undefined;
  /** Get all non-hidden, non-expired crossed paths */
  getVisibleCrossedPaths: () => DemoCrossedPath[];
  /** Seed crossed paths based on user's live GPS location (called from Nearby screen) */
  seedCrossedPathsWithLocation: (latitude: number, longitude: number) => void;

  /** Returns all user IDs that should be hidden from Discover/Explore:
   *  blocked + matched + conversation partners + swiped. */
  getExcludedUserIds: () => string[];

  /** Re-inject all DEMO_PROFILES into the store so Discover never runs dry.
   *  Does NOT touch matches, messages, blocks, likes, or swiped. */
  resetDiscoverPool: () => void;

  // Safety actions
  blockUser: (userId: string) => void;
  reportUser: (userId: string, reason: string, description?: string) => void;
  unblockUser: (userId: string) => void;
  clearSafety: () => void;
}

/**
 * Simple string hash for deterministic category assignment.
 * Same profile ID always gets same category index.
 */
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/** Filter out profiles with no valid primary photo, ensure verification status, and assign Phase 2 category */
function withValidPhotos(profiles: DemoProfile[]): DemoProfile[] {
  return profiles
    .filter((p) => p.photos?.length > 0 && !!p.photos[0]?.url)
    .map((p) => ({
      ...p,
      // 8A: All demo profiles are treated as verified
      verificationStatus: 'verified' as const,
      // Face 2: Assign deterministic intent category based on profile ID
      privateIntentKey: PRIVATE_INTENT_CATEGORIES[simpleHash(p._id) % PRIVATE_INTENT_CATEGORIES.length].key,
    }));
}

export const useDemoStore = create<DemoState>()(
  persist(
    (set, get) => ({
      profiles: [],
      matches: [],
      likes: [],
      crossedPaths: [],
      seeded: false,
      crossedPathsSeeded: false,
      demoAccounts: [],
      currentDemoUserId: null,
      demoProfiles: {},
      demoOnboardingComplete: {},
      _hasHydrated: false,
      reportedUserIds: [],
      reports: [],
      dismissedNudges: [],
      newMatchUserId: null,
      swipedProfileIds: [], // 3B-1: Track swiped profiles

      // 3A2: Store hashed password, not plain text
      demoSignUp: (email, password) => {
        const state = get();
        const normalised = email.toLowerCase();
        const existing = state.demoAccounts.find(
          (a) => a.email.toLowerCase() === normalised,
        );
        if (existing) {
          throw new Error('An account with this email already exists');
        }
        const userId = `demo_${normalised.replace(/[^a-z0-9]/g, '_')}`;
        set({
          demoAccounts: [...state.demoAccounts, {
            email: normalised,
            passwordHash: hashDemoPassword(password),
            userId,
          }],
          currentDemoUserId: userId,
        });
        return userId;
      },

      // 3A2: Verify against hashed password
      demoSignIn: (email, password) => {
        const state = get();
        const normalised = email.toLowerCase();
        const account = state.demoAccounts.find(
          (a) => a.email.toLowerCase() === normalised,
        );
        if (!account) {
          throw new Error('No account found with this email');
        }
        // Support both legacy plain password and new hash format
        const inputHash = hashDemoPassword(password);
        const isValid = account.passwordHash === inputHash ||
          // Backward compat: old accounts may have plain password stored
          (account as any).password === password;
        if (!isValid) {
          throw new Error('Incorrect password');
        }
        set({ currentDemoUserId: account.userId });
        return {
          userId: account.userId,
          onboardingComplete: !!state.demoOnboardingComplete[account.userId],
        };
      },

      demoLogout: () => {
        // C7 fix: clear session data on logout while preserving accounts
        // NOTE: demoDmStore is NOT reset here — DM messages persist across logout/login
        // Only explicit "Reset Demo Data" (via reset()) should wipe demo messages
        useDemoNotifStore.getState().reset();
        useBlockStore.getState().clearBlocks();

        // Reset session-scoped state but preserve persistent user data
        // DM-FIX: matches, likes, swipedProfileIds are NOT reset — they persist across logout/login
        // This ensures DM conversations remain visible (since Messages screen uses matches)
        set({
          currentDemoUserId: null,
          // matches: preserved — user-created matches persist
          // likes: preserved — incoming likes persist
          // swipedProfileIds: preserved — swipe history persists
          crossedPaths: [], // Session-scoped — re-seeded with live GPS on Nearby screen
          profiles: withValidPhotos(JSON.parse(JSON.stringify(DEMO_PROFILES)) as DemoProfile[]),
          reportedUserIds: [],
          reports: [],
          dismissedNudges: [],
          newMatchUserId: null,
          crossedPathsSeeded: false, // Reset so Nearby will seed with live GPS location
        });
      },

      saveDemoProfile: (userId, data) => {
        // Log only significant changes (photos, prompts)
        const prevProfile = get().demoProfiles[userId];
        const photoChange = data.photos && data.photos.length !== (prevProfile?.photos?.length ?? 0);
        if (photoChange) {
          log.info('[PROFILE]', 'photos updated', { count: data.photos?.length });
        }

        // PATCH-safe merge: only update fields that are explicitly provided
        // Spread prev profile first, then spread patch data to overwrite only provided fields
        set((s) => ({
          demoProfiles: {
            ...s.demoProfiles,
            [userId]: { ...s.demoProfiles[userId], ...data } as DemoUserProfile,
          },
        }));
      },

      setDemoOnboardingComplete: (userId) => {
        set((s) => ({
          demoOnboardingComplete: { ...s.demoOnboardingComplete, [userId]: true },
        }));
      },

      setHasHydrated: (state) => set({ _hasHydrated: state }),

      setNewMatchUserId: (id) => set({ newMatchUserId: id }),

      dismissNudge: (nudgeId) => {
        set((s) => ({
          dismissedNudges: s.dismissedNudges.includes(nudgeId)
            ? s.dismissedNudges
            : [...s.dismissedNudges, nudgeId],
        }));
      },

      // 3B-1: Record a swiped profile to prevent re-appearance
      recordSwipe: (profileId) => {
        set((s) => ({
          swipedProfileIds: s.swipedProfileIds.includes(profileId)
            ? s.swipedProfileIds
            : [...s.swipedProfileIds, profileId],
        }));
      },

      getExcludedUserIds: () => {
        const s = get();
        const ids = new Set(useBlockStore.getState().blockedUserIds);
        // 3B-1: Add swiped profiles
        for (const id of s.swipedProfileIds) {
          ids.add(id);
        }
        // NOTE: In demo mode, do NOT exclude matched users from discover pool.
        // This keeps 50+ profiles available for testing.
        // Matches remain visible in Messages; users just won't re-appear in feed
        // until swiped (which adds them to swipedProfileIds).
        return Array.from(ids);
      },

      resetDiscoverPool: () => {
        // Re-inject profiles but KEEP swipedProfileIds to prevent duplicates
        set({
          profiles: withValidPhotos(JSON.parse(JSON.stringify(DEMO_PROFILES)) as DemoProfile[]),
        });
      },

      seed: () => {
        const state = get();

        // CRITICAL: Do not seed before hydration completes
        // CR-3: Also check dependent stores (demoDmStore, blockStore) to prevent race conditions
        if (!state._hasHydrated) return;

        // CR-2: Check dependent stores with retry logic instead of silent return
        const demoDmHydrated = useDemoDmStore.getState()._hasHydrated;
        const blockHydrated = useBlockStore.getState()._hasHydrated;

        if (!demoDmHydrated || !blockHydrated) {
          // Clear any existing retry timeout
          if (_seedRetryTimeoutId !== null) {
            clearTimeout(_seedRetryTimeoutId);
            _seedRetryTimeoutId = null;
          }

          if (_seedRetryCount < SEED_MAX_RETRIES) {
            _seedRetryCount++;
            if (__DEV__) {
              console.log(`[demoStore] seed() waiting for deps (attempt ${_seedRetryCount}/${SEED_MAX_RETRIES}) — demoDm:${demoDmHydrated}, block:${blockHydrated}`);
            }
            _seedRetryTimeoutId = setTimeout(() => {
              _seedRetryTimeoutId = null;
              get().seed();
            }, SEED_RETRY_DELAY_MS);
            return;
          } else {
            // Max retries exceeded — proceed with warning
            console.warn(`[DEMO] seed() timed out waiting for dependencies (demoDm:${demoDmHydrated}, block:${blockHydrated}), proceeding anyway`);
            _seedRetryCount = 0; // Reset for future calls
          }
        } else {
          // Dependencies ready — reset retry counter
          _seedRetryCount = 0;
        }

        // Only skip if ALL data is present
        if (state.seeded && state.profiles.length > 0 && state.likes.length > 0) {
          // Clean up matches that conflict with CURRENT likes (not DEMO_LIKES!)
          // A match only conflicts if the same user exists in BOTH matches AND current likes
          // Using DEMO_LIKES here would incorrectly remove user-created matches after reload
          const currentLikeUserIds = new Set(state.likes.map((l) => l.userId));
          const conflictCount = state.matches.filter((m) => currentLikeUserIds.has(m.otherUser?.id || '')).length;
          if (conflictCount > 0) {
            const cleanedMatches = state.matches.filter((m) => !currentLikeUserIds.has(m.otherUser?.id || ''));
            set({ matches: cleanedMatches });
          }

          // DEMO-ONLY GUARD: Filter out likes for profiles with existing conversations
          const dmState = useDemoDmStore.getState();
          const likesWithConvos = state.likes.filter((l) => {
            const convoId = `demo_convo_${l.userId}`;
            return dmState.conversations[convoId]?.length > 0 || dmState.meta[convoId];
          });
          if (likesWithConvos.length > 0) {
            const cleanedLikes = state.likes.filter((l) => {
              const convoId = `demo_convo_${l.userId}`;
              return !(dmState.conversations[convoId]?.length > 0 || dmState.meta[convoId]);
            });
            set({ likes: cleanedLikes });
          }

          // NOTE: Crossed paths are now seeded dynamically with live GPS location
          // in the Nearby screen via seedCrossedPathsWithLocation()
          // This ensures crossed paths appear relative to user's actual location

          // INVARIANT ENFORCEMENT: Remove orphaned like notifications
          // A like_received notification may exist IF AND ONLY IF a pending Like exists
          // Use 'startup' context to log summary instead of per-profile [BUG] warnings
          const currentLikes = get().likes;
          const validLikeUserIds = new Set(currentLikes.map((l) => l.userId));
          useDemoNotifStore.getState().removeOrphanedLikeNotifications(validLikeUserIds, 'startup');

          // INVARIANT ENFORCEMENT: Remove orphaned crossed_paths notifications
          // A crossed_paths notification may exist IF AND ONLY IF a crossedPaths entry exists
          const currentCrossedPaths = get().crossedPaths;
          const validCrossedPathUserIds = new Set(currentCrossedPaths.map((cp) => cp.otherUserId));
          useDemoNotifStore.getState().removeOrphanedCrossedPathNotifications(validCrossedPathUserIds, 'startup');

          // Check if all profiles would be filtered out
          const excludedIds = get().getExcludedUserIds();
          const excludedSet = new Set(excludedIds);
          const availableProfiles = state.profiles.filter(p => !excludedSet.has(p._id));

          if (availableProfiles.length === 0 && state.swipedProfileIds.length > 0) {
            set({ swipedProfileIds: [] });
          }
          return;
        }

        // DEMO-ONLY GUARD: Filter out likes for profiles with existing conversations
        const dmState = useDemoDmStore.getState();
        const filterLikesWithExistingConvos = (likes: DemoLike[]): DemoLike[] => {
          return likes.filter((l) => {
            const convoId = `demo_convo_${l.userId}`;
            return !(dmState.conversations[convoId]?.length > 0 || dmState.meta[convoId]);
          });
        };

        // Determine which likes to use (preserve persisted or fallback to DEMO_LIKES)
        const seedLikes = state.likes.length > 0
          ? filterLikesWithExistingConvos(state.likes)
          : filterLikesWithExistingConvos(JSON.parse(JSON.stringify(DEMO_LIKES)) as DemoLike[]);

        // Build set from ACTUAL likes that will be used (not static DEMO_LIKES!)
        // A match only conflicts if the same user exists in BOTH matches AND current likes
        // Using DEMO_LIKES here would incorrectly remove user-created matches after reload
        const actualLikeUserIds = new Set(seedLikes.map((l) => l.userId));

        // Remove any matches that conflict with actual current likes
        const cleanedMatches = (state.matches.length > 0 ? state.matches : JSON.parse(JSON.stringify(DEMO_MATCHES)) as DemoMatch[])
          .filter((m) => !actualLikeUserIds.has(m.otherUser?.id || ''));

        // NOTE: Crossed paths are seeded dynamically with live GPS location
        // in the Nearby screen via seedCrossedPathsWithLocation()
        // Keep existing crossed paths if present, otherwise leave empty for later seeding

        set({
          profiles: state.profiles.length > 0
            ? state.profiles
            : withValidPhotos(JSON.parse(JSON.stringify(DEMO_PROFILES)) as DemoProfile[]),
          matches: cleanedMatches,
          likes: seedLikes,
          crossedPaths: state.crossedPaths, // Preserve existing, Nearby will seed if needed
          seeded: true,
          // Don't set crossedPathsSeeded here — Nearby screen handles this with live location
          swipedProfileIds: state.swipedProfileIds.length >= DEMO_PROFILES.length ? [] : state.swipedProfileIds,
        });

        // INVARIANT ENFORCEMENT: Remove orphaned like notifications after seed
        // Use 'startup' context to log summary instead of per-profile [BUG] warnings
        const finalLikes = get().likes;
        const validLikeUserIds = new Set(finalLikes.map((l) => l.userId));
        useDemoNotifStore.getState().removeOrphanedLikeNotifications(validLikeUserIds, 'startup');

        // INVARIANT ENFORCEMENT: Remove orphaned crossed_paths notifications after seed
        const finalCrossedPaths = get().crossedPaths;
        const validCrossedPathUserIds = new Set(finalCrossedPaths.map((cp) => cp.otherUserId));
        useDemoNotifStore.getState().removeOrphanedCrossedPathNotifications(validCrossedPathUserIds, 'startup');

        // ONE summary log after initial seed
        const newState = get();
        log.once('demo-seed', '[DEMO]', 'seed complete', {
          profiles: newState.profiles.length,
          likes: newState.likes.length,
          matches: newState.matches.length,
          crossedPaths: newState.crossedPaths.length,
        });
      },

      reset: () => {
        // Clear dependent stores
        useDemoDmStore.setState({ conversations: {}, meta: {}, drafts: {} });
        // Lazy require to break cycle: demoStore <-> confessionStore
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { useConfessionStore } = require('@/stores/confessionStore') as {
          useConfessionStore: {
            getState: () => { seedConfessions: () => void };
            setState: (state: { seeded: boolean }) => void;
          };
        };
        useConfessionStore.setState({ seeded: false });
        useConfessionStore.getState().seedConfessions();

        useBlockStore.getState().clearBlocks();
        set({
          profiles: withValidPhotos(JSON.parse(JSON.stringify(DEMO_PROFILES)) as DemoProfile[]),
          matches: JSON.parse(JSON.stringify(DEMO_MATCHES)) as DemoMatch[],
          likes: JSON.parse(JSON.stringify(DEMO_LIKES)) as DemoLike[],
          crossedPaths: [], // Empty — will be seeded with live location in Nearby screen
          seeded: true,
          crossedPathsSeeded: false, // Reset so Nearby will seed with live GPS location
          demoAccounts: [],
          currentDemoUserId: null,
          demoProfiles: {},
          demoOnboardingComplete: {},
          reportedUserIds: [],
          reports: [],
          dismissedNudges: [],
          swipedProfileIds: [], // 3B-1: Clear swiped profiles on reset
          newMatchUserId: null,
        });
      },

      addProfile: (p) => {
        if (!p.photos?.length || !p.photos[0]?.url) return;
        set((s) => ({ profiles: [...s.profiles, p] }));
      },

      removeProfile: (id) => {
        set((s) => ({ profiles: s.profiles.filter((p) => p._id !== id) }));
      },

      clearProfiles: () => {
        set({ profiles: [] });
      },

      addMatch: (m) => {
        set((s) => ({ matches: [m, ...s.matches] }));
      },

      addLike: (l) => {
        // DEMO-ONLY GUARD: Skip if a conversation already exists with this profile
        const convoId = `demo_convo_${l.userId}`;
        const dmState = useDemoDmStore.getState();
        const hasExistingConvo = dmState.conversations[convoId]?.length > 0 || dmState.meta[convoId];
        if (hasExistingConvo) return;

        const isDuplicate = get().likes.some((existing) => existing.userId === l.userId);
        set((s) => {
          if (s.likes.some((existing) => existing.userId === l.userId)) return s;
          return { likes: [l, ...s.likes] };
        });

        // Fire bell notification (skip if duplicate — already notified)
        // Per-event notifications: "<Name> liked you" or "<Name> super-liked you"
        if (!isDuplicate) {
          const likerName = l.name || 'Someone';
          if (l.action === 'super_like') {
            useDemoNotifStore.getState().addNotification({
              type: 'super_like_received',
              title: 'Super Like',
              body: `${likerName} super-liked you!`,
              data: { otherUserId: l.userId, likerName },
            });
          } else {
            useDemoNotifStore.getState().addNotification({
              type: 'like_received',
              title: 'New Like',
              body: `${likerName} liked you`,
              data: { otherUserId: l.userId, likerName },
            });
          }
        }
      },

      removeLike: (userId) => {
        set((s) => ({ likes: s.likes.filter((l) => l.userId !== userId) }));
        // Also remove any like notifications for this user to maintain consistency
        useDemoNotifStore.getState().removeLikeNotificationsForUser(userId);
      },

      // Crossed paths actions
      addCrossedPath: (cp) => {
        const isDuplicate = get().crossedPaths.some((existing) => existing.otherUserId === cp.otherUserId);
        if (isDuplicate) return;

        set((s) => ({ crossedPaths: [cp, ...s.crossedPaths] }));

        // Fire notification for crossed path WITH reason
        // If no reasonText, fall back to generic message
        const notificationBody = cp.reasonText
          ? `You crossed paths with ${cp.name} — ${cp.reasonText}`
          : `You crossed paths with ${cp.name} nearby.`;

        useDemoNotifStore.getState().addNotification({
          type: 'crossed_paths',
          title: 'Crossed paths!',
          body: notificationBody,
          data: {
            otherUserId: cp.otherUserId,
            crossedAt: String(cp.crossedAt),
            reasonTags: cp.reasonTags?.join(',') ?? '',
            areaName: cp.areaName ?? '',
          },
        });
      },

      removeCrossedPath: (otherUserId) => {
        set((s) => ({ crossedPaths: s.crossedPaths.filter((cp) => cp.otherUserId !== otherUserId) }));
        // Also remove any crossed_paths notifications for this user to maintain consistency
        useDemoNotifStore.getState().removeCrossedPathNotificationsForUser(otherUserId);
      },

      markCrossedPathSeen: (otherUserId) => {
        set((s) => ({
          crossedPaths: s.crossedPaths.map((cp) =>
            cp.otherUserId === otherUserId ? { ...cp, seen: true } : cp
          ),
        }));
      },

      hideCrossedPath: (otherUserId) => {
        set((s) => ({
          crossedPaths: s.crossedPaths.map((cp) =>
            cp.otherUserId === otherUserId ? { ...cp, hidden: true } : cp
          ),
        }));
        // Also remove any crossed_paths notifications for this user
        useDemoNotifStore.getState().removeCrossedPathNotificationsForUser(otherUserId);
      },

      getCrossedPathByUserId: (otherUserId) => {
        return get().crossedPaths.find((cp) => cp.otherUserId === otherUserId);
      },

      getVisibleCrossedPaths: () => {
        const now = Date.now();
        return get().crossedPaths.filter((cp) => {
          // Filter out hidden entries
          if (cp.hidden) return false;
          // Filter out expired entries (30 days)
          if (cp.expiresAt && cp.expiresAt < now) return false;
          return true;
        });
      },

      seedCrossedPathsWithLocation: (latitude, longitude) => {
        const state = get();

        // Skip if already seeded with valid data
        if (state.crossedPathsSeeded && state.crossedPaths.length > 0) {
          // Check if existing crossed paths have valid coordinates near the user
          const hasValidCoords = state.crossedPaths.every(
            (cp) =>
              typeof cp.latitude === 'number' &&
              typeof cp.longitude === 'number' &&
              !Number.isNaN(cp.latitude) &&
              !Number.isNaN(cp.longitude)
          );
          if (hasValidCoords) {
            log.info('[DEMO]', 'crossedPaths already seeded with valid coordinates, skipping');
            return;
          }
        }

        // Validate input coordinates
        if (
          typeof latitude !== 'number' ||
          typeof longitude !== 'number' ||
          Number.isNaN(latitude) ||
          Number.isNaN(longitude)
        ) {
          log.warn('[DEMO]', 'seedCrossedPathsWithLocation called with invalid coordinates', {
            latitude,
            longitude,
          });
          return;
        }

        // Generate crossed paths around user's location
        const newCrossedPaths = generateDemoCrossedPaths(latitude, longitude);

        if (newCrossedPaths.length === 0) {
          log.warn('[DEMO]', 'generateDemoCrossedPaths returned empty array');
          return;
        }

        log.info('[DEMO]', 'seeding crossed paths around user location', {
          latitude,
          longitude,
          count: newCrossedPaths.length,
        });

        set({
          crossedPaths: newCrossedPaths,
          crossedPathsSeeded: true,
        });
      },

      simulateMatch: (profileId) => {
        const state = get();

        // IDEMPOTENT: Skip if match already exists for this profile
        const existingMatch = state.matches.find((m) => m.otherUser?.id === profileId);
        if (existingMatch) {
          if (__DEV__) log.info('[MATCH]', 'skipped (already exists)', { profileId });
          return;
        }

        const profile = state.profiles.find((p) => p._id === profileId);
        if (!profile) return;

        // Deterministic IDs — same profileId always yields the same conversationId
        const convoId = `demo_convo_${profileId}`;
        const matchId = `match_${profileId}`;
        log.info('[MATCH]', 'created', { name: profile.name });

        const newMatch: DemoMatch = {
          id: matchId,
          conversationId: convoId,
          otherUser: {
            id: profile._id,
            name: profile.name,
            photoUrl: profile.photos[0]?.url ?? '',
            lastActive: Date.now(),
            isVerified: profile.isVerified,
          },
          lastMessage: null,
          unreadCount: 0,
          isPreMatch: false,
        };

        // Seed an empty conversation in the DM store with the deterministic id
        const dmStore = useDemoDmStore.getState();
        dmStore.seedConversation(convoId, []);
        dmStore.setMeta(convoId, {
          otherUser: {
            id: profile._id,
            name: profile.name,
            lastActive: Date.now(),
            isVerified: profile.isVerified,
          },
          isPreMatch: false,
        });

        set((s) => ({
          profiles: s.profiles.filter((p) => p._id !== profileId),
          matches: [newMatch, ...s.matches],
          likes: s.likes.filter((l) => l.userId !== profileId),
          newMatchUserId: profileId,
        }));

        // Fire bell notification
        useDemoNotifStore.getState().addNotification({
          type: 'match_created',
          title: "It's a match!",
          body: `You and ${profile.name} liked each other.`,
          data: { otherUserId: profileId, matchId },
        });

        // Debug event logging
        logDebugEvent('MATCH_CREATED', 'New match created');
      },

      // ── Safety actions ──
      // These delegate to blockStore (single source of truth for blocked IDs).
      // Also clean up demoStore entities (matches, likes, crossedPaths, DM, confessions).

      blockUser: (userId) => {
        // Delegate to shared blockStore (single source of truth)
        useBlockStore.getState().blockUser(userId);

        // Clean up demoStore entities that reference this user
        set((s) => ({
          matches: s.matches.filter((m) => m.otherUser?.id !== userId),
          likes: s.likes.filter((l) => l.userId !== userId),
          // SAFETY FIX: Also remove blocked user from crossed paths immediately
          crossedPaths: s.crossedPaths.filter((cp) => cp.otherUserId !== userId),
        }));
        // Debug event logging
        logDebugEvent('BLOCK_OR_REPORT', 'User blocked');
        // Also remove crossed path notifications for blocked user
        useDemoNotifStore.getState().removeCrossedPathNotificationsForUser(userId);

        // Clean DM store — remove all conversations with this user
        const dmState = useDemoDmStore.getState();
        const meta = dmState.meta;
        const convoIdsToDelete: string[] = [];
        for (const convoId of Object.keys(meta)) {
          if (meta[convoId]?.otherUser?.id === userId) {
            convoIdsToDelete.push(convoId);
          }
        }
        if (convoIdsToDelete.length > 0) {
          dmState.deleteConversations(convoIdsToDelete);
        }

        // Clean confession store — remove confessions from this user + confession threads
        // Lazy require to break cycle: demoStore <-> confessionStore
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { useConfessionStore } = require('@/stores/confessionStore') as {
          useConfessionStore: {
            getState: () => {
              confessionThreads: Record<string, string>;
              confessions: Array<{ id: string; userId: string; targetUserId?: string }>;
              blockUser: (userId: string) => void;
            };
            setState: (state: { confessionThreads: Record<string, string> }) => void;
          };
        };
        const confessionState = useConfessionStore.getState();
        confessionState.blockUser(userId);
        // Also clean confession threads that involve this user
        const confessionThreads = confessionState.confessionThreads;
        const confessions = confessionState.confessions;
        const confessionIdsToClean: string[] = [];
        for (const [confessionId, convoId] of Object.entries(confessionThreads)) {
          const confession = confessions.find((c) => c.id === confessionId);
          // If confession author is blocked or if tagged user is blocked
          if (confession?.userId === userId || confession?.targetUserId === userId) {
            confessionIdsToClean.push(confessionId);
            // Also delete the conversation from DM store if not already deleted
            if (!convoIdsToDelete.includes(convoId)) {
              dmState.deleteConversation(convoId);
            }
          }
        }
        // Remove cleaned confession threads from tracking
        if (confessionIdsToClean.length > 0) {
          const newThreads = { ...confessionThreads };
          for (const id of confessionIdsToClean) {
            delete newThreads[id];
          }
          useConfessionStore.setState({ confessionThreads: newThreads });
        }
      },

      reportUser: (userId, reason, description) => {
        // Reporting always auto-blocks — the reported user disappears immediately
        // from Discover, Explore, Nearby, and Messages. This matches the live
        // backend behavior where reportUser also calls blockUser server-side.

        // First, add the report record
        set((s) => {
          const report: DemoReport = { userId, reason, description, createdAt: Date.now() };
          return {
            reportedUserIds: s.reportedUserIds.includes(userId)
              ? s.reportedUserIds
              : [...s.reportedUserIds, userId],
            reports: [...s.reports, report],
          };
        });

        // Then use blockUser for the full purge (handles matches, likes, DM, confessions)
        get().blockUser(userId);
      },

      unblockUser: (userId) => {
        // Delegate to shared blockStore (single source of truth)
        useBlockStore.getState().unblockUser(userId);
      },

      clearSafety: () => {
        // Delegate to shared blockStore (single source of truth)
        useBlockStore.getState().clearBlocks();
        set({ reportedUserIds: [], reports: [] });
      },
    }),
    {
      name: 'demo-store',
      storage: createJSONStorage(() => AsyncStorage),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          log.error('[DEMO]', 'rehydration error', error);
        }
        if (state) {
          const profile = state.currentDemoUserId ? state.demoProfiles[state.currentDemoUserId] : null;
          // DEBUG: Log persistence state on hydrate for verification
          log.info('[DEMO]', 'hydrated from storage', {
            matches: state.matches?.length ?? 0,
            likes: state.likes?.length ?? 0,
            profiles: state.profiles?.length ?? 0,
            seeded: state.seeded,
            photos: profile?.photos?.length ?? 0,
            onboarding: !!state.demoOnboardingComplete[state.currentDemoUserId || ''],
          });

          // MIGRATION: Normalize crossedPaths data from old schema (lat/lng) to new (latitude/longitude)
          // This handles persisted data from before the schema change
          if (state.crossedPaths && state.crossedPaths.length > 0) {
            let fixedCount = 0;
            let removedCount = 0;
            const removedUserIds: string[] = [];

            const migratedPaths = state.crossedPaths
              .map((cp: any) => {
                // Try to extract valid coordinates from various possible schemas
                let lat = cp.latitude;
                let lng = cp.longitude;

                // Check for old lat/lng keys
                if (typeof lat !== 'number' && typeof cp.lat === 'number') {
                  lat = cp.lat;
                  fixedCount++;
                }
                if (typeof lng !== 'number' && typeof cp.lng === 'number') {
                  lng = cp.lng;
                  fixedCount++;
                }

                // Check for nested location object
                if (typeof lat !== 'number' && cp.location?.lat != null) {
                  lat = cp.location.lat;
                  fixedCount++;
                }
                if (typeof lng !== 'number' && cp.location?.lng != null) {
                  lng = cp.location.lng;
                  fixedCount++;
                }

                return {
                  ...cp,
                  latitude: lat,
                  longitude: lng,
                  // Remove old keys if they exist
                  lat: undefined,
                  lng: undefined,
                  location: undefined,
                };
              })
              .filter((cp: any) => {
                // Validate coordinates
                const isValid =
                  typeof cp.latitude === 'number' &&
                  typeof cp.longitude === 'number' &&
                  !Number.isNaN(cp.latitude) &&
                  !Number.isNaN(cp.longitude);

                if (!isValid) {
                  removedCount++;
                  removedUserIds.push(cp.otherUserId);
                }
                return isValid;
              });

            // Apply migration if any changes were made
            if (fixedCount > 0 || removedCount > 0) {
              // Update crossedPaths with migrated data
              useDemoStore.setState({ crossedPaths: migratedPaths });

              // Remove notifications for removed entries (maintain invariant)
              if (removedUserIds.length > 0) {
                for (const userId of removedUserIds) {
                  useDemoNotifStore.getState().removeCrossedPathNotificationsForUser(userId);
                }
              }

              log.once('crossed-paths-migration', '[DEMO]', 'migrated crossedPaths', {
                fixed: fixedCount,
                removed: removedCount,
              });
            }
          }
        }
        state?.setHasHydrated(true);
        // Milestone C: demoStore hydration complete
        markTiming('demo_hydrated');
        if (__DEV__) {
          const hydrationTime = Date.now() - DEMO_STORE_LOAD_TIME;
          // Log data sizes for debugging
          const profileCount = state?.profiles?.length ?? 0;
          const matchCount = state?.matches?.length ?? 0;
          const crossedPathsCount = state?.crossedPaths?.length ?? 0;
          console.log(`[HYDRATION] demoStore: ${hydrationTime}ms (profiles=${profileCount}, matches=${matchCount}, crossedPaths=${crossedPathsCount})`);
        }
      },
      partialize: (state) => ({
        profiles: state.profiles,
        matches: state.matches,
        likes: state.likes,
        crossedPaths: state.crossedPaths,
        seeded: state.seeded,
        crossedPathsSeeded: state.crossedPathsSeeded,
        demoAccounts: state.demoAccounts,
        currentDemoUserId: state.currentDemoUserId,
        demoProfiles: state.demoProfiles,
        demoOnboardingComplete: state.demoOnboardingComplete,
        reportedUserIds: state.reportedUserIds,
        reports: state.reports,
        dismissedNudges: state.dismissedNudges,
        swipedProfileIds: state.swipedProfileIds, // 3B-1: Persist swiped profiles
      }),
    },
  ),
);

// BUGFIX #14: Store timeout ID to prevent multiple timers on hot reload
const HYDRATION_TIMEOUT_MS = 5000;
let _demoHydrationTimeoutId: ReturnType<typeof setTimeout> | null = null;

function setupDemoHydrationTimeout() {
  // Clear any existing timeout (hot reload safety)
  if (_demoHydrationTimeoutId !== null) {
    clearTimeout(_demoHydrationTimeoutId);
  }
  _demoHydrationTimeoutId = setTimeout(() => {
    if (!useDemoStore.getState()._hasHydrated) {
      console.warn('[demoStore] Hydration timeout — forcing hydrated state');
      useDemoStore.getState().setHasHydrated(true);
    }
    _demoHydrationTimeoutId = null;
  }, HYDRATION_TIMEOUT_MS);
}

// C8 fix: hydration timeout fallback
setupDemoHydrationTimeout();

/**
 * DEV ONLY: Master reset for all demo state (Phase 1 + Phase 2).
 * Clears everything for fresh testing:
 * - Demo profiles, matches, likes
 * - Swiped profile IDs
 * - Phase 1 DM conversations
 * - Phase 2 private chat state
 * - Session-scoped matched user IDs
 *
 * Call this to start testing from a completely clean slate.
 */
export async function resetAllDemoForTesting(): Promise<void> {
  log.info('[DEMO]', 'reset all state');

  // 1) Reset Phase 1 demo state (includes DM store)
  useDemoStore.getState().reset();

  // 2) Reset Phase 2 private chat state (conversations, messages, unlocked users)
  resetPrivateChatForTesting();

  // 3) Reset Phase 2 session match tracking (prevents duplicate matches)
  resetPhase2MatchSession();

  // 4) Clear notification counts
  useDemoNotifStore.getState().reset();
}
