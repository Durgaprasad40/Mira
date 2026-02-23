import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  TextInput,
  Modal,
  FlatList,
  Pressable,
} from 'react-native';
import { useRouter } from 'expo-router';
import { COLORS } from '@/lib/constants';
import { Button } from '@/components/ui';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { useAuthStore } from '@/stores/authStore';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

// Country list with flag emoji, name, and dial code
const COUNTRIES = [
  { flag: '🇮🇳', name: 'India', code: '+91' },
  { flag: '🇺🇸', name: 'United States', code: '+1' },
  { flag: '🇬🇧', name: 'United Kingdom', code: '+44' },
  { flag: '🇧🇷', name: 'Brazil', code: '+55' },
  { flag: '🇨🇦', name: 'Canada', code: '+1' },
  { flag: '🇫🇷', name: 'France', code: '+33' },
  { flag: '🇦🇺', name: 'Australia', code: '+61' },
  { flag: '🇩🇪', name: 'Germany', code: '+49' },
  { flag: '🇳🇱', name: 'Netherlands', code: '+31' },
  { flag: '🇲🇽', name: 'Mexico', code: '+52' },
  { flag: '🇪🇸', name: 'Spain', code: '+34' },
];

type Country = (typeof COUNTRIES)[number];
type ScreenMode = 'enterPhone' | 'enterOtp';

