/**
 * PHASE-2 FULL PROFILE VIEW
 *
 * Dedicated Phase-2 profile screen matching Phase-1 full-profile UX but with:
 * - Phase-2 data sources only (privateDiscover.getProfileByUserId)
 * - Phase-2 categories, prompts, and styling
 * - No Phase-1 route leakage
 *
 * STRICT ISOLATION: This is a Phase-2-only route under /(main)/(private)/
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  Dimensions,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { Id } from '@/convex/_generated/dataModel';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { useDiscoverStore } from '@/stores/discoverStore';
import { useInteractionStore } from '@/stores/interactionStore';
import {
  INCOGNITO_COLORS,
  ACTIVITY_FILTERS,
  EDUCATION_OPTIONS,
  RELIGION_OPTIONS,
} from '@/lib/constants';
import { cmToFeetInches } from '@/lib/utils';
import {
  PRIVATE_INTENT_CATEGORIES,
  PRIVATE_DESIRE_TAGS,
  getPhase2PromptSection,
  type Phase2PromptSection,
} from '@/lib/privateConstants';
import { isDemoMode } from '@/hooks/useConvex';
import { useScreenTrace } from '@/lib/devTrace';
import { Toast } from '@/components/ui/Toast';
import { StandOutComposerSheet } from '@/components/discover/StandOutComposerSheet';
import { ReportBlockModal } from '@/components/security/ReportBlockModal';
// P2-004: Centralized gender icon utility
import { getGenderIcon } from '@/lib/genderIcon';
import { formatPhase2DistanceMiles } from '@/lib/phase2Distance';
import { getVerificationDisplay } from '@/lib/verificationStatus';
// Phase-2 (Deep Connect) action-row tokens — opened-profile mirrors the
// homepage swipe-card action row exactly so the two surfaces feel identical.
import {
  DC_BUTTON_DIAMETER,
  DC_BUTTON_DIAMETER_COMPACT,
  DC_ICON_SIZE,
  DC_STAR_ICON_SIZE,
  DC_BUTTON_GAP,
  DC_ROW_PADDING_X,
  DC_PRESS_SCALE,
  DC_BUTTON_SHADOW,
  DC_GLASS_BORDER_WIDTH,
  DC_GLASS_BORDER_LIGHT,
  DC_GLASS_BORDER_PASS,
  DC_GLASS_HIGHLIGHT_COLORS_LIGHT,
  DC_GLASS_HIGHLIGHT_COLORS_PASS,
  DC_GLASS_HIGHLIGHT_LOCATIONS,
  DC_GLASS_HIGHLIGHT_START,
  DC_GLASS_HIGHLIGHT_END,
  getDeepConnectBottomLayout,
} from '@/components/screens/_internal/deepConnectActionRow.tokens';

const C = INCOGNITO_COLORS;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const PHOTO_HEIGHT = SCREEN_HEIGHT * 0.55;

// ═══════════════════════════════════════════════════════════════════════════
// PHASE-2 DEEP CONNECT — deeper misty-blue premium palette.
// Reads clearly as blue (never as white/cream/settings-page).
// Local-only; does not export, does not mutate INCOGNITO_COLORS.
// ═══════════════════════════════════════════════════════════════════════════
const P2 = {
  pageBg: '#DCE5F2',          // misty soft blue page surface (clearly blue)
  cardBg: '#E8EEF8',          // pale blue glass card (never reads as white)
  cardBgAlt: '#E1E9F4',       // slightly cooler card variant
  border: '#C7D3E5',          // cool blue hairline
  text: '#0F1E3D',            // deep navy ink
  textMuted: '#445B81',       // slate-blue body
  textSubtle: '#7889A3',      // gentle label / placeholder
  chipBg: '#D2DCEC',          // blue-gray chip fill (single system)
  chipBgStrong: '#C5D2E6',    // grouped/emphasised chip variant
  accent: C.primary,          // brand accent — verified tick only
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// FLOATING ACTION BUTTONS COMPONENT
//
// Mirrors the Phase-2 (Deep Connect) homepage swipe-card action row exactly:
//   • Same diameters (62 / 54 / 62 via cappedScale tokens)
//   • Same lit-edge glass border (1.5px, white/red-accent)
//   • Same neutral drop shadow (DC_BUTTON_SHADOW)
//   • Same 3-stop inner sheen LinearGradient (orb depth, not flat circle)
//   • Same press scale (DC_PRESS_SCALE, 0.9)
//   • Same gap + horizontal padding (DC_BUTTON_GAP / DC_ROW_PADDING_X)
//   • Numeric "remaining" badge intentionally hidden (per product spec)
// ═══════════════════════════════════════════════════════════════════════════
interface FloatingActionButtonsProps {
  onPass: () => void;
  onStandOut: () => void;
  onLike: () => void;
  standOutDisabled: boolean;
  bottomInset: number;
}

function FloatingActionButtons({
  onPass,
  onStandOut,
  onLike,
  standOutDisabled,
  bottomInset,
}: FloatingActionButtonsProps) {
  // Animation scales for each button
  const passScale = useSharedValue(1);
  const standOutScale = useSharedValue(1);
  const likeScale = useSharedValue(1);

  // Animated styles
  const passAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: passScale.value }],
  }));
  const standOutAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: standOutScale.value }],
  }));
  const likeAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: likeScale.value }],
  }));

  // Press handlers — single shared scale matches DC_PRESS_SCALE so all three
  // buttons feel identical on press, just like the homepage row.
  const onPassPressIn = () => {
    passScale.value = withSpring(DC_PRESS_SCALE, { damping: 15, stiffness: 400 });
  };
  const onPassPressOut = () => {
    passScale.value = withSpring(1, { damping: 12, stiffness: 350 });
  };

  const onStandOutPressIn = () => {
    standOutScale.value = withSpring(DC_PRESS_SCALE, { damping: 15, stiffness: 400 });
  };
  const onStandOutPressOut = () => {
    standOutScale.value = withSpring(1, { damping: 12, stiffness: 350 });
  };

  const onLikePressIn = () => {
    likeScale.value = withSpring(DC_PRESS_SCALE, { damping: 15, stiffness: 400 });
  };
  const onLikePressOut = () => {
    likeScale.value = withSpring(1, { damping: 12, stiffness: 350 });
  };

  // Match the homepage: anchor row above the safe-area inset using the same
  // helper, so the opened profile and the swipe card share one visual rhythm.
  const { actionRowBottom } = getDeepConnectBottomLayout({ bottom: bottomInset });
  // Opened-profile-only lift: +25% above the homepage anchor. The opened
  // profile has no card-deck below the row, so the homepage's tight anchor
  // reads as "too low / too close to the nav edge" here. Lift only this
  // surface; do NOT change the homepage helper.
  const liftedActionRowBottom = Math.round(actionRowBottom * 1.25);

  return (
    <View style={[floatingStyles.cluster, { bottom: liftedActionRowBottom }]} pointerEvents="box-none">
      {/* Pass — white surface with subtle red lit edge */}
      <Animated.View style={passAnimStyle}>
        <Pressable
          style={floatingStyles.passButton}
          onPress={onPass}
          onPressIn={onPassPressIn}
          onPressOut={onPassPressOut}
        >
          <LinearGradient
            colors={DC_GLASS_HIGHLIGHT_COLORS_PASS}
            locations={DC_GLASS_HIGHLIGHT_LOCATIONS}
            start={DC_GLASS_HIGHLIGHT_START}
            end={DC_GLASS_HIGHLIGHT_END}
            pointerEvents="none"
            style={floatingStyles.glassOverlay}
          />
          <Ionicons name="close" size={DC_ICON_SIZE} color="#F44336" />
        </Pressable>
      </Animated.View>

      {/* Stand Out — compact blue orb with white lit edge. Numeric badge
          intentionally omitted (per product spec, until Stand Out limits are
          finalised). hasReachedStandOutLimit() still gates the press. */}
      <Animated.View style={standOutAnimStyle}>
        <Pressable
          style={[
            floatingStyles.standOutButton,
            standOutDisabled && floatingStyles.buttonDisabled,
          ]}
          onPress={onStandOut}
          onPressIn={onStandOutPressIn}
          onPressOut={onStandOutPressOut}
          disabled={standOutDisabled}
        >
          <LinearGradient
            colors={DC_GLASS_HIGHLIGHT_COLORS_LIGHT}
            locations={DC_GLASS_HIGHLIGHT_LOCATIONS}
            start={DC_GLASS_HIGHLIGHT_START}
            end={DC_GLASS_HIGHLIGHT_END}
            pointerEvents="none"
            style={floatingStyles.glassOverlayCompact}
          />
          <Ionicons name="star" size={DC_STAR_ICON_SIZE} color="#FFF" />
        </Pressable>
      </Animated.View>

      {/* Like — brand-tint orb with white lit edge */}
      <Animated.View style={likeAnimStyle}>
        <Pressable
          style={floatingStyles.likeButton}
          onPress={onLike}
          onPressIn={onLikePressIn}
          onPressOut={onLikePressOut}
        >
          <LinearGradient
            colors={DC_GLASS_HIGHLIGHT_COLORS_LIGHT}
            locations={DC_GLASS_HIGHLIGHT_LOCATIONS}
            start={DC_GLASS_HIGHLIGHT_START}
            end={DC_GLASS_HIGHLIGHT_END}
            pointerEvents="none"
            style={floatingStyles.glassOverlay}
          />
          <Ionicons name="heart" size={DC_ICON_SIZE} color="#FFF" />
        </Pressable>
      </Animated.View>
    </View>
  );
}

