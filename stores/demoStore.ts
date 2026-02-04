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

interface DemoState {
  profiles: DemoProfile[];
  matches: DemoMatch[];
  likes: DemoLike[];
  seeded: boolean;

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
  simulateMatch: (profileId: string) => void;

  // Safety actions
  blockUser: (userId: string) => void;
  reportUser: (userId: string, reason: string, description?: string) => void;
  unblockUser: (userId: string) => void;
  clearSafety: () => void;
}

export const useDemoStore = create<DemoState>()(
  persist(
    (set, get) => ({
      profiles: [],
      matches: [],
      likes: [],
      seeded: false,
      blockedUserIds: [],
      reportedUserIds: [],
      reports: [],
      dismissedNudges: [],

      dismissNudge: (nudgeId) => {
        set((s) => ({
          dismissedNudges: s.dismissedNudges.includes(nudgeId)
            ? s.dismissedNudges
            : [...s.dismissedNudges, nudgeId],
        }));
      },

      seed: () => {
        if (get().seeded) return;
        set({
          profiles: JSON.parse(JSON.stringify(DEMO_PROFILES)) as DemoProfile[],
          matches: JSON.parse(JSON.stringify(DEMO_MATCHES)) as DemoMatch[],
          likes: JSON.parse(JSON.stringify(DEMO_LIKES)) as DemoLike[],
          seeded: true,
        });
      },

      reset: () => {
        // Clear dependent stores
        useDemoDmStore.setState({ conversations: {}, meta: {} });
        useConfessionStore.setState({ seeded: false });
        useConfessionStore.getState().seedConfessions();

        set({
          profiles: JSON.parse(JSON.stringify(DEMO_PROFILES)) as DemoProfile[],
          matches: JSON.parse(JSON.stringify(DEMO_MATCHES)) as DemoMatch[],
          likes: JSON.parse(JSON.stringify(DEMO_LIKES)) as DemoLike[],
          seeded: true,
          blockedUserIds: [],
          reportedUserIds: [],
          reports: [],
          dismissedNudges: [],
        });
      },

      addProfile: (p) => {
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
        set((s) => ({ likes: [l, ...s.likes] }));
      },

      simulateMatch: (profileId) => {
        const state = get();
        const profile = state.profiles.find((p) => p._id === profileId);
        if (!profile) return;

        const matchId = `match_demo_${Date.now()}`;
        const newMatch: DemoMatch = {
          id: matchId,
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

        // Seed a starter conversation in the DM store
        useDemoDmStore.getState().seedConversation(matchId, [
          {
            _id: `msg_${Date.now()}`,
            content: `You matched with ${profile.name}! Say hi.`,
            type: 'system',
            senderId: 'system',
            createdAt: Date.now(),
          },
        ]);

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
