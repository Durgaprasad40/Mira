import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { COLORS, VALIDATION } from '@/lib/constants';
import { Input, Button } from '@/components/ui';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { Ionicons } from '@expo/vector-icons';

// ============================================================================
// DEV MODE: Skip OTP entirely for faster onboarding testing
// In production builds, __DEV__ is false, so OTP will be required
// ============================================================================
const SKIP_OTP_IN_DEV = __DEV__;

export default function EmailPhoneScreen() {
  const { email, phone, setEmail, setPhone, setStep } = useOnboardingStore();
  const router = useRouter();
  const [useEmail, setUseEmail] = useState(true);
  const [error, setError] = useState('');

  const validateEmail = (email: string) => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  };

  const validatePhone = (phone: string) => {
    const cleaned = phone.replace(/\D/g, '');
    return cleaned.length >= 10;
  };

  const handleNext = () => {
    setError('');
    
    if (useEmail) {
      if (!email) {
        setError('Please enter your email');
        return;
      }
      if (!validateEmail(email)) {
        setError('Please enter a valid email address');
        return;
      }
    } else {
      if (!phone) {
        setError('Please enter your phone number');
        return;
      }
      if (!validatePhone(phone)) {
        setError('Please enter a valid phone number');
        return;
      }
    }

    // =========================================================================
    // DEV MODE: Skip OTP entirely – go straight to password step
    // Production: Require OTP verification
    // =========================================================================
    if (SKIP_OTP_IN_DEV) {
      console.log('[DEV_AUTH] Skipping OTP screen – going to password');
      setStep('password');
      router.push('/(onboarding)/password' as any);
    } else {
      setStep('otp');
      router.push('/(onboarding)/otp' as any);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>What's your contact info?</Text>
      <Text style={styles.subtitle}>
        Use your email or phone number so we can verify your account.
      </Text>

      <View style={styles.toggleContainer}>
        <TouchableOpacity
          style={[styles.toggle, useEmail && styles.toggleActive]}
          onPress={() => {
            setUseEmail(true);
            setError('');
          }}
        >
          <Ionicons name="mail" size={20} color={useEmail ? COLORS.white : COLORS.textLight} />
          <Text style={[styles.toggleText, useEmail && styles.toggleTextActive]}>Email</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggle, !useEmail && styles.toggleActive]}
          onPress={() => {
            setUseEmail(false);
            setError('');
          }}
        >
          <Ionicons name="call" size={20} color={!useEmail ? COLORS.white : COLORS.textLight} />
          <Text style={[styles.toggleText, !useEmail && styles.toggleTextActive]}>Phone</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.field}>
        {useEmail ? (
          <Input
            label="Email"
            value={email}
            onChangeText={(text) => {
              setEmail(text);
              setError('');
            }}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
          />
        ) : (
          <Input
            label="Phone Number"
            value={phone}
            onChangeText={(text) => {
              setPhone(text);
              setError('');
            }}
            placeholder="+91 98765 43210"
            keyboardType="phone-pad"
            autoComplete="tel"
          />
        )}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.footer}>
        <Button
          title="Continue"
          variant="primary"
          onPress={handleNext}
          fullWidth
        />
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
  toggleContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  toggle: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    backgroundColor: COLORS.backgroundDark,
    gap: 8,
  },
  toggleActive: {
    backgroundColor: COLORS.primary,
  },
  toggleText: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.textLight,
  },
  toggleTextActive: {
    color: COLORS.white,
  },
  field: {
    marginBottom: 16,
  },
  error: {
    fontSize: 14,
    color: COLORS.error,
    marginBottom: 16,
  },
  footer: {
    marginTop: 24,
  },
});
