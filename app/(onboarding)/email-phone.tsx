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
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { useAuthStore } from '@/stores/authStore';
import { OnboardingProgressHeader } from '@/components/OnboardingProgressHeader';
import { useScreenTrace } from '@/lib/devTrace';

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
        Alert.alert('Coming Soon', 'Google Sign-In will be available soon.');
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

        {/* Google - Coming soon */}
        {renderAuthOption('google', 'logo-google', 'Continue with Google', false, 'Coming soon')}
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
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.textLight,
    marginBottom: 32,
    lineHeight: 22,
  },
  authOptionsContainer: {
    gap: 12,
  },
  authOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 12,
    backgroundColor: COLORS.backgroundDark,
  },
  authOptionDisabled: {
    opacity: 0.5,
  },
  authOptionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  authOptionTextContainer: {
    flexDirection: 'column',
  },
  authOptionLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.text,
  },
  authOptionLabelDisabled: {
    color: COLORS.textLight,
  },
  authOptionNote: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 2,
  },
  loadingContainer: {
    marginTop: 24,
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 14,
    color: COLORS.textLight,
  },
});
