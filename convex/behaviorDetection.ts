import { v } from "convex/values";
import { mutation } from "./_generated/server";

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

// Check for rapid swiping behavior
export const checkSwipeBehavior = mutation({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const { userId } = args;
    const now = Date.now();
    const fiveMinAgo = now - FIVE_MINUTES_MS;

    // Count recent swipes
    const recentSwipes = await ctx.db
      .query("likes")
      .withIndex("by_from_user", (q) => q.eq("fromUserId", userId))
      .collect();

    const recentCount = recentSwipes.filter(
      (s) => s.createdAt > fiveMinAgo
    ).length;

    if (recentCount > 100) {
      // Check if already flagged recently
      const existingFlag = await ctx.db
        .query("behaviorFlags")
        .withIndex("by_user_type", (q) =>
          q.eq("userId", userId).eq("flagType", "rapid_swiping")
        )
        .collect();

      const recentFlag = existingFlag.find(
        (f) => now - f.createdAt < ONE_HOUR_MS
      );

      if (!recentFlag) {
        await ctx.db.insert("behaviorFlags", {
          userId,
          flagType: "rapid_swiping",
          severity: "medium",
          description: `${recentCount} swipes in 5 minutes`,
          createdAt: now,
        });
      }

      return { flagged: true, count: recentCount };
    }

    return { flagged: false, count: recentCount };
  },
});

// Check for mass messaging behavior
export const checkMessageBehavior = mutation({
  args: {
    userId: v.id("users"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId, content } = args;
    const now = Date.now();
    const oneHourAgo = now - ONE_HOUR_MS;

    // Get recent messages from this user
    const conversations = await ctx.db
      .query("conversations")
      .collect();

    const userConversations = conversations.filter((c) =>
      c.participants.includes(userId)
    );

    let identicalCount = 0;

    for (const conv of userConversations) {
      const messages = await ctx.db
        .query("messages")
        .withIndex("by_conversation", (q) =>
          q.eq("conversationId", conv._id)
        )
        .collect();

      const recentFromUser = messages.filter(
        (m) =>
          m.senderId === userId &&
          m.createdAt > oneHourAgo &&
          m.content === content
      );

      identicalCount += recentFromUser.length;
    }

    if (identicalCount >= 20) {
      await ctx.db.insert("behaviorFlags", {
        userId,
        flagType: "mass_messaging",
        severity: "high",
        description: `${identicalCount} identical messages in 1 hour`,
        createdAt: now,
      });

      // Force security_only
      await ctx.db.patch(userId, {
        verificationEnforcementLevel: "security_only",
      });

      return { flagged: true, count: identicalCount };
    }

    return { flagged: false, count: identicalCount };
  },
});

// Check report threshold
export const checkReportThreshold = mutation({
  args: {
    reportedUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const { reportedUserId } = args;
    const now = Date.now();

    const reports = await ctx.db
      .query("reports")
      .withIndex("by_reported_user", (q) =>
        q.eq("reportedUserId", reportedUserId)
      )
      .collect();

    const distinctReporters = new Set(reports.map((r) => r.reporterId));

    if (distinctReporters.size >= 3) {
      const existingFlag = await ctx.db
        .query("behaviorFlags")
        .withIndex("by_user_type", (q) =>
          q
            .eq("userId", reportedUserId)
            .eq("flagType", "reported_by_multiple")
        )
        .first();

      if (!existingFlag) {
        await ctx.db.insert("behaviorFlags", {
          userId: reportedUserId,
          flagType: "reported_by_multiple",
          severity: distinctReporters.size >= 5 ? "high" : "medium",
          description: `Reported by ${distinctReporters.size} distinct users`,
          createdAt: now,
        });
      }

      if (distinctReporters.size >= 5) {
        await ctx.db.patch(reportedUserId, {
          verificationEnforcementLevel: "security_only",
        });
      }

      return { flagged: true, reporters: distinctReporters.size };
    }

    return { flagged: false, reporters: distinctReporters.size };
  },
});
