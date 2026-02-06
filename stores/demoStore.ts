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
import { DEMO_PROFILES, DEMO_MATCHES, DEMO_LIKES } from '@/lib/demoData';
import { useDemoDmStore } from '@/stores/demoDmStore';
import { useConfessionStore } from '@/stores/confessionStore';
import { useDemoNotifStore } from '@/hooks/useNotifications';
import { logDebugEvent } from '@/lib/debugEventLogger';

// ---------------------------------------------------------------------------
// Types — lightweight "Like" shapes matching the demo data constants
// ---------------------------------------------------------------------------

export interface DemoProfile {
  _id: string;
  name: string;
  age: number;
  gender: string;
  bio: string;
  isVerified: boolean;
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
}

export interface DemoMatch {
  id: string;
  /** Deterministic conversation key: `demo_convo_${otherUser.id}` */
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

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface DemoReport {
  userId: string;
  reason: string;
  description?: string;
  createdAt: number;
}

/** A demo account credential record. */
export interface DemoAccount {
  email: string;
  password: string;
  userId: string;
}

/** The demo user's own profile — created via onboarding. */
export interface DemoUserProfile {
  name: string;
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
}

interface DemoState {
  profiles: DemoProfile[];
  matches: DemoMatch[];
  likes: DemoLike[];
  seeded: boolean;

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

  // Safety
  blockedUserIds: string[];
  reportedUserIds: string[];
  reports: DemoReport[];

  // Nudge dismissals (keyed by screen: 'discover' | 'settings' | 'messages')
  dismissedNudges: string[];
  dismissNudge: (nudgeId: string) => void;

  /** Profile ID of the most recent match — drives the match celebration modal.
   *  Set by simulateMatch(), cleared when the user dismisses the modal. */
  newMatchUserId: string | null;
  setNewMatchUserId: (id: string | null) => void;

  seed: () => void;
  reset: () => void;
  addProfile: (p: DemoProfile) => void;
  removeProfile: (id: string) => void;
  clearProfiles: () => void;
  addMatch: (m: DemoMatch) => void;
  addLike: (l: DemoLike) => void;
  removeLike: (userId: string) => void;
  simulateMatch: (profileId: string) => void;

  /** Returns all user IDs that should be hidden from Discover/Explore:
   *  blocked + matched + conversation partners. */
  getExcludedUserIds: () => string[];

  /** Re-inject all DEMO_PROFILES into the store so Discover never runs dry.
   *  Does NOT touch matches, messages, blocks, or likes. */
  resetDiscoverPool: () => void;

