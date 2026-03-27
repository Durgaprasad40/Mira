/*
 * LOCKED (TRUTH OR DARE SCREEN)
 * Do NOT modify this file unless Durga Prasad explicitly unlocks it.
 *
 * STATUS:
 * - Feature is stable and production-locked
 * - No logic/UI changes allowed
 *
 * UI REDESIGN v2: Premium dark theme with energetic feel
 */
import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, Platform, Animated, Pressable, Alert, Modal,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { useAuthStore } from '@/stores/authStore';
import { useScreenTrace } from '@/lib/devTrace';

// Premium color palette - softer, more energetic dark theme
const PREMIUM = {
  // Softer dark backgrounds with depth
  bgDeep: '#0D0D1A',      // Deepest layer
  bgBase: '#141428',       // Main background
  bgElevated: '#1C1C36',   // Card surface
  bgHighlight: '#252545',  // Hover/active states

  // Accent colors
  coral: '#E94560',        // Primary accent (existing)
  coralSoft: '#FF6B8A',    // Lighter coral for gradients
  coralGlow: 'rgba(233, 69, 96, 0.25)', // Glow effect

  // Type badges
  truthPurple: '#7C6AEF',  // Refined purple for Truth
  truthPurpleLight: '#9D8FFF',
  dareOrange: '#FF7849',   // Warmer orange for Dare
  dareOrangeLight: '#FF9A70',

  // Text hierarchy
  textPrimary: '#F5F5F7',  // Bright white for headlines
  textSecondary: '#B8B8C7', // Softer for secondary
  textMuted: '#6E6E82',    // Muted for metadata

  // Borders and dividers
  borderSubtle: 'rgba(255, 255, 255, 0.06)',
  borderAccent: 'rgba(233, 69, 96, 0.3)',

  // Gender accent colors (subtle)
  genderFemale: '#FF8FA3',   // Soft pink
  genderMale: '#7DB9FF',     // Soft blue
  genderOther: '#B8B8C7',    // Neutral

  // Shadows
  shadowColor: '#000',
};

// Module-level cache for instant load across tab switches
// M-001 FIX: Track cache for HMR cleanup
let _cachedPromptsData: any[] = [];
let _cachedTrendingData: { trendingDarePrompt: any; trendingTruthPrompt: any } | null = null;
let _hasEverLoaded = false;

/**
 * Clear the T&D cache on logout to prevent data leak between users.
 * Called from authStore.logout() to ensure clean state.
 */
export function clearTodCache() {
  _cachedPromptsData = [];
  _cachedTrendingData = null;
  _hasEverLoaded = false;
  if (__DEV__) {
    console.log('[T/D] Cache cleared on logout');
  }
}

// Timing for diagnostics
let _tabOpenTime = 0;

// M-001 FIX: Reset cache on HMR to prevent stale data in development
if (__DEV__ && typeof module !== 'undefined' && (module as any).hot) {
  (module as any).hot.accept(() => {
    _cachedPromptsData = [];
    _cachedTrendingData = null;
    _hasEverLoaded = false;
    _tabOpenTime = 0;
    console.log('[T/D HMR] Cache cleared on hot reload');
  });
}

/** Prewarm the T/D cache with data (called from Private layout mount) */
export function prewarmTodCache(prompts: any[] | undefined, trending: any | undefined) {
  if (prompts !== undefined && prompts.length > 0 && !_hasEverLoaded) {
    _cachedPromptsData = prompts;
    _hasEverLoaded = true;
    console.log(`[T/D PREWARM] cached ${prompts.length} prompts`);
  }
  if (trending !== undefined && !_cachedTrendingData) {
    _cachedTrendingData = trending;
  }
}

/** Get URL prefix for diagnostics */
function getUrlPrefix(url?: string): string {
  if (!url) return 'none';
  if (url.startsWith('https://')) return 'https';
  if (url.startsWith('http://')) return 'http';
  if (url.startsWith('file://')) return 'file';
  if (url.startsWith('convex://')) return 'convex';
  return 'unknown';
}

/** Check if URL is valid for display:
 * - Accept https/http always
 * - Accept file:// if NOT from unstable cache (ImagePicker cache)
 * - Reject content:// (not directly displayable)
 * P0-003 FIX: Case-insensitive path matching for cross-device Android consistency
 */
function isValidPhotoUrl(url?: string): boolean {
  if (!url) return false;
  // Accept remote URLs always
  if (url.startsWith('http://') || url.startsWith('https://')) return true;
  // Accept file:// if not from unstable cache
  if (url.startsWith('file://')) {
    // P0-003 FIX: Normalize to lowercase for case-insensitive matching
    // Samsung uses /cache/ImagePicker/, OnePlus may use /Cache/ImagePicker/
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.includes('/cache/imagepicker/')) {
      return false;
    }
    return true;
  }
  return false;
}

const C = INCOGNITO_COLORS;

/* ─── Owner Photo (simple, no blur) ─── */
function OwnerPhoto({ uri, promptId }: { uri: string; promptId: string }) {
  return (
    <Image
      source={{ uri }}
      style={styles.ownerPhoto}
      onError={() => {
        console.log(`[T/D PHOTO ERROR] id=${promptId} uriPrefix=${getUrlPrefix(uri)}`);
      }}
    />
  );
}

