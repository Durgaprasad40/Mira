/**
 * Cross-feature draggable FAB.
 *
 * The drag/snap/clamp/persist logic was first written for Phase-2 Truth or
 * Dare in `components/truthdare/DraggableTodFab.tsx`. This module re-exports
 * the same component under a feature-neutral name (`DraggableFab`) so other
 * surfaces — like Phase-1 Confess — can use it without reaching into the
 * `truthdare/` namespace and without duplicating drag logic.
 *
 * Behavior is identical to `DraggableTodFab`. Each consumer must pass a
 * distinct `storageKey` so positions never collide across surfaces.
 */
import { DraggableTodFab } from '@/components/truthdare/DraggableTodFab';

export const DraggableFab = DraggableTodFab;

/**
 * Persistence keys for surfaces that consume `DraggableFab`. Each key is
 * versioned so we can invalidate stored positions without conflating them
 * with a different surface's preferences.
 */
export const DRAGGABLE_FAB_STORAGE_KEYS = {
  /** Phase-1 Confess composer FAB on the main confessions tab. */
  confessComposer: 'mira:phase1-confess:fab:composer:v1',
} as const;
