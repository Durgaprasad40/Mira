import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Switch,
  Alert,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import EmojiPicker from 'rn-emoji-keyboard';
import { COLORS } from '@/lib/constants';
import { ConfessionRevealPolicy, TimedRevealOption } from '@/types';
import { isContentClean } from '@/lib/contentFilter';
import { useConfessionStore } from '@/stores/confessionStore';
import { useAuthStore } from '@/stores/authStore';
import { useInteractionStore } from '@/stores/interactionStore';
import { isDemoMode } from '@/hooks/useConvex';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useDemoStore } from '@/stores/demoStore';
import { asUserId } from '@/convex/id';
import { logDebugEvent } from '@/lib/debugEventLogger';

const TIMED_OPTIONS: { value: TimedRevealOption; label: string }[] = [
  { value: 'never', label: 'Never' },
  { value: '24h', label: '24 hours' },
  { value: '48h', label: '48 hours' },
];

export default function ComposeConfessionScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { userId } = useAuthStore();
  // BUGFIX: In live mode, never use demo_user_1 fallback for Convex mutations
  const currentUserId = isDemoMode ? (userId || 'demo_user_1') : (userId || undefined);

  const addConfession = useConfessionStore((s) => s.addConfession);
  const canPostConfession = useConfessionStore((s) => s.canPostConfession);
  const recordConfessionTimestamp = useConfessionStore((s) => s.recordConfessionTimestamp);
  const setTimedReveal = useConfessionStore((s) => s.setTimedReveal);
  const createConfessionMutation = useMutation(api.confessions.createConfession);

  // Get current user profile for non-anonymous confessions
  const demoCurrentUserId = useDemoStore((s) => s.currentDemoUserId);
  const demoProfiles = useDemoStore((s) => s.demoProfiles);
  const demoMyProfile = demoCurrentUserId ? demoProfiles[demoCurrentUserId] : null;
  const convexQueryArgs = !isDemoMode && currentUserId ? { userId: asUserId(currentUserId) ?? currentUserId } : 'skip';
  const convexCurrentUser = useQuery(api.users.getCurrentUser, convexQueryArgs);

  // Helper to compute age from dateOfBirth string (YYYY-MM-DD or similar)
  const computeAge = (dateOfBirth: string | undefined): number | undefined => {
    if (!dateOfBirth) return undefined;
    const birthDate = new Date(dateOfBirth);
    if (isNaN(birthDate.getTime())) return undefined;
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age > 0 && age < 120 ? age : undefined;
  };

  // Extract author info for non-anonymous confessions
  const getAuthorInfo = (): { authorName?: string; authorPhotoUrl?: string; authorAge?: number; authorGender?: string } => {
    if (isDemoMode && demoMyProfile) {
      const result = {
        authorName: demoMyProfile.name,
        authorPhotoUrl: demoMyProfile.photos?.[0]?.url,
        authorAge: (demoMyProfile as any).age,
        authorGender: (demoMyProfile as any).gender,
      };
      if (__DEV__) console.log('[COMPOSE] getAuthorInfo DEMO:', result);
      return result;
    }
    if (!isDemoMode && convexCurrentUser) {
      const primaryPhoto = convexCurrentUser.photos?.find((p: any) => p.isPrimary) || convexCurrentUser.photos?.[0];
      const userAny = convexCurrentUser as any;
      const result = {
        authorName: userAny.firstName || userAny.name,
        authorPhotoUrl: primaryPhoto?.url,
        authorAge: computeAge(userAny.dateOfBirth),
        authorGender: userAny.gender,
      };
      if (__DEV__) console.log('[COMPOSE] getAuthorInfo REAL:', { result, convexCurrentUser, primaryPhoto });
      return result;
    }
    if (__DEV__) console.log('[COMPOSE] getAuthorInfo EMPTY - isDemoMode:', isDemoMode, 'convexCurrentUser:', convexCurrentUser);
    return {};
  };

  const [text, setText] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(true);
  const [confessToSomeone, setConfessToSomeone] = useState(false);
  const [targetUserId, setTargetUserId] = useState<string | undefined>();
  const [targetName, setTargetName] = useState<string | undefined>();
  const [revealPolicy, setRevealPolicy] = useState<ConfessionRevealPolicy>('never');
  const [timedRevealOption, setTimedRevealOption] = useState<TimedRevealOption>('never');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<TextInput>(null);

  // Listen for person picker result
  const personPickerResult = useInteractionStore((s) => s.personPickerResult);
  useEffect(() => {
    if (personPickerResult) {
      setTargetUserId(personPickerResult.userId);
      setTargetName(personPickerResult.name);
      setConfessToSomeone(true);
      useInteractionStore.getState().setPersonPickerResult(null);
    }
  }, [personPickerResult]);

  const canSubmit = text.trim().length >= 10 && !isSubmitting;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || isSubmitting) return;
    const trimmed = text.trim();

    if (isDemoMode && !canPostConfession()) {
      Alert.alert(
        'Limit Reached',
        "You've reached today's confession limit. Try again later."
      );
      return;
    }

    const phonePattern = /\b\d{10,}\b|\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/;
    const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
    if (phonePattern.test(trimmed) || emailPattern.test(trimmed)) {
      Alert.alert('Safety Warning', "Don't include phone numbers or personal details.");
      return;
    }
    if (!isContentClean(trimmed)) {
      Alert.alert('Content Warning', 'Your confession contains inappropriate content. Please revise it.');
      return;
    }
    setIsSubmitting(true);

    // Guard: require valid userId
    if (!currentUserId) {
      setIsSubmitting(false);
      return;
    }

    const finalTarget = confessToSomeone ? targetUserId : undefined;

    // Get author info for non-anonymous confessions
    const authorInfo = !isAnonymous ? getAuthorInfo() : {};

    if (__DEV__) console.log('[COMPOSE] handleSubmit - isAnonymous:', isAnonymous, 'authorInfo:', authorInfo);

    // Safety guard: prevent posting non-anonymous without profile data
    if (!isAnonymous && !authorInfo.authorName) {
      setIsSubmitting(false);
      Alert.alert(
        'Profile Not Ready',
        'Your profile is still loading. Please wait a moment and try again, or post anonymously.',
        [{ text: 'OK' }]
      );
      return;
    }

    try {
      if (isDemoMode) {
        const createdAt = Date.now();
        const confessionId = `conf_new_${Date.now()}`;

        addConfession({
          id: confessionId,
          userId: currentUserId,
          text: trimmed,
          isAnonymous,
          mood: 'emotional' as const,
          topEmojis: [],
          replyPreviews: [],
          targetUserId: finalTarget,
          visibility: 'global' as const,
          replyCount: 0,
          reactionCount: 0,
          createdAt,
          expiresAt: createdAt + 24 * 60 * 60 * 1000,
          revealPolicy: revealPolicy || 'never',
          ...(authorInfo.authorName ? { authorName: authorInfo.authorName } : {}),
          ...(authorInfo.authorPhotoUrl ? { authorPhotoUrl: authorInfo.authorPhotoUrl } : {}),
          ...(authorInfo.authorAge ? { authorAge: authorInfo.authorAge } : {}),
          ...(authorInfo.authorGender ? { authorGender: authorInfo.authorGender } : {}),
        });
        recordConfessionTimestamp();

        if (timedRevealOption && timedRevealOption !== 'never' && finalTarget) {
          setTimedReveal(confessionId, timedRevealOption, finalTarget);
        }

        if (finalTarget) {
          const { addSecretCrush } = useConfessionStore.getState();
          addSecretCrush({
            id: `sc_new_${Date.now()}`,
            fromUserId: currentUserId,
            toUserId: finalTarget,
            confessionText: trimmed,
            isRevealed: false,
            createdAt: Date.now(),
            expiresAt: Date.now() + 1000 * 60 * 60 * 48,
          });
        }
      } else {
        const mutationPayload = {
          text: trimmed,
          isAnonymous,
          mood: 'emotional' as any,
          visibility: 'global' as any,
          ...(finalTarget ? { taggedUserId: finalTarget as any } : {}),
          ...(authorInfo.authorName ? { authorName: authorInfo.authorName } : {}),
          ...(authorInfo.authorPhotoUrl ? { authorPhotoUrl: authorInfo.authorPhotoUrl } : {}),
          ...(authorInfo.authorAge ? { authorAge: authorInfo.authorAge } : {}),
          ...(authorInfo.authorGender ? { authorGender: authorInfo.authorGender } : {}),
        };
        if (__DEV__) console.log('[COMPOSE] mutation payload:', mutationPayload);
        await createConfessionMutation(mutationPayload);
      }

      logDebugEvent('CONFESSION_CREATED', 'New confession posted');
      if (finalTarget) {
        logDebugEvent('CONFESSION_TAGGED', 'Confession tagged someone');
      }

      router.back();
    } catch (error: any) {
      setIsSubmitting(false);
      Alert.alert('Error', error?.message || 'Failed to post confession');
    }
  }, [canSubmit, isSubmitting, text, isAnonymous, confessToSomeone, targetUserId, revealPolicy, timedRevealOption, currentUserId, addConfession, canPostConfession, recordConfessionTimestamp, setTimedReveal, createConfessionMutation, router, isDemoMode]);

  const handleEmojiSelected = (emoji: any) => {
    setText((prev) => prev + emoji.emoji);
  };

  const handlePickPerson = () => {
    router.push('/(main)/person-picker' as any);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="close" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>New Confession</Text>
        <TouchableOpacity
          onPress={handleSubmit}
          disabled={!canSubmit || isSubmitting}
          style={[styles.submitButton, (!canSubmit || isSubmitting) && styles.submitButtonDisabled]}
        >
          <Text style={[styles.submitText, (!canSubmit || isSubmitting) && styles.submitTextDisabled]}>
            {isSubmitting ? 'Posting...' : 'Post'}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollBody}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 28 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.introCard}>
          <View style={styles.introIcon}>
            <Ionicons name="sparkles-outline" size={18} color={COLORS.primary} />
          </View>
          <View style={styles.introCopy}>
            <Text style={styles.introTitle}>Share something real</Text>
            <Text style={styles.introSubtitle}>Keep it thoughtful, kind, and free of personal contact details.</Text>
          </View>
        </View>

        {/* Safety text */}
        <View style={styles.safetyBanner}>
          <Ionicons name="shield-checkmark" size={14} color={COLORS.primary} />
          <Text style={styles.safetyText}>Don't include phone numbers or personal details.</Text>
        </View>

        {/* Text Input */}
        <TextInput
          ref={inputRef}
          style={styles.textInput}
          placeholder="What's on your mind? Share your confession..."
          placeholderTextColor={COLORS.textMuted}
          multiline
          maxLength={500}
          value={text}
          onChangeText={setText}
          autoFocus
          textAlignVertical="top"
        />

        {/* Toolbar row */}
        <View style={styles.toolbarRow}>
          <TouchableOpacity onPress={() => setShowEmojiPicker(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={{ fontSize: 20 }}>🙂</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }} />
          <Text style={styles.charCount}>{text.length}/500</Text>
        </View>

        {/* Anonymous / Open Toggle */}
        <View style={styles.toggleRow}>
          <View style={styles.toggleInfo}>
            <Ionicons
              name={isAnonymous ? 'eye-off' : 'person'}
              size={20}
              color={isAnonymous ? COLORS.textMuted : COLORS.primary}
            />
            <View>
              <Text style={styles.toggleLabel}>{isAnonymous ? 'Anonymous' : 'Open'}</Text>
              <Text style={styles.toggleDesc}>
                {isAnonymous ? 'Your identity is hidden' : 'Your name will be shown'}
              </Text>
            </View>
          </View>
          <Switch
            value={!isAnonymous}
            onValueChange={(val) => setIsAnonymous(!val)}
            trackColor={{ false: COLORS.border, true: COLORS.primaryLight }}
            thumbColor={!isAnonymous ? COLORS.primary : '#f4f3f4'}
          />
        </View>

        {/* Confess to Someone Toggle */}
        <View style={styles.toggleRow}>
          <View style={styles.toggleInfo}>
            <Ionicons
              name="heart"
              size={20}
              color={confessToSomeone ? COLORS.primary : COLORS.textMuted}
            />
            <View>
              <Text style={styles.toggleLabel}>Confess to Someone</Text>
              <Text style={styles.toggleDesc}>
                {confessToSomeone
                  ? targetName
                    ? `Sending to ${targetName}`
                    : 'Tap to pick a person'
                  : 'Send this to someone you have already liked'}
              </Text>
            </View>
          </View>
          <Switch
            value={confessToSomeone}
            onValueChange={(val) => {
              setConfessToSomeone(val);
              if (val && !targetUserId) {
                handlePickPerson();
              }
            }}
            trackColor={{ false: COLORS.border, true: COLORS.primaryLight }}
            thumbColor={confessToSomeone ? COLORS.primary : '#f4f3f4'}
          />
        </View>

        {confessToSomeone && (
          <TouchableOpacity
            style={styles.pickPersonButton}
            onPress={handlePickPerson}
          >
            <Text style={styles.pickPersonText}>
              {targetName ? `Change person (${targetName})` : 'Pick a person'}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={COLORS.primary} />
          </TouchableOpacity>
        )}

        {isDemoMode && (
          <>
            {/* Reveal Policy */}
            <View style={styles.toggleRow}>
              <View style={styles.toggleInfo}>
                <Ionicons
                  name={revealPolicy === 'allow_later' ? 'eye' : 'eye-off'}
                  size={20}
                  color={revealPolicy === 'allow_later' ? COLORS.primary : COLORS.textMuted}
                />
                <View>
                  <Text style={styles.toggleLabel}>Allow Reveal Later</Text>
                  <Text style={styles.toggleDesc}>
                    {revealPolicy === 'allow_later'
                      ? 'You can reveal your identity in chat'
                      : 'Identity stays hidden forever'}
                  </Text>
                </View>
              </View>
              <Switch
                value={revealPolicy === 'allow_later'}
                onValueChange={(val) => setRevealPolicy(val ? 'allow_later' : 'never')}
                trackColor={{ false: COLORS.border, true: COLORS.primaryLight }}
                thumbColor={revealPolicy === 'allow_later' ? COLORS.primary : '#f4f3f4'}
              />
            </View>

            {/* Timed Reveal */}
            {confessToSomeone && revealPolicy === 'allow_later' && (
              <View style={styles.timedSection}>
                <Text style={styles.timedLabel}>Auto-reveal identity after:</Text>
                <View style={styles.timedRow}>
                  {TIMED_OPTIONS.map((opt) => (
                    <TouchableOpacity
                      key={opt.value}
                      style={[
                        styles.timedChip,
                        timedRevealOption === opt.value && styles.timedChipActive,
                      ]}
                      onPress={() => setTimedRevealOption(opt.value)}
                    >
                      <Text
                        style={[
                          styles.timedChipText,
                          timedRevealOption === opt.value && styles.timedChipTextActive,
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* Emoji Picker */}
      <EmojiPicker
        onEmojiSelected={handleEmojiSelected}
        open={showEmojiPicker}
        onClose={() => setShowEmojiPicker(false)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.backgroundDark,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
  },
  submitButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
  },
  submitButtonDisabled: {
    backgroundColor: COLORS.border,
  },
  submitText: {
    color: COLORS.white,
    fontWeight: '700',
    fontSize: 14,
  },
  submitTextDisabled: {
    color: COLORS.textMuted,
  },
  scrollBody: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 12,
  },
  introCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 18,
    backgroundColor: COLORS.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
  },
  introIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,107,107,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  introCopy: {
    flex: 1,
  },
  introTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 3,
  },
  introSubtitle: {
    fontSize: 13,
    lineHeight: 19,
    color: COLORS.textMuted,
  },
  safetyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    backgroundColor: COLORS.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    borderColor: COLORS.border,
  },
  safetyText: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  textInput: {
    fontSize: 16,
    lineHeight: 24,
    color: COLORS.text,
    marginHorizontal: 16,
    paddingHorizontal: 16,
    paddingTop: 16,
    backgroundColor: COLORS.white,
    minHeight: 120,
    maxHeight: 220,
  },
  toolbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginHorizontal: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: COLORS.white,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
    borderColor: COLORS.border,
    marginBottom: 12,
  },
  charCount: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: COLORS.white,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    marginBottom: 12,
  },
  toggleInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  toggleLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  toggleDesc: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  pickPersonButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginTop: -4,
    marginBottom: 12,
    borderRadius: 16,
    backgroundColor: COLORS.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
  },
  pickPersonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
  },
  timedSection: {
    marginHorizontal: 16,
    marginTop: -4,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 14,
    borderRadius: 16,
    backgroundColor: COLORS.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
  },
  timedLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
  },
  timedRow: {
    flexDirection: 'row',
    gap: 8,
  },
  timedChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  timedChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  timedChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
  },
  timedChipTextActive: {
    color: COLORS.white,
  },
});
