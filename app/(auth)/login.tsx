/**
 * LOCKED (Onboarding Page Lock)
 * Page: app/(auth)/login.tsx
 * Policy:
 * - NO feature changes
 * - ONLY stability/bug fixes allowed IF Durga Prasad explicitly requests
 * - Do not change UX/flows without explicit unlock
 * Date locked: 2026-03-04
 */
import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from "react-native";
import { COLORS } from "@/lib/constants";
import { Button, Input } from "@/components/ui";
import { useRouter } from "expo-router";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuthStore } from "@/stores/authStore";
import { Ionicons } from "@expo/vector-icons";
import { isDemoMode } from "@/hooks/useConvex";
import { useDemoStore } from "@/stores/demoStore";

export default function LoginScreen() {
  const router = useRouter();
  const { setAuth, userId, token, logout } = useAuthStore();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  // H8 FIX: Track mounted state to prevent setAuth after unmount
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const loginWithEmail = useMutation(api.auth.loginWithEmail);

  const handleLogin = async () => {
    // Demo mode: local sign-in via demoStore
    if (isDemoMode) {
      if (!email) { setError("Please enter your email"); return; }
      if (!password) { setError("Please enter your password"); return; }
      setIsLoading(true);
      setError("");
      // H7 FIX: Capture auth version before demo sign-in
      const capturedAuthVersion = useAuthStore.getState().authVersion;
      try {
        const { userId, onboardingComplete } = useDemoStore.getState().demoSignIn(email, password);
        setAuth(userId, "demo_token", onboardingComplete, capturedAuthVersion);
        if (onboardingComplete) {
          router.replace("/(main)/(tabs)/home");
        } else {
          // Incomplete onboarding - go directly to basic-info in confirm mode
          // Do NOT route to welcome first (that creates a confusing loop)
          router.replace("/(onboarding)/basic-info?confirm=true" as any);
        }
      } catch (e: any) {
        setError(e.message || "Login failed");
      } finally {
        setIsLoading(false);
      }
      return;
    }

    if (!email) {
      setError("Please enter your email");
      return;
    }
    if (!password) {
      setError("Please enter your password");
      return;
    }

    setIsLoading(true);
    setError("");

    // H7 FIX: Capture auth version before async operation
    const capturedAuthVersion = useAuthStore.getState().authVersion;

    try {
      const result = await loginWithEmail({ email, password });

      // H7 FIX: Check if logout happened during mutation (version changed)
      if (useAuthStore.getState().authVersion !== capturedAuthVersion) {
        if (__DEV__) console.log('[AUTH] Logout detected during login - ignoring result');
        return;
      }

      // H8 FIX: Check if component unmounted during async login
      if (!mountedRef.current) {
        if (__DEV__) console.log('[AUTH] Component unmounted during login - ignoring result');
        return;
      }

      if (result.success && result.userId && result.token) {
        setAuth(
          result.userId,
          result.token,
          result.onboardingCompleted || false,
          capturedAuthVersion,
        );

        // Persist auth token after confirmed login success
        const { saveAuthBootCache } = require('@/stores/authBootCache');
        await saveAuthBootCache(result.token, result.userId);

        if (result.onboardingCompleted) {
          router.replace("/(main)/(tabs)/home");
        } else {
          // Incomplete onboarding - go directly to basic-info in confirm mode
          // Do NOT route to welcome first (that creates a confusing loop)
          router.replace("/(onboarding)/basic-info?confirm=true" as any);
        }
      }
    } catch (error: any) {
      setError(error.message || "Login failed. Please check your credentials.");
    } finally {
      setIsLoading(false);
    }
  };

  // STABILITY FIX: Force logout before starting new account creation
  // This prevents session/token leakage when user switches accounts
  const handleSignUp = async () => {
    // Check if there's an existing session (userId or token)
    if (userId || token) {
      if (__DEV__) console.log('[AUTH] Sign up pressed with existing session -> forcing logout before new signup');
      await logout();
    }
    router.push("/(onboarding)");
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
        <Ionicons name="arrow-back" size={24} color={COLORS.text} />
      </TouchableOpacity>

      <Text style={styles.title}>Welcome back</Text>
      <Text style={styles.subtitle}>Sign in to continue</Text>

      <View style={styles.form}>
        <View style={styles.field}>
          <Input
            label="Email"
            value={email}
            onChangeText={(text) => {
              setEmail(text);
              setError("");
            }}
            placeholder="you@example.com"
            autoCapitalize="none"
            allowAuthAutofill={true}
          />
        </View>

        <View style={styles.field}>
          <Input
            label="Password"
            value={password}
            onChangeText={(text) => {
              setPassword(text);
              setError("");
            }}
            placeholder="Enter your password"
            secureTextEntry
          />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button
          title="Sign In"
          variant="primary"
          onPress={handleLogin}
          loading={isLoading}
          fullWidth
          style={styles.loginButton}
        />

        <TouchableOpacity style={styles.forgotPassword}>
          <Text style={styles.forgotPasswordText}>Forgot password?</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Don't have an account? </Text>
        <TouchableOpacity onPress={handleSignUp}>
          <Text style={styles.signupLink}>Sign up</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    padding: 24,
    paddingTop: 60,
  },
  backButton: {
    marginBottom: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: "bold",
    color: COLORS.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.textLight,
    marginBottom: 32,
  },
  form: {
    marginBottom: 24,
  },
  field: {
    marginBottom: 16,
  },
  error: {
    color: COLORS.error,
    fontSize: 14,
    marginBottom: 16,
    textAlign: "center",
  },
  loginButton: {
    marginTop: 8,
  },
  forgotPassword: {
    alignItems: "center",
    marginTop: 16,
  },
  forgotPasswordText: {
    color: COLORS.primary,
    fontSize: 14,
    fontWeight: "500",
  },
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: "auto",
    paddingVertical: 24,
  },
  footerText: {
    color: COLORS.textLight,
    fontSize: 14,
  },
  signupLink: {
    color: COLORS.primary,
    fontSize: 14,
    fontWeight: "600",
  },
});