// Floating button styles — values come from the Deep Connect tokens file so
// the opened-profile row and the homepage swipe-card row stay in lockstep.
const floatingStyles = StyleSheet.create({
  cluster: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: DC_BUTTON_GAP,
    paddingHorizontal: DC_ROW_PADDING_X,
    // No background — fully transparent like the homepage row.
  },
  passButton: {
    width: DC_BUTTON_DIAMETER,
    height: DC_BUTTON_DIAMETER,
    borderRadius: DC_BUTTON_DIAMETER / 2,
    backgroundColor: 'rgba(255,255,255,0.97)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: DC_GLASS_BORDER_WIDTH,
    borderColor: DC_GLASS_BORDER_PASS,
    shadowColor: '#000',
    ...DC_BUTTON_SHADOW,
  },
  standOutButton: {
    width: DC_BUTTON_DIAMETER_COMPACT,
    height: DC_BUTTON_DIAMETER_COMPACT,
    borderRadius: DC_BUTTON_DIAMETER_COMPACT / 2,
    backgroundColor: '#2196F3',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: DC_GLASS_BORDER_WIDTH,
    borderColor: DC_GLASS_BORDER_LIGHT,
    shadowColor: '#000',
    ...DC_BUTTON_SHADOW,
  },
  likeButton: {
    width: DC_BUTTON_DIAMETER,
    height: DC_BUTTON_DIAMETER,
    borderRadius: DC_BUTTON_DIAMETER / 2,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: DC_GLASS_BORDER_WIDTH,
    borderColor: DC_GLASS_BORDER_LIGHT,
    shadowColor: '#000',
    ...DC_BUTTON_SHADOW,
  },
  glassOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: DC_BUTTON_DIAMETER / 2,
  },
  glassOverlayCompact: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: DC_BUTTON_DIAMETER_COMPACT / 2,
  },
  buttonDisabled: {
    opacity: 0.35,
  },
});

