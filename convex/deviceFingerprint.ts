import { v } from "convex/values";
import { mutation } from "./_generated/server";

// Register device fingerprint and check for multi-account
export const registerDeviceFingerprint = mutation({
  args: {
    userId: v.id("users"),
    deviceId: v.string(),
    platform: v.string(),
    osVersion: v.string(),
    appVersion: v.string(),
    installId: v.string(),
    deviceModel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId, deviceId, platform, osVersion, appVersion, installId, deviceModel } = args;
    const now = Date.now();

    // Check if this user already has a fingerprint
    const existingForUser = await ctx.db
      .query("deviceFingerprints")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    if (existingForUser) {
      // Update last seen
      await ctx.db.patch(existingForUser._id, {
        lastSeenAt: now,
        osVersion,
        appVersion,
      });
      return { fingerprintId: existingForUser._id, isMultiAccountFlagged: existingForUser.isMultiAccountFlagged };
    }

    // Check if deviceId or installId already exists for a different user
    const existingByDevice = await ctx.db
      .query("deviceFingerprints")
      .withIndex("by_device_id", (q) => q.eq("deviceId", deviceId))
      .collect();

    const existingByInstall = await ctx.db
      .query("deviceFingerprints")
      .withIndex("by_install_id", (q) => q.eq("installId", installId))
      .collect();

    const otherUserFingerprints = [
      ...existingByDevice.filter((f) => f.userId !== userId),
      ...existingByInstall.filter((f) => f.userId !== userId),
    ];

    let isMultiAccountFlagged = false;

    if (otherUserFingerprints.length > 0) {
      isMultiAccountFlagged = true;

      // Flag both users
      const linkedUserIds = [...new Set(otherUserFingerprints.map((f) => f.userId))];

      // Flag existing fingerprints
      for (const fp of otherUserFingerprints) {
        if (!fp.isMultiAccountFlagged) {
          await ctx.db.patch(fp._id, {
            isMultiAccountFlagged: true,
            linkedUserIds: [userId],
          });
        }

        // Insert behavior flag for the other user
        const existingFlag = await ctx.db
          .query("behaviorFlags")
          .withIndex("by_user_type", (q) =>
            q.eq("userId", fp.userId).eq("flagType", "rapid_account_creation")
          )
          .first();

        if (!existingFlag) {
          await ctx.db.insert("behaviorFlags", {
            userId: fp.userId,
            flagType: "rapid_account_creation",
            severity: "medium",
            description: "Multiple accounts detected from same device",
            createdAt: now,
          });

          // Adjust trust score
          const otherUser = await ctx.db.get(fp.userId);
          if (otherUser && otherUser.trustScore !== undefined) {
            await ctx.db.patch(fp.userId, {
              trustScore: Math.max(0, (otherUser.trustScore || 50) - 15),
              trustScoreUpdatedAt: now,
            });
          }
        }
      }

      // Insert behavior flag for current user
      await ctx.db.insert("behaviorFlags", {
        userId,
        flagType: "rapid_account_creation",
        severity: "medium",
        description: "Multiple accounts detected from same device",
        createdAt: now,
      });

      // Adjust trust score for current user
      const currentUser = await ctx.db.get(userId);
      if (currentUser && currentUser.trustScore !== undefined) {
        await ctx.db.patch(userId, {
          trustScore: Math.max(0, (currentUser.trustScore || 50) - 15),
          trustScoreUpdatedAt: now,
        });
      }
    }

    // Create fingerprint record
    const fingerprintId = await ctx.db.insert("deviceFingerprints", {
      userId,
      deviceId,
      platform,
      osVersion,
      appVersion,
      installId,
      deviceModel,
      isMultiAccountFlagged,
      linkedUserIds: isMultiAccountFlagged
        ? [...new Set(otherUserFingerprints.map((f) => f.userId))]
        : undefined,
      createdAt: now,
      lastSeenAt: now,
    });

    // Set as primary device
    await ctx.db.patch(userId, { primaryDeviceFingerprintId: fingerprintId });

    return { fingerprintId, isMultiAccountFlagged };
  },
});

// Update device last seen
export const updateDeviceLastSeen = mutation({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const fingerprint = await ctx.db
      .query("deviceFingerprints")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();

    if (fingerprint) {
      await ctx.db.patch(fingerprint._id, { lastSeenAt: Date.now() });
    }

    return { success: true };
  },
});