/**
 * Determine if photo should be shown:
 * - visibility="public" AND valid photo url => show photo
 * - visibility="anonymous" OR "no_photo" => no photo
 * - Legacy: photoBlurMode="blur" => treat as no_photo (hide photo)
 */
function shouldShowPhoto(prompt: { isAnonymous?: boolean; photoBlurMode?: string; ownerPhotoUrl?: string }): boolean {
  // Anonymous => no photo
  if (prompt.isAnonymous) return false;
  // Legacy blur mode => treat as no_photo
  if (prompt.photoBlurMode === 'blur') return false;
  // Must have valid photo URL
  if (!prompt.ownerPhotoUrl) return false;
  if (!isValidPhotoUrl(prompt.ownerPhotoUrl)) return false;
  return true;
}

// Gender icon helper
function getGenderIcon(gender?: string): keyof typeof Ionicons.glyphMap {
  if (!gender) return 'male-female';
  const g = gender.toLowerCase();
  if (g === 'male') return 'male';
  if (g === 'female') return 'female';
  return 'male-female';
}

// Gender color helper
function getGenderColor(gender?: string): string {
  if (!gender) return PREMIUM.genderOther;
  const g = gender.toLowerCase();
  if (g === 'female') return PREMIUM.genderFemale;
  if (g === 'male') return PREMIUM.genderMale;
  return PREMIUM.genderOther;
}

/* ─── Skeleton Card (placeholder while loading) - Premium animated ─── */
function SkeletonCard() {
  const pulseAnim = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.7, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.4, duration: 800, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  return (
    <View style={styles.skeletonCard}>
      <View style={styles.skeletonContent}>
        <View style={styles.skeletonHeader}>
          <Animated.View style={[styles.skeletonAvatar, { opacity: pulseAnim }]} />
          <Animated.View style={[styles.skeletonName, { opacity: pulseAnim }]} />
          <Animated.View style={[styles.skeletonPill, { opacity: pulseAnim }]} />
        </View>
        <Animated.View style={[styles.skeletonText, { opacity: pulseAnim }]} />
        <Animated.View style={[styles.skeletonTextShort, { opacity: pulseAnim }]} />
      </View>
      <Animated.View style={[styles.skeletonButton, { opacity: pulseAnim }]} />
    </View>
  );
}

/* ─── Compact Comment Preview Row - Premium styling ─── */
function CommentPreviewRow({ answer }: { answer: any }) {
  const isMedia = answer.type === 'photo' || answer.type === 'video' || answer.type === 'voice';
  const displayName = answer.isAnonymous !== false ? 'Anonymous' : (answer.authorName || 'User');

  return (
    <View style={styles.commentRow}>
      <View style={styles.commentAvatar}>
        <Ionicons name="person" size={10} color={PREMIUM.textMuted} />
      </View>
      <Text style={styles.commentText} numberOfLines={1} ellipsizeMode="tail">
        <Text style={styles.commentName}>{displayName}</Text>
        {'  '}
        {isMedia ? (
          <Text style={styles.commentMedia}>
            {answer.type === 'voice' ? '🎤 Voice' : answer.type === 'video' ? '🎬 Video' : '📷 Photo'}
          </Text>
        ) : (
          <Text style={styles.commentSnippet}>{answer.text || ''}</Text>
        )}
      </Text>
    </View>
  );
}

/* ─── Section Header Component - Premium styling ─── */
function SectionHeader({ label, isTrending }: { label: string; isTrending: boolean }) {
  if (isTrending) {
    return (
      <View style={styles.trendingSectionHeader}>
        <LinearGradient
          colors={[PREMIUM.coral, PREMIUM.coralSoft]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.trendingIconBg}
        >
          <Ionicons name="flame" size={12} color="#FFF" />
        </LinearGradient>
        <Text style={styles.trendingSectionLabel}>Trending</Text>
      </View>
    );
  }

  return (
    <View style={styles.sectionHeaderContainer}>
      <View style={styles.sectionDivider} />
      <Text style={styles.sectionLabel}>{label}</Text>
      <View style={styles.sectionDivider} />
    </View>
  );
}

/* ─── Trending Prompt Data Type ─── */
type TrendingPromptData = {
  _id: any;
  type: 'truth' | 'dare';
  text: string;
  isTrending: boolean;
  expiresAt: number;
  answerCount: number;
  isAnonymous?: boolean;
  photoBlurMode?: 'none' | 'blur';
  ownerName?: string;
  ownerPhotoUrl?: string;
  ownerAge?: number;
  ownerGender?: string;
};

