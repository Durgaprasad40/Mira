"use node";

import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";

// Response shape returned by `linkOrCreateGoogleSession`. Declared locally
// (rather than imported via FunctionReturnType) so the action's return type
// can be annotated without triggering TS's circular-inference guard.
type GoogleSessionResult = {
  success: true;
  userId: Id<"users">;
  token: string;
  isNewUser: boolean;
  onboardingCompleted: boolean;
};

// =============================================================================
// Google Sign-In — Convex Node action (server-side ID-token verification).
//
// SAFETY MODEL
//   The client passes ONLY the raw Google ID token. We never accept an
//   `externalId` from the client. The verified `sub` claim is the only
//   stable identifier used downstream. This replaces the legacy
//   `auth.socialAuth({ provider: "google", externalId, ... })` flow, which
//   trusted the client and is now blocked at the public mutation layer.
//
// VERIFICATION
//   1. Send the token to Google's `tokeninfo` endpoint. Google internally
//      validates the JWT signature, structure, and `exp` and returns a
//      non-2xx response for anything invalid.
//   2. On 200, we re-enforce: `iss`, `aud`, `email_verified`, and a
//      non-empty `sub`. We also re-check `exp` with a small skew tolerance
//      as a defense-in-depth measure.
//
// REMAINING RISK
//   tokeninfo is rate-limited and adds an outbound HTTP hop per sign-in.
//   For production hardening, switch to local JWKS-based RS256 verification.
// =============================================================================

const VALID_ISSUERS = new Set([
  "accounts.google.com",
  "https://accounts.google.com",
]);

const TOKEN_INFO_ENDPOINT =
  "https://oauth2.googleapis.com/tokeninfo?id_token=";

const EXPIRY_SKEW_MS = 30_000;

interface GoogleTokenInfo {
  aud?: string;
  iss?: string;
  sub?: string;
  email?: string;
  // tokeninfo returns this as a string "true" / "false".
  email_verified?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  exp?: string;
}

export const signInWithGoogleIdToken = action({
  args: {
    idToken: v.string(),
  },
  handler: async (ctx, { idToken }): Promise<GoogleSessionResult> => {
    // Cheap structural rejection before we hit the network. Real Google ID
    // tokens are JWTs (well over 100 chars). 8 KiB is a generous upper bound.
    if (
      typeof idToken !== "string" ||
      idToken.length < 50 ||
      idToken.length > 8192
    ) {
      throw new Error("Invalid request");
    }

    const allowedAudiences = [
      process.env.GOOGLE_WEB_CLIENT_ID,
      process.env.GOOGLE_ANDROID_CLIENT_ID,
      process.env.GOOGLE_IOS_CLIENT_ID,
    ].filter((x): x is string => typeof x === "string" && x.length > 0);

    if (allowedAudiences.length === 0) {
      throw new Error(
        "Server misconfigured: Google OAuth client IDs are not set",
      );
    }

    let response: Response;
    try {
      response = await fetch(
        TOKEN_INFO_ENDPOINT + encodeURIComponent(idToken),
        { method: "GET" },
      );
    } catch {
      throw new Error("Google verification unavailable");
    }

    if (!response.ok) {
      // Google rejected the token (bad signature, expired, malformed, etc.).
      throw new Error("Google sign-in failed: token rejected");
    }

    let info: GoogleTokenInfo;
    try {
      info = (await response.json()) as GoogleTokenInfo;
    } catch {
      throw new Error("Google sign-in failed: bad response");
    }

    // Issuer must be Google.
    if (!info.iss || !VALID_ISSUERS.has(info.iss)) {
      throw new Error("Google sign-in failed: invalid issuer");
    }

    // Audience must be one of OUR registered Google client IDs.
    if (!info.aud || !allowedAudiences.includes(info.aud)) {
      throw new Error("Google sign-in failed: invalid audience");
    }

    // Expiry — belt-and-braces. tokeninfo also enforces this.
    if (info.exp) {
      const expSec = Number(info.exp);
      if (
        Number.isFinite(expSec) &&
        expSec * 1000 < Date.now() - EXPIRY_SKEW_MS
      ) {
        throw new Error("Google sign-in failed: token expired");
      }
    }

    // Subject — Google's stable user ID.
    if (
      !info.sub ||
      typeof info.sub !== "string" ||
      info.sub.length === 0
    ) {
      throw new Error("Google sign-in failed: missing subject");
    }

    // Email must be present and verified by Google. We use it for
    // cross-provider account linking against existing rows in `users`.
    if (!info.email || info.email_verified !== "true") {
      throw new Error("Google sign-in failed: email not verified");
    }

    const externalId = info.sub;
    const email = info.email.toLowerCase().trim();
    const name =
      (typeof info.name === "string" && info.name.trim()) ||
      (typeof info.given_name === "string" && info.given_name.trim()) ||
      undefined;

    const result: GoogleSessionResult = await ctx.runMutation(
      internal.googleAuthInternal.linkOrCreateGoogleSession,
      { externalId, email, name },
    );

    return result;
  },
});
