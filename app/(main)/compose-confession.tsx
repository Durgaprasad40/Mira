import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ScrollView,
  Animated,
  Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import EmojiPicker from 'rn-emoji-keyboard';
import { COLORS } from '@/lib/constants';
import { ConfessionRevealPolicy, TimedRevealOption, ConfessionAuthorVisibility } from '@/types';
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
      // SINGLE SOURCE OF TRUTH: First photo (index 0) is always main
      const primaryPhoto = convexCurrentUser.photos?.[0];
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
  const [authorVisibility, setAuthorVisibility] = useState<ConfessionAuthorVisibility>('anonymous');
  const [confessToSomeone, setConfessToSomeone] = useState(false);
  const [targetUserId, setTargetUserId] = useState<string | undefined>();
  const [targetName, setTargetName] = useState<string | undefined>();
  const [revealPolicy, setRevealPolicy] = useState<ConfessionRevealPolicy>('never');
  const [timedRevealOption, setTimedRevealOption] = useState<TimedRevealOption>('never');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const [showToast, setShowToast] = useState(false);

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

  const handleSubmit = useCallback(() => {
    if (!canSubmit || isSubmitting) return;
    const trimmed = text.trim();
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

    const confessionId = `conf_new_${Date.now()}`;
    const finalTarget = confessToSomeone ? targetUserId : undefined;

    // Convert visibility mode to legacy isAnonymous for backward compatibility
    const isAnonymous = authorVisibility === 'anonymous';
    // Get author info for non-anonymous confessions (open and blur_photo modes)
    const includeAuthorInfo = authorVisibility !== 'anonymous';
    const authorInfo = includeAuthorInfo ? getAuthorInfo() : {};

    if (__DEV__) console.log('[COMPOSE] handleSubmit - authorVisibility:', authorVisibility, 'isAnonymous:', isAnonymous, 'authorInfo:', authorInfo);

    // Safety guard: prevent posting non-anonymous without profile data
    if (includeAuthorInfo && !authorInfo.authorName) {
      setIsSubmitting(false);
      Alert.alert(
        'Profile Not Ready',
        'Your profile is still loading. Please wait a moment and try again, or post anonymously.',
        [{ text: 'OK' }]
      );
      return;
    }

    addConfession({
      id: confessionId,
      userId: currentUserId,
      text: trimmed,
      isAnonymous,
      authorVisibility, // New 3-mode visibility
      mood: 'emotional' as const,
      topEmojis: [],
      replyPreviews: [],
      targetUserId: finalTarget,
      visibility: 'global' as const,
      replyCount: 0,
      reactionCount: 0,
      createdAt: Date.now(),
      revealPolicy: revealPolicy || 'never',
      // Include author identity for non-anonymous confessions (open and blur_photo modes)
      ...(authorInfo.authorName ? { authorName: authorInfo.authorName } : {}),
      ...(authorInfo.authorPhotoUrl ? { authorPhotoUrl: authorInfo.authorPhotoUrl } : {}),
      ...(authorInfo.authorAge ? { authorAge: authorInfo.authorAge } : {}),
      ...(authorInfo.authorGender ? { authorGender: authorInfo.authorGender } : {}),
    });

    // Debug event logging
    logDebugEvent('CONFESSION_CREATED', 'New confession posted');
    if (finalTarget) {
      logDebugEvent('CONFESSION_TAGGED', 'Confession tagged someone');
    }

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

    // Sync to backend (only if we have a valid userId)
    if (!isDemoMode && currentUserId) {
      const mutationPayload = {
        userId: currentUserId as any,
        text: trimmed,
        isAnonymous,
        authorVisibility, // New 3-mode visibility
        mood: 'emotional' as any,
        visibility: 'global' as any,
        // Include tagged user if confessing to someone
        ...(finalTarget ? { taggedUserId: finalTarget as any } : {}),
        // Include author identity for non-anonymous confessions (open and blur_photo modes)
        ...(authorInfo.authorName ? { authorName: authorInfo.authorName } : {}),
        ...(authorInfo.authorPhotoUrl ? { authorPhotoUrl: authorInfo.authorPhotoUrl } : {}),
        ...(authorInfo.authorAge ? { authorAge: authorInfo.authorAge } : {}),
        ...(authorInfo.authorGender ? { authorGender: authorInfo.authorGender } : {}),
      };
      if (__DEV__) console.log('[COMPOSE] mutation payload:', mutationPayload);
      createConfessionMutation(mutationPayload).catch((error: any) => {
        Alert.alert('Error', error.message || 'Failed to post confession');
      });
    }

    // Navigate back
    router.back();
  }, [canSubmit, isSubmitting, text, authorVisibility, confessToSomeone, targetUserId, revealPolicy, timedRevealOption, currentUserId, addConfession, setTimedReveal, createConfessionMutation, router]);

  const handleEmojiSelected = (emoji: any) => {
    setText((prev) => prev + emoji.emoji);
  };

  const handlePickPerson = () => {
    router.push('/(main)/person-picker' as any);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
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
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
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

        {/* Visibility Mode Selection - 3 side-by-side options */}
        <View style={styles.visibilitySection}>
          <Text style={styles.visibilitySectionTitle}>How others will see you</Text>
          <View style={styles.visibilityOptions}>
            {/* Anonymous option */}
            <TouchableOpacity
              style={[
                styles.visibilityOption,
                authorVisibility === 'anonymous' && styles.visibilityOptionSelected,
              ]}
              onPress={() => setAuthorVisibility('anonymous')}
              activeOpacity={0.7}
            >
              <View style={[
                styles.visibilityIconWrap,
                authorVisibility === 'anonymous' && styles.visibilityIconWrapSelected,
              ]}>
                <Ionicons
                  name="eye-off"
                  size={18}
                  color={authorVisibility === 'anonymous' ? COLORS.white : COLORS.textMuted}
                />
              </View>
              <Text style={[
                styles.visibilityLabel,
                authorVisibility === 'anonymous' && styles.visibilityLabelSelected,
              ]}>Anonymous</Text>
            </TouchableOpacity>

            {/* Open to all option */}
            <TouchableOpacity
              style={[
                styles.visibilityOption,
                authorVisibility === 'open' && styles.visibilityOptionSelected,
              ]}
              onPress={() => setAuthorVisibility('open')}
              activeOpacity={0.7}
            >
              <View style={[
                styles.visibilityIconWrap,
                authorVisibility === 'open' && styles.visibilityIconWrapSelected,
              ]}>
                <Ionicons
                  name="person"
                  size={18}
                  color={authorVisibility === 'open' ? COLORS.white : COLORS.textMuted}
                />
              </View>
              <Text style={[
                styles.visibilityLabel,
                authorVisibility === 'open' && styles.visibilityLabelSelected,
              ]}>Open to all</Text>
            </TouchableOpacity>

            {/* Blur photo option */}
            <TouchableOpacity
              style={[
                styles.visibilityOption,
                authorVisibility === 'blur_photo' && styles.visibilityOptionSelected,
              ]}
              onPress={() => setAuthorVisibility('blur_photo')}
              activeOpacity={0.7}
            >
              <View style={[
                styles.visibilityIconWrap,
                authorVisibility === 'blur_photo' && styles.visibilityIconWrapSelected,
              ]}>
                <Ionicons
                  name="eye"
                  size={18}
                  color={authorVisibility === 'blur_photo' ? COLORS.white : COLORS.textMuted}
                />
              </View>
              <Text style={[
                styles.visibilityLabel,
                authorVisibility === 'blur_photo' && styles.visibilityLabelSelected,
              ]}>Blur photo</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Helper explanation section */}
        <View style={styles.helperSection}>
          <Text style={styles.helperTitle}>How your confession will appear</Text>
          <Text style={styles.helperBulletText}>
            • <Text style={styles.helperBulletLabel}>Anonymous:</Text> your name, photo, and profile details will be completely hidden from everyone
          </Text>
          <Text style={styles.helperBulletText}>
            • <Text style={styles.helperBulletLabel}>Open:</Text> your profile will be visible with the confession, so people can see who posted it
          </Text>
          <Text style={styles.helperBulletText}>
            • <Text style={styles.helperBulletLabel}>Mention username:</Text> tag someone you like so your confession directly reaches them
          </Text>
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
                  : 'Send a secret confession to someone'}
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
    backgroundColor: COLORS.white,
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
    paddingBottom: 40,
  },
  safetyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,107,107,0.06)',
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
    paddingHorizontal: 16,
    paddingTop: 16,
    minHeight: 120,
    maxHeight: 220,
  },
  toolbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  charCount: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
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
  // Visibility mode selector styles (3 options)
  visibilitySection: {
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  visibilitySectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12,
  },
  visibilityOptions: {
    flexDirection: 'row',
    gap: 10,
  },
  visibilityOption: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  visibilityOptionSelected: {
    borderColor: COLORS.primary,
    backgroundColor: 'rgba(255,107,107,0.08)',
  },
  visibilityIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(153,153,153,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  visibilityIconWrapSelected: {
    backgroundColor: COLORS.primary,
  },
  visibilityLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textMuted,
    textAlign: 'center',
  },
  visibilityLabelSelected: {
    color: COLORS.primary,
  },
  // Helper instructions section (minimal)
  helperSection: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginTop: 4,
  },
  helperTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textMuted,
    marginBottom: 8,
  },
  helperBulletText: {
    fontSize: 12,
    lineHeight: 20,
    color: COLORS.textMuted,
  },
  helperBulletLabel: {
    fontWeight: '600',
  },
  pickPersonButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginBottom: 4,
    borderRadius: 10,
    backgroundColor: 'rgba(255,107,107,0.08)',
  },
  pickPersonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
  },
  timedSection: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 14,
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
