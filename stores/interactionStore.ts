import { create } from 'zustand';
import { ConfessionRevealPolicy, TimedRevealOption } from '@/types';

/**
 * Lightweight store for cross-screen communication.
 * Used when a route-based screen (compose-confession, person-picker, stand-out)
 * needs to pass results back to a tab screen without prop-drilling.
 */

interface ComposeResult {
  text: string;
  isAnonymous: boolean;
  targetUserId?: string;
  revealPolicy?: ConfessionRevealPolicy;
  timedReveal?: TimedRevealOption;
}

interface PersonPickerResult {
  userId: string;
  name: string;
}

interface StandOutResult {
  profileId: string;
  message: string;
}

interface DiscoverProfileActionResult {
  profileId: string;
  action: 'like' | 'pass' | 'super_like';
  source: 'phase1_discover_profile';
}

interface InteractionStore {
  // Compose confession
  composeResult: ComposeResult | null;
  setComposeResult: (result: ComposeResult | null) => void;

  // Person picker
  personPickerResult: PersonPickerResult | null;
  setPersonPickerResult: (result: PersonPickerResult | null) => void;

  // Person picker callback for compose screen
  onPersonSelected: ((userId: string, name: string) => void) | null;
  setOnPersonSelected: (cb: ((userId: string, name: string) => void) | null) => void;

  // Stand out
  standOutResult: StandOutResult | null;
  setStandOutResult: (result: StandOutResult | null) => void;

  // Phase-1 Discover profile -> deck sync
  discoverProfileActionResult: DiscoverProfileActionResult | null;
  setDiscoverProfileActionResult: (result: DiscoverProfileActionResult | null) => void;
}

export const useInteractionStore = create<InteractionStore>((set) => ({
  composeResult: null,
  setComposeResult: (result) => set({ composeResult: result }),

  personPickerResult: null,
  setPersonPickerResult: (result) => set({ personPickerResult: result }),

  onPersonSelected: null,
  setOnPersonSelected: (cb) => set({ onPersonSelected: cb }),

  standOutResult: null,
  setStandOutResult: (result) => set({ standOutResult: result }),

  discoverProfileActionResult: null,
  setDiscoverProfileActionResult: (result) => set({ discoverProfileActionResult: result }),
}));
