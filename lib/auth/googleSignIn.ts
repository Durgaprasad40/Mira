// =============================================================================
// useGoogleSignIn — client hook for "Continue with Google".
//
// Responsibilities:
//   1. Wrap `expo-auth-session/providers/google` so the rest of the app does
//      not have to know about the request/response plumbing.
//   2. Read the three OAuth client IDs (web/android/ios) from
//      `expo-constants` extras so they are never hard-coded.
//   3. Drive the native sign-in popup and return a clean discriminated
//      union { success | cancel | error } that the onboarding screen can
//      switch on.
//
// SAFETY:
//   This hook deliberately exposes ONLY the Google ID token. The token is
//   then sent to the Convex Node action `googleAuth.signInWithGoogleIdToken`,
//   which performs the actual identity verification (issuer / audience /
//   expiry / email_verified / non-empty sub) before it will create or link
//   a Mira account. The client never claims any identity itself.
// =============================================================================

import { useCallback, useMemo } from "react";
import Constants from "expo-constants";
import * as WebBrowser from "expo-web-browser";
import * as Google from "expo-auth-session/providers/google";

// Allow the auth-session popup to dismiss cleanly when the user returns to
// the app. Idempotent and safe to call on every import.
WebBrowser.maybeCompleteAuthSession();

export type GoogleSignInResult =
  | { type: "success"; idToken: string }
  | { type: "cancel" }
  | { type: "error"; message: string };

interface GoogleAuthExtra {
  webClientId?: string;
  androidClientId?: string;
  iosClientId?: string;
}

function readGoogleAuthExtras(): GoogleAuthExtra {
  // `expoConfig` is the runtime-resolved app.config.ts. `manifest2` is the EAS
  // updates shape. Either one may carry the extras depending on how the app
  // was launched (dev client vs production). We read both defensively.
  const extra =
    (Constants.expoConfig?.extra as { googleAuth?: GoogleAuthExtra } | undefined)
      ?.googleAuth ??
    (((Constants as unknown) as {
      manifest2?: { extra?: { expoClient?: { extra?: { googleAuth?: GoogleAuthExtra } } } };
    }).manifest2?.extra?.expoClient?.extra?.googleAuth);

  return extra ?? {};
}

export function useGoogleSignIn() {
  const extras = useMemo(readGoogleAuthExtras, []);

  const [request, response, promptAsync] = Google.useAuthRequest({
    webClientId: extras.webClientId,
    androidClientId: extras.androidClientId,
    iosClientId: extras.iosClientId,
    // We only need identity — never any Google API scope. Email comes back
    // inside the verified ID token as a claim. Asking for less is safer.
    scopes: ["openid", "email", "profile"],
  });

  const ready = !!request;

  const signIn = useCallback(async (): Promise<GoogleSignInResult> => {
    if (!request) {
      return {
        type: "error",
        message: "Google sign-in is not configured for this build.",
      };
    }

    try {
      const result = await promptAsync();

      if (result.type === "success") {
        // Different response shapes depending on flow. Both are valid.
        const idToken =
          (result.params && (result.params as Record<string, string>).id_token) ||
          (result.authentication && result.authentication.idToken) ||
          undefined;

        if (!idToken || typeof idToken !== "string") {
          return {
            type: "error",
            message: "Google did not return an ID token.",
          };
        }
        return { type: "success", idToken };
      }

      if (result.type === "cancel" || result.type === "dismiss") {
        return { type: "cancel" };
      }

      // error / locked / etc.
      const message =
        (result as { error?: { message?: string } }).error?.message ||
        "Google sign-in failed.";
      return { type: "error", message };
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : "Google sign-in failed.";
      return { type: "error", message };
    }
  }, [request, promptAsync]);

  return { ready, response, signIn };
}
