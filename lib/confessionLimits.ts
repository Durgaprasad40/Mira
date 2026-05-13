// Phase-1 Confess length rules.
// Keep these in sync with the matching constants at the top of
// convex/confessions.ts so frontend and backend agree on validation.
export const MIN_CONFESSION_LENGTH = 20;
export const MAX_CONFESSION_LENGTH = 800;

// User-facing validation messages (shared by composer + future surfaces).
export const CONFESSION_MIN_LENGTH_MESSAGE =
  `Write at least ${MIN_CONFESSION_LENGTH} characters to post.`;
export const CONFESSION_MAX_LENGTH_MESSAGE =
  `Confession must be ${MAX_CONFESSION_LENGTH} characters or less.`;
