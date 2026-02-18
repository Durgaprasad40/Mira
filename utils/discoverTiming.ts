/**
 * discoverTiming — Performance measurement for Discover feed
 *
 * Tracks key milestones:
 * - DISCOVER_MOUNT: Component mounted
 * - FIRST_CARDS_RENDERED: First cards visible
 * - FIRST_IMAGE_LOADED: First card image loaded
 *
 * Prints PERCEIVED_SPEED_REPORT after both cards rendered and first image loaded.
 */

type DiscoverMilestone =
  | 'discover_mount'
  | 'first_cards_rendered'
  | 'first_image_loaded'
  | 'images_preloaded';

interface DiscoverTimingState {
  times: Partial<Record<DiscoverMilestone, number>>;
  mountTime: number | null;
  reportPrinted: boolean;
  cardsRenderedCount: number;
  imageLoadedCount: number;
}

const state: DiscoverTimingState = {
  times: {},
  mountTime: null,
  reportPrinted: false,
  cardsRenderedCount: 0,
  imageLoadedCount: 0,
};

/**
 * Mark a Discover timing milestone.
 */
export function markDiscoverTiming(milestone: DiscoverMilestone): void {
  if (state.times[milestone]) return; // Already marked

  const now = Date.now();
  state.times[milestone] = now;

  if (milestone === 'discover_mount') {
    state.mountTime = now;
  }

  if (__DEV__) {
    const elapsed = state.mountTime ? now - state.mountTime : 0;
    console.log(`[DISCOVER_TIMING] ${milestone} @ +${elapsed}ms`);
  }

  // Try to print report after key milestones
  tryPrintReport();
}

/**
 * Increment cards rendered count and mark milestone when first batch done.
 */
export function markCardRendered(): void {
  state.cardsRenderedCount++;
  if (state.cardsRenderedCount === 2 && !state.times.first_cards_rendered) {
    markDiscoverTiming('first_cards_rendered');
  }
}

/**
 * Increment image loaded count and mark milestone on first load.
 */
export function markImageLoaded(): void {
  state.imageLoadedCount++;
  if (state.imageLoadedCount === 1) {
    markDiscoverTiming('first_image_loaded');
  }
}

/**
 * Print the PERCEIVED_SPEED_REPORT once conditions are met.
 */
function tryPrintReport(): void {
  if (state.reportPrinted) return;
  if (!__DEV__) return;

  const t = state.times;
  const mount = state.mountTime;

  // Wait until we have first cards + first image
  if (!t.first_cards_rendered || !t.first_image_loaded || !mount) return;

  state.reportPrinted = true;

  const report = {
    mount_to_cards: t.first_cards_rendered - mount,
    mount_to_first_image: t.first_image_loaded - mount,
    cards_to_image: t.first_image_loaded - t.first_cards_rendered,
    total_perceived: t.first_image_loaded - mount,
  };

  console.log('='.repeat(50));
  console.log('PERCEIVED_SPEED_REPORT (Discover)');
  console.log('='.repeat(50));
  console.log(`  mount_to_cards: ${report.mount_to_cards}ms`);
  console.log(`  mount_to_first_image: ${report.mount_to_first_image}ms`);
  console.log(`  cards_to_image: ${report.cards_to_image}ms`);
  console.log(`  total_perceived: ${report.total_perceived}ms`);
  console.log('='.repeat(50));
}

/**
 * Get current timing data for external use.
 */
export function getDiscoverTimingReport(): Record<string, number | string> {
  const t = state.times;
  const mount = state.mountTime ?? 0;

  return {
    mount_to_cards: t.first_cards_rendered ? t.first_cards_rendered - mount : '-',
    mount_to_first_image: t.first_image_loaded ? t.first_image_loaded - mount : '-',
    total_perceived: t.first_image_loaded ? t.first_image_loaded - mount : '-',
    cards_rendered: state.cardsRenderedCount,
    images_loaded: state.imageLoadedCount,
  };
}

/**
 * Reset timing state (for testing or re-navigation).
 */
export function resetDiscoverTiming(): void {
  state.times = {};
  state.mountTime = null;
  state.reportPrinted = false;
  state.cardsRenderedCount = 0;
  state.imageLoadedCount = 0;
}
