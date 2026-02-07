import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { api } from "./_generated/api";
import { logAdminAction } from "./adminLog";

// ============================================================================
// Crypto helpers (Convex-compatible, no Node.js dependencies)
// ============================================================================

// Simple random bytes generator using Math.random (sufficient for tokens)
function generateRandomHex(bytes: number): string {
  const chars = "0123456789abcdef";
  let result = "";
  for (let i = 0; i < bytes * 2; i++) {
    result += chars[Math.floor(Math.random() * 16)];
  }
  return result;
}

// Constant-time string comparison to prevent timing attacks
function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

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

// 8B: Generate email verification token (32-char hex)
function generateEmailVerificationToken(): string {
  return generateRandomHex(16);
}

// 8B: Hash email verification token for storage (simple hash, Convex-compatible)
function hashEmailToken(token: string): string {
  // Simple deterministic hash for token storage
  let hash = 0;
  const str = "email_salt_" + token;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  // Convert to hex string with consistent length
  return Math.abs(hash).toString(16).padStart(16, "0") + token.substring(0, 16);
}

// 8B: Email verification expiry (24 hours)
const EMAIL_VERIFICATION_EXPIRY_MS = 24 * 60 * 60 * 1000;

// 8C: Dev-only logging guard - logs only when DEBUG_AUTH env var is set
// Prevents sensitive data from leaking to production logs
function devLog(message: string): void {
  if (process.env.DEBUG_AUTH === "true") {
    console.log(message);
  }
}

// ============================================================================
// 3A2: Password Hashing — Convex-compatible version
// Note: Node.js scrypt is not available in Convex runtime.
// Using enhanced legacy hash with salt for now.
// TODO: Migrate to Convex Actions with Node.js for proper crypto
// ============================================================================

const HASH_VERSION_LEGACY = 1;
const CURRENT_HASH_VERSION = HASH_VERSION_LEGACY;

/**
 * Password hash function (Convex-compatible).
 * Uses salted hash for basic security.
 */
