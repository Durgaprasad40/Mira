// Phase-1 Confess blur-photo intensity.
// Shared by ConfessionCard, the Confess feed (trending + my-confession),
// and the confession thread so blurred identities read consistently across
// every Confess surface. Slightly softer than the previous local 20/24 so
// the photo stays private but is still gently visible.
//
// IMPORTANT: This constant is Confess-specific. Truth or Dare uses its own
// BLUR_PHOTO_RADIUS in components/truthdare/TodAvatar.tsx and must remain
// independent — do not import this constant there.
export const CONFESSION_BLUR_PHOTO_RADIUS = 17;
