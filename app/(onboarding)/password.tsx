import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { COLORS, VALIDATION } from '@/lib/constants';
import { Input, Button } from '@/components/ui';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { Ionicons } from '@expo/vector-icons';

export default function PasswordScreen() {
  const { password, setPassword, setStep } = useOnboardingStore();
  const router = useRouter();
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});

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

  const validate = () => {
    const newErrors: { password?: string; confirm?: string } = {};

    if (password.length < VALIDATION.PASSWORD_MIN_LENGTH) {
      newErrors.password = `Password must be at least ${VALIDATION.PASSWORD_MIN_LENGTH} characters`;
    }

    if (password !== confirmPassword) {
      newErrors.confirm = 'Passwords do not match';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (!validate()) return;

    setStep('basic_info');
    router.push('/(onboarding)/basic-info' as any);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Create a password</Text>
      <Text style={styles.subtitle}>
        Choose a strong password to keep your account secure.
      </Text>

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
          rightIcon={
            <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
              <Ionicons
                name={showPassword ? 'eye-off' : 'eye'}
                size={20}
                color={COLORS.textLight}
              />
            </TouchableOpacity>
          }
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
          rightIcon={
            <TouchableOpacity onPress={() => setShowConfirmPassword(!showConfirmPassword)}>
              <Ionicons
                name={showConfirmPassword ? 'eye-off' : 'eye'}
                size={20}
                color={COLORS.textLight}
              />
            </TouchableOpacity>
          }
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
  field: {
    marginBottom: 20,
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
