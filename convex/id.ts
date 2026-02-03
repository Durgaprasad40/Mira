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
