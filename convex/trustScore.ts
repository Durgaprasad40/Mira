import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// Compute and update trust score for a user
export const computeTrustScore = mutation({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const { userId } = args;
    const now = Date.now();

    const user = await ctx.db.get(userId);
    if (!user) throw new Error("User not found");

    let score = 50; // Base

    // Positive factors
    if (user.verificationStatus === "verified") score += 20;
    else if (user.verificationStatus === "pending_verification") score += 10;
    if (user.emailVerified) score += 5;
    if (now - user.createdAt >= THIRTY_DAYS_MS) score += 5;

    // Check photos
    const photos = await ctx.db
      .query("photos")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const facePhotos = photos.filter((p) => p.hasFace && !p.isNsfw);
    if (facePhotos.length >= 3) score += 5;

    // Check bio
    if (user.bio && user.bio.length > 100) score += 5;

    // Check profile prompts
    if (user.profilePrompts && user.profilePrompts.length >= 2) score += 5;

    // Negative factors
    const fingerprint = await ctx.db
      .query("deviceFingerprints")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    if (fingerprint?.isMultiAccountFlagged) score -= 15;

    // Check reports
    const reports = await ctx.db
      .query("reports")
      .withIndex("by_reported_user", (q) => q.eq("reportedUserId", userId))
      .collect();

    const distinctReporters = new Set(reports.map((r) => r.reporterId));
    if (distinctReporters.size >= 3) score -= 10;

    // Check behavior flags
    const flags = await ctx.db
      .query("behaviorFlags")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const unresolvedFlags = flags.filter((f) => !f.resolvedAt);
    for (const flag of unresolvedFlags) {
      if (flag.severity === "high") score -= 10;
      else if (flag.severity === "medium") score -= 5;
    }

    // NSFW photos
    const nsfwPhotos = photos.filter((p) => p.isNsfw);
    if (nsfwPhotos.length > 0) score -= 5;

    // Clamp
    score = Math.max(0, Math.min(100, score));

    // Auto-flag if score drops too low
    if (score < 30) {
      const existingSuspicious = await ctx.db
        .query("behaviorFlags")
        .withIndex("by_user_type", (q) =>
          q.eq("userId", userId).eq("flagType", "suspicious_profile")
        )
        .first();

      if (!existingSuspicious) {
        await ctx.db.insert("behaviorFlags", {
          userId,
          flagType: "suspicious_profile",
          severity: "medium",
          description: `Trust score dropped to ${score}`,
          createdAt: now,
        });
      }
    }

    // Force security_only if below 15
    if (score < 15) {
      await ctx.db.patch(userId, {
        verificationEnforcementLevel: "security_only",
      });
    }

    // Update user
    await ctx.db.patch(userId, {
      trustScore: score,
      trustScoreUpdatedAt: now,
    });

    return { score };
  },
});

// Get trust score (internal query)
export const getTrustScore = query({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return null;
    return {
      score: user.trustScore ?? 50,
      updatedAt: user.trustScoreUpdatedAt,
    };
  },
});
