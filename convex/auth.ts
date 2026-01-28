import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";

// Generate a random 6-digit OTP
function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Generate a random session token
function generateToken(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";
  for (let i = 0; i < 64; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

// Simple password hashing (in production, use bcrypt or similar)
// Using a simple hash for demo - NOT secure for production!
function hashPassword(password: string): string {
  // Simple hash function for demo purposes
  // In production, use a proper hashing library via an action
  let hash = 0;
  for (let i = 0; i < password.length; i++) {
    const char = password.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  // Add salt-like prefix and convert to string
  return "hash_" + Math.abs(hash).toString(36) + "_" + password.length;
}

function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash;
}

// Send OTP to email or phone
export const sendOTP = mutation({
  args: {
    identifier: v.string(),
    type: v.union(v.literal("email"), v.literal("phone")),
  },
  handler: async (ctx, args) => {
    const { identifier, type } = args;
    const now = Date.now();

    // Check for existing unexpired OTP
    const existingOTP = await ctx.db
      .query("otpCodes")
      .withIndex("by_identifier", (q) => q.eq("identifier", identifier))
      .filter((q) => q.gt(q.field("expiresAt"), now))
      .first();

    if (existingOTP) {
      // Rate limiting: don't send if OTP was sent in last 60 seconds
      if (now - existingOTP.createdAt < 60000) {
        throw new Error("Please wait before requesting another OTP");
      }
    }

    const code = generateOTP();
    const expiresAt = now + 10 * 60 * 1000; // 10 minutes

    await ctx.db.insert("otpCodes", {
      identifier,
      code,
      type,
      expiresAt,
      attempts: 0,
      createdAt: now,
    });

    // In production, integrate with email/SMS service
    console.log(`OTP for ${identifier}: ${code}`);

    return { success: true, message: "OTP sent successfully" };
  },
});

// Verify OTP
export const verifyOTP = mutation({
  args: {
    identifier: v.string(),
    code: v.string(),
  },
  handler: async (ctx, args) => {
    const { identifier, code } = args;
    const now = Date.now();

    const otpRecord = await ctx.db
      .query("otpCodes")
      .withIndex("by_identifier_code", (q) =>
        q.eq("identifier", identifier).eq("code", code),
      )
      .first();

    if (!otpRecord) {
      throw new Error("Invalid OTP");
    }

    if (otpRecord.expiresAt < now) {
      throw new Error("OTP has expired");
    }

    if (otpRecord.verifiedAt) {
      throw new Error("OTP already used");
    }

    if (otpRecord.attempts >= 3) {
      throw new Error("Too many attempts");
    }

    // Mark as verified
    await ctx.db.patch(otpRecord._id, {
      verifiedAt: now,
    });

    return { success: true, verified: true };
  },
});

// Register with email/password
export const registerWithEmail = mutation({
  args: {
    email: v.string(),
    password: v.string(),
    name: v.string(),
    dateOfBirth: v.string(),
    gender: v.union(
      v.literal("male"),
      v.literal("female"),
      v.literal("non_binary"),
      v.literal("other"),
    ),
  },
  handler: async (ctx, args) => {
    const { email, password, name, dateOfBirth, gender } = args;
    const now = Date.now();

    // Check if user already exists
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();

    if (existingUser) {
      throw new Error("Email already registered");
    }

    // Calculate trial end date (7 days from now)
    const trialEndsAt =
      gender === "male" ? now + 7 * 24 * 60 * 60 * 1000 : undefined;

    // Create user
    const userId = await ctx.db.insert("users", {
      email,
      passwordHash: hashPassword(password),
      authProvider: "email",
      name,
      dateOfBirth,
      gender,
      bio: "",
      isVerified: false,
      lookingFor: gender === "male" ? ["female"] : ["male"],
      relationshipIntent: [],
      activities: [],
      minAge: 18,
      maxAge: 50,
      maxDistance: 50,
      subscriptionTier: "free",
      trialEndsAt,
      incognitoMode: false,
      likesRemaining: gender === "female" ? 999999 : 50,
      superLikesRemaining: gender === "female" ? 999999 : 1,
      messagesRemaining: gender === "female" ? 999999 : 5,
      rewindsRemaining: gender === "female" ? 999999 : 0,
      boostsRemaining: gender === "female" ? 999999 : 0,
      likesResetAt: now + 24 * 60 * 60 * 1000,
      superLikesResetAt: now + 7 * 24 * 60 * 60 * 1000,
      messagesResetAt: now + 7 * 24 * 60 * 60 * 1000,
      lastActive: now,
      createdAt: now,
      onboardingCompleted: false,
      onboardingStep: "photo_upload",
      notificationsEnabled: false,
      isActive: true,
      isBanned: false,
    });

    // Create session
    const token = generateToken();
    await ctx.db.insert("sessions", {
      userId,
      token,
      expiresAt: now + 30 * 24 * 60 * 60 * 1000, // 30 days
      createdAt: now,
    });

    return {
      success: true,
      userId,
      token,
    };
  },
});

// Login with email/password
export const loginWithEmail = mutation({
  args: {
    email: v.string(),
    password: v.string(),
  },
  handler: async (ctx, args) => {
    const { email, password } = args;
    const now = Date.now();

    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();

    if (!user) {
      throw new Error("Invalid email or password");
    }

    if (!user.passwordHash || !verifyPassword(password, user.passwordHash)) {
      throw new Error("Invalid email or password");
    }

    if (user.isBanned) {
      throw new Error("Account has been suspended");
    }

    // Update last active
    await ctx.db.patch(user._id, { lastActive: now });

    // Create session
    const token = generateToken();
    await ctx.db.insert("sessions", {
      userId: user._id,
      token,
      expiresAt: now + 30 * 24 * 60 * 60 * 1000, // 30 days
      createdAt: now,
    });

    return {
      success: true,
      userId: user._id,
      token,
      onboardingCompleted: user.onboardingCompleted,
    };
  },
});

// Social auth (Google, Apple, Facebook)
export const socialAuth = mutation({
  args: {
    provider: v.union(
      v.literal("google"),
      v.literal("apple"),
      v.literal("facebook"),
    ),
    externalId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { provider, externalId, email, name } = args;
    const now = Date.now();

    // Check if user already exists with this external ID
    let user = await ctx.db
      .query("users")
      .withIndex("by_external_id", (q) => q.eq("externalId", externalId))
      .first();

    if (user) {
      // Existing user - update last active and create session
      await ctx.db.patch(user._id, { lastActive: now });

      const token = generateToken();
      await ctx.db.insert("sessions", {
        userId: user._id,
        token,
        expiresAt: now + 30 * 24 * 60 * 60 * 1000,
        createdAt: now,
      });

      return {
        success: true,
        userId: user._id,
        token,
        isNewUser: false,
        onboardingCompleted: user.onboardingCompleted,
      };
    }

    // Check if user exists with same email
    if (email) {
      user = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", email))
        .first();

      if (user) {
        // Link account
        await ctx.db.patch(user._id, {
          externalId,
          authProvider: provider,
          lastActive: now,
        });

        const token = generateToken();
        await ctx.db.insert("sessions", {
          userId: user._id,
          token,
          expiresAt: now + 30 * 24 * 60 * 60 * 1000,
          createdAt: now,
        });

        return {
          success: true,
          userId: user._id,
          token,
          isNewUser: false,
          onboardingCompleted: user.onboardingCompleted,
        };
      }
    }

    // New user - need to complete registration
    return {
      success: true,
      isNewUser: true,
      provider,
      externalId,
      email,
      name,
    };
  },
});

// Complete social auth registration
export const completeSocialAuth = mutation({
  args: {
    provider: v.union(
      v.literal("google"),
      v.literal("apple"),
      v.literal("facebook"),
    ),
    externalId: v.string(),
    email: v.optional(v.string()),
    name: v.string(),
    dateOfBirth: v.string(),
    gender: v.union(
      v.literal("male"),
      v.literal("female"),
      v.literal("non_binary"),
      v.literal("other"),
    ),
  },
  handler: async (ctx, args) => {
    const { provider, externalId, email, name, dateOfBirth, gender } = args;
    const now = Date.now();

    const trialEndsAt =
      gender === "male" ? now + 7 * 24 * 60 * 60 * 1000 : undefined;

    const userId = await ctx.db.insert("users", {
      email,
      externalId,
      authProvider: provider,
      name,
      dateOfBirth,
      gender,
      bio: "",
      isVerified: false,
      lookingFor: gender === "male" ? ["female"] : ["male"],
      relationshipIntent: [],
      activities: [],
      minAge: 18,
      maxAge: 50,
      maxDistance: 50,
      subscriptionTier: "free",
      trialEndsAt,
      incognitoMode: false,
      likesRemaining: gender === "female" ? 999999 : 50,
      superLikesRemaining: gender === "female" ? 999999 : 1,
      messagesRemaining: gender === "female" ? 999999 : 5,
      rewindsRemaining: gender === "female" ? 999999 : 0,
      boostsRemaining: gender === "female" ? 999999 : 0,
      likesResetAt: now + 24 * 60 * 60 * 1000,
      superLikesResetAt: now + 7 * 24 * 60 * 60 * 1000,
      messagesResetAt: now + 7 * 24 * 60 * 60 * 1000,
      lastActive: now,
      createdAt: now,
      onboardingCompleted: false,
      onboardingStep: "photo_upload",
      notificationsEnabled: false,
      isActive: true,
      isBanned: false,
    });

    const token = generateToken();
    await ctx.db.insert("sessions", {
      userId,
      token,
      expiresAt: now + 30 * 24 * 60 * 60 * 1000,
      createdAt: now,
    });

    return {
      success: true,
      userId,
      token,
    };
  },
});

// Validate session
export const validateSession = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const { token } = args;
    const now = Date.now();

    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();

    if (!session) {
      return { valid: false };
    }

    if (session.expiresAt < now) {
      return { valid: false, expired: true };
    }

    const user = await ctx.db.get(session.userId);
    if (!user || !user.isActive || user.isBanned) {
      return { valid: false };
    }

    return {
      valid: true,
      userId: session.userId,
      onboardingCompleted: user.onboardingCompleted,
    };
  },
});

// Logout
export const logout = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const { token } = args;

    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();

    if (session) {
      await ctx.db.delete(session._id);
    }

    return { success: true };
  },
});

// Logout all devices
export const logoutAll = mutation({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const { userId } = args;

    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    for (const session of sessions) {
      await ctx.db.delete(session._id);
    }

    return { success: true };
  },
});
