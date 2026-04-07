import type { Id } from "./_generated/dataModel";

/**
 * Safely cast a string to Convex Id<"users">.
 * Returns null if the input is empty/invalid-ish.
 * This is a runtime guard against accidental undefined/empty ids.
 * (We keep it permissive to avoid behavior changes.)
 */
export function asUserId(value: unknown): Id<"users"> | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v) return null;
  // Convex Ids are strings; we only guard against empty/whitespace.
  return v as Id<"users">;
}

/**
 * P0-001 FIX: Safely cast a string to Convex Id<"confessions">.
 * Returns null if the input is empty/invalid-ish.
 */
export function asConfessionId(value: unknown): Id<"confessions"> | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v) return null;
  return v as Id<"confessions">;
}

/**
 * P0-001 FIX: Safely cast a string to Convex Id<"confessionReplies">.
 * Returns null if the input is empty/invalid-ish.
 */
export function asReplyId(value: unknown): Id<"confessionReplies"> | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v) return null;
  return v as Id<"confessionReplies">;
}

/**
 * Safely cast a string to Convex Id<"confessionCommentConnects">.
 * Returns null if the input is empty/invalid-ish.
 */
export function asCommentConnectId(value: unknown): Id<"confessionCommentConnects"> | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v) return null;
  return v as Id<"confessionCommentConnects">;
}