export default function Phase2FullProfileScreen() {
  useScreenTrace('P2_FULL_PROFILE_VIEW');
  const { userId: profileUserId } = useLocalSearchParams<{ userId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const currentUserId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.token);

  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
  const photoListRef = useRef<FlatList>(null);
  const [showReportBlock, setShowReportBlock] = useState(false);

  // Stand Out limits from discover store (shared with discovery card)
  const standOutsRemaining = useDiscoverStore((s) => s.standOutsRemaining);
  const hasReachedStandOutLimit = useDiscoverStore((s) => s.hasReachedStandOutLimit);
  const incrementStandOuts = useDiscoverStore((s) => s.incrementStandOuts);

  // Inline Stand Out composer sheet target. When non-null, renders the
  // premium bottom-sheet composer over the current profile (no route push,
  // no white-page flash). Sending pipes through the existing standOutResult
  // effect below so the Phase-2 swipeMutation call path is unchanged.
  const [standOutSheetTarget, setStandOutSheetTarget] = useState<{
    profileId: string;
    name: string;
  } | null>(null);

  // P0-001 FIX: Watch for Stand Out result from stand-out screen
  // When user sends a Stand Out message, this effect handles the API call
  const standOutResult = useInteractionStore((s) => s.standOutResult);

  // Phase-2 swipe mutation (must be declared before useEffect that uses it)
  const swipeMutation = useMutation(api.privateSwipes.swipe);

  useEffect(() => {
    if (!standOutResult || !profileUserId || !currentUserId || !token) return;
    // Only handle if this is for our profile
    if (standOutResult.profileId !== profileUserId) return;

    // Clear the result immediately to prevent re-processing
    useInteractionStore.getState().setStandOutResult(null);

    const sendStandOut = async () => {
      try {
        const result = await swipeMutation({
          token,
          authUserId: currentUserId,
          toUserId: profileUserId as any,
          action: 'super_like',
          message: standOutResult.message || undefined,
        });

        // Increment stand out count
        incrementStandOuts();

        if (result?.isMatch) {
          const matchResult = result as any;
          router.push(
            `/(main)/match-celebration?matchId=${matchResult.matchId}&userId=${profileUserId}&mode=phase2&conversationId=${matchResult.conversationId || ''}&source=${matchResult.source || 'deep_connect'}&alreadyMatched=${matchResult.alreadyMatched ? '1' : '0'}` as any
          );
        } else {
          const hasMessage = standOutResult.message.trim().length > 0;
          Toast.show(hasMessage ? 'Stand Out sent! They will see your message.' : 'Stand Out sent.');
          router.back();
        }
      } catch (error: any) {
        if (__DEV__) {
          console.warn('[P2_FULL_PROFILE_STANDOUT] Error');
        }
        Toast.show("Couldn't send Stand Out. Please try again.");
      }
    };

    sendStandOut();
  }, [standOutResult, profileUserId, currentUserId, token, router, incrementStandOuts, swipeMutation]);

  // Phase-2 profile query
  const profile = useQuery(
    api.privateDiscover.getProfileByUserId,
    !isDemoMode && profileUserId && currentUserId && token
      ? { token, userId: profileUserId as any, viewerAuthUserId: currentUserId }
      : 'skip'
  );

  // Phase-2 per-photo blur model (viewer-facing): blur only if enabled AND this slot is marked blurred
  const photoBlurEnabled = profile?.photoBlurEnabled === true;
  const photoBlurSlots: boolean[] = Array.isArray(profile?.photoBlurSlots) ? profile.photoBlurSlots : [];

  // [P2_PROMPT_DUP] One-shot dev probe — warns when this profile's
  // promptAnswers contain duplicate promptId values. Used to confirm the
  // data-side hypothesis behind the OnePlus prompt-repetition report.
  useEffect(() => {
    if (!__DEV__) return;
    const prompts = (profile as any)?.promptAnswers;
    if (!Array.isArray(prompts) || prompts.length < 2) return;
    const seen = new Set<string>();
    const dups: string[] = [];
    for (const ans of prompts) {
      const id = ans?.promptId;
      if (!id) continue;
      if (seen.has(id)) dups.push(id);
      else seen.add(id);
    }
    if (dups.length > 0) {
      if (__DEV__) {
        console.warn('[P2_PROMPT_DUP] duplicate promptIds in promptAnswers');
      }
    }
  }, [profile, profileUserId]);

  // ═══════════════════════════════════════════════════════════════════════════
  // P0 HOOK ORDER FIX: ALL HOOKS MUST BE DECLARED BEFORE EARLY RETURNS
  // These hooks were previously after the early returns, causing React error:
  // "Rendered more hooks than during the previous render"
  // ═══════════════════════════════════════════════════════════════════════════

  // Photo navigation hooks (safe even when profile is null)
  const photos = profile?.photos || [];
  const hasMultiplePhotos = photos.length > 1;

  // PERF: animated:false snaps instantly (no 300ms RN scroll curve), matches
  // discovery-card UX. Pair with getItemLayout below for O(1) layout.
  const goNextPhoto = useCallback(() => {
    if (photos.length <= 1) return;
    const nextIndex = currentPhotoIndex + 1;
    if (nextIndex >= photos.length) return;
    setCurrentPhotoIndex(nextIndex);
    photoListRef.current?.scrollToIndex({ index: nextIndex, animated: false });
  }, [photos.length, currentPhotoIndex]);

  const goPrevPhoto = useCallback(() => {
    if (photos.length <= 1) return;
    const prevIndex = currentPhotoIndex - 1;
    if (prevIndex < 0) return;
    setCurrentPhotoIndex(prevIndex);
    photoListRef.current?.scrollToIndex({ index: prevIndex, animated: false });
  }, [photos.length, currentPhotoIndex]);

  // PERF: O(1) layout for FlatList scrollToIndex. Avoids RN measuring rows.
  const getPhotoItemLayout = useCallback(
    (_data: ArrayLike<unknown> | null | undefined, index: number) => ({
      length: SCREEN_WIDTH,
      offset: SCREEN_WIDTH * index,
      index,
    }),
    [],
  );

  // Tap feedback animations (Reanimated hooks)
  const leftTapScale = useSharedValue(1);
  const rightTapScale = useSharedValue(1);

  // PERF: Removed opacity flash on tap — was causing visible "dim then snap"
  // before the next photo committed. Keep micro-scale only, no opacity.
  const leftTapStyle = useAnimatedStyle(() => ({
    transform: [{ scale: leftTapScale.value }],
  }));

  const rightTapStyle = useAnimatedStyle(() => ({
    transform: [{ scale: rightTapScale.value }],
  }));

  const onLeftPressIn = useCallback(() => {
    leftTapScale.value = withSpring(0.99, { damping: 18, stiffness: 500 });
  }, [leftTapScale]);

  const onLeftPressOut = useCallback(() => {
    leftTapScale.value = withSpring(1, { damping: 18, stiffness: 500 });
  }, [leftTapScale]);

  const onRightPressIn = useCallback(() => {
    rightTapScale.value = withSpring(0.99, { damping: 18, stiffness: 500 });
  }, [rightTapScale]);

  const onRightPressOut = useCallback(() => {
    rightTapScale.value = withSpring(1, { damping: 18, stiffness: 500 });
  }, [rightTapScale]);

  // ═══════════════════════════════════════════════════════════════════════════
  // EARLY RETURNS (safe now - all hooks declared above)
  // ═══════════════════════════════════════════════════════════════════════════

  // Loading state
  if (profile === undefined) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={C.primary} />
        </View>
      </View>
    );
  }

  // Profile not found or blocked
  if (profile === null) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={P2.text} />
        </TouchableOpacity>
        <View style={styles.emptyContainer}>
          <Ionicons name="person-outline" size={64} color={P2.textSubtle} />
          <Text style={styles.emptyTitle}>Profile not available</Text>
          <Text style={styles.emptySubtitle}>
            This profile may have been removed or is not accessible
          </Text>
        </View>
      </View>
    );
  }

  const profileDistanceKm = (profile as { distanceKm?: number }).distanceKm;
  // Phase-2 Deep Connect: miles only, with " away" suffix.
  // Returns null when distance is missing/hidden — row renders nothing.
  const profileDistanceLabel = formatPhase2DistanceMiles(profileDistanceKm, {
    includeAway: true,
  });
  const profileVerificationDisplay = getVerificationDisplay({
    isVerified: profile.isVerified,
    verificationStatus: (profile as any).verificationStatus,
  });
  const targetUserId =
    typeof profile.userId === 'string' && profile.userId.trim().length > 0
      ? profile.userId
      : profileUserId;
  const targetUserName = profile.name || 'this user';

  const handleOpenReportBlock = () => {
    if (!targetUserId) {
      Toast.show('Profile unavailable');
      return;
    }
    setShowReportBlock(true);
  };

  // Handle like action
  const handleLike = async () => {
    if (!currentUserId || !profileUserId || !token) return;

    try {
      const result = await swipeMutation({
        token,
        authUserId: currentUserId,
        toUserId: profileUserId as any,
        action: 'like',
      });

      if (result?.isMatch) {
        const matchResult = result as any;
        // P2-ISOLATION-FIX: Pass conversationId to prevent Phase 1 API fallback
        router.push(
          `/(main)/match-celebration?matchId=${matchResult.matchId}&userId=${profileUserId}&mode=phase2&conversationId=${matchResult.conversationId}&source=${matchResult.source || 'deep_connect'}&alreadyMatched=${matchResult.alreadyMatched ? '1' : '0'}` as any
        );
      } else {
        Toast.show('Liked! They will see it in their likes.');
        router.back();
      }
    } catch (error: any) {
      if (__DEV__) {
        console.warn('[P2_FULL_PROFILE] Like error');
      }
      Toast.show("Couldn't like. Please try again.");
    }
  };

  // Handle pass action
  const handlePass = async () => {
    if (!currentUserId || !profileUserId || !token) return;

    try {
      await swipeMutation({
        token,
        authUserId: currentUserId,
        toUserId: profileUserId as any,
        action: 'pass',
      });
      router.back();
    } catch (error: any) {
      if (__DEV__) {
        console.warn('[P2_FULL_PROFILE] Pass error');
      }
    }
  };

  // Handle Stand Out action — opens the inline composer sheet over this
  // profile screen. Replaces the previous `router.push('/(main)/stand-out')`
  // navigation, which showed a separate full screen with a white background
  // flash. The standOutResult effect above still owns the Convex mutation.
  const handleStandOut = () => {
    if (!profile || !profileUserId) return;
    if (hasReachedStandOutLimit()) {
      Toast.show('No Stand Outs remaining today');
      return;
    }

    // P0-002 FIX: Use backend display name only (returned as `name` here).
    const profileName = profile.name || 'Someone';
    setStandOutSheetTarget({
      profileId: String(profileUserId),
      name: profileName,
    });
  };

  // P2-004: Using centralized getGenderIcon from lib/genderIcon.ts

  // Render photo carousel item with conditional blur.
  // PERF: cachePolicy memory-disk + recyclingKey lets expo-image keep
  // adjacent slides decoded; priority=high for the active slot speeds the
  // first paint after a tap. transition=0 disables the fade-in that masked
  // the snap.
  const renderPhotoItem = ({ item, index }: { item: { url: string }; index: number }) => (
    <Image
      source={{ uri: item.url }}
      style={styles.heroPhoto}
      contentFit="cover"
      blurRadius={photoBlurEnabled && photoBlurSlots[index] ? 15 : 0}
      cachePolicy="memory-disk"
      recyclingKey={item.url}
      priority={index === currentPhotoIndex ? 'high' : 'normal'}
      transition={0}
    />
  );

  // Get intent info
  const getIntentInfo = (key: string) => {
    return PRIVATE_INTENT_CATEGORIES.find((c) => c.key === key);
  };

  // Get desire tag info
  const getDesireTagLabel = (key: string) => {
    return PRIVATE_DESIRE_TAGS.find((t) => t.key === key)?.label || key;
  };

  const uniqueStrings = (values: unknown): string[] => {
    if (!Array.isArray(values)) return [];
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
      if (typeof value !== 'string') continue;
      const trimmed = value.trim();
      const key = trimmed.toLowerCase();
      if (!trimmed || seen.has(key)) continue;
      seen.add(key);
      result.push(trimmed);
    }
    return result;
  };

  const getValidPrompts = () => {
    const prompts = Array.isArray(profile.promptAnswers) ? profile.promptAnswers : [];
    const seen = new Set<string>();
    return prompts
      .map((prompt: any) => {
        const question = typeof prompt?.question === 'string' ? prompt.question.trim() : '';
        const answer = typeof prompt?.answer === 'string' ? prompt.answer.trim() : '';
        if (!question || !answer) return null;
        const promptId =
          typeof prompt?.promptId === 'string' && prompt.promptId.trim().length > 0
            ? prompt.promptId.trim()
            : null;
        const key = promptId ? `id:${promptId}` : `q:${question.toLowerCase().replace(/\s+/g, ' ')}`;
        if (seen.has(key)) return null;
        seen.add(key);
        // Resolve which Phase-2 section this prompt belongs to so the renderer
        // can collapse choice prompts into a single "Quick Picks" chip group
        // and render typed Values/Personality prompts as full cards.
        const section: Phase2PromptSection = getPhase2PromptSection(promptId);
        return { ...prompt, promptId, question, answer, key, section };
      })
      .filter(Boolean) as Array<{
        promptId?: string | null;
        question: string;
        answer: string;
        key: string;
        section: Phase2PromptSection;
      }>;
  };

  // Get hobby/interest info with emoji
  const getHobbyInfo = (key: string) => {
    const activity = ACTIVITY_FILTERS.find((a) => a.value === key);
    return activity ? { label: activity.label, emoji: activity.emoji } : { label: key, emoji: '' };
  };

  // Get lifestyle items as array for chip display
  const getLifestyleItems = () => {
    const items: { icon: string; label: string }[] = [];
    const heightStr = cmToFeetInches(profile.height);
    if (heightStr) items.push({ icon: 'resize-outline', label: heightStr });
    if (profile.smoking && profile.smoking !== 'prefer_not_to_say') {
      const smokingLabels: Record<string, string> = {
        never: 'Non-smoker', socially: 'Social smoker', regularly: 'Smoker'
      };
      items.push({ icon: 'flame-outline', label: smokingLabels[profile.smoking] || profile.smoking });
    }
    if (profile.drinking && profile.drinking !== 'prefer_not_to_say') {
      const drinkingLabels: Record<string, string> = {
        never: "Doesn't drink", socially: 'Drinks socially', regularly: 'Drinks regularly'
      };
      items.push({ icon: 'wine-outline', label: drinkingLabels[profile.drinking] || profile.drinking });
    }
    return items;
  };

  const getEducationReligionItems = () => {
    const profileAny = profile as any;
    const items: { icon: string; label: string }[] = [];
    const education = typeof profileAny.education === 'string' ? profileAny.education.trim() : '';
    const religion = typeof profileAny.religion === 'string' ? profileAny.religion.trim() : '';
    const educationLabel =
      education && education !== 'prefer_not_to_say'
        ? EDUCATION_OPTIONS.find((option) => option.value === education)?.label ?? education
        : null;
    const religionLabel =
      religion && religion !== 'prefer_not_to_say'
        ? RELIGION_OPTIONS.find((option) => option.value === religion)?.label ?? religion
        : null;

    if (educationLabel) items.push({ icon: 'school-outline', label: educationLabel });
    if (religionLabel) items.push({ icon: 'sparkles-outline', label: religionLabel });
    return items;
  };

  const intentKeys = uniqueStrings(profile.intentKeys);
  const desireKeys = uniqueStrings(profile.desireTagKeys);
  const validPrompts = getValidPrompts();
  // Bucket by Phase-2 prompt section so the UI can render quick choice
  // prompts as a single chip strip and typed prompts (Values/Personality)
  // as full premium cards. 'unknown' (legacy / off-catalog) falls back to
  // Personality so nothing is dropped silently.
  const quickPrompts = validPrompts.filter((p) => p.section === 'quick');
  const valuesPrompts = validPrompts.filter((p) => p.section === 'values');
  const personalityPrompts = validPrompts.filter(
    (p) => p.section === 'personality' || p.section === 'unknown',
  );
  const lifestyleItems = getLifestyleItems();
  const educationReligionItems = getEducationReligionItems();
  const rawInterestKeys =
    Array.isArray(profile.hobbies) && profile.hobbies.length > 0
      ? profile.hobbies
      : profile.activities;
  const interestKeys = uniqueStrings(rawInterestKeys);

  return (
    <View style={styles.container}>
      {/* ANDROID FIX: Add top safe area padding so photo doesn't overlap status bar */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ═══════════════════════════════════════════════════════════════════
            HERO PHOTO SECTION
        ═══════════════════════════════════════════════════════════════════ */}
        <View style={styles.heroSection}>
          {photos.length > 0 ? (
            <>
              <FlatList
                ref={photoListRef}
                data={photos}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                renderItem={renderPhotoItem}
                keyExtractor={(item, i) => `photo_${i}`}
                getItemLayout={getPhotoItemLayout}
                initialNumToRender={2}
                maxToRenderPerBatch={2}
                windowSize={3}
                removeClippedSubviews
                onMomentumScrollEnd={(e) => {
                  const index = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
                  // PERF: avoid redundant re-render when tap-handler already set state.
                  setCurrentPhotoIndex((prev) => (prev === index ? prev : index));
                }}
                scrollEnabled={hasMultiplePhotos}
              />

              {/* TAP ZONES FOR PHOTO NAVIGATION (matches Discovery card UX) */}
              {/* PREMIUM UX: Animated tap feedback with subtle scale */}
              {hasMultiplePhotos && (
                <>
                  {/* Left tap zone = previous photo */}
                  <Animated.View style={[styles.photoTapZoneLeft, leftTapStyle]}>
                    <Pressable
                      style={StyleSheet.absoluteFill}
                      onPress={goPrevPhoto}
                      onPressIn={onLeftPressIn}
                      onPressOut={onLeftPressOut}
                    />
                  </Animated.View>
                  {/* Right tap zone = next photo */}
                  <Animated.View style={[styles.photoTapZoneRight, rightTapStyle]}>
                    <Pressable
                      style={StyleSheet.absoluteFill}
                      onPress={goNextPhoto}
                      onPressIn={onRightPressIn}
                      onPressOut={onRightPressOut}
                    />
                  </Animated.View>
                </>
              )}

              {/* Photo indicators */}
              {hasMultiplePhotos && (
                <View style={styles.photoIndicators}>
                  {photos.map((_: { _id: string; url: string }, i: number) => (
                    <View
                      key={i}
                      style={[
                        styles.photoIndicator,
                        i === currentPhotoIndex && styles.photoIndicatorActive,
                      ]}
                    />
                  ))}
                </View>
              )}
            </>
          ) : (
            <View style={styles.noPhotoPlaceholder}>
              <Ionicons name="person" size={80} color={P2.textSubtle} />
            </View>
          )}

          {/* Top scrim only — minimal, just enough for menu readability.
              No bottom scrim per product direction: photo must end crisply. */}
          <LinearGradient
            colors={["rgba(0,0,0,0.45)", "rgba(0,0,0,0)"]}
            style={styles.heroTopScrim}
            pointerEvents="none"
          />

          {/* Safety menu */}
          <TouchableOpacity
            style={[styles.moreButton, { top: 10 }]}
            onPress={handleOpenReportBlock}
            accessibilityRole="button"
            accessibilityLabel="Profile actions"
          >
            <View style={styles.moreButtonBg}>
              <Ionicons name="ellipsis-horizontal" size={18} color="#FFF" />
            </View>
          </TouchableOpacity>
        </View>

        {/* ═══════════════════════════════════════════════════════════════════
            DETAILS WRAPPER — misty-blue surface that hosts every card.
            Photo ends crisp above; this view begins the premium content area.
            (No transition strip — the photo's clean edge is the transition.)
        ═══════════════════════════════════════════════════════════════════ */}
        <View style={styles.detailsWrapper}>
          {/* ─── IDENTITY CARD ─────────────────────────────────────────── */}
          <View style={styles.identityCard}>
            {/* P0-002 FIX: Use backend display name only (returned as `name` here). */}
            <View style={styles.nameRow}>
              <Text style={styles.nameText}>{profile.name}</Text>
              {typeof profile.age === 'number' && profile.age > 0 ? (
                <Text style={styles.ageText}>{profile.age}</Text>
              ) : null}
              <Ionicons
                name={getGenderIcon(profile.gender) as any}
                size={18}
                color={P2.textMuted}
                style={styles.genderIcon}
              />
              <View style={styles.verificationStatusRow}>
                <View
                  style={[
                    styles.verificationStatusDot,
                    profileVerificationDisplay.tone === 'verified' && styles.verificationStatusDotVerified,
                    profileVerificationDisplay.tone === 'pending' && styles.verificationStatusDotPending,
                    profileVerificationDisplay.tone === 'unverified' && styles.verificationStatusDotUnverified,
                  ]}
                />
                <Text
                  style={[
                    styles.verificationStatusText,
                    profileVerificationDisplay.tone === 'verified' && styles.verificationStatusTextVerified,
                    profileVerificationDisplay.tone === 'pending' && styles.verificationStatusTextPending,
                    profileVerificationDisplay.tone === 'unverified' && styles.verificationStatusTextUnverified,
                  ]}
                  numberOfLines={1}
                >
                  {profileVerificationDisplay.label}
                </Text>
              </View>
            </View>
            {/* Phase-2 Deep Connect: distance only (miles). No city / locality
                / area name. If distance is hidden or missing, render nothing. */}
            {profileDistanceLabel && (
              <View style={styles.distanceRow}>
                <Ionicons name="location-outline" size={14} color={P2.textSubtle} />
                <Text style={styles.distanceText}>{profileDistanceLabel}</Text>
              </View>
            )}
          </View>

          {/* ─── BIO ───────────────────────────────────────────────────── */}
          {profile.bio && (
            <View style={styles.cardSection}>
              <Text style={styles.sectionTitle}>Bio</Text>
              <Text style={styles.bioText}>{profile.bio}</Text>
            </View>
          )}

          {/* ─── RELATIONSHIP GOAL (private intent chips) ──────────────── */}
          {intentKeys.length > 0 && (
            <View style={styles.cardSection}>
              <Text style={styles.sectionTitle}>Relationship goal</Text>
              <View style={styles.chipsRow}>
                {intentKeys.map((key: string, i: number) => {
                  const intent = getIntentInfo(key);
                  if (!intent) return null;
                  return (
                    <View key={`intent-${key || 'k'}-${i}`} style={styles.chip}>
                      <Text style={styles.chipText}>{intent.label}</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {/* ─── DESIRES ───────────────────────────────────────────────── */}
          {desireKeys.length > 0 && (
            <View style={styles.cardSection}>
              <Text style={styles.sectionTitle}>Desires</Text>
              <View style={styles.chipsRow}>
                {desireKeys.slice(0, 4).map((key: string, i: number) => (
                  <View key={`desire-${key || 'k'}-${i}`} style={styles.chip}>
                    <Text style={styles.chipText}>{getDesireTagLabel(key)}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* ─── QUICK PICKS (choice prompts collapsed to answer-only chips) ─ */}
          {quickPrompts.length > 0 && (
            <View style={styles.cardSection}>
              <Text style={styles.sectionTitle}>Quick Picks</Text>
              <View style={styles.chipsRow}>
                {quickPrompts.map((prompt, i: number) => (
                  <View
                    key={`quick-${prompt.key}-${i}`}
                    style={styles.chipStrong}
                  >
                    <Text style={styles.chipText}>{prompt.answer}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* ─── VALUES (typed prompts; one card per question) ─────────── */}
          {valuesPrompts.length > 0 && (
            <View style={styles.promptsGroup}>
              <Text style={[styles.sectionTitle, styles.promptsGroupTitle]}>Values</Text>
              {valuesPrompts.map((prompt, i: number) => (
                <View key={`values-${prompt.key}-${i}`} style={styles.promptCard}>
                  <Text style={styles.promptQuestion}>{prompt.question}</Text>
                  <Text style={styles.promptAnswer}>{prompt.answer}</Text>
                </View>
              ))}
            </View>
          )}

          {/* ─── PERSONALITY (typed prompts; one card per question) ────── */}
          {personalityPrompts.length > 0 && (
            <View style={styles.promptsGroup}>
              <Text style={[styles.sectionTitle, styles.promptsGroupTitle]}>Personality</Text>
              {personalityPrompts.map((prompt, i: number) => (
                <View key={`personality-${prompt.key}-${i}`} style={styles.promptCard}>
                  <Text style={styles.promptQuestion}>{prompt.question}</Text>
                  <Text style={styles.promptAnswer}>{prompt.answer}</Text>
                </View>
              ))}
            </View>
          )}

          {/* ─── LIFESTYLE (height + smoking + drinking) ──────────────── */}
          {lifestyleItems.length > 0 && (
            <View style={styles.cardSection}>
              <Text style={styles.sectionTitle}>Lifestyle</Text>
              <View style={styles.chipsRow}>
                {lifestyleItems.map((item, i) => (
                  <View key={i} style={styles.chipWithIcon}>
                    <Ionicons name={item.icon as any} size={14} color={P2.textMuted} />
                    <Text style={styles.chipText}>{item.label}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* ─── INTERESTS ─────────────────────────────────────────────── */}
          {(() => {
            if (interestKeys.length === 0) return null;

            return (
              <View style={styles.cardSection}>
                <Text style={styles.sectionTitle}>Interests</Text>
                <View style={styles.chipsRow}>
                  {interestKeys.slice(0, 6).map((hobby: string, i: number) => {
                    const info = getHobbyInfo(hobby);
                    return (
                      <View key={i} style={styles.chipWithIcon}>
                        {info.emoji && <Text style={styles.chipEmoji}>{info.emoji}</Text>}
                        <Text style={styles.chipText}>{info.label}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            );
          })()}

          {/* ─── EDUCATION + RELIGION (split into two cards) ──────────── */}
          {(() => {
            const edu = educationReligionItems.find((i) => i.icon === 'school-outline');
            const rel = educationReligionItems.find((i) => i.icon === 'sparkles-outline');
            return (
              <>
                {edu && (
                  <View style={styles.cardSection}>
                    <Text style={styles.sectionTitle}>Education</Text>
                    <View style={styles.detailRow}>
                      <Ionicons name={edu.icon as any} size={16} color={P2.textMuted} />
                      <Text style={styles.detailText}>{edu.label}</Text>
                    </View>
                  </View>
                )}
                {rel && (
                  <View style={styles.cardSection}>
                    <Text style={styles.sectionTitle}>Religion</Text>
                    <View style={styles.detailRow}>
                      <Ionicons name={rel.icon as any} size={16} color={P2.textMuted} />
                      <Text style={styles.detailText}>{rel.label}</Text>
                    </View>
                  </View>
                )}
              </>
            );
          })()}
        </View>

        {/* ═══════════════════════════════════════════════════════════════════
            BOTTOM SPACER: Keeps the last card clear of the floating action row.
            Uses the same DC tokens as the row itself so the gap is correct on
            every device (Samsung 360dp ↔ OnePlus 411dp ↔ iPhone 390dp).
        ═══════════════════════════════════════════════════════════════════ */}
        {(() => {
          const { actionRowBottom, actionRowClearance } = getDeepConnectBottomLayout({
            bottom: insets.bottom,
          });
          // Mirror the +25% opened-profile lift here so the spacer matches the
          // floating row's actual bottom anchor and the last card never sits
          // underneath the buttons.
          const liftedActionRowBottom = Math.round(actionRowBottom * 1.25);
          const EXTRA_BREATHING_ROOM = 20;
          const bottomPadding = liftedActionRowBottom + actionRowClearance + EXTRA_BREATHING_ROOM;

          return <View style={{ height: bottomPadding }} />;
        })()}
      </ScrollView>

      {/* ═══════════════════════════════════════════════════════════════════
          FLOATING ACTION BUTTONS (Pass / Stand Out / Like)
          Premium floating cluster with micro-interactions
          - NO rectangular background
          - Soft shadows for depth
          - Spring scale on press
      ═══════════════════════════════════════════════════════════════════ */}
      <FloatingActionButtons
        onPass={handlePass}
        onStandOut={handleStandOut}
        onLike={handleLike}
        standOutDisabled={hasReachedStandOutLimit()}
        bottomInset={insets.bottom}
      />

      {/* Inline Stand Out composer for the Phase-2 full-profile screen.
          Mirrors the Discover-card composer; sending dispatches via
          `setStandOutResult`, which the standOutResult effect above turns
          into the existing Phase-2 `swipeMutation` call. */}
      <StandOutComposerSheet
        visible={standOutSheetTarget !== null}
        targetName={standOutSheetTarget?.name ?? null}
        standOutsLeft={standOutsRemaining()}
        mode="phase2"
        onSend={(message) => {
          const target = standOutSheetTarget;
          setStandOutSheetTarget(null);
          if (!target) return;
          useInteractionStore.getState().setStandOutResult({
            profileId: target.profileId,
            message,
          });
        }}
        onClose={() => setStandOutSheetTarget(null)}
      />

      <ReportBlockModal
        visible={showReportBlock && !!targetUserId}
        onClose={() => setShowReportBlock(false)}
        reportedUserId={targetUserId || ''}
        reportedUserName={targetUserName}
        currentUserId={currentUserId || ''}
        source="profile"
        onBlockSuccess={() => {
          setShowReportBlock(false);
          router.replace('/(main)/(private)/(tabs)/deep-connect' as any);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // ═════════════════════════════════════════════════════════════════════════
  // PREMIUM MISTY-BLUE REDESIGN
  // Photo ends crisp directly into the misty-blue details surface — no
  // gradient band, no fade. Pale-blue glass cards sit on the misty-blue page.
  // ═════════════════════════════════════════════════════════════════════════
  container: {
    flex: 1,
    backgroundColor: P2.pageBg,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 20,
    backgroundColor: P2.pageBg,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: P2.text,
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    color: P2.textMuted,
    textAlign: 'center',
    marginTop: 8,
  },

  // ─── Hero photo (no bottom scrim — photo ends crisp) ──────────────────
  heroSection: {
    width: SCREEN_WIDTH,
    height: PHOTO_HEIGHT,
    position: 'relative',
    backgroundColor: '#000',
  },
  heroPhoto: {
    width: SCREEN_WIDTH,
    height: PHOTO_HEIGHT,
    backgroundColor: '#000',
  },
  noPhotoPlaceholder: {
    width: SCREEN_WIDTH,
    height: PHOTO_HEIGHT,
    backgroundColor: P2.chipBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTopScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 90,
  },
  photoIndicators: {
    position: 'absolute',
    top: 12,
    left: 16,
    right: 16,
    flexDirection: 'row',
    gap: 4,
    zIndex: 10,
  },
  photoIndicator: {
    flex: 1,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.35)',
    borderRadius: 2,
  },
  photoIndicatorActive: {
    backgroundColor: '#FFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
    elevation: 2,
  },
  photoTapZoneLeft: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: '40%',
    zIndex: 5,
  },
  photoTapZoneRight: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: '40%',
    zIndex: 5,
  },
  backButton: {
    position: 'absolute',
    left: 16,
    zIndex: 10,
  },
  backButtonBg: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.32)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreButton: {
    position: 'absolute',
    right: 16,
    zIndex: 10,
  },
  moreButtonBg: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.32)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ─── Details wrapper (misty-blue page bg under all cards) ────────────
  // Photo ends crisp directly above; no transition strip, no fade.
  detailsWrapper: {
    backgroundColor: P2.pageBg,
    paddingTop: 16,
    paddingHorizontal: 16,
    gap: 12,
  },

  // ─── Identity card ────────────────────────────────────────────────────
  identityCard: {
    backgroundColor: P2.cardBg,
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 20,
    borderWidth: 1,
    borderColor: P2.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
  },
  nameText: {
    fontSize: 30,
    fontWeight: '700',
    color: P2.text,
    letterSpacing: -0.4,
  },
  ageText: {
    fontSize: 28,
    fontWeight: '300',
    color: P2.textMuted,
    marginLeft: 10,
    letterSpacing: -0.3,
  },
  genderIcon: {
    marginLeft: 12,
  },
  // Row wrapper: dot + status label, sits to the right of name/age/gender.
  verificationStatusRow: {
    marginLeft: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
    minWidth: 0,
  },
  verificationStatusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: P2.textSubtle,
  },
  verificationStatusDotVerified: {
    backgroundColor: '#10B981',
  },
  verificationStatusDotPending: {
    backgroundColor: '#F59E0B',
  },
  verificationStatusDotUnverified: {
    backgroundColor: '#EF4444',
  },
  verificationStatusText: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.1,
    flexShrink: 1,
    minWidth: 0,
  },
  // Premium tone-driven verification text colors for the Phase-2 opened
  // profile (light misty-blue surface).
  //   Verified: emerald (#10B981)
  //   Pending:  amber (#F59E0B)
  //   Not verified: red (#EF4444)
  verificationStatusTextVerified: {
    color: '#10B981',
  },
  verificationStatusTextPending: {
    color: '#F59E0B',
  },
  verificationStatusTextUnverified: {
    color: '#EF4444',
  },
  distanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 4,
  },
  distanceText: {
    fontSize: 14,
    fontWeight: '500',
    color: P2.textMuted,
    letterSpacing: 0.1,
  },

  // ─── Section card (used by Bio, Relationship goal, Lifestyle, Interests …)
  cardSection: {
    backgroundColor: P2.cardBg,
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 20,
    borderWidth: 1,
    borderColor: P2.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 1,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: P2.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1.4,
    marginBottom: 14,
  },
  bioText: {
    fontSize: 16,
    fontWeight: '400',
    color: P2.text,
    lineHeight: 25,
    letterSpacing: 0.05,
  },

  // ─── Single chip system (used by Relationship goal, Desires, Lifestyle, Interests)
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    backgroundColor: P2.chipBg,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 100,
  },
  // Slightly stronger fill for Quick Picks — same family, no new colour.
  chipStrong: {
    backgroundColor: P2.chipBgStrong,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 100,
  },
  chipWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: P2.chipBg,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 100,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: P2.text,
    letterSpacing: 0.1,
  },
  chipEmoji: {
    fontSize: 14,
  },

  // ─── Detail row (Education / Religion single value) ───────────────────
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  detailText: {
    fontSize: 16,
    fontWeight: '500',
    color: P2.text,
    letterSpacing: 0.1,
  },

  // ─── Prompts group + prompt card ──────────────────────────────────────
  promptsGroup: {
    gap: 10,
  },
  promptsGroupTitle: {
    marginLeft: 4,
    marginBottom: 8,
  },
  promptCard: {
    backgroundColor: P2.cardBg,
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 22,
    borderWidth: 1,
    borderColor: P2.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 1,
  },
  promptQuestion: {
    fontSize: 12,
    fontWeight: '700',
    color: P2.textMuted,
    marginBottom: 10,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  promptAnswer: {
    fontSize: 19,
    fontWeight: '500',
    color: P2.text,
    lineHeight: 28,
    letterSpacing: -0.1,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PHOTO ACCESS: Styles for photo privacy feature
  // ═══════════════════════════════════════════════════════════════════════════
  photoAccessOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoAccessContent: {
    alignItems: 'center',
    padding: 24,
  },
  photoAccessTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    marginTop: 12,
  },
  photoAccessSubtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 4,
    textAlign: 'center',
  },
  photoAccessRequestButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.primary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    marginTop: 20,
  },
  photoAccessRequestButtonPending: {
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  photoAccessRequestText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
