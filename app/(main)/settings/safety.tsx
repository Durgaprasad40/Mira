import React, { useState, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, LayoutChangeEvent, Modal, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';
import { useVerificationStore } from '@/stores/verificationStore';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { CameraView, useCameraPermissions } from 'expo-camera';

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

  // Verification store
  const faceStatus = useVerificationStore((s) => s.faceStatus);
  const kycStatus = useVerificationStore((s) => s.kycStatus);
  const startFaceVerification = useVerificationStore((s) => s.startFaceVerification);
  const completeFaceVerification = useVerificationStore((s) => s.completeFaceVerification);
  const startKycVerification = useVerificationStore((s) => s.startKycVerification);
  const completeKycVerification = useVerificationStore((s) => s.completeKycVerification);

  // Subscription store - KYC enabled for paid subscribers (basic or premium)
  const subscriptionTier = useSubscriptionStore((s) => s.tier);
  const hasPaidPlan = subscriptionTier !== 'free';

  // Camera state for face verification
  const [showCamera, setShowCamera] = useState(false);
  const [captureStep, setCaptureStep] = useState(0); // 0: neutral, 1: left, 2: right
  const [isCapturing, setIsCapturing] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  // Track which safety tip section is expanded
  const [expandedTip, setExpandedTip] = useState<string | null>(null);

  // ScrollView ref for auto-scroll
  const scrollViewRef = useRef<ScrollView>(null);

  // Track Y positions of tip sections for auto-scroll
  const tipPositions = useRef<Record<string, number>>({});
  const safetyCenterOffset = useRef<number>(0);

  // Capture instructions for each step
  const captureInstructions = [
    'Look straight at the camera',
    'Turn your head slightly left',
    'Turn your head slightly right',
  ];

  // Handle face verification start
  const handleStartFaceVerification = async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert('Camera Permission', 'Camera access is required for face verification.');
        return;
      }
    }
    setCaptureStep(0);
    setShowCamera(true);
  };

  // Handle camera modal close — reset all capture state to prevent stale step on reopen
  const handleCloseCamera = () => {
    setShowCamera(false);
    setCaptureStep(0);
    setIsCapturing(false);
  };

  // Capture a frame
  const handleCaptureFrame = async () => {
    if (!cameraRef.current || isCapturing) return;

    setIsCapturing(true);

    try {
      // Simulate capture (in real app, would use takePictureAsync)
      await new Promise((resolve) => setTimeout(resolve, 500));

      if (captureStep < 2) {
        // Move to next capture step
        setCaptureStep((prev) => prev + 1);
      } else {
        // All frames captured, close camera and set to pending
        setShowCamera(false);
        setCaptureStep(0);
        startFaceVerification();

        // Simulate backend processing (mock: auto-verify after 2s for demo)
        setTimeout(() => {
          completeFaceVerification();
        }, 2000);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to capture. Please try again.');
    } finally {
      setIsCapturing(false);
    }
  };

  // Handle KYC verification start
  const handleStartKycVerification = () => {
    if (!hasPaidPlan) {
      Alert.alert(
        'Subscription Required',
        'KYC verification is available for paid subscribers only.',
        [{ text: 'OK' }]
      );
      return;
    }

    Alert.alert(
      'Start KYC Verification',
      'This will begin the identity verification process. You\'ll need to provide a government-issued ID.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          onPress: () => {
            startKycVerification();
            // Mock: auto-complete after 3s for demo
            setTimeout(() => {
              completeKycVerification();
            }, 3000);
          },
        },
      ]
    );
  };

  const handleReportUser = () => {
    router.push('/(main)/settings/report-user' as any);
  };

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
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Safety</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView ref={scrollViewRef} style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Verification Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Verification</Text>

          {/* ───────────────────────────────────────────────────────────────
              BADGES (Always at top when earned)
             ─────────────────────────────────────────────────────────────── */}
          {(faceStatus === 'pending' || faceStatus === 'verified' || kycStatus === 'verified') && (
            <View style={styles.badgesContainer}>
              {/* Face Verification Badge */}
              {faceStatus === 'pending' && (
                <View style={[styles.badge, styles.badgePending]}>
                  <Ionicons name="time-outline" size={14} color="#F59E0B" />
                  <Text style={[styles.badgeText, styles.badgeTextPending]}>Face verification pending</Text>
                </View>
              )}
              {faceStatus === 'verified' && (
                <View style={[styles.badge, styles.badgeVerified]}>
                  <Ionicons name="checkmark-circle" size={14} color={COLORS.success} />
                  <Text style={[styles.badgeText, styles.badgeTextVerified]}>Face verified</Text>
                </View>
              )}

              {/* KYC Verification Badge - only shown when verified */}
              {kycStatus === 'verified' && (
                <View style={[styles.badge, styles.badgeVerified]}>
                  <Ionicons name="shield-checkmark" size={14} color={COLORS.success} />
                  <Text style={[styles.badgeText, styles.badgeTextVerified]}>Identity verified</Text>
                </View>
              )}
            </View>
          )}

          {/* ───────────────────────────────────────────────────────────────
              FACE VERIFICATION SECTION (only if not verified)
             ─────────────────────────────────────────────────────────────── */}
          {faceStatus !== 'verified' && (
            <View style={styles.verificationCard}>
              <View style={styles.verificationHeader}>
                <View style={[
                  styles.verificationIconContainer,
                  faceStatus === 'pending' && styles.verificationIconPending,
                ]}>
                  <Ionicons
                    name="person-circle-outline"
                    size={24}
                    color={faceStatus === 'pending' ? '#F59E0B' : COLORS.textMuted}
                  />
                </View>
                <View style={styles.verificationInfo}>
                  <Text style={styles.verificationTitle}>Face Verification</Text>
                  <View style={[
                    styles.statusPill,
                    faceStatus === 'pending' && styles.statusPillPending,
                  ]}>
                    <Text style={[
                      styles.statusPillText,
                      faceStatus === 'pending' && styles.statusPillTextPending,
                    ]}>
                      {faceStatus === 'pending' ? 'Verification pending' : 'Not verified'}
                    </Text>
                  </View>
                </View>
              </View>

              <Text style={styles.verificationDescription}>
                Verify your face to build trust and improve match quality.
              </Text>

              {/* CTA only if not started */}
              {faceStatus === 'not_verified' && (
                <TouchableOpacity style={styles.verificationButton} onPress={handleStartFaceVerification}>
                  <Ionicons name="camera-outline" size={18} color={COLORS.white} />
                  <Text style={styles.verificationButtonText}>Start Verification</Text>
                </TouchableOpacity>
              )}

              {/* Pending state - no CTA, just info */}
              {faceStatus === 'pending' && (
                <View style={styles.pendingInfo}>
                  <ActivityIndicator size="small" color="#F59E0B" />
                  <Text style={styles.pendingInfoText}>Processing your verification...</Text>
                </View>
              )}
            </View>
          )}

          {/* ───────────────────────────────────────────────────────────────
              KYC VERIFICATION SECTION
             ─────────────────────────────────────────────────────────────── */}
          {kycStatus !== 'verified' && (
            <View style={[styles.verificationCard, styles.kycCard]}>
              <View style={styles.verificationHeader}>
                <View style={[
                  styles.verificationIconContainer,
                  kycStatus === 'pending' && styles.verificationIconPending,
                ]}>
                  <Ionicons
                    name="id-card-outline"
                    size={24}
                    color={kycStatus === 'pending' ? '#F59E0B' : COLORS.textMuted}
                  />
                </View>
                <View style={styles.verificationInfo}>
                  <Text style={styles.verificationTitle}>KYC Verification</Text>
                  <View style={[
                    styles.statusPill,
                    kycStatus === 'pending' && styles.statusPillPending,
                  ]}>
                    <Text style={[
                      styles.statusPillText,
                      kycStatus === 'pending' && styles.statusPillTextPending,
                    ]}>
                      {kycStatus === 'pending' ? 'Verification pending' : 'Not started'}
                    </Text>
                  </View>
                </View>
              </View>

              <Text style={styles.verificationDescription}>
                Required only for certain features or payments.
              </Text>

              {/* CTA only if not started and has paid plan */}
              {kycStatus === 'not_started' && (
                <TouchableOpacity
                  style={[
                    styles.verificationButton,
                    !hasPaidPlan && styles.verificationButtonDisabled,
                  ]}
                  onPress={handleStartKycVerification}
                  activeOpacity={hasPaidPlan ? 0.8 : 1}
                >
                  <Ionicons name="shield-outline" size={18} color={hasPaidPlan ? COLORS.white : COLORS.textMuted} />
                  <Text style={[
                    styles.verificationButtonText,
                    !hasPaidPlan && styles.verificationButtonTextDisabled,
                  ]}>
                    Start KYC Verification
                  </Text>
                </TouchableOpacity>
              )}

              {/* Show gating message if no paid plan */}
              {kycStatus === 'not_started' && !hasPaidPlan && (
                <Text style={styles.kycGatingText}>
                  Available for paid subscribers
                </Text>
              )}

              {/* Pending state */}
              {kycStatus === 'pending' && (
                <View style={styles.pendingInfo}>
                  <ActivityIndicator size="small" color="#F59E0B" />
                  <Text style={styles.pendingInfoText}>Processing your verification...</Text>
                </View>
              )}
            </View>
          )}

        </View>

        {/* Blocking & Reporting Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Blocking & Reporting</Text>

          <TouchableOpacity style={styles.menuRow} onPress={handleReportUser} activeOpacity={0.7}>
            <View style={styles.menuRowLeft}>
              <Ionicons name="flag-outline" size={22} color={COLORS.text} />
              <View style={styles.menuRowInfo}>
                <Text style={styles.menuRowTitle}>Report a user</Text>
                <Text style={styles.menuRowSubtitle}>Report suspicious or harmful behavior</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuRow}
            onPress={() => router.push('/(main)/settings/blocked-users' as any)}
            activeOpacity={0.7}
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

      {/* ───────────────────────────────────────────────────────────────
          FACE VERIFICATION CAMERA MODAL
         ─────────────────────────────────────────────────────────────── */}
      <Modal
        visible={showCamera}
        animationType="slide"
        onRequestClose={handleCloseCamera}
      >
        <SafeAreaView style={styles.cameraContainer}>
          <View style={styles.cameraHeader}>
            <TouchableOpacity
              onPress={handleCloseCamera}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons name="close" size={28} color={COLORS.white} />
            </TouchableOpacity>
            <Text style={styles.cameraTitle}>Face Verification</Text>
            <View style={{ width: 28 }} />
          </View>

          {/* Camera view */}
          <View style={styles.cameraWrapper}>
            {permission?.granted ? (
              <CameraView
                ref={cameraRef}
                style={styles.camera}
                facing="front"
              />
            ) : (
              <View style={styles.cameraPlaceholder}>
                <Ionicons name="camera-outline" size={64} color={COLORS.textMuted} />
                <Text style={styles.cameraPlaceholderText}>Camera access required</Text>
              </View>
            )}

            {/* Oval face guide overlay */}
            <View style={styles.faceGuideOverlay}>
              <View style={styles.faceGuideOval} />
            </View>
          </View>

          {/* Instructions */}
          <View style={styles.cameraInstructions}>
            <Text style={styles.cameraInstructionStep}>
              Step {captureStep + 1} of 3
            </Text>
            <Text style={styles.cameraInstructionText}>
              {captureInstructions[captureStep]}
            </Text>
          </View>

          {/* Capture button */}
          <View style={styles.cameraActions}>
            <TouchableOpacity
              style={[styles.captureButton, isCapturing && styles.captureButtonDisabled]}
              onPress={handleCaptureFrame}
              disabled={isCapturing}
            >
              {isCapturing ? (
                <ActivityIndicator size="small" color={COLORS.white} />
              ) : (
                <View style={styles.captureButtonInner} />
              )}
            </TouchableOpacity>
          </View>

          {/* Progress dots */}
          <View style={styles.progressDots}>
            {[0, 1, 2].map((step) => (
              <View
                key={step}
                style={[
                  styles.progressDot,
                  step <= captureStep && styles.progressDotActive,
                  step < captureStep && styles.progressDotCompleted,
                ]}
              />
            ))}
          </View>
        </SafeAreaView>
      </Modal>
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
  verificationButtonDisabled: {
    backgroundColor: COLORS.border,
  },
  verificationButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.white,
  },
  verificationButtonTextDisabled: {
    color: COLORS.textMuted,
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
  kycGatingText: {
    fontSize: 12,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 8,
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
  captureButtonDisabled: {
    opacity: 0.7,
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
