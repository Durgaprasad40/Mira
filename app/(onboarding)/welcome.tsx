import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { COLORS } from '@/lib/constants';
import { Button } from '@/components/ui';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

export default function OnboardingWelcomeScreen() {
  const router = useRouter();
  const { setStep } = useOnboardingStore();

  const handleGetStarted = () => {
    setStep('email_phone');
    router.push('/(onboarding)/email-phone' as any);
  };

  return (
    <LinearGradient
      colors={[COLORS.primary, COLORS.secondary]}
      style={styles.container}
    >
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Ionicons name="heart" size={80} color={COLORS.white} />
        </View>
        
        <Text style={styles.title}>Welcome to Mira</Text>
        <Text style={styles.subtitle}>
          Find meaningful connections and discover people who share your interests
        </Text>

        <View style={styles.features}>
          <View style={styles.feature}>
            <Ionicons name="flame" size={24} color={COLORS.white} />
            <Text style={styles.featureText}>Swipe to match</Text>
          </View>
          <View style={styles.feature}>
            <Ionicons name="chatbubbles" size={24} color={COLORS.white} />
            <Text style={styles.featureText}>Chat with matches</Text>
          </View>
          <View style={styles.feature}>
            <Ionicons name="location" size={24} color={COLORS.white} />
            <Text style={styles.featureText}>Find people nearby</Text>
          </View>
        </View>
      </View>

      <View style={styles.footer}>
        <Button
          title="Create Account"
          variant="primary"
          onPress={handleGetStarted}
          fullWidth
          style={{
            backgroundColor: COLORS.primary,
            borderWidth: 0,
            elevation: 0,
            borderRadius: 12,
            height: 52,
            marginBottom: 12,
          }}
          textStyle={{
            color: COLORS.white,
            fontWeight: '600',
          }}
        />
        <Button
          title="I already have an account"
          variant="outline"
          onPress={handleGetStarted}
          fullWidth
          style={styles.outlineButton}
          textStyle={styles.outlineButtonText}
        />
        <Text style={styles.terms}>
          By continuing, you agree to our Terms of Service and Privacy Policy
        </Text>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  iconContainer: {
    marginBottom: 32,
  },
  title: {
    fontSize: 36,
    fontWeight: '700',
    color: COLORS.white,
    marginBottom: 16,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 18,
    color: COLORS.white,
    textAlign: 'center',
    lineHeight: 26,
    opacity: 0.9,
    marginBottom: 48,
  },
  features: {
    width: '100%',
    gap: 20,
  },
  feature: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: COLORS.white + '20',
    padding: 16,
    borderRadius: 12,
  },
  featureText: {
    fontSize: 16,
    color: COLORS.white,
    fontWeight: '500',
  },
  footer: {
    padding: 24,
    paddingBottom: 40,
  },
  outlineButton: {
    backgroundColor: '#00000000',
    borderWidth: 2,
    borderColor: COLORS.white,
    marginBottom: 12,
    elevation: 0,
  },
  outlineButtonText: {
    color: COLORS.white,
  },
  terms: {
    fontSize: 12,
    color: COLORS.white,
    textAlign: 'center',
    opacity: 0.8,
    lineHeight: 18,
  },
});
