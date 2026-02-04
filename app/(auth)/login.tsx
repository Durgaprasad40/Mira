import React, { useState } from "react";
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
  const { setAuth } = useAuthStore();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const loginWithEmail = useMutation(api.auth.loginWithEmail);

  const handleLogin = async () => {
    // Demo mode: local sign-in via demoStore
    if (isDemoMode) {
      if (!email) { setError("Please enter your email"); return; }
      if (!password) { setError("Please enter your password"); return; }
      setIsLoading(true);
      setError("");
      try {
        const { userId, onboardingComplete } = useDemoStore.getState().demoSignIn(email, password);
        setAuth(userId, "demo_token", onboardingComplete);
        if (onboardingComplete) {
          router.replace("/(main)/(tabs)/home");
        } else {
          router.replace("/(onboarding)");
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

    try {
      const result = await loginWithEmail({ email, password });

      if (result.success && result.userId && result.token) {
        setAuth(
          result.userId,
          result.token,
          result.onboardingCompleted || false,
        );

        if (result.onboardingCompleted) {
          router.replace("/(main)/(tabs)/home");
        } else {
          router.replace("/(onboarding)/photo-upload");
        }
      }
    } catch (error: any) {
      setError(error.message || "Login failed. Please check your credentials.");
    } finally {
      setIsLoading(false);
    }
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
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
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
        <TouchableOpacity onPress={() => router.push("/(onboarding)")}>
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