/* ─── Animated Press Wrapper for premium feel ─── */
function AnimatedPressCard({
  children,
  onPress,
  onLongPress,
  style,
  isTrending = false,
}: {
  children: React.ReactNode;
  onPress: () => void;
  onLongPress?: () => void;
  style?: any;
  isTrending?: boolean;
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.98,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  };

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      delayLongPress={400}
    >
      <Animated.View style={[style, { transform: [{ scale: scaleAnim }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

/* ─── Trending Card (premium styling with glow accent) ─── */
// P2-002 FIX: Accept promptId prop and call handlers with ID to avoid inline arrow functions in renderItem
const TrendingCard = React.memo(function TrendingCard({
  prompt,
  promptId,
  onOpenThread,
  onAddComment,
  onLongPress,
  isOwner,
}: {
  prompt: TrendingPromptData;
  promptId: string;
  onOpenThread: (id: string) => void;
  onAddComment: (id: string) => void;
  onLongPress?: (id: string) => void;
  isOwner?: boolean;
}) {
  // P2-002: Stable callback references
  const handleOpenThread = useCallback(() => onOpenThread(promptId), [onOpenThread, promptId]);
  const handleAddComment = useCallback(() => onAddComment(promptId), [onAddComment, promptId]);
  const handleLongPress = useCallback(() => onLongPress?.(promptId), [onLongPress, promptId]);
  const isTruth = prompt.type === 'truth';
  const isAnon = prompt.isAnonymous ?? true;
  const answerCount = prompt.answerCount ?? 0;
  const showPhoto = shouldShowPhoto(prompt);
  const genderColor = getGenderColor(prompt.ownerGender);

  const pillColors: readonly [string, string] = isTruth
    ? [PREMIUM.truthPurple, PREMIUM.truthPurpleLight]
    : [PREMIUM.dareOrange, PREMIUM.dareOrangeLight];

  return (
    <AnimatedPressCard
      onPress={handleOpenThread}
      onLongPress={isOwner ? handleLongPress : undefined}
      style={styles.trendingCard}
      isTrending
    >
      {/* Accent glow border effect */}
      <LinearGradient
        colors={[isTruth ? 'rgba(124,106,239,0.15)' : 'rgba(255,120,73,0.15)', 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.trendingGlow}
      />

      {/* Card content wrapper */}
      <View style={styles.cardContent}>
        {/* Header Row: Owner Identity */}
        <View style={styles.cardHeader}>
          <View style={styles.ownerIdentity}>
            {showPhoto ? (
              <View style={styles.ownerPhotoWrapper}>
                <OwnerPhoto uri={prompt.ownerPhotoUrl!} promptId={String(prompt._id)} />
              </View>
            ) : (
              <View style={styles.ownerPhotoPlaceholder}>
                <Ionicons name={isAnon ? 'eye-off' : 'person'} size={14} color={PREMIUM.textMuted} />
              </View>
            )}
            <View style={styles.ownerInfo}>
              <Text style={styles.ownerNamePremium} numberOfLines={1}>
                {isAnon ? 'Anonymous' : (prompt.ownerName || 'User')}
              </Text>
              {!isAnon && (prompt.ownerAge || prompt.ownerGender) && (
                <View style={styles.ownerMeta}>
                  {prompt.ownerAge && (
                    <Text style={styles.ownerAge}>{prompt.ownerAge}</Text>
                  )}
                  {prompt.ownerGender && (
                    <>
                      <View style={[styles.genderDot, { backgroundColor: genderColor }]} />
                      <Ionicons name={getGenderIcon(prompt.ownerGender)} size={11} color={genderColor} />
                    </>
                  )}
                </View>
              )}
            </View>
          </View>
        </View>

        {/* Prompt text - Hero element */}
        <Text style={styles.promptTextHero} numberOfLines={3}>{prompt.text}</Text>

        {/* Engagement row */}
        <View style={styles.engagementRow}>
          <View style={styles.answerBadge}>
            <Ionicons name="chatbubble" size={11} color={PREMIUM.textMuted} />
            <Text style={styles.answerCountText}>
              {answerCount === 1 ? '1 answer' : `${answerCount} answers`}
            </Text>
          </View>
          <View style={styles.trendingBadge}>
            <Ionicons name="flame" size={11} color={PREMIUM.coral} />
            <Text style={styles.trendingBadgeText}>Hot</Text>
          </View>
        </View>
      </View>

      {/* Right column: Pill top, + button bottom */}
      <View style={styles.cardRightColumn}>
        <LinearGradient
          colors={pillColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.typePillGradient}
        >
          <Ionicons name={isTruth ? 'help-circle' : 'flash'} size={12} color="#FFF" />
          <Text style={styles.typePillText}>{isTruth ? 'Truth' : 'Dare'}</Text>
        </LinearGradient>

        <TouchableOpacity
          style={styles.addButtonPremium}
          onPress={(e) => { e.stopPropagation?.(); handleAddComment(); }}
          activeOpacity={0.85}
        >
          <LinearGradient
            colors={[PREMIUM.coral, PREMIUM.coralSoft]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.addButtonGradient}
          >
            <Ionicons name="add" size={22} color="#FFF" />
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </AnimatedPressCard>
  );
});

/* ─── Prompt Card (with comment previews) - Premium redesign ─── */
// P2-002 FIX: Accept promptId prop and call handlers with ID to avoid inline arrow functions in renderItem
const PromptCard = React.memo(function PromptCard({
  prompt,
  promptId,
  onOpenThread,
  onAddComment,
  onLongPress,
  isOwner,
}: {
  prompt: {
    _id: any;
    type: 'truth' | 'dare';
    text: string;
    isTrending: boolean;
    expiresAt: number;
    top2Answers: any[];
    totalAnswers: number;
    hasAnswered: boolean;
    myAnswerId: string | null;
    isAnonymous?: boolean;
    photoBlurMode?: 'none' | 'blur';
    ownerName?: string;
    ownerPhotoUrl?: string;
    ownerAge?: number;
    ownerGender?: string;
    answerCount?: number;
  };
  promptId: string;
  onOpenThread: (id: string) => void;
  onAddComment: (id: string) => void;
  onLongPress?: (id: string) => void;
  isOwner?: boolean;
}) {
  // P2-002: Stable callback references
  const handleOpenThread = useCallback(() => onOpenThread(promptId), [onOpenThread, promptId]);
  const handleAddComment = useCallback(() => onAddComment(promptId), [onAddComment, promptId]);
  const handleLongPress = useCallback(() => onLongPress?.(promptId), [onLongPress, promptId]);

  const isTruth = prompt.type === 'truth';
  const isAnon = prompt.isAnonymous ?? true;
  const answerCount = prompt.totalAnswers ?? prompt.answerCount ?? 0;
  const previewCount = prompt.top2Answers?.length ?? 0;
  const showPhoto = shouldShowPhoto(prompt);
  const genderColor = getGenderColor(prompt.ownerGender);

  const pillColors: readonly [string, string] = isTruth
    ? [PREMIUM.truthPurple, PREMIUM.truthPurpleLight]
    : [PREMIUM.dareOrange, PREMIUM.dareOrangeLight];

  return (
    <AnimatedPressCard
      onPress={handleOpenThread}
      onLongPress={isOwner ? handleLongPress : undefined}
      style={styles.card}
    >
      {/* Card content wrapper */}
      <View style={styles.cardContent}>
        {/* Header Row: Owner Identity */}
        <View style={styles.cardHeader}>
          <View style={styles.ownerIdentity}>
            {showPhoto ? (
              <View style={styles.ownerPhotoWrapper}>
                <OwnerPhoto uri={prompt.ownerPhotoUrl!} promptId={String(prompt._id)} />
              </View>
            ) : (
              <View style={styles.ownerPhotoPlaceholder}>
                <Ionicons name={isAnon ? 'eye-off' : 'person'} size={14} color={PREMIUM.textMuted} />
              </View>
            )}
            <View style={styles.ownerInfo}>
              <Text style={styles.ownerNamePremium} numberOfLines={1}>
                {isAnon ? 'Anonymous' : (prompt.ownerName || 'User')}
              </Text>
              {!isAnon && (prompt.ownerAge || prompt.ownerGender) && (
                <View style={styles.ownerMeta}>
                  {prompt.ownerAge && (
                    <Text style={styles.ownerAge}>{prompt.ownerAge}</Text>
                  )}
                  {prompt.ownerGender && (
                    <>
                      <View style={[styles.genderDot, { backgroundColor: genderColor }]} />
                      <Ionicons name={getGenderIcon(prompt.ownerGender)} size={11} color={genderColor} />
                    </>
                  )}
                </View>
              )}
            </View>
          </View>
        </View>

        {/* Prompt text - Hero element */}
        <Text style={styles.promptTextHero} numberOfLines={3}>{prompt.text}</Text>

        {/* Comment previews (up to 2) */}
        {previewCount > 0 && (
          <View style={styles.previewSection}>
            {prompt.top2Answers.map((answer) => (
              <CommentPreviewRow key={answer._id} answer={answer} />
            ))}
          </View>
        )}

        {/* Engagement row */}
        <View style={styles.engagementRow}>
          <View style={styles.answerBadge}>
            <Ionicons name="chatbubble" size={11} color={PREMIUM.textMuted} />
            <Text style={styles.answerCountText}>
              {answerCount === 1 ? '1 answer' : `${answerCount} answers`}
            </Text>
          </View>
        </View>
      </View>

      {/* Right column: Pill top, + button bottom */}
      <View style={styles.cardRightColumn}>
        <LinearGradient
          colors={pillColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.typePillGradient}
        >
          <Ionicons name={isTruth ? 'help-circle' : 'flash'} size={12} color="#FFF" />
          <Text style={styles.typePillText}>{isTruth ? 'Truth' : 'Dare'}</Text>
        </LinearGradient>

        <TouchableOpacity
          style={styles.addButtonPremium}
          onPress={(e) => { e.stopPropagation?.(); handleAddComment(); }}
          activeOpacity={0.85}
        >
          <LinearGradient
            colors={[PREMIUM.coral, PREMIUM.coralSoft]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.addButtonGradient}
          >
            <Ionicons name="add" size={22} color="#FFF" />
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </AnimatedPressCard>
  );
});

/* ─── Main Screen ─── */
export default function TruthOrDareScreen() {
  useScreenTrace("P2_TRUTH_OR_DARE");
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [refreshKey, setRefreshKey] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const firstRenderRef = useRef(true);
  const dataReceivedRef = useRef(false);

  // B2-HIGH FIX: Prevent stuck spinner and setState-after-unmount
  const mountedRef = useRef(true);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // B2-HIGH FIX: Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
    };
  }, []);

  // DIAGNOSTIC: Log when tab opens
  useEffect(() => {
    _tabOpenTime = Date.now();
    console.log(`[T/D REPORT] open_start=${_tabOpenTime}`);
    return () => { _tabOpenTime = 0; };
  }, []);

  // DIAGNOSTIC: Log first render timing
  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      const renderMs = _tabOpenTime > 0 ? Date.now() - _tabOpenTime : 0;
      console.log(`[T/D REPORT] first_render_ms=${renderMs}`);
    }
  }, []);

  const userId = useAuthStore((s) => s.userId);

  // Delete popup state
  const [deletePopupPromptId, setDeletePopupPromptId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const deletePromptMutation = useMutation(api.truthDare.deleteMyPrompt);

  // Get trending prompts (1 Dare + 1 Truth)
  const trendingDataQuery = useQuery(api.truthDare.getTrendingTruthAndDare);

  // Get all prompts (sorted by engagement)
  const promptsDataQuery = useQuery(
    api.truthDare.listActivePromptsWithTop2Answers,
    { viewerUserId: userId ?? undefined }
  );

  // Update cache when data arrives + log diagnostics
  useEffect(() => {
    if (promptsDataQuery !== undefined) {
      _cachedPromptsData = promptsDataQuery;
      _hasEverLoaded = true;
      // B2-HIGH FIX: Guard setState and clear timeout when data arrives
      if (mountedRef.current) {
        setIsRefreshing(false);
        if (refreshTimeoutRef.current) {
          clearTimeout(refreshTimeoutRef.current);
          refreshTimeoutRef.current = null;
        }
      }

      // DIAGNOSTIC: Log first data received timing
      if (!dataReceivedRef.current) {
        dataReceivedRef.current = true;
        const dataMs = _tabOpenTime > 0 ? Date.now() - _tabOpenTime : 0;
        console.log(`[T/D REPORT] first_data_ms=${dataMs}`);
        console.log(`[T/D REPORT] feed_count=${promptsDataQuery.length}`);

        // Log latest 3 prompts details
        promptsDataQuery.slice(0, 3).forEach((p: any, idx: number) => {
          const visibility = p.isAnonymous ? 'anonymous' : (p.photoBlurMode === 'blur' ? 'blurred' : 'everyone');
          console.log(`[T/D REPORT] item${idx + 1} id=${String(p._id).slice(-6)} visibility=${visibility} hasName=${!!p.ownerName} hasPhoto=${!!p.ownerPhotoUrl} photoPrefix=${getUrlPrefix(p.ownerPhotoUrl)} blurMode=${p.photoBlurMode || 'none'}`);
        });
      }
    }
  }, [promptsDataQuery]);

  useEffect(() => {
    if (trendingDataQuery !== undefined) {
      _cachedTrendingData = trendingDataQuery;
    }
  }, [trendingDataQuery]);

  // Use cached data ALWAYS for instant render - never block on query loading
  const prompts = promptsDataQuery ?? _cachedPromptsData;
  const trendingData = trendingDataQuery ?? _cachedTrendingData;

  // Get trending prompt IDs to exclude from normal list
  const trendingIds = useMemo(() => {
    const ids = new Set<string>();
    if (trendingData?.trendingDarePrompt) {
      ids.add(trendingData.trendingDarePrompt._id as unknown as string);
    }
    if (trendingData?.trendingTruthPrompt) {
      ids.add(trendingData.trendingTruthPrompt._id as unknown as string);
    }
    return ids;
  }, [trendingData]);

  // Filter out trending prompts from normal list
  const normalPrompts = useMemo(() => {
    return prompts.filter((p) => !trendingIds.has(p._id as unknown as string));
  }, [prompts, trendingIds]);

  const onRefresh = useCallback(() => {
    setIsRefreshing(true);
    setRefreshKey((k: number) => k + 1);

    // B2-HIGH FIX: Timeout fallback to prevent stuck spinner (10s)
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
    }
    refreshTimeoutRef.current = setTimeout(() => {
      if (mountedRef.current) {
        setIsRefreshing(false);
      }
    }, 10000);
  }, []);

  const openThread = useCallback((promptId: string) => {
    router.push({ pathname: '/(main)/prompt-thread' as any, params: { promptId } });
  }, [router]);

  const openCreateTod = useCallback(() => {
    router.push('/(main)/incognito-create-tod' as any);
  }, [router]);

  // Open thread for adding comment (same as opening thread, composer auto-shows)
  const openThreadForComment = useCallback((promptId: string) => {
    router.push({ pathname: '/(main)/prompt-thread' as any, params: { promptId, autoOpenComposer: 'new' } });
  }, [router]);

  // Long-press to show delete popup (owner only)
  const handleLongPressPrompt = useCallback((promptId: string) => {
    setDeletePopupPromptId(promptId);
  }, []);

  // Handle delete confirmation
  const handleDeletePrompt = useCallback(async () => {
    if (!deletePopupPromptId || !userId) return;

    setIsDeleting(true);
    try {
      await deletePromptMutation({ promptId: deletePopupPromptId, userId });
      setDeletePopupPromptId(null);
      Alert.alert('Deleted', 'Your post has been deleted.');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to delete post.');
    } finally {
      setIsDeleting(false);
    }
  }, [deletePopupPromptId, userId, deletePromptMutation]);

  // Close delete popup
  const handleCloseDeletePopup = useCallback(() => {
    setDeletePopupPromptId(null);
  }, []);

  type FeedItem =
    | { type: 'section'; label: string }
    | { type: 'trending'; prompt: TrendingPromptData }
    | { type: 'prompt'; prompt: typeof prompts[0] };

  const feedData: FeedItem[] = useMemo(() => {
    const items: FeedItem[] = [];

    // Trending section (Dare first, then Truth)
    const hasTrendingDare = !!trendingData?.trendingDarePrompt;
    const hasTrendingTruth = !!trendingData?.trendingTruthPrompt;

    if (hasTrendingDare || hasTrendingTruth) {
      items.push({ type: 'section', label: '🔥 Trending' });
      if (hasTrendingDare) {
        items.push({ type: 'trending', prompt: trendingData!.trendingDarePrompt! });
      }
      if (hasTrendingTruth) {
        items.push({ type: 'trending', prompt: trendingData!.trendingTruthPrompt! });
      }
    }

    // Normal prompts section
    if (normalPrompts.length > 0) {
      items.push({ type: 'section', label: 'More Truths & Dares' });
      normalPrompts.forEach((p) => items.push({ type: 'prompt', prompt: p }));
    }

    return items;
  }, [trendingData, normalPrompts]);

  // P2-002 FIX: Pass promptId and stable callbacks to cards (no inline arrow functions)
  const renderItem = useCallback(({ item }: { item: FeedItem }) => {
    if (item.type === 'section') {
      const isTrending = item.label.toLowerCase().includes('trending');
      return <SectionHeader label={item.label} isTrending={isTrending} />;
    }

    if (item.type === 'trending') {
      const promptId = item.prompt._id as unknown as string;
      const isOwner = (item.prompt as any).ownerUserId === userId;
      return (
        <TrendingCard
          prompt={item.prompt}
          promptId={promptId}
          onOpenThread={openThread}
          onAddComment={openThreadForComment}
          onLongPress={handleLongPressPrompt}
          isOwner={isOwner}
        />
      );
    }

    const promptId = item.prompt._id as unknown as string;
    const isOwner = (item.prompt as any).ownerUserId === userId;
    return (
      <PromptCard
        prompt={item.prompt}
        promptId={promptId}
        onOpenThread={openThread}
        onAddComment={openThreadForComment}
        onLongPress={handleLongPressPrompt}
        isOwner={isOwner}
      />
    );
  }, [openThread, openThreadForComment, handleLongPressPrompt, userId]);

  const getKey = useCallback((item: FeedItem, idx: number) => {
    if (item.type === 'section') return `section_${idx}`;
    if (item.type === 'trending') return `trending_${item.prompt._id}`;
    return `prompt_${item.prompt._id}`;
  }, []);

  // Check if we're in initial loading state (no data yet, cache empty)
  const isInitialLoading = promptsDataQuery === undefined && prompts.length === 0;

  // Show skeleton cards while first load is happening
  if (isInitialLoading) {
    return (
      <LinearGradient
        colors={[PREMIUM.bgDeep, PREMIUM.bgBase]}
        style={[styles.container, { paddingTop: insets.top }]}
      >
        <View style={styles.header}>
          <LinearGradient
            colors={[PREMIUM.coral, PREMIUM.coralSoft]}
            style={styles.headerIconBg}
          >
            <Ionicons name="flame" size={14} color="#FFF" />
          </LinearGradient>
          <Text style={styles.headerTitle}>Truth or Dare</Text>
        </View>
        <View style={styles.listContent}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </View>
        <TouchableOpacity style={styles.fab} onPress={openCreateTod} activeOpacity={0.85}>
          <LinearGradient
            colors={[PREMIUM.coral, PREMIUM.coralSoft]}
            style={styles.fabGradient}
          >
            <Ionicons name="add" size={26} color="#FFF" />
          </LinearGradient>
        </TouchableOpacity>
      </LinearGradient>
    );
  }

  // Empty state only after data has loaded and is actually empty
  if (prompts.length === 0 && promptsDataQuery !== undefined) {
    return (
      <LinearGradient
        colors={[PREMIUM.bgDeep, PREMIUM.bgBase]}
        style={[styles.container, { paddingTop: insets.top }]}
      >
        <View style={styles.header}>
          <LinearGradient
            colors={[PREMIUM.coral, PREMIUM.coralSoft]}
            style={styles.headerIconBg}
          >
            <Ionicons name="flame" size={14} color="#FFF" />
          </LinearGradient>
          <Text style={styles.headerTitle}>Truth or Dare</Text>
        </View>
        <View style={styles.emptyState}>
          <View style={styles.emptyIconContainer}>
            <Ionicons name="help-circle-outline" size={52} color={PREMIUM.textMuted} />
          </View>
          <Text style={styles.emptyTitle}>No active prompts</Text>
          <Text style={styles.emptySubtitle}>Be the first to create a Truth or Dare!</Text>
          <TouchableOpacity style={styles.createFirstBtn} onPress={openCreateTod} activeOpacity={0.85}>
            <LinearGradient
              colors={[PREMIUM.coral, PREMIUM.coralSoft]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.createFirstBtnGradient}
            >
              <Ionicons name="add" size={18} color="#FFF" />
              <Text style={styles.createFirstBtnText}>Create Post</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient
      colors={[PREMIUM.bgDeep, PREMIUM.bgBase]}
      style={[styles.container, { paddingTop: insets.top }]}
    >
      <View style={styles.header}>
        <LinearGradient
          colors={[PREMIUM.coral, PREMIUM.coralSoft]}
          style={styles.headerIconBg}
        >
          <Ionicons name="flame" size={14} color="#FFF" />
        </LinearGradient>
        <Text style={styles.headerTitle}>Truth or Dare</Text>
      </View>

      <FlatList
        data={feedData}
        keyExtractor={getKey}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor={PREMIUM.coral}
            colors={[PREMIUM.coral]}
          />
        }
        // Performance props
        initialNumToRender={8}
        maxToRenderPerBatch={6}
        updateCellsBatchingPeriod={50}
        windowSize={5}
        removeClippedSubviews={Platform.OS === 'android'}
      />

      <TouchableOpacity
        style={styles.fab}
        onPress={openCreateTod}
        activeOpacity={0.85}
      >
        <LinearGradient
          colors={[PREMIUM.coral, PREMIUM.coralSoft]}
          style={styles.fabGradient}
        >
          <Ionicons name="add" size={26} color="#FFF" />
        </LinearGradient>
      </TouchableOpacity>

      {/* Delete confirmation popup - compact and contextual */}
      <Modal
        visible={!!deletePopupPromptId}
        transparent
        animationType="fade"
        onRequestClose={handleCloseDeletePopup}
      >
        <Pressable style={styles.deletePopupOverlay} onPress={handleCloseDeletePopup}>
          <Pressable style={styles.deletePopupContainer} onPress={() => {}}>
            <Text style={styles.deletePopupTitle}>Delete this post?</Text>
            <Text style={styles.deletePopupSubtitle}>
              This will permanently remove the post and all its comments.
            </Text>
            <View style={styles.deletePopupActions}>
              <TouchableOpacity
                style={styles.deletePopupCancelBtn}
                onPress={handleCloseDeletePopup}
                disabled={isDeleting}
              >
                <Text style={styles.deletePopupCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.deletePopupDeleteBtn}
                onPress={handleDeletePrompt}
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <Text style={styles.deletePopupDeleteText}>Deleting...</Text>
                ) : (
                  <>
                    <Ionicons name="trash-outline" size={14} color="#FFF" />
                    <Text style={styles.deletePopupDeleteText}>Delete</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  // ═══════════════════════════════════════════════════════════════════════════════
  // PREMIUM DARK THEME - Energetic, Modern, Polished
  // ═══════════════════════════════════════════════════════════════════════════════

  container: {
    flex: 1,
  },

  // ─── Header ───
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: PREMIUM.borderSubtle,
  },
  headerIconBg: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: PREMIUM.textPrimary,
    letterSpacing: 0.3,
  },

  // ─── Section Headers ───
  sectionHeaderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 12,
    gap: 12,
  },
  sectionDivider: {
    flex: 1,
    height: 1,
    backgroundColor: PREMIUM.borderSubtle,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: PREMIUM.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  trendingSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 10,
    gap: 8,
  },
  trendingIconBg: {
    width: 24,
    height: 24,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trendingSectionLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: PREMIUM.textPrimary,
    letterSpacing: 0.5,
  },

  listContent: {
    paddingBottom: 100,
    paddingTop: 4,
  },

  // ─── Normal Card - Premium styling ───
  card: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginHorizontal: 12,
    marginVertical: 6,
    backgroundColor: PREMIUM.bgElevated,
    borderRadius: 16,
    paddingLeft: 14,
    paddingRight: 10,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: PREMIUM.borderSubtle,
    // Subtle shadow for depth
    shadowColor: PREMIUM.shadowColor,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 3,
  },

  // ─── Trending Card - Distinct premium styling with glow ───
  trendingCard: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginHorizontal: 12,
    marginVertical: 6,
    backgroundColor: PREMIUM.bgElevated,
    borderRadius: 18,
    paddingLeft: 14,
    paddingRight: 10,
    paddingVertical: 16,
    borderWidth: 1.5,
    borderColor: PREMIUM.borderAccent,
    // Enhanced shadow for trending
    shadowColor: PREMIUM.coral,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 5,
    overflow: 'hidden',
  },
  trendingGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 18,
  },

  // ─── Card Content ───
  cardContent: {
    flex: 1,
    paddingRight: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },

  // ─── Owner Identity ───
  ownerIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  ownerPhotoWrapper: {
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: PREMIUM.borderSubtle,
    overflow: 'hidden',
  },
  ownerPhoto: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: PREMIUM.bgHighlight,
  },
  ownerPhotoPlaceholder: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: PREMIUM.bgHighlight,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: PREMIUM.borderSubtle,
  },
  ownerInfo: {
    flexDirection: 'column',
    justifyContent: 'center',
    gap: 2,
    flex: 1,
  },
  ownerName: {
    fontSize: 13,
    fontWeight: '600',
    color: PREMIUM.textSecondary,
  },
  ownerNamePremium: {
    fontSize: 13,
    fontWeight: '700',
    color: PREMIUM.textPrimary,
    letterSpacing: 0.2,
  },
  ownerMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ownerAge: {
    fontSize: 11,
    fontWeight: '500',
    color: PREMIUM.textMuted,
  },
  genderDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    opacity: 0.7,
  },

  // ─── Card Right Column - Pill top, + bottom ───
  cardRightColumn: {
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: '100%',
    minHeight: 80,
    paddingVertical: 2,
  },

  // ─── Type Pills - Gradient styling ───
  typePillGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  typePillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFF',
    letterSpacing: 0.3,
  },

  // ─── Prompt Text - Hero element ───
  promptTextHero: {
    fontSize: 16,
    fontWeight: '600',
    color: PREMIUM.textPrimary,
    lineHeight: 22,
    marginBottom: 10,
    letterSpacing: 0.2,
  },

  // ─── Engagement Row ───
  engagementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
  },
  answerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  answerCountText: {
    fontSize: 12,
    color: PREMIUM.textMuted,
    fontWeight: '500',
  },
  trendingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(233, 69, 96, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  trendingBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: PREMIUM.coral,
    letterSpacing: 0.5,
  },

  // ─── Comment Previews ───
  previewSection: {
    gap: 6,
    marginBottom: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: PREMIUM.borderSubtle,
  },
  commentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  commentAvatar: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: PREMIUM.bgHighlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentText: {
    flex: 1,
    fontSize: 12,
    color: PREMIUM.textSecondary,
    lineHeight: 16,
  },
  commentName: {
    fontWeight: '600',
    color: PREMIUM.textPrimary,
  },
  commentSnippet: {
    color: PREMIUM.textMuted,
  },
  commentMedia: {
    color: PREMIUM.coral,
    fontWeight: '600',
  },

  // ─── Add Button - Premium gradient ───
  addButtonPremium: {
    marginLeft: 6,
  },
  addButtonGradient: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: PREMIUM.coral,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },

  // ─── Empty State ───
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    gap: 16,
  },
  emptyIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: PREMIUM.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: PREMIUM.textPrimary,
  },
  emptySubtitle: {
    fontSize: 14,
    color: PREMIUM.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  createFirstBtn: {
    marginTop: 12,
    borderRadius: 24,
    overflow: 'hidden',
  },
  createFirstBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  createFirstBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFF',
    letterSpacing: 0.3,
  },

  // ─── FAB - Premium floating action button ───
  fab: {
    position: 'absolute',
    right: 18,
    bottom: 28,
    borderRadius: 28,
    shadowColor: PREMIUM.coral,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  fabGradient: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ─── Skeleton Cards - Animated loading placeholders ───
  skeletonCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    marginVertical: 6,
    backgroundColor: PREMIUM.bgElevated,
    borderRadius: 16,
    paddingLeft: 14,
    paddingRight: 8,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: PREMIUM.borderSubtle,
  },
  skeletonContent: {
    flex: 1,
    paddingRight: 10,
  },
  skeletonHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  skeletonAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: PREMIUM.bgHighlight,
  },
  skeletonName: {
    width: 90,
    height: 14,
    borderRadius: 7,
    backgroundColor: PREMIUM.bgHighlight,
    marginLeft: 10,
  },
  skeletonPill: {
    width: 60,
    height: 22,
    borderRadius: 11,
    backgroundColor: PREMIUM.bgHighlight,
    marginLeft: 'auto',
  },
  skeletonText: {
    width: '100%',
    height: 16,
    borderRadius: 8,
    backgroundColor: PREMIUM.bgHighlight,
    marginBottom: 8,
  },
  skeletonTextShort: {
    width: '65%',
    height: 16,
    borderRadius: 8,
    backgroundColor: PREMIUM.bgHighlight,
  },
  skeletonButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: PREMIUM.bgHighlight,
    marginLeft: 6,
  },

  // ─── Delete Popup - Compact contextual menu ───
  deletePopupOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  deletePopupContainer: {
    backgroundColor: PREMIUM.bgElevated,
    borderRadius: 16,
    padding: 20,
    width: 280,
    borderWidth: 1,
    borderColor: PREMIUM.borderSubtle,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 10,
  },
  deletePopupTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: PREMIUM.textPrimary,
    marginBottom: 8,
    textAlign: 'center',
  },
  deletePopupSubtitle: {
    fontSize: 13,
    color: PREMIUM.textMuted,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
  },
  deletePopupActions: {
    flexDirection: 'row',
    gap: 12,
  },
  deletePopupCancelBtn: {
    flex: 1,
    backgroundColor: PREMIUM.bgHighlight,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  deletePopupCancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: PREMIUM.textSecondary,
  },
  deletePopupDeleteBtn: {
    flex: 1,
    backgroundColor: PREMIUM.coral,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  deletePopupDeleteText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFF',
  },
});
