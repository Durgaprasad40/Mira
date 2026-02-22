import { useCallback } from "react";
import { Alert } from "react-native";
import { useRouter } from "expo-router";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";

/**
 * Centralized auth submission hook that handles USER_EXISTS responses.
 *
 * When a registration mutation returns USER_EXISTS:
 * - Shows an alert informing the user they already have an account
 * - Routes to the correct login method based on result.provider:
 *   - "email" → /(auth)/login
 *   - "phone" → /(onboarding)/email-phone (sign-in choice, no dedicated phone login exists)
 * - Stops further execution (returns null)
 * - Does NOT hydrate onboarding or profile state
 *
 * Usage in screens:
 *   import { useAuthSubmit } from "@/hooks/useAuthSubmit";
 *
 *   const { submitEmailRegistration } = useAuthSubmit();
 *   const result = await submitEmailRegistration({ email, password, name, dateOfBirth, gender });
 *   if (!result) return; // USER_EXISTS was handled, stop here
 *   // Continue with success flow...
 */
export function useAuthSubmit() {
  const router = useRouter();
  const registerWithEmail = useMutation(api.auth.registerWithEmail);
  const verifyPhoneOtp = useMutation(api.auth.verifyPhoneOtp);

  /**
   * Handles USER_EXISTS response by showing alert and routing to correct login.
   * Returns true if USER_EXISTS was handled (caller should stop), false otherwise.
   */
  const handleUserExists = useCallback(
    (provider: string | undefined): boolean => {
      const loginProvider = provider || "email";

      Alert.alert(
        "Account already exists",
        "You already have an account. Please log in.\nFor security reasons, we don't allow multiple accounts.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Go to Login",
            onPress: () => {
              if (loginProvider === "phone") {
                // No dedicated phone login route exists in (auth).
                // Route to sign-in choice screen as fallback.
                router.replace("/(onboarding)/email-phone" as any);
              } else {
                // Email users go to email/password login
                router.replace("/(auth)/login");
              }
            },
          },
        ]
      );

      return true;
    },
    [router]
  );

  /**
   * Submit email registration with centralized USER_EXISTS handling.
   * Returns the mutation result on success, or null if USER_EXISTS was handled.
   * Catches errors and maps USER_EXISTS responses to alert + routing.
   */
  const submitEmailRegistration = useCallback(
    async (args: {
      email: string;
      password: string;
      name: string;
      dateOfBirth: string;
      gender: "male" | "female" | "non_binary" | "lesbian" | "other";
    }): Promise<{
      success: boolean;
      userId?: string;
      token?: string;
      code?: string;
      provider?: string;
    } | null> => {
      try {
        const result = await registerWithEmail(args);

        // Handle USER_EXISTS response (structured response, not exception)
        if (result.code === "USER_EXISTS") {
          handleUserExists(result.provider);
          return null;
        }

        return result;
      } catch (error: any) {
        // Handle case where Convex throws instead of returning structured response
        const message = error?.message || "";
        if (
          message.includes("USER_EXISTS") ||
          message.includes("already exists") ||
          message.includes("already registered")
        ) {
          // Try to extract provider from error message, default to email
          const provider = message.includes("phone") ? "phone" : "email";
          handleUserExists(provider);
          return null;
        }
        // Re-throw other errors for caller to handle
        throw error;
      }
    },
    [registerWithEmail, handleUserExists]
  );

  /**
   * Submit phone OTP verification with centralized USER_EXISTS handling.
   * Returns the mutation result on success, or null if USER_EXISTS was handled.
   */
  const submitPhoneVerification = useCallback(
    async (args: { phone: string; code: string }): Promise<{
      success: boolean;
      userId?: string;
      token?: string;
      onboardingCompleted?: boolean;
    } | null> => {
      try {
        const result = await verifyPhoneOtp(args);

        // Phone verification creates account if not exists, so USER_EXISTS
        // typically won't occur here. But handle it for safety.
        if ("code" in result && (result as any).code === "USER_EXISTS") {
          handleUserExists((result as any).provider);
          return null;
        }

        return result;
      } catch (error: any) {
        // Handle thrown USER_EXISTS errors
        const message = error?.message || "";
        if (
          message.includes("USER_EXISTS") ||
          message.includes("already exists")
        ) {
          handleUserExists("phone");
          return null;
        }
        // Re-throw other errors for caller to handle
        throw error;
      }
    },
    [verifyPhoneOtp, handleUserExists]
  );

  return {
    submitEmailRegistration,
    submitPhoneVerification,
    handleUserExists,
  };
}
