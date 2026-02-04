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

/** The demo user's own profile — created via the demo profile screen. */
export interface DemoUserProfile {
  name: string;
  photos: { url: string }[];
  bio?: string;
  gender?: string;
  dateOfBirth?: string;
  city?: string;
}

interface DemoState {
  profiles: DemoProfile[];
  matches: DemoMatch[];
  likes: DemoLike[];
  seeded: boolean;

  /** The current demo user's profile (null until created). */
  demoUserProfile: DemoUserProfile | null;
  setDemoUserProfile: (profile: DemoUserProfile) => void;

  // Safety
  blockedUserIds: string[];
  reportedUserIds: string[];
  reports: DemoReport[];

  // Nudge dismissals (keyed by screen: 'discover' | 'settings' | 'messages')
  dismissedNudges: string[];
  dismissNudge: (nudgeId: string) => void;

  seed: () => void;
  reset: () => void;
  addProfile: (p: DemoProfile) => void;
  removeProfile: (id: string) => void;
  clearProfiles: () => void;
  addMatch: (m: DemoMatch) => void;
  addLike: (l: DemoLike) => void;
  removeLike: (userId: string) => void;
  simulateMatch: (profileId: string) => void;

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
      demoUserProfile: null,
      blockedUserIds: [],
      reportedUserIds: [],
      reports: [],
      dismissedNudges: [],

      setDemoUserProfile: (profile) => set({ demoUserProfile: profile }),

      dismissNudge: (nudgeId) => {
        set((s) => ({
          dismissedNudges: s.dismissedNudges.includes(nudgeId)
            ? s.dismissedNudges
            : [...s.dismissedNudges, nudgeId],
        }));
      },

      seed: () => {
        const state = get();
        if (state.seeded && state.profiles.length > 0) return;
        set({
          profiles: withValidPhotos(JSON.parse(JSON.stringify(DEMO_PROFILES)) as DemoProfile[]),
          matches: JSON.parse(JSON.stringify(DEMO_MATCHES)) as DemoMatch[],
          likes: JSON.parse(JSON.stringify(DEMO_LIKES)) as DemoLike[],
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
          demoUserProfile: null,
          blockedUserIds: [],
          reportedUserIds: [],
          reports: [],
          dismissedNudges: [],
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
        set((s) => {
          if (s.likes.some((existing) => existing.userId === l.userId)) return s;
          return { likes: [l, ...s.likes] };
        });
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
        }));
      },

      // ── Safety actions ──
      // These update blockedUserIds which is read (via .includes() / .filter())
      // by every consumer that shows profiles: DiscoverCardStack, useExploreProfiles,
      // nearby, and messages. Blocking takes effect instantly across the whole app
      // because Zustand triggers re-renders in all subscribed components.

      blockUser: (userId) => {
        set((s) => {
          if (s.blockedUserIds.includes(userId)) return s;
          return { blockedUserIds: [...s.blockedUserIds, userId] };
        });
      },

      reportUser: (userId, reason, description) => {
        // Reporting always auto-blocks — the reported user disappears immediately
        // from Discover, Explore, Nearby, and Messages. This matches the live
        // backend behavior where reportUser also calls blockUser server-side.
        set((s) => {
          const report: DemoReport = { userId, reason, description, createdAt: Date.now() };
          return {
            reportedUserIds: s.reportedUserIds.includes(userId)
              ? s.reportedUserIds
              : [...s.reportedUserIds, userId],
            reports: [...s.reports, report],
            blockedUserIds: s.blockedUserIds.includes(userId)
              ? s.blockedUserIds
              : [...s.blockedUserIds, userId],
          };
        });
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
      partialize: (state) => ({
        profiles: state.profiles,
        matches: state.matches,
        likes: state.likes,
        seeded: state.seeded,
        blockedUserIds: state.blockedUserIds,
        reportedUserIds: state.reportedUserIds,
        reports: state.reports,
        dismissedNudges: state.dismissedNudges,
      }),
    },
  ),
);
