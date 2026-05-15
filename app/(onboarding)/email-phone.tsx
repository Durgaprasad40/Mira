/**
 * LOCKED (Onboarding Page Lock)
 * Page: app/(onboarding)/email-phone.tsx
 * Policy:
 * - NO feature changes
 * - ONLY stability/bug fixes allowed IF Durga Prasad explicitly requests
 * - Do not change UX/flows without explicit unlock
 * Date locked: 2026-03-04
 */
import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { COLORS } from '@/lib/constants';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useMutation, useAction } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { useAuthStore } from '@/stores/authStore';
import { OnboardingProgressHeader } from '@/components/OnboardingProgressHeader';
import { useScreenTrace } from '@/lib/devTrace';
import { useGoogleSignIn } from '@/lib/auth/googleSignIn';

type AuthMethod = 'email' | 'phone' | 'apple' | 'google';

export default function EmailPhoneScreen() {
  useScreenTrace("ONB_EMAIL_PHONE");
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [isLoading, setIsLoading] = useState(false);
  const { setStep } = useOnboardingStore();
  const { setAuth } = useAuthStore();

  // H8 FIX: Track mounted state to prevent setAuth after unmount
  // Prevents auth restoration when user navigates away during async auth
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Convex mutations
  const socialAuth = useMutation(api.auth.socialAuth);
  // Google sign-in: action verifies the ID token server-side (issuer,
  // audience, expiry, email_verified, non-empty sub) and only THEN creates
  // or links a Mira session. The client never claims an identity itself.
  const signInWithGoogleIdToken = useAction(api.googleAuth.signInWithGoogleIdToken);
  const { ready: googleReady, signIn: googleSignIn } = useGoogleSignIn();

  // =========================================================================
  // Apple Sign-In Handler (iOS only)
  // =========================================================================
  const handleAppleSignIn = async () => {
    if (Platform.OS !== 'ios') {
      return;
    }

    setIsLoading(true);

    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (!credential.identityToken) {
        Alert.alert('Sign-In Failed', 'No identity token received from Apple.');
        setIsLoading(false);
        return;
      }

      console.log('[AppleAuth] Success, token prefix:', credential.identityToken.substring(0, 20) + '...');

      // H7 FIX: Capture auth version before async operation
      const capturedAuthVersion = useAuthStore.getState().authVersion;

      try {
        const result = await socialAuth({
          provider: 'apple',
          externalId: credential.user,
          email: credential.email || undefined,
          name: credential.fullName?.givenName
            ? `${credential.fullName.givenName} ${credential.fullName.familyName || ''}`.trim()
            : undefined,
        });

        // H7 FIX: Check if logout happened during mutation (version changed)
        if (useAuthStore.getState().authVersion !== capturedAuthVersion) {
          if (__DEV__) console.log('[AUTH] Logout detected during Apple auth - ignoring result');
          return;
        }

        // H8 FIX: Check if component unmounted during async auth
        // Prevents auth restoration when user navigates away
        if (!mountedRef.current) {
          if (__DEV__) console.log('[AUTH] Component unmounted during Apple auth - ignoring result');
          return;
        }

        // STABILITY FIX (2026-03-04): Validate mutation success before routing
        if (!result) {
          throw new Error('No response from server');
        }

        if (result.isNewUser) {
          Alert.alert('Welcome!', 'Please complete your profile setup.');
          setStep('basic_info');
          router.push('/(onboarding)/basic-info' as any);
        } else if (result.token && result.userId) {
          setAuth(result.userId as string, result.token, result.onboardingCompleted || false, capturedAuthVersion);

          // Persist auth token after confirmed email/phone success
          const { saveAuthBootCache } = require('@/stores/authBootCache');
          await saveAuthBootCache(result.token, result.userId as string);

          if (result.onboardingCompleted) {
            router.replace('/(main)/(tabs)/home' as any);
          } else {
            // Incomplete onboarding - go directly to basic-info in confirm mode
            // Do NOT route to welcome first (that creates a confusing loop)
            router.replace('/(onboarding)/basic-info?confirm=true' as any);
          }
        } else {
          // STABILITY FIX (2026-03-04): Handle unexpected response format
          throw new Error('Invalid response from server - missing required fields');
        }
      } catch (backendError: any) {
        console.error('[AppleAuth] Backend error:', backendError.message);
        Alert.alert('Sign-In Error', backendError.message || 'Failed to authenticate with server.');
      }
    } catch (e: any) {
      if (e.code === 'ERR_REQUEST_CANCELED') {
        console.log('[AppleAuth] User cancelled');
      } else {
        console.error('[AppleAuth] Error:', e);
        Alert.alert('Sign-In Failed', e.message || 'An error occurred during Apple Sign-In.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // =========================================================================
  // Google Sign-In Handler
  //
  // The client only gets an ID token from Google. It is sent untouched to
  // the Convex Node action, which verifies it and returns the same response
  // shape the Apple path uses (success/isNewUser/token/userId/onboardingCompleted).
  // We deliberately do NOT pass an externalId from the client.
  // =========================================================================
  const handleGoogleSignIn = async () => {
    if (!googleReady) {
      Alert.alert(
        'Google Sign-In Unavailable',
        'Google sign-in is not configured for this build.',
      );
      return;
    }

    setIsLoading(true);

    try {
      const popup = await googleSignIn();

      if (popup.type === 'cancel') {
        if (__DEV__) console.log('[GoogleAuth] User cancelled');
        setIsLoading(false);
        return;
      }

      if (popup.type === 'error') {
        console.error('[GoogleAuth] Popup error:', popup.message);
        Alert.alert('Sign-In Failed', popup.message);
        setIsLoading(false);
        return;
      }

      if (__DEV__) {
        console.log('[GoogleAuth] Got ID token, prefix:', popup.idToken.substring(0, 16) + '...');
      }

      // H7 FIX: Capture auth version before async operation
      const capturedAuthVersion = useAuthStore.getState().authVersion;

      try {
        const result = await signInWithGoogleIdToken({ idToken: popup.idToken });

        // H7 FIX: Check if logout happened during action (version changed)
        if (useAuthStore.getState().authVersion !== capturedAuthVersion) {
          if (__DEV__) console.log('[AUTH] Logout detected during Google auth - ignoring result');
          return;
        }

        // H8 FIX: Check if component unmounted during async auth
        if (!mountedRef.current) {
          if (__DEV__) console.log('[AUTH] Component unmounted during Google auth - ignoring result');
          return;
        }

        if (!result || !result.token || !result.userId) {
          throw new Error('Invalid response from server - missing required fields');
        }

        setAuth(
          result.userId as string,
          result.token,
          result.onboardingCompleted || false,
          capturedAuthVersion,
        );

        const { saveAuthBootCache } = require('@/stores/authBootCache');
        await saveAuthBootCache(result.token, result.userId as string);

        if (result.onboardingCompleted) {
          router.replace('/(main)/(tabs)/home' as any);
        } else {
          // Onboarding not complete (likely a brand-new account). Send the
          // user straight to basic-info in confirm mode, same as Apple.
          router.replace('/(onboarding)/basic-info?confirm=true' as any);
        }
      } catch (backendError: any) {
        console.error('[GoogleAuth] Backend error:', backendError?.message);
        Alert.alert(
          'Sign-In Error',
          backendError?.message || 'Failed to authenticate with server.',
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  // =========================================================================
  // Handle Auth Option Press
  // =========================================================================
  const handleOptionPress = (method: AuthMethod) => {
    if (isLoading) return;

    switch (method) {
      case 'email':
        setStep('password');
        router.push('/(onboarding)/password' as any);
        break;
      case 'phone':
        router.push('/(onboarding)/phone-entry' as any);
        break;
      case 'apple':
        if (Platform.OS === 'ios') {
          handleAppleSignIn();
        }
        break;
      case 'google':
        handleGoogleSignIn();
        break;
    }
  };

  // =========================================================================
  // Render Auth Option Button
  // =========================================================================
  const renderAuthOption = (
    method: AuthMethod,
    icon: string,
    label: string,
    disabled: boolean = false,
    note?: string
  ) => {
    return (
      <TouchableOpacity
        key={method}
        style={[
          styles.authOption,
          disabled && styles.authOptionDisabled,
        ]}
        onPress={() => handleOptionPress(method)}
        disabled={disabled || isLoading}
        activeOpacity={0.7}
      >
        <View style={styles.authOptionContent}>
          <Ionicons
            name={icon as any}
            size={24}
            color={disabled ? COLORS.textLight : COLORS.text}
          />
          <View style={styles.authOptionTextContainer}>
            <Text
              style={[
                styles.authOptionLabel,
                disabled && styles.authOptionLabelDisabled,
              ]}
            >
              {label}
            </Text>
            {note && <Text style={styles.authOptionNote}>{note}</Text>}
          </View>
        </View>
        <Ionicons
          name="chevron-forward"
          size={20}
          color={disabled ? COLORS.textLight : COLORS.textLight}
        />
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <OnboardingProgressHeader />
      <Text style={styles.title}>How do you want to sign in?</Text>
      <Text style={styles.subtitle}>
        Choose your preferred method to create or access your account.
      </Text>

      {/* Auth Options List */}
      <View style={styles.authOptionsContainer}>
        {renderAuthOption('email', 'mail-outline', 'Continue with Email')}
        {renderAuthOption('phone', 'call-outline', 'Continue with Phone')}

        {/* Apple - iOS only */}
        {Platform.OS === 'ios' ? (
          renderAuthOption('apple', 'logo-apple', 'Continue with Apple')
        ) : (
          renderAuthOption('apple', 'logo-apple', 'Continue with Apple', true, 'iOS only')
        )}

        {/* Google */}
        {googleReady
          ? renderAuthOption('google', 'logo-google', 'Continue with Google')
          : renderAuthOption('google', 'logo-google', 'Continue with Google', true, 'Unavailable')}
      </View>

      {/* Loading indicator */}
      {isLoading && (
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Signing in...</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    padding: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 10,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.textLight,
    marginBottom: 32,
    lineHeight: 24,
  },
  authOptionsContainer: {
    gap: 14,
  },
  authOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 18,
    paddingHorizontal: 18,
    borderRadius: 14,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  authOptionDisabled: {
    opacity: 0.5,
  },
  authOptionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  authOptionTextContainer: {
    flexDirection: 'column',
  },
  authOptionLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.text,
    letterSpacing: 0.1,
  },
  authOptionLabelDisabled: {
    color: COLORS.textLight,
  },
  authOptionNote: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 3,
  },
  loadingContainer: {
    marginTop: 28,
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 14,
    color: COLORS.textLight,
    fontWeight: '500',
  },
});
