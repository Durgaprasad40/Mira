import { create } from 'zustand';
import type { ProfileData } from '@/lib/profileData';

interface Phase2DiscoverCacheState {
  viewerUserId: string | null;
  profilesMap: Map<string, ProfileData>;
  consumedIds: Set<string>;
  queue: string[];
  searchingDone: boolean;
  mergeProfiles: (userId: string | null | undefined, profiles: ProfileData[]) => void;
  consume: (profileId: string) => void;
  purgeUserIds: (ids: Set<string>) => void;
  setQueue: (ids: string[]) => void;
  markSearchingDone: () => void;
  resetForUser: (userId: string | null | undefined) => void;
  hardReset: () => void;
}

const emptyCacheForUser = (userId: string | null | undefined) => ({
  viewerUserId: userId ?? null,
  profilesMap: new Map<string, ProfileData>(),
  consumedIds: new Set<string>(),
  queue: [],
  searchingDone: false,
});

export const usePhase2DiscoverCacheStore = create<Phase2DiscoverCacheState>()((set) => ({
  ...emptyCacheForUser(null),

  mergeProfiles: (userId, profiles) =>
    set((state) => {
      const viewerUserId = userId ?? null;
      const sameViewer = state.viewerUserId === viewerUserId;
      const profilesMap = sameViewer
        ? new Map(state.profilesMap)
        : new Map<string, ProfileData>();
      const consumedIds = sameViewer
        ? new Set(state.consumedIds)
        : new Set<string>();

      for (const profile of profiles) {
        if (!consumedIds.has(profile.id)) {
          profilesMap.set(profile.id, profile);
        }
      }

      return {
        viewerUserId,
        profilesMap,
        consumedIds,
        queue: sameViewer ? state.queue : [],
        searchingDone: sameViewer ? state.searchingDone : false,
      };
    }),

  consume: (profileId) =>
    set((state) => {
      const consumedIds = new Set(state.consumedIds);
      consumedIds.add(profileId);

      const profilesMap = new Map(state.profilesMap);
      profilesMap.delete(profileId);

      return {
        consumedIds,
        profilesMap,
        queue: state.queue.filter((id) => id !== profileId),
      };
    }),

  purgeUserIds: (ids) =>
    set((state) => {
      if (ids.size === 0) return state;

      const idsToPurge = new Set(ids);
      const profilesMap = new Map(state.profilesMap);

      for (const [profileId, profile] of profilesMap) {
        if (idsToPurge.has(profileId) || (profile.userId && idsToPurge.has(profile.userId))) {
          idsToPurge.add(profileId);
          if (profile.userId) {
            idsToPurge.add(profile.userId);
          }
          profilesMap.delete(profileId);
        }
      }

      const consumedIds = new Set(state.consumedIds);
      for (const id of idsToPurge) {
        consumedIds.add(id);
      }

      return {
        consumedIds,
        profilesMap,
        queue: state.queue.filter((id) => !idsToPurge.has(id)),
      };
    }),

  setQueue: (ids) => set({ queue: ids }),

  markSearchingDone: () => set({ searchingDone: true }),

  resetForUser: (userId) =>
    set((state) => {
      const viewerUserId = userId ?? null;
      if (state.viewerUserId === viewerUserId) return state;
      return emptyCacheForUser(viewerUserId);
    }),

  hardReset: () =>
    set((state) => ({
      ...emptyCacheForUser(state.viewerUserId),
    })),
}));