export default function PhoneEntryScreen() {
  const { setPhone, setStep } = useOnboardingStore();
  const { setAuth } = useAuthStore();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Screen mode: phone entry or OTP verification
  const [mode, setMode] = useState<ScreenMode>('enterPhone');

  // Phone entry state
  const [selectedCountry, setSelectedCountry] = useState<Country>(COUNTRIES[0]);
  const [digits, setDigits] = useState('');
  const [modalVisible, setModalVisible] = useState(false);

  // OTP entry state
  const [otpCode, setOtpCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);

  // Shared state
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [retryAfter, setRetryAfter] = useState(0);

  // Store the full phone number for OTP verification
  const [fullPhone, setFullPhone] = useState('');

  // Convex mutations
  const requestPhoneOtp = useMutation(api.auth.requestPhoneOtp);
  const verifyPhoneOtp = useMutation(api.auth.verifyPhoneOtp);

  // OTP input ref
  const otpInputRef = useRef<TextInput>(null);

  // Countdown timer for resend
  useEffect(() => {
    if (retryAfter <= 0) return;

    const timer = setInterval(() => {
      setRetryAfter((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [retryAfter]);

  // Focus OTP input when entering OTP mode
  useEffect(() => {
    if (mode === 'enterOtp') {
      setTimeout(() => otpInputRef.current?.focus(), 100);
    }
  }, [mode]);

  // Filter input to digits only
  const handleDigitsChange = (text: string) => {
    const digitsOnly = text.replace(/\D/g, '');
    setDigits(digitsOnly);
    setError('');
  };

  // Filter OTP input to digits only
  const handleOtpChange = (text: string) => {
    const digitsOnly = text.replace(/\D/g, '').slice(0, 6);
    setOtpCode(digitsOnly);
    setError('');
  };

  // Validation based on country
  const validatePhone = (): boolean => {
    if (!digits) {
      setError('Please enter your phone number');
      return false;
    }

    // India requires exactly 10 digits
    if (selectedCountry.code === '+91') {
      if (digits.length !== 10) {
        setError('Indian phone numbers must be exactly 10 digits');
        return false;
      }
    } else {
      // Other countries: 7-15 digits
      if (digits.length < 7 || digits.length > 15) {
        setError('Phone number must be 7-15 digits');
        return false;
      }
    }

    return true;
  };

  // Request OTP from server
  const handleRequestOtp = async () => {
    setError('');

    if (!validatePhone()) {
      return;
    }

    // Build E.164 phone number
    const phone = `${selectedCountry.code}${digits}`;
    setFullPhone(phone);
    setPhone(phone);
    setIsLoading(true);

    try {
      const result = await requestPhoneOtp({ phone });

      if (result.success) {
        // Store dev code if provided (only in development)
        if (result.devCode) {
          setDevCode(result.devCode);
          console.log('[DEV] OTP code:', result.devCode);
        }

        // Handle retryAfter if provided
        if (result.retryAfter && result.retryAfter > 0) {
          setRetryAfter(result.retryAfter);
        }

        // Transition to OTP entry mode
        setMode('enterOtp');
        setOtpCode('');
      }
    } catch (err: any) {
      const message = err.message || 'Failed to send OTP';

      // Handle specific error codes
      if (message.includes('RATE_LIMITED')) {
        // Extract seconds from message if available
        const match = message.match(/(\d+)\s*second/);
        const seconds = match ? parseInt(match[1], 10) : 30;
        setRetryAfter(seconds);
        setError(`Please wait ${seconds}s before requesting another code`);
      } else if (message.includes('INVALID_PHONE')) {
        setError('Invalid phone number format');
      } else {
        setError(message);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Verify OTP code
  const handleVerifyOtp = async () => {
    if (otpCode.length !== 6) {
      setError('Please enter the 6-digit code');
      return;
    }

    setError('');
    setIsLoading(true);

    try {
      const result = await verifyPhoneOtp({ phone: fullPhone, code: otpCode });

      if (result.success && result.userId && result.token) {
        if (__DEV__) console.log("[AUTH] login success, onboardingCompleted =", result.onboardingCompleted);
        // Store auth credentials
        setAuth(result.userId, result.token, result.onboardingCompleted || false);

        // Navigate based on onboarding status
        if (result.onboardingCompleted) {
          router.replace('/(main)/(tabs)/home');
        } else {
          // Resume at photo-upload (safe screen that doesn't create accounts)
          const resumeRoute = '/(onboarding)/photo-upload';
          if (__DEV__) console.log("[AUTH] resuming onboarding at", resumeRoute);
          setStep('photo_upload');
          router.replace(resumeRoute);
        }
      }
    } catch (err: any) {
      const message = err.message || 'Verification failed';

      // Handle specific error codes
      if (message.includes('INVALID_CODE')) {
        setError('Invalid code. Please try again.');
      } else if (message.includes('EXPIRED')) {
        setError('Code expired. Please request a new one.');
      } else if (message.includes('MAX_ATTEMPTS')) {
        setError('Too many attempts. Please request a new code.');
        // Reset to phone entry mode to request new OTP
        setMode('enterPhone');
        setOtpCode('');
      } else {
        setError(message);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Resend OTP
  const handleResend = async () => {
    if (retryAfter > 0 || isLoading) return;

    setError('');
    setIsLoading(true);
    setOtpCode('');
    setDevCode(null);

    try {
      const result = await requestPhoneOtp({ phone: fullPhone });

      if (result.success) {
        if (result.devCode) {
          setDevCode(result.devCode);
          console.log('[DEV] New OTP code:', result.devCode);
        }

        if (result.retryAfter && result.retryAfter > 0) {
          setRetryAfter(result.retryAfter);
        } else {
          setRetryAfter(30); // Default 30s cooldown
        }
      }
    } catch (err: any) {
      const message = err.message || 'Failed to resend OTP';

      if (message.includes('RATE_LIMITED')) {
        const match = message.match(/(\d+)\s*second/);
        const seconds = match ? parseInt(match[1], 10) : 30;
        setRetryAfter(seconds);
        setError(`Please wait ${seconds}s before requesting another code`);
      } else {
        setError(message);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Go back to phone entry
  const handleBackToPhone = () => {
    setMode('enterPhone');
    setOtpCode('');
    setDevCode(null);
    setError('');
  };

  const handleSelectCountry = (country: Country) => {
    setSelectedCountry(country);
    setModalVisible(false);
    setError('');
  };

  const renderCountryItem = ({ item }: { item: Country }) => (
    <TouchableOpacity
      style={styles.countryItem}
      onPress={() => handleSelectCountry(item)}
      activeOpacity={0.7}
    >
      <Text style={styles.countryFlag}>{item.flag}</Text>
      <Text style={styles.countryName}>{item.name}</Text>
      <Text style={styles.countryCode}>{item.code}</Text>
    </TouchableOpacity>
  );

  // Render phone entry mode
  const renderPhoneEntry = () => (
    <>
      <Text style={styles.title}>Enter your phone</Text>
      <Text style={styles.subtitle}>
        We'll send you a verification code to confirm your number.
      </Text>

      <Text style={styles.label}>Phone Number</Text>
      <View style={styles.phoneRow}>
        {/* Country Code Selector */}
        <TouchableOpacity
          style={styles.countrySelector}
          onPress={() => setModalVisible(true)}
          activeOpacity={0.7}
        >
          <Text style={styles.countrySelectorText}>
            {selectedCountry.flag} {selectedCountry.code}
          </Text>
        </TouchableOpacity>

        {/* Phone Digits Input */}
        <TextInput
          style={styles.phoneInput}
          value={digits}
          onChangeText={handleDigitsChange}
          placeholder=""
          placeholderTextColor={COLORS.textMuted}
          keyboardType="number-pad"
          autoFocus
          maxLength={15}
          editable={!isLoading}
        />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.footer}>
        <Button
          title="Continue"
          variant="primary"
          onPress={handleRequestOtp}
          loading={isLoading}
          fullWidth
        />
      </View>
    </>
  );

  // Render OTP entry mode
  const renderOtpEntry = () => (
    <>
      <TouchableOpacity onPress={handleBackToPhone} style={styles.backButton}>
        <Text style={styles.backButtonText}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Enter verification code</Text>
      <Text style={styles.subtitle}>
        We sent a 6-digit code to {fullPhone}
      </Text>

      {/* Dev mode: show the OTP code */}
      {devCode && (
        <View style={styles.devCodeContainer}>
          <Text style={styles.devCodeLabel}>DEV MODE - Your code:</Text>
          <Text style={styles.devCodeValue}>{devCode}</Text>
        </View>
      )}

      <Text style={styles.label}>Verification Code</Text>
      <TextInput
        ref={otpInputRef}
        style={styles.otpInput}
        value={otpCode}
        onChangeText={handleOtpChange}
        placeholder="000000"
        placeholderTextColor={COLORS.textMuted}
        keyboardType="number-pad"
        maxLength={6}
        editable={!isLoading}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.footer}>
        <Button
          title="Verify"
          variant="primary"
          onPress={handleVerifyOtp}
          loading={isLoading}
          disabled={otpCode.length !== 6}
          fullWidth
        />

        <TouchableOpacity
          style={styles.resendButton}
          onPress={handleResend}
          disabled={retryAfter > 0 || isLoading}
        >
          <Text
            style={[
              styles.resendText,
              (retryAfter > 0 || isLoading) && styles.resendTextDisabled,
            ]}
          >
            {retryAfter > 0
              ? `Resend code in ${retryAfter}s`
              : "Didn't receive a code? Resend"}
          </Text>
        </TouchableOpacity>
      </View>
    </>
  );

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top + 16 }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.content}>
        {mode === 'enterPhone' ? renderPhoneEntry() : renderOtpEntry()}
      </View>

      {/* Country Picker Modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setModalVisible(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setModalVisible(false)}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Country</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Text style={styles.modalClose}>Done</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={COUNTRIES}
              keyExtractor={(item) => `${item.name}-${item.code}`}
              renderItem={renderCountryItem}
              showsVerticalScrollIndicator={false}
            />
          </View>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    flex: 1,
    padding: 24,
  },
  backButton: {
    marginBottom: 16,
  },
  backButtonText: {
    fontSize: 16,
    color: COLORS.primary,
    fontWeight: '500',
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
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
  },
  phoneRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  countrySelector: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 12,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 90,
  },
  countrySelectorText: {
    fontSize: 16,
    color: COLORS.text,
    fontWeight: '500',
  },
  phoneInput: {
    flex: 1,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 16,
    color: COLORS.text,
  },
  otpInput: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    fontSize: 24,
    color: COLORS.text,
    textAlign: 'center',
    letterSpacing: 8,
    fontWeight: '600',
  },
  error: {
    fontSize: 14,
    color: COLORS.error,
    marginTop: 8,
    marginBottom: 8,
  },
  footer: {
    marginTop: 24,
  },
  resendButton: {
    alignItems: 'center',
    marginTop: 20,
    padding: 8,
  },
  resendText: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '500',
  },
  resendTextDisabled: {
    color: COLORS.textMuted,
  },
  devCodeContainer: {
    backgroundColor: COLORS.primary + '15',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    alignItems: 'center',
  },
  devCodeLabel: {
    fontSize: 12,
    color: COLORS.textLight,
    marginBottom: 4,
  },
  devCodeValue: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.primary,
    letterSpacing: 4,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '60%',
    paddingBottom: 34,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  modalClose: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.primary,
  },
  countryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  countryFlag: {
    fontSize: 24,
    marginRight: 12,
  },
  countryName: {
    flex: 1,
    fontSize: 16,
    color: COLORS.text,
  },
  countryCode: {
    fontSize: 16,
    color: COLORS.textLight,
    fontWeight: '500',
  },
});
