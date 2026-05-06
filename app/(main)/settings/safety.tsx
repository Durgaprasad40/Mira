/*
 * LOCKED (SAFETY SETTINGS)
 * Do NOT modify this file unless Durga Prasad explicitly unlocks it.
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, LayoutChangeEvent, ActivityIndicator } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from 'convex/react';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';
import { getDemoCurrentUser } from '@/lib/demoData';

// Safety tips content
const SAFETY_TIPS = {
  scammers: {
    title: 'Spot Scammers',
    tips: [
      'Be wary of profiles that seem too good to be true',
      'Never send money to someone you haven\'t met in person',
      'Watch for inconsistent stories or details',
      'Reverse image search photos if something feels off',
    ],
  },
  protect: {
    title: 'Protect Your Account',
    tips: [
      'Never share your OTP or verification codes',
      'Use a strong, unique password',
      'Enable two-factor authentication when available',
      'Don\'t click suspicious links in messages',
    ],
  },
  meetSafely: {
    title: 'Meet Safely',
    tips: [
      'Always meet in a public place for first dates',
      'Tell a friend where you\'re going and who you\'re meeting',
      'Arrange your own transportation',
      'Trust your instincts—leave if something feels wrong',
    ],
  },
};

export default function SafetySettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const token = useAuthStore((s) => s.token);
  const userId = useAuthStore((s) => s.userId);

  // Safe back navigation - ensures return to Profile tab
  const handleGoBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(main)/(tabs)/profile' as any);
    }
  }, [router]);

  const currentUserQuery = useQuery(
    api.users.getCurrentUser,
    !isDemoMode && userId ? { userId } : 'skip'
  );
  const currentUser = isDemoMode ? (getDemoCurrentUser() as any) : currentUserQuery;
  const verificationDetails = useQuery(
    api.verification.getVerificationStatus,
    !isDemoMode && userId ? { userId } : 'skip'
  );
  const [timedOut, setTimedOut] = useState(false);

  // Track which safety tip section is expanded
  const [expandedTip, setExpandedTip] = useState<string | null>(null);

  // ScrollView ref for auto-scroll
  const scrollViewRef = useRef<ScrollView>(null);

  // Track Y positions of tip sections for auto-scroll
  const tipPositions = useRef<Record<string, number>>({});
  const safetyCenterOffset = useRef<number>(0);

  useEffect(() => {
    if (
      isDemoMode ||
      !token ||
      (currentUserQuery !== undefined && verificationDetails !== undefined)
    ) {
      return;
    }

    const timeout = setTimeout(() => setTimedOut(true), 8000);
    return () => clearTimeout(timeout);
  }, [currentUserQuery, verificationDetails, token]);

  const isLoading =
    !isDemoMode &&
    !!token &&
    currentUserQuery !== null &&
    (currentUserQuery === undefined || verificationDetails === undefined) &&
    !timedOut;
  const isUnavailable =
    !isDemoMode &&
    (!token ||
      currentUserQuery === null ||
      ((currentUserQuery === undefined || verificationDetails === undefined) && timedOut));

  const faceStatus = React.useMemo(() => {
    if (isDemoMode) {
      return currentUser?.isVerified ? 'verified' : 'not_verified';
    }

    const backendStatus = verificationDetails?.status || currentUser?.verificationStatus || 'unverified';
    if (backendStatus === 'verified') return 'verified';
    if (backendStatus === 'pending_verification' || backendStatus === 'pending') return 'pending';
    return 'not_verified';
  }, [currentUser?.isVerified, currentUser?.verificationStatus, verificationDetails, currentUser]);

  const handleOpenVerification = useCallback(() => {
    router.push('/(main)/verification' as any);
  }, [router]);

  // Track layout position of each tip section
  const handleTipLayout = useCallback((tipKey: string, event: LayoutChangeEvent) => {
    tipPositions.current[tipKey] = event.nativeEvent.layout.y;
  }, []);

  // Track Safety Center section position
  const handleSafetyCenterLayout = useCallback((event: LayoutChangeEvent) => {
    safetyCenterOffset.current = event.nativeEvent.layout.y;
  }, []);

  // Toggle tip and auto-scroll to make expanded section visible
  const toggleTip = useCallback((tipKey: string) => {
    const isExpanding = expandedTip !== tipKey;

    setExpandedTip(isExpanding ? tipKey : null);

    // Auto-scroll when expanding a section
    if (isExpanding && scrollViewRef.current) {
      setTimeout(() => {
        const tipRelativePosition = tipPositions.current[tipKey];
        if (tipRelativePosition !== undefined) {
          const absolutePosition = safetyCenterOffset.current + tipRelativePosition + 48;
          scrollViewRef.current?.scrollTo({
            y: absolutePosition - 20,
            animated: true,
          });
        }
      }, 100);
    }
  }, [expandedTip]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleGoBack}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Safety</Text>
        <View style={{ width: 24 }} />
      </View>

      {isLoading ? (
        <View style={styles.stateContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.stateText}>Loading your safety settings...</Text>
        </View>
      ) : isUnavailable ? (
        <View style={styles.stateContainer}>
          <Ionicons name="shield-checkmark-outline" size={40} color={COLORS.textMuted} />
          <Text style={styles.stateText}>We couldn&apos;t load your safety details.</Text>
          <TouchableOpacity style={styles.stateButton} onPress={handleGoBack} accessibilityLabel="Back to profile">
            <Text style={styles.stateButtonText}>Back to Profile</Text>
          </TouchableOpacity>
        </View>
      ) : (
      <ScrollView ref={scrollViewRef} style={styles.content} contentContainerStyle={{ paddingBottom: insets.bottom + 20 }} showsVerticalScrollIndicator={false}>
        {/* Verification Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Verification</Text>
          <View style={styles.verificationCard}>
            <View style={styles.verificationHeader}>
              <View style={[
                styles.verificationIconContainer,
                faceStatus === 'pending' && styles.verificationIconPending,
                faceStatus === 'verified' && styles.badgeVerified,
              ]}>
                <Ionicons
                  name={
                    faceStatus === 'verified'
                      ? 'checkmark-circle'
                      : faceStatus === 'pending'
                        ? 'time-outline'
                        : 'person-circle-outline'
                  }
                  size={24}
                  color={
                    faceStatus === 'verified'
                      ? COLORS.success
                      : faceStatus === 'pending'
                        ? '#F59E0B'
                        : COLORS.textMuted
                  }
                />
              </View>
              <View style={styles.verificationInfo}>
                <Text style={styles.verificationTitle}>Face Verification</Text>
                <View
                  style={[
                    styles.statusPill,
                    faceStatus === 'pending' && styles.statusPillPending,
                    faceStatus === 'verified' && styles.badgeVerified,
                  ]}
                >
                  <Text
                    style={[
                      styles.statusPillText,
                      faceStatus === 'pending' && styles.statusPillTextPending,
                      faceStatus === 'verified' && styles.badgeTextVerified,
                    ]}
                  >
                    {faceStatus === 'verified'
                      ? 'Face verified'
                      : faceStatus === 'pending'
                        ? 'Verification pending'
                        : 'Not verified'}
                  </Text>
                </View>
              </View>
            </View>

            <Text style={styles.verificationDescription}>
              {faceStatus === 'verified'
                ? 'Your profile is verified.'
                : faceStatus === 'pending'
                  ? 'Your selfie is under review.'
                  : 'Verify your face to build trust on your profile.'}
            </Text>

            {faceStatus === 'pending' && (
              <View style={styles.pendingInfo}>
                <ActivityIndicator size="small" color="#F59E0B" />
                <Text style={styles.pendingInfoText}>Processing your verification...</Text>
              </View>
            )}

            <TouchableOpacity
              style={styles.verificationButton}
              onPress={handleOpenVerification}
              activeOpacity={0.8}
              accessibilityLabel="Open verification"
            >
              <Ionicons
                name={faceStatus === 'verified' ? 'shield-checkmark-outline' : 'camera-outline'}
                size={18}
                color={COLORS.white}
              />
              <Text style={styles.verificationButtonText}>
                {faceStatus === 'verified'
                  ? 'View Verification'
                  : faceStatus === 'pending'
                    ? 'Check Verification'
                    : 'Start Verification'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Blocking & Support Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Blocking & Support</Text>

          <TouchableOpacity
            style={styles.menuRow}
            onPress={() => router.push('/(main)/settings/blocked-users' as any)}
            activeOpacity={0.7}
            accessibilityLabel="Manage blocked users"
          >
            <View style={styles.menuRowLeft}>
              <Ionicons name="ban-outline" size={22} color={COLORS.text} />
              <View style={styles.menuRowInfo}>
                <Text style={styles.menuRowTitle}>Blocked users</Text>
                <Text style={styles.menuRowSubtitle}>Manage users you've blocked</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuRow}
            onPress={() => router.push('/(main)/settings/support' as any)}
            activeOpacity={0.7}
            accessibilityLabel="Get help"
          >
            <View style={styles.menuRowLeft}>
              <Ionicons name="help-circle-outline" size={22} color={COLORS.text} />
              <View style={styles.menuRowInfo}>
                <Text style={styles.menuRowTitle}>Get help</Text>
                <Text style={styles.menuRowSubtitle}>Report a problem, safety concern, or account issue.</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
          </TouchableOpacity>
        </View>

        {/* Safety Center Section */}
        <View style={styles.section} onLayout={handleSafetyCenterLayout}>
          <Text style={styles.sectionTitle}>Safety Center</Text>
          <Text style={styles.sectionSubtitle}>Tips to stay safe while dating</Text>

          {/* Spot Scammers */}
          <View onLayout={(e) => handleTipLayout('scammers', e)}>
            <TouchableOpacity
              style={styles.tipRow}
              onPress={() => toggleTip('scammers')}
              activeOpacity={0.7}
            >
              <View style={styles.tipRowLeft}>
                <Ionicons name="warning-outline" size={22} color={COLORS.text} />
                <Text style={styles.tipRowTitle}>{SAFETY_TIPS.scammers.title}</Text>
              </View>
              <Ionicons
                name={expandedTip === 'scammers' ? 'chevron-up' : 'chevron-down'}
                size={20}
                color={COLORS.textLight}
              />
            </TouchableOpacity>
            {expandedTip === 'scammers' && (
              <View style={styles.tipContent}>
                {SAFETY_TIPS.scammers.tips.map((tip, index) => (
                  <View key={index} style={styles.tipItem}>
                    <Text style={styles.tipBullet}>•</Text>
                    <Text style={styles.tipText}>{tip}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* Protect Your Account */}
          <View onLayout={(e) => handleTipLayout('protect', e)}>
            <TouchableOpacity
              style={styles.tipRow}
              onPress={() => toggleTip('protect')}
              activeOpacity={0.7}
            >
              <View style={styles.tipRowLeft}>
                <Ionicons name="key-outline" size={22} color={COLORS.text} />
                <Text style={styles.tipRowTitle}>{SAFETY_TIPS.protect.title}</Text>
              </View>
              <Ionicons
                name={expandedTip === 'protect' ? 'chevron-up' : 'chevron-down'}
                size={20}
                color={COLORS.textLight}
              />
            </TouchableOpacity>
            {expandedTip === 'protect' && (
              <View style={styles.tipContent}>
                {SAFETY_TIPS.protect.tips.map((tip, index) => (
                  <View key={index} style={styles.tipItem}>
                    <Text style={styles.tipBullet}>•</Text>
                    <Text style={styles.tipText}>{tip}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* Meet Safely */}
          <View onLayout={(e) => handleTipLayout('meetSafely', e)}>
            <TouchableOpacity
              style={styles.tipRow}
              onPress={() => toggleTip('meetSafely')}
              activeOpacity={0.7}
            >
              <View style={styles.tipRowLeft}>
                <Ionicons name="people-outline" size={22} color={COLORS.text} />
                <Text style={styles.tipRowTitle}>{SAFETY_TIPS.meetSafely.title}</Text>
              </View>
              <Ionicons
                name={expandedTip === 'meetSafely' ? 'chevron-up' : 'chevron-down'}
                size={20}
                color={COLORS.textLight}
              />
            </TouchableOpacity>
            {expandedTip === 'meetSafely' && (
              <View style={styles.tipContent}>
                {SAFETY_TIPS.meetSafely.tips.map((tip, index) => (
                  <View key={index} style={styles.tipItem}>
                    <Text style={styles.tipBullet}>•</Text>
                    <Text style={styles.tipText}>{tip}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>
      </ScrollView>
      )}

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  content: {
    flex: 1,
  },
  stateContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  stateText: {
    marginTop: 12,
    fontSize: 14,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  stateButton: {
    marginTop: 18,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: COLORS.primary,
  },
  stateButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.white,
  },
  section: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginBottom: 12,
  },

  // Badges
  badgesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
    marginBottom: 12,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  badgePending: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
  },
  badgeVerified: {
    backgroundColor: 'rgba(76, 175, 80, 0.15)',
  },
  badgeText: {
    fontSize: 13,
    fontWeight: '500',
  },
  badgeTextPending: {
    color: '#F59E0B',
  },
  badgeTextVerified: {
    color: COLORS.success,
  },

  // Verification card
  verificationCard: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
  },
  kycCard: {
    marginTop: 12,
  },
  verificationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  verificationIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  verificationIconPending: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
  },
  verificationInfo: {
    flex: 1,
  },
  verificationTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 4,
  },
  statusPill: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.border,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusPillPending: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
  },
  statusPillText: {
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.textMuted,
  },
  statusPillTextPending: {
    color: '#F59E0B',
  },
  verificationDescription: {
    fontSize: 14,
    color: COLORS.textMuted,
    lineHeight: 20,
    marginBottom: 14,
  },
  verificationButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.primary,
    paddingVertical: 12,
    borderRadius: 10,
  },
  verificationButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.white,
  },
  pendingInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  pendingInfoText: {
    fontSize: 14,
    color: '#F59E0B',
  },

  // Menu rows
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  menuRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 14,
  },
  menuRowInfo: {
    flex: 1,
  },
  menuRowTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.text,
    marginBottom: 2,
  },
  menuRowSubtitle: {
    fontSize: 13,
    color: COLORS.textMuted,
  },

  // Safety tips expandable rows
  tipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  tipRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  tipRowTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.text,
  },
  tipContent: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 8,
    padding: 14,
    marginBottom: 8,
  },
  tipItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  tipBullet: {
    fontSize: 14,
    color: COLORS.primary,
    marginRight: 8,
    marginTop: 1,
  },
  tipText: {
    flex: 1,
    fontSize: 14,
    color: COLORS.text,
    lineHeight: 20,
  },

  // Camera modal
  cameraContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  cameraHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  cameraTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.white,
  },
  cameraWrapper: {
    flex: 1,
    position: 'relative',
  },
  camera: {
    flex: 1,
  },
  cameraPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1a1a1a',
  },
  cameraPlaceholderText: {
    fontSize: 16,
    color: COLORS.textMuted,
    marginTop: 16,
  },
  faceGuideOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  faceGuideOval: {
    width: 220,
    height: 300,
    borderRadius: 110,
    borderWidth: 3,
    borderColor: COLORS.white,
    borderStyle: 'dashed',
    opacity: 0.6,
  },
  cameraInstructions: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  cameraInstructionStep: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginBottom: 4,
  },
  cameraInstructionText: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.white,
  },
  cameraActions: {
    alignItems: 'center',
    paddingBottom: 20,
  },
  captureButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  captureButtonInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.white,
  },
  progressDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    paddingBottom: 30,
  },
  progressDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  progressDotActive: {
    backgroundColor: COLORS.white,
  },
  progressDotCompleted: {
    backgroundColor: COLORS.success,
  },
});
