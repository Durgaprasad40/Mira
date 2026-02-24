import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { COLORS, VALIDATION } from '@/lib/constants';
import { Input, Button } from '@/components/ui';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { isDemoMode } from '@/hooks/useConvex';
import { useDemoStore } from '@/stores/demoStore';

export default function PasswordScreen() {
  const { email, setEmail, password, setPassword, setStep } = useOnboardingStore();
  const router = useRouter();

  // Two-phase state: false = email only, true = show password fields
  const [emailVerified, setEmailVerified] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string; confirm?: string }>({});
  const [isChecking, setIsChecking] = useState(false);

  // Email to check (set when user taps Continue)
  const [emailToCheck, setEmailToCheck] = useState<string | null>(null);

  // Query for email existence (live mode only)
  const emailCheckResult = useQuery(
    api.auth.checkEmailExists,
    !isDemoMode && emailToCheck ? { email: emailToCheck } : "skip"
  );

  // Handle email check result
  useEffect(() => {
    if (!emailToCheck) return;

    // Demo mode: check local demoStore
    if (isDemoMode) {
      const demoAccounts = useDemoStore.getState().demoAccounts;
      const exists = demoAccounts.some(a => a.email.toLowerCase() === emailToCheck.toLowerCase());

      if (__DEV__) console.log('[AUTH] create_account_email_check exists=' + exists);
      setIsChecking(false);

      if (exists) {
        Alert.alert(
          'Email Already Registered',
          'This email is already registered. Please sign in.',
          [{ text: 'Sign In', onPress: () => router.replace('/(auth)/login') }]
        );
      } else {
        setEmailVerified(true);
      }
      setEmailToCheck(null);
      return;
    }

    // Live mode: wait for query result
    if (emailCheckResult === undefined) return;

    if (__DEV__) console.log('[AUTH] create_account_email_check exists=' + emailCheckResult.exists);
    setIsChecking(false);

    if (emailCheckResult.exists) {
      Alert.alert(
        'Email Already Registered',
        'This email is already registered. Please sign in.',
        [{ text: 'Sign In', onPress: () => router.replace('/(auth)/login') }]
      );
      setEmailToCheck(null);
    } else {
      setEmailVerified(true);
      setEmailToCheck(null);
    }
  }, [emailCheckResult, emailToCheck, router]);

  const validateEmail = (emailValue: string) => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(emailValue);
  };

  const getPasswordStrength = (pwd: string) => {
    if (pwd.length === 0) return { strength: 0, label: '', color: COLORS.border };
    if (pwd.length < VALIDATION.PASSWORD_MIN_LENGTH) {
      return { strength: 1, label: 'Too short', color: COLORS.error };
    }

    let strength = 0;
    if (pwd.length >= 8) strength++;
    if (/[a-z]/.test(pwd)) strength++;
    if (/[A-Z]/.test(pwd)) strength++;
    if (/[0-9]/.test(pwd)) strength++;
    if (/[^a-zA-Z0-9]/.test(pwd)) strength++;

    const labels = ['Weak', 'Fair', 'Good', 'Strong', 'Very Strong'];
    const colors = [COLORS.error, COLORS.warning, COLORS.warning, COLORS.success, COLORS.success];

    return {
      strength: Math.min(strength, 4),
      label: labels[strength - 1] || '',
      color: colors[strength - 1] || COLORS.border,
    };
  };

  const passwordStrength = getPasswordStrength(password);

  // Step 1: Check email
  const handleCheckEmail = () => {
    const newErrors: { email?: string } = {};

    if (!email || email.trim().length === 0) {
      newErrors.email = 'Please enter your email';
    } else if (!validateEmail(email)) {
      newErrors.email = 'Please enter a valid email address';
    }

    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    setIsChecking(true);
    setEmailToCheck(email.trim().toLowerCase());
  };

  // Step 2: Validate password and continue
  const handleNext = () => {
    const newErrors: { email?: string; password?: string; confirm?: string } = {};

    if (password.length < VALIDATION.PASSWORD_MIN_LENGTH) {
      newErrors.password = `Password must be at least ${VALIDATION.PASSWORD_MIN_LENGTH} characters`;
    }

    if (password !== confirmPassword) {
      newErrors.confirm = 'Passwords do not match';
    }

    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    setStep('basic_info');
    router.push('/(onboarding)/basic-info' as any);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Create your account</Text>
      <Text style={styles.subtitle}>
        {emailVerified
          ? 'Create a secure password for your account.'
          : 'Enter your email to get started.'}
      </Text>

      {/* Email input */}
      <View style={styles.field}>
        <Input
          label="Email"
          value={email}
          onChangeText={(text) => {
            if (!emailVerified) {
              setEmail(text);
              setErrors((prev) => ({ ...prev, email: undefined }));
            }
          }}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          editable={!emailVerified}
        />
        {errors.email && <Text style={styles.error}>{errors.email}</Text>}
        {emailVerified && (
          <Text style={styles.verified}>
            <Ionicons name="checkmark-circle" size={14} color={COLORS.success} /> Verified
          </Text>
        )}
      </View>

      {/* Phase 1: Only show Continue button */}
      {!emailVerified && (
        <View style={styles.footer}>
          <Button
            title="Continue"
            variant="primary"
            onPress={handleCheckEmail}
            loading={isChecking}
            fullWidth
          />
        </View>
      )}

      {/* Phase 2: Show password fields after email verified */}
      {emailVerified && (
        <>
          <View style={styles.field}>
            <Input
              label="Password"
              value={password}
              onChangeText={(text) => {
                setPassword(text);
                setErrors({});
              }}
              placeholder="Enter your password"
              secureTextEntry={!showPassword}
              rightIcon={showPassword ? 'eye-off' : 'eye'}
              onRightIconPress={() => setShowPassword(!showPassword)}
            />
            {password.length > 0 && (
              <View style={styles.strengthContainer}>
                <View style={styles.strengthBar}>
                  {[1, 2, 3, 4].map((level) => (
                    <View
                      key={level}
                      style={[
                        styles.strengthSegment,
                        level <= passwordStrength.strength && {
                          backgroundColor: passwordStrength.color,
                        },
                      ]}
                    />
                  ))}
                </View>
                {passwordStrength.label && (
                  <Text style={[styles.strengthLabel, { color: passwordStrength.color }]}>
                    {passwordStrength.label}
                  </Text>
                )}
              </View>
            )}
            {errors.password && <Text style={styles.error}>{errors.password}</Text>}
          </View>

          <View style={styles.field}>
            <Input
              label="Confirm Password"
              value={confirmPassword}
              onChangeText={(text) => {
                setConfirmPassword(text);
                setErrors({});
              }}
              placeholder="Confirm your password"
              secureTextEntry={!showConfirmPassword}
              rightIcon={showConfirmPassword ? 'eye-off' : 'eye'}
              onRightIconPress={() => setShowConfirmPassword(!showConfirmPassword)}
            />
            {errors.confirm && <Text style={styles.error}>{errors.confirm}</Text>}
          </View>

          <View style={styles.tips}>
            <Text style={styles.tipsTitle}>Password requirements:</Text>
            <View style={styles.tipItem}>
              <Ionicons
                name={password.length >= VALIDATION.PASSWORD_MIN_LENGTH ? 'checkmark-circle' : 'ellipse-outline'}
                size={16}
                color={password.length >= VALIDATION.PASSWORD_MIN_LENGTH ? COLORS.success : COLORS.textLight}
              />
              <Text style={styles.tipText}>At least {VALIDATION.PASSWORD_MIN_LENGTH} characters</Text>
            </View>
            <View style={styles.tipItem}>
              <Ionicons
                name={/[A-Z]/.test(password) ? 'checkmark-circle' : 'ellipse-outline'}
                size={16}
                color={/[A-Z]/.test(password) ? COLORS.success : COLORS.textLight}
              />
              <Text style={styles.tipText}>One uppercase letter</Text>
            </View>
            <View style={styles.tipItem}>
              <Ionicons
                name={/[0-9]/.test(password) ? 'checkmark-circle' : 'ellipse-outline'}
                size={16}
                color={/[0-9]/.test(password) ? COLORS.success : COLORS.textLight}
              />
              <Text style={styles.tipText}>One number</Text>
            </View>
          </View>

          <View style={styles.footer}>
            <Button
              title="Continue"
              variant="primary"
              onPress={handleNext}
              fullWidth
            />
          </View>
        </>
      )}
    </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
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
    marginBottom: 24,
    lineHeight: 22,
  },
  field: {
    marginBottom: 20,
  },
  verified: {
    fontSize: 13,
    color: COLORS.success,
    marginTop: 4,
  },
  strengthContainer: {
    marginTop: 8,
  },
  strengthBar: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 4,
  },
  strengthSegment: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
  },
  strengthLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  error: {
    fontSize: 12,
    color: COLORS.error,
    marginTop: 4,
  },
  tips: {
    backgroundColor: COLORS.backgroundDark,
    padding: 16,
    borderRadius: 12,
    marginBottom: 24,
  },
  tipsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12,
  },
  tipItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  tipText: {
    fontSize: 13,
    color: COLORS.textLight,
  },
  footer: {
    marginTop: 24,
  },
});