  // Safety actions
  blockUser: (userId: string) => void;
  reportUser: (userId: string, reason: string, description?: string) => void;
  unblockUser: (userId: string) => void;
  clearSafety: () => void;
}

/** Filter out profiles with no valid primary photo */
function withValidPhotos(profiles: DemoProfile[]): DemoProfile[] {
  return profiles.filter((p) => p.photos?.length > 0 && !!p.photos[0]?.url);
}

export const useDemoStore = create<DemoState>()(
  persist(
    (set, get) => ({
      profiles: [],
      matches: [],
      likes: [],
      seeded: false,
      demoAccounts: [],
      currentDemoUserId: null,
      demoProfiles: {},
      demoOnboardingComplete: {},
      _hasHydrated: false,
      blockedUserIds: [],
      reportedUserIds: [],
      reports: [],
      dismissedNudges: [],
      newMatchUserId: null,

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
          demoAccounts: [...state.demoAccounts, { email: normalised, password, userId }],
          currentDemoUserId: userId,
        });
        return userId;
      },

      demoSignIn: (email, password) => {
        const state = get();
        const normalised = email.toLowerCase();
        const account = state.demoAccounts.find(
          (a) => a.email.toLowerCase() === normalised,
        );
        if (!account) {
          throw new Error('No account found with this email');
        }
        if (account.password !== password) {
          throw new Error('Incorrect password');
        }
        set({ currentDemoUserId: account.userId });
        return {
          userId: account.userId,
          onboardingComplete: !!state.demoOnboardingComplete[account.userId],
        };
      },

      demoLogout: () => {
        set({ currentDemoUserId: null });
      },

      saveDemoProfile: (userId, data) => {
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

      getExcludedUserIds: () => {
        const s = get();
        const ids = new Set(s.blockedUserIds);
        // Add all matched user IDs
        for (const m of s.matches) {
          ids.add(m.otherUser.id);
        }
        // Add all conversation partner IDs from demoDmStore
        const dmMeta = useDemoDmStore.getState().meta;
        for (const key of Object.keys(dmMeta)) {
          const partnerId = dmMeta[key]?.otherUser?.id;
          if (partnerId) ids.add(partnerId);
        }
        return Array.from(ids);
      },

      resetDiscoverPool: () => {
        if (__DEV__) console.log('[demoStore] resetDiscoverPool — re-injecting demo profiles');
        set({
          profiles: withValidPhotos(JSON.parse(JSON.stringify(DEMO_PROFILES)) as DemoProfile[]),
        });
      },

      seed: () => {
        const state = get();
        // Only skip if ALL data is present. If likes/profiles were drained
        // (e.g. persisted from older session), re-seed the missing parts.
        if (state.seeded && state.profiles.length > 0 && state.likes.length > 0) return;
        set({
          profiles: state.profiles.length > 0
            ? state.profiles
            : withValidPhotos(JSON.parse(JSON.stringify(DEMO_PROFILES)) as DemoProfile[]),
          matches: state.matches.length > 0
            ? state.matches
            : JSON.parse(JSON.stringify(DEMO_MATCHES)) as DemoMatch[],
          likes: state.likes.length > 0
            ? state.likes
            : JSON.parse(JSON.stringify(DEMO_LIKES)) as DemoLike[],
          seeded: true,
        });
      },

      reset: () => {
        // Clear dependent stores
        useDemoDmStore.setState({ conversations: {}, meta: {}, drafts: {} });
        useConfessionStore.setState({ seeded: false });
        useConfessionStore.getState().seedConfessions();

        set({
          profiles: withValidPhotos(JSON.parse(JSON.stringify(DEMO_PROFILES)) as DemoProfile[]),
          matches: JSON.parse(JSON.stringify(DEMO_MATCHES)) as DemoMatch[],
          likes: JSON.parse(JSON.stringify(DEMO_LIKES)) as DemoLike[],
          seeded: true,
          demoAccounts: [],
          currentDemoUserId: null,
          demoProfiles: {},
          demoOnboardingComplete: {},
          blockedUserIds: [],
          reportedUserIds: [],
          reports: [],
          dismissedNudges: [],
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
        const isDuplicate = get().likes.some((existing) => existing.userId === l.userId);
        set((s) => {
          if (s.likes.some((existing) => existing.userId === l.userId)) return s;
          return { likes: [l, ...s.likes] };
        });

        // Fire bell notification (skip if duplicate — already notified)
        if (!isDuplicate) {
          if (l.action === 'super_like') {
            useDemoNotifStore.getState().addNotification({
              type: 'super_like_received',
              title: 'Super Like',
              body: 'Someone super-liked you!',
              data: { otherUserId: l.userId },
            });
          } else {
            useDemoNotifStore.getState().addNotification({
              type: 'like_received',
              title: 'New like',
              body: 'Someone liked you.',
              data: { otherUserId: l.userId },
            });
          }
        }
      },

      removeLike: (userId) => {
        set((s) => ({ likes: s.likes.filter((l) => l.userId !== userId) }));
      },

      simulateMatch: (profileId) => {
        const state = get();
        const profile = state.profiles.find((p) => p._id === profileId);
        if (!profile) return;

        // Deterministic IDs — same profileId always yields the same
        // conversationId so every screen (messages list, chat, celebration)
        // references the same conversation record.
        const convoId = `demo_convo_${profileId}`;
        const matchId = `match_${profileId}`;
        if (__DEV__) console.log(`[simulateMatch] profileId=${profileId} convoId=${convoId}`);

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
      // These update blockedUserIds which is read (via .includes() / .filter())
      // by every consumer that shows profiles: DiscoverCardStack, useExploreProfiles,
      // nearby, and messages. Blocking takes effect instantly across the whole app
      // because Zustand triggers re-renders in all subscribed components.

      blockUser: (userId) => {
        set((s) => {
          if (s.blockedUserIds.includes(userId)) return s;
          return {
            blockedUserIds: [...s.blockedUserIds, userId],
            matches: s.matches.filter((m) => m.otherUser?.id !== userId),
            likes: s.likes.filter((l) => l.userId !== userId),
          };
        });
        // Debug event logging
        logDebugEvent('BLOCK_OR_REPORT', 'User blocked');

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
        set((s) => ({
          blockedUserIds: s.blockedUserIds.filter((id) => id !== userId),
        }));
      },

      clearSafety: () => {
        set({ blockedUserIds: [], reportedUserIds: [], reports: [] });
      },
    }),
    {
      name: 'demo-store',
      storage: createJSONStorage(() => AsyncStorage),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
      partialize: (state) => ({
        profiles: state.profiles,
        matches: state.matches,
        likes: state.likes,
        seeded: state.seeded,
        demoAccounts: state.demoAccounts,
        currentDemoUserId: state.currentDemoUserId,
        demoProfiles: state.demoProfiles,
        demoOnboardingComplete: state.demoOnboardingComplete,
        blockedUserIds: state.blockedUserIds,
        reportedUserIds: state.reportedUserIds,
        reports: state.reports,
        dismissedNudges: state.dismissedNudges,
      }),
    },
  ),
);