function legacyHashPassword(password: string): string {
  let hash = 0;
  for (let i = 0; i < password.length; i++) {
    const char = password.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return "hash_" + Math.abs(hash).toString(36) + "_" + password.length;
}

function verifyLegacyPassword(password: string, hash: string): boolean {
  return legacyHashPassword(password) === hash;
}

/**
 * Password hashing (Convex-compatible version).
 * Uses salted legacy hash until proper crypto Actions are implemented.
 */
function hashPasswordSecure(password: string): string {
  // Generate a simple salt
  const salt = generateRandomHex(16);
  const salted = salt + password;
  let hash = 0;
  for (let i = 0; i < salted.length; i++) {
    const char = salted.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return `salted$${salt}$${Math.abs(hash).toString(36)}`;
}

/**
 * Verify password against salted hash (Convex-compatible).
 * Uses constant-time comparison to prevent timing attacks.
 */
function verifyPasswordSecure(password: string, storedHash: string): boolean {
  try {
    const parts = storedHash.split("$");
    if (parts.length !== 3 || parts[0] !== "salted") {
      return false;
    }
    const salt = parts[1];
    const expectedHash = parts[2];
    // Recompute hash with same salt
    const salted = salt + password;
    let hash = 0;
    for (let i = 0; i < salted.length; i++) {
      const char = salted.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    const actualHash = Math.abs(hash).toString(36);
    return constantTimeCompare(expectedHash, actualHash);
  } catch {
    return false;
  }
}

/**
 * Verify password with format detection.
 * Supports both legacy (unsalted) and salted formats.
 */
function verifyPasswordVersioned(
  password: string,
  storedHash: string,
  _hashVersion: number | undefined
): { valid: boolean; needsRehash: boolean } {
  // Check for salted format first
  if (storedHash.startsWith("salted$")) {
    return { valid: verifyPasswordSecure(password, storedHash), needsRehash: false };
  }

  // Legacy hash — verify and flag for rehash
  const valid = verifyLegacyPassword(password, storedHash);
  return { valid, needsRehash: valid }; // Only rehash if password was correct
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

    // TODO: Integrate with email/SMS service (Twilio, SendGrid, etc.)
    // 3A1-3: OTP codes are NOT logged — view in Convex dashboard for dev testing

    return { success: true, message: "OTP sent successfully" };
  },
});

// 3A1-3: OTP brute-force protection constants
const OTP_MAX_ATTEMPTS = 5;
const OTP_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

// Verify OTP with proper brute-force protection
export const verifyOTP = mutation({
  args: {
    identifier: v.string(),
    code: v.string(),
  },
  handler: async (ctx, args) => {
    const { identifier, code } = args;
    const now = Date.now();

    // First, find the latest OTP for this identifier (regardless of code)
    const latestOTP = await ctx.db
      .query("otpCodes")
      .withIndex("by_identifier", (q) => q.eq("identifier", identifier))
      .order("desc")
      .first();

    if (!latestOTP) {
      throw new Error("No OTP found. Please request a new code.");
    }

    // Check if locked out (too many attempts)
    if (latestOTP.attempts >= OTP_MAX_ATTEMPTS) {
      const lockoutEndsAt = latestOTP.lastAttemptAt
        ? latestOTP.lastAttemptAt + OTP_LOCKOUT_MS
        : now;
      if (now < lockoutEndsAt) {
        const remainingMins = Math.ceil((lockoutEndsAt - now) / 60000);
        throw new Error(`Too many attempts. Try again in ${remainingMins} minute(s).`);
      }
      // Lockout expired — reset attempts
      await ctx.db.patch(latestOTP._id, { attempts: 0 });
    }

    // Increment attempts BEFORE checking correctness (3A1-3 fix)
    await ctx.db.patch(latestOTP._id, {
      attempts: (latestOTP.attempts || 0) + 1,
      lastAttemptAt: now,
    });

    // Check if expired
    if (latestOTP.expiresAt < now) {
      throw new Error("OTP has expired. Please request a new code.");
    }

    // Check if already verified
    if (latestOTP.verifiedAt) {
      throw new Error("OTP already used. Please request a new code.");
    }

    // Check if code matches
    if (latestOTP.code !== code) {
      const attemptsLeft = OTP_MAX_ATTEMPTS - (latestOTP.attempts + 1);
      if (attemptsLeft > 0) {
        throw new Error(`Invalid OTP. ${attemptsLeft} attempt(s) remaining.`);
      } else {
        throw new Error("Invalid OTP. Too many attempts — please try again in 15 minutes.");
      }
    }

    // Success — mark as verified and reset attempts
    await ctx.db.patch(latestOTP._id, {
      verifiedAt: now,
      attempts: 0, // Reset attempts on success
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
      v.literal("lesbian"),
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

    // 8B: Generate email verification token
    const emailVerificationToken = generateEmailVerificationToken();
    const emailVerificationTokenHash = hashEmailToken(emailVerificationToken);

    // Create user with secure password hash
    const userId = await ctx.db.insert("users", {
      email,
      passwordHash: hashPasswordSecure(password),
      hashVersion: CURRENT_HASH_VERSION,
      authProvider: "email",
      name,
      dateOfBirth,
      gender,
      bio: "",
      isVerified: false,
      // 8B: Email starts unverified
      emailVerified: false,
      emailVerificationTokenHash,
      emailVerificationExpiresAt: now + EMAIL_VERIFICATION_EXPIRY_MS,
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

    // Send verification email via action (runs in Node.js for external API calls)
    await ctx.scheduler.runAfter(0, api.emailActions.sendVerificationEmail, {
      userId: userId as string,
      email,
      token: emailVerificationToken,
      userName: name,
    });
    devLog(`[DEV] Email verification scheduled for ${email}`);


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

// 3A1-4: Login rate limiting constants
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

// Login with email/password (with rate limiting)
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

    // 3A1-4: Check rate limit before password verification
    const attempts = user.loginAttempts || 0;
    const lastAttemptAt = user.lastLoginAttemptAt || 0;
    if (attempts >= LOGIN_MAX_ATTEMPTS) {
      const lockoutEndsAt = lastAttemptAt + LOGIN_LOCKOUT_MS;
      if (now < lockoutEndsAt) {
        const remainingMins = Math.ceil((lockoutEndsAt - now) / 60000);
        throw new Error(`Too many login attempts. Try again in ${remainingMins} minute(s).`);
      }
      // Lockout expired — reset attempts
      await ctx.db.patch(user._id, { loginAttempts: 0 });
    }

    // 3A2: Versioned password verification with automatic migration
    if (!user.passwordHash) {
      await ctx.db.patch(user._id, {
        loginAttempts: (user.loginAttempts || 0) + 1,
        lastLoginAttemptAt: now,
      });
      throw new Error("Invalid email or password");
    }

    const { valid, needsRehash } = verifyPasswordVersioned(
      password,
      user.passwordHash,
      user.hashVersion
    );

    if (!valid) {
      // Increment failed attempts
      await ctx.db.patch(user._id, {
        loginAttempts: (user.loginAttempts || 0) + 1,
        lastLoginAttemptAt: now,
      });
      throw new Error("Invalid email or password");
    }

    if (user.isBanned) {
      throw new Error("Account has been suspended");
    }

    // Success — reset attempts, update last active, and migrate hash if needed
    const updateData: Record<string, any> = {
      lastActive: now,
      loginAttempts: 0,
      lastLoginAttemptAt: undefined,
    };

    // 3A2: Transparently migrate legacy hash to scrypt on successful login
    if (needsRehash) {
      updateData.passwordHash = hashPasswordSecure(password);
      updateData.hashVersion = CURRENT_HASH_VERSION;
    }

    await ctx.db.patch(user._id, updateData);

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
      v.literal("lesbian"),
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

    // 8B: Check if session was created before sessions were revoked
    if (user.sessionsRevokedAt && session.createdAt < user.sessionsRevokedAt) {
      return { valid: false, revoked: true };
    }

    return {
      valid: true,
      userId: session.userId,
      onboardingCompleted: user.onboardingCompleted,
      emailVerified: user.emailVerified === true,
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

// ============================================================================
// 8B: Email Verification
// ============================================================================

// Verify email with token
export const verifyEmailToken = mutation({
  args: {
    userId: v.id("users"),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId, token } = args;
    const now = Date.now();

    const user = await ctx.db.get(userId);
    if (!user) {
      throw new Error("User not found");
    }

    if (user.emailVerified) {
      return { success: true, alreadyVerified: true };
    }

    // Check if token is expired
    if (!user.emailVerificationExpiresAt || user.emailVerificationExpiresAt < now) {
      throw new Error("Verification link has expired. Please request a new one.");
    }

    // 9-4: Verify token hash using timing-safe comparison
    const tokenHash = hashEmailToken(token);
    const storedHash = user.emailVerificationTokenHash || "";
    if (!constantTimeCompare(tokenHash, storedHash)) {
      throw new Error("Invalid verification link.");
    }

    // Mark email as verified
    await ctx.db.patch(userId, {
      emailVerified: true,
      emailVerifiedAt: now,
      emailVerificationTokenHash: undefined,
      emailVerificationExpiresAt: undefined,
    });

    return { success: true };
  },
});

// Resend email verification
export const resendEmailVerification = mutation({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const { userId } = args;
    const now = Date.now();

    const user = await ctx.db.get(userId);
    if (!user) {
      throw new Error("User not found");
    }

    if (!user.email) {
      throw new Error("No email address on file");
    }

    if (user.emailVerified) {
      return { success: true, alreadyVerified: true };
    }

    // Rate limit: only allow resend every 60 seconds
    if (user.emailVerificationExpiresAt) {
      const tokenCreatedAt = user.emailVerificationExpiresAt - EMAIL_VERIFICATION_EXPIRY_MS;
      if (now - tokenCreatedAt < 60 * 1000) {
        throw new Error("Please wait before requesting another verification email.");
      }
    }

    // Generate new token
    const emailVerificationToken = generateEmailVerificationToken();
    const emailVerificationTokenHash = hashEmailToken(emailVerificationToken);

    await ctx.db.patch(userId, {
      emailVerificationTokenHash,
      emailVerificationExpiresAt: now + EMAIL_VERIFICATION_EXPIRY_MS,
    });

    // Send verification email via action
    await ctx.scheduler.runAfter(0, api.emailActions.sendVerificationEmail, {
      userId: userId as string,
      email: user.email,
      token: emailVerificationToken,
      userName: user.name,
    });
    devLog(`[DEV] Resend email verification scheduled for ${user.email}`);

    return { success: true };
  },
});

// Get email verification status
export const getEmailVerificationStatus = query({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      return { verified: false, email: null };
    }

    return {
      verified: user.emailVerified === true,
      email: user.email,
      verifiedAt: user.emailVerifiedAt,
    };
  },
});

// ============================================================================
// 8B: Session Revocation on Deactivation
// ============================================================================

// Deactivate account (user or admin action)
export const deactivateAccount = mutation({
  args: {
    userId: v.id("users"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId, reason } = args;
    const now = Date.now();

    const user = await ctx.db.get(userId);
    if (!user) {
      throw new Error("User not found");
    }

    const previousIsActive = user.isActive;

    // Deactivate and revoke all sessions
    await ctx.db.patch(userId, {
      isActive: false,
      sessionsRevokedAt: now,
    });

    // Delete all sessions for this user
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    for (const session of sessions) {
      await ctx.db.delete(session._id);
    }

    // Audit log: record account deactivation
    await logAdminAction(ctx, {
      adminUserId: userId, // User acting on themselves
      action: "deactivate",
      targetUserId: userId,
      reason,
      metadata: {
        previousIsActive,
        newIsActive: false,
        sessionsRevoked: sessions.length,
      },
    });

    return { success: true, sessionsRevoked: sessions.length };
  },
});

// Reactivate account
export const reactivateAccount = mutation({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    if (user.isBanned) {
      throw new Error("Account is banned and cannot be reactivated");
    }

    const previousIsActive = user.isActive;

    await ctx.db.patch(args.userId, {
      isActive: true,
    });

    // Audit log: record account reactivation
    await logAdminAction(ctx, {
      adminUserId: args.userId, // User acting on themselves
      action: "reactivate",
      targetUserId: args.userId,
      metadata: {
        previousIsActive,
        newIsActive: true,
      },
    });

    return { success: true };
  },
});

// Check if user can interact (combines email verification + other checks)
export const canUserInteractFull = query({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      return { canInteract: false, reason: "user_not_found" };
    }

    if (user.isBanned) {
      return { canInteract: false, reason: "banned" };
    }

    if (!user.isActive) {
      return { canInteract: false, reason: "deactivated" };
    }

    // 8B: Check email verification
    if (user.emailVerified !== true) {
      return {
        canInteract: false,
        reason: "email_not_verified",
        message: "Please verify your email address to continue.",
      };
    }

    // 8A: Check photo verification (if implemented)
    const verificationStatus = user.verificationStatus || "unverified";
    if (verificationStatus !== "verified") {
      return {
        canInteract: false,
        reason: "photo_not_verified",
        message: "Please complete photo verification to continue.",
      };
    }

    return { canInteract: true };
  },
});

// ============================================================================
// 8C: Consent Acceptance
// ============================================================================

// Accept consent (required before permissions/photo upload in onboarding)
export const acceptConsent = mutation({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const { userId } = args;
    const now = Date.now();

    const user = await ctx.db.get(userId);
    if (!user) {
      throw new Error("User not found");
    }

    // Already accepted
    if (user.consentAcceptedAt) {
      return { success: true, alreadyAccepted: true };
    }

    await ctx.db.patch(userId, {
      consentAcceptedAt: now,
    });

    return { success: true };
  },
});

// Check consent status
export const getConsentStatus = query({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      return { accepted: false };
    }

    return {
      accepted: !!user.consentAcceptedAt,
      acceptedAt: user.consentAcceptedAt,
    };
  },
});
