/**
 * Crossed Paths Screen - Phase 2 Implementation
 *
 * Features:
 * - Lists users who have crossed paths with the current user
 * - Shows distance ranges (e.g., "4-5 km") instead of exact distances
 * - Shows relative time (e.g., "today", "yesterday") instead of exact timestamps
 * - Shows crossing count for repeated crossings
 * - "Why am I seeing this?" explanation
 * - Navigation to profile on tap
 * - Hide/delete crossed path entries
 * - Demo mode with sample data
 */
import React, { useCallback, useState, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Animated,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { safePush } from '@/lib/safeRouter';
import { COLORS } from '@/lib/constants';
import { isDemoMode } from '@/hooks/useConvex';
import { DEMO_PROFILES } from '@/lib/demoData';
import { Id } from '@/convex/_generated/dataModel';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Key for storing when user last viewed crossed paths (shared with nearby.tsx)
const CROSSED_PATHS_LAST_SEEN_KEY = 'mira_crossed_paths_last_seen';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CrossedPathItem {
  id: string;
  otherUserId: string;
  otherUserName: string;
  otherUserAge: number;
  areaName: string;
  crossingCount: number;
  // Capped display ("1" / "2" / "3+") — clients should prefer this over
  // crossingCount for any UI string (Fix 4: no raw counts to displays).
  crossingCountDisplay?: string;
  distanceRange: string | null;
  locationDisclosure?: string | null;
  relativeTime: string;
  reasonTags: string[];
  reasonText: string | null;
  whyExplanation: string;
  photoUrl: string | null | undefined;
  initial: string;
  isVerified: boolean;
  createdAt?: number; // Timestamp for sorting/filtering
}

function formatLocationDisclosure(disclosure?: string | null): string | null {
  if (disclosure === 'distance_hidden') return 'Distance hidden for privacy';
  if (disclosure === 'approximate_area') return 'Approximate area';
  return null;
}

// 12 hours in milliseconds for "Just Crossed" threshold
const JUST_CROSSED_THRESHOLD_MS = 12 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Demo Data
// ---------------------------------------------------------------------------

const DEMO_CROSSED_PATHS: CrossedPathItem[] = [
  {
    id: 'demo_cp_1',
    otherUserId: 'demo_profile_1',
    otherUserName: DEMO_PROFILES[0]?.name ?? 'Priya',
    otherUserAge: DEMO_PROFILES[0]?.age ?? 25,
    areaName: 'Near Bandra West',
    crossingCount: 3,
    distanceRange: '2-3 km',
    relativeTime: '2 hours ago',
    reasonTags: ['interest:coffee', 'lookingFor:serious_vibes'],
    reasonText: 'You both enjoy coffee',
    whyExplanation: "You've crossed paths 3 times in similar areas. You both enjoy coffee.",
    photoUrl: DEMO_PROFILES[0]?.photos?.[0]?.url ?? null,
    initial: 'P',
    isVerified: true,
    createdAt: Date.now() - 2 * 60 * 60 * 1000, // 2 hours ago
  },
  {
    id: 'demo_cp_2',
    otherUserId: 'demo_profile_2',
    otherUserName: DEMO_PROFILES[1]?.name ?? 'Ananya',
    otherUserAge: DEMO_PROFILES[1]?.age ?? 23,
    areaName: 'Nearby area',
    crossingCount: 1,
    distanceRange: '1-2 km',
    relativeTime: 'Yesterday',
    reasonTags: ['interest:movies'],
    reasonText: 'You both enjoy movies',
    whyExplanation: 'You were in the same area within the last 24 hours. You both enjoy movies.',
    photoUrl: DEMO_PROFILES[1]?.photos?.[0]?.url ?? null,
    initial: 'A',
    isVerified: true,
    createdAt: Date.now() - 26 * 60 * 60 * 1000, // Yesterday
  },
  {
    id: 'demo_cp_3',
    otherUserId: 'demo_profile_3',
    otherUserName: DEMO_PROFILES[2]?.name ?? 'Meera',
    otherUserAge: DEMO_PROFILES[2]?.age ?? 27,
    areaName: 'Near Koramangala',
    crossingCount: 5,
    distanceRange: '3-5 km',
    relativeTime: '2 days ago',
    reasonTags: ['lookingFor:serious_vibes'],
    reasonText: "You're both looking for something serious",
    whyExplanation: "You've crossed paths 5 times in similar areas. You're both looking for something serious.",
    photoUrl: DEMO_PROFILES[2]?.photos?.[0]?.url ?? null,
    initial: 'M',
    isVerified: true,
    createdAt: Date.now() - 2 * 24 * 60 * 60 * 1000, // 2 days ago
  },
  {
    id: 'demo_cp_4',
    otherUserId: 'demo_profile_4',
    otherUserName: DEMO_PROFILES[3]?.name ?? 'Riya',
    otherUserAge: DEMO_PROFILES[3]?.age ?? 24,
    areaName: 'Near Indiranagar',
    crossingCount: 2,
    distanceRange: '1-2 km',
    relativeTime: '3 days ago',
    reasonTags: ['interest:travel'],
    reasonText: 'You both enjoy traveling',
    whyExplanation: "You've crossed paths 2 times. You both enjoy traveling.",
    photoUrl: DEMO_PROFILES[3]?.photos?.[0]?.url ?? null,
    initial: 'R',
    isVerified: true,
    createdAt: Date.now() - 3 * 24 * 60 * 60 * 1000, // 3 days ago
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CrossedPathsScreen() {
  const router = useRouter();
  const isDemo = isDemoMode;

  // Auth store - CONTRACT FIX: Use userId instead of token
  const userId = useAuthStore((s) => s.userId);

  // Local state
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hiddenDemoIds, setHiddenDemoIds] = useState<Set<string>>(new Set());
  const [refreshKey, setRefreshKey] = useState(0);

  // ---------------------------------------------------------------------------
  // Animation state for section reveals
  // ---------------------------------------------------------------------------
  const justCrossedOpacity = useRef(new Animated.Value(0)).current;
  const justCrossedTranslateY = useRef(new Animated.Value(12)).current;
  const frequentOpacity = useRef(new Animated.Value(0)).current;
  const frequentTranslateY = useRef(new Animated.Value(12)).current;
  const recentOpacity = useRef(new Animated.Value(0)).current;
  const recentTranslateY = useRef(new Animated.Value(12)).current;
  const hasAnimatedRef = useRef(false);

  // Query crossed paths history (live mode only)
  // CONTRACT FIX: Use authUserId instead of token
  const crossedPathsQuery = useQuery(
    api.crossedPaths.getCrossPathHistory,
    !isDemo && userId ? { authUserId: userId } : 'skip'
  );

  // Mutations for hide/delete (live mode only)
  const hideCrossedPathMutation = useMutation(api.crossedPaths.hideCrossedPath);
  const deleteCrossedPathMutation = useMutation(api.crossedPaths.deleteCrossedPath);
  // Fix 7 — daily distinct crossed-profile cap. Best-effort write so the
  // backend can correctly count "new" surfaces vs re-displays.
  const markDailyCrossedProfilesShown = useMutation(
    api.crossedPaths.markDailyCrossedProfilesShown,
  );
  const markedDailyShownKeyRef = useRef<string>('');

  // Loading state
  const isLoading = !isDemo && crossedPathsQuery === undefined;

  useEffect(() => {
    if (!isDemo && isRefreshing && crossedPathsQuery !== undefined) {
      setIsRefreshing(false);
    }
  }, [isDemo, isRefreshing, crossedPathsQuery]);

  // Mark crossed paths as seen when screen opens
  useEffect(() => {
    AsyncStorage.setItem(CROSSED_PATHS_LAST_SEEN_KEY, Date.now().toString()).catch(() => {});
  }, []);

  // Combine demo and live data
  const crossedPaths: CrossedPathItem[] = useMemo(() => {
    if (isDemo) {
      // Filter out hidden demo items
      return DEMO_CROSSED_PATHS.filter((item) => !hiddenDemoIds.has(item.id));
    }
    return crossedPathsQuery ?? [];
  }, [isDemo, crossedPathsQuery, hiddenDemoIds]);

  // Fix 7 — after the crossed-paths list renders, tell the backend which
  // distinct profiles the viewer saw today. This is best-effort: a failure
  // does not affect the UI, but it does let the daily cap correctly count
  // "new" surfaces vs re-displays. The markerKey guard prevents the same
  // identical list from being re-marked on every render.
  useEffect(() => {
    if (isDemo || !userId || crossedPaths.length === 0) return;
    const targetUserIds = Array.from(
      new Set(
        crossedPaths
          .map((item) => item.otherUserId)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    );
    if (targetUserIds.length === 0) return;

    const markerKey = `${userId}:${targetUserIds.join('|')}`;
    if (markedDailyShownKeyRef.current === markerKey) return;
    markedDailyShownKeyRef.current = markerKey;

    markDailyCrossedProfilesShown({
      authUserId: userId,
      targetUserIds: targetUserIds as any,
    }).catch((err) => {
      if (__DEV__) {
        console.log('[CROSSED_PATHS] daily shown tracking skipped', {
          reason: String(err).slice(0, 80),
        });
      }
    });
  }, [isDemo, userId, crossedPaths, markDailyCrossedProfilesShown]);

  // ---------------------------------------------------------------------------
  // Section Data - Split into "Just Crossed", "Frequent Crosses", "Recent"
  // ---------------------------------------------------------------------------
  const { justCrossed, frequentCrosses, recentEncounters } = useMemo(() => {
    const now = Date.now();

    // Sort all by createdAt DESC
    const sorted = [...crossedPaths].sort((a, b) =>
      (b.createdAt || 0) - (a.createdAt || 0)
    );

    // Just Crossed: Most recent within last 12 hours (only 1 item)
    const justCrossedItem = sorted.find((item) => {
      if (!item.createdAt) return false;
      return now - item.createdAt < JUST_CROSSED_THRESHOLD_MS;
    });

    // Frequent Crosses: crossingCount >= 2 (excluding justCrossed)
    const frequent = sorted.filter((item) =>
      item.crossingCount >= 2 && item.id !== justCrossedItem?.id
    );

    // Recent Encounters: Everything else (excluding justCrossed and frequent)
    const frequentIds = new Set(frequent.map(f => f.id));
    const recent = sorted.filter((item) =>
      item.id !== justCrossedItem?.id && !frequentIds.has(item.id)
    );

    return {
      justCrossed: justCrossedItem || null,
      frequentCrosses: frequent,
      recentEncounters: recent,
    };
  }, [crossedPaths]);

  // ---------------------------------------------------------------------------
  // Staggered section reveal animation
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // Only animate once when data first loads
    // Safe guards: check arrays exist before accessing .length
    if (hasAnimatedRef.current || isLoading) return;
    if (!crossedPaths || crossedPaths.length === 0) return;
    hasAnimatedRef.current = true;

    // Reset values
    justCrossedOpacity.setValue(0);
    justCrossedTranslateY.setValue(12);
    frequentOpacity.setValue(0);
    frequentTranslateY.setValue(12);
    recentOpacity.setValue(0);
    recentTranslateY.setValue(12);

    // Staggered animation sequence
    const DURATION = 250;
    const STAGGER_DELAY = 140;

    // Just Crossed section (immediate)
    if (justCrossed) {
      Animated.parallel([
        Animated.timing(justCrossedOpacity, {
          toValue: 1,
          duration: DURATION,
          useNativeDriver: true,
        }),
        Animated.timing(justCrossedTranslateY, {
          toValue: 0,
          duration: DURATION,
          useNativeDriver: true,
        }),
      ]).start();
    }

    // Frequent section (delayed)
    if (frequentCrosses && frequentCrosses.length > 0) {
      setTimeout(() => {
        Animated.parallel([
          Animated.timing(frequentOpacity, {
            toValue: 1,
            duration: DURATION,
            useNativeDriver: true,
          }),
          Animated.timing(frequentTranslateY, {
            toValue: 0,
            duration: DURATION,
            useNativeDriver: true,
          }),
        ]).start();
      }, justCrossed ? STAGGER_DELAY : 0);
    }

    // Recent section (further delayed)
    if (recentEncounters && recentEncounters.length > 0) {
      const delay = (justCrossed ? STAGGER_DELAY : 0) +
                    (frequentCrosses?.length > 0 ? STAGGER_DELAY : 0);
      setTimeout(() => {
        Animated.parallel([
          Animated.timing(recentOpacity, {
            toValue: 1,
            duration: DURATION,
            useNativeDriver: true,
          }),
          Animated.timing(recentTranslateY, {
            toValue: 0,
            duration: DURATION,
            useNativeDriver: true,
          }),
        ]).start();
      }, delay);
    }
  }, [isLoading, crossedPaths, justCrossed, frequentCrosses, recentEncounters]);

  // ---------------------------------------------------------------------------
  // Refresh handler
  // ---------------------------------------------------------------------------
  const handleRefresh = useCallback(async () => {
    if (isDemo) {
      // Demo mode: simulate refresh
      setIsRefreshing(true);
      await new Promise((resolve) => setTimeout(resolve, 500));
      setIsRefreshing(false);
      return;
    }

    // Live mode: change query identity so refresh causes a real refetch
    setIsRefreshing(true);
    setRefreshKey((current) => current + 1);
  }, [isDemo]);

  // ---------------------------------------------------------------------------
  // Navigation handlers
  // ---------------------------------------------------------------------------
  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const handleProfilePress = useCallback((profileId: string) => {
    // Light haptic on card tap
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      // Haptics not available
    }
    safePush(router, `/(main)/profile/${profileId}?source=crossed_paths` as any, 'crossed-paths->profile');
  }, [router]);

  // ---------------------------------------------------------------------------
  // Hide/Delete handlers
  // ---------------------------------------------------------------------------
  const handleHidePress = useCallback((item: CrossedPathItem) => {
    Alert.alert(
      'Hide this person?',
      `${item.otherUserName} will stay removed from Nearby and crossed paths unless you restore them later.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Hide',
          style: 'destructive',
          onPress: async () => {
            if (isDemo) {
              // Demo mode: hide locally
              setHiddenDemoIds((prev) => new Set([...prev, item.id]));
              return;
            }

            // Live mode: call mutation - CONTRACT FIX: Use authUserId
            if (!userId) return;
            try {
              await hideCrossedPathMutation({
                authUserId: userId,
                historyId: item.id as Id<'crossPathHistory'>,
              });
            } catch (error) {
              if (__DEV__) console.error('[CROSSED_PATHS] Hide failed:', error);
              Alert.alert('Error', 'Failed to hide. Please try again.');
            }
          },
        },
      ]
    );
  }, [isDemo, userId, hideCrossedPathMutation]);

  const handleDeletePress = useCallback((item: CrossedPathItem) => {
    Alert.alert(
      'Remove this person?',
      `${item.otherUserName} will stay removed from Nearby and crossed paths unless you restore them later.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            if (isDemo) {
              // Demo mode: hide locally (same effect)
              setHiddenDemoIds((prev) => new Set([...prev, item.id]));
              return;
            }

            // Live mode: call mutation - CONTRACT FIX: Use authUserId
            if (!userId) return;
            try {
              await deleteCrossedPathMutation({
                authUserId: userId,
                historyId: item.id as Id<'crossPathHistory'>,
              });
            } catch (error) {
              if (__DEV__) console.error('[CROSSED_PATHS] Delete failed:', error);
              Alert.alert('Error', 'Failed to remove. Please try again.');
            }
          },
        },
      ]
    );
  }, [isDemo, userId, deleteCrossedPathMutation]);

  const handleOptionsPress = useCallback((item: CrossedPathItem) => {
    Alert.alert(
      item.otherUserName,
      'What would you like to do?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Hide from list',
          onPress: () => handleHidePress(item),
        },
        {
          text: 'Remove permanently',
          style: 'destructive',
          onPress: () => handleDeletePress(item),
        },
      ]
    );
  }, [handleHidePress, handleDeletePress]);

  // ---------------------------------------------------------------------------
  // Render standard card (used in Recent and Frequent sections)
  // ---------------------------------------------------------------------------
  const renderCard = useCallback((item: CrossedPathItem) => {
    const locationDisclosure = formatLocationDisclosure(item.locationDisclosure);
    return (
      <TouchableOpacity
        key={item.id}
        style={styles.card}
        onPress={() => handleProfilePress(item.otherUserId as string)}
        onLongPress={() => handleOptionsPress(item)}
        activeOpacity={0.7}
        delayLongPress={400}
      >
        <View style={styles.cardContent}>
          {/* Profile photo */}
          <View style={styles.photoContainer}>
            {item.photoUrl ? (
              <Image source={{ uri: item.photoUrl }} style={styles.photo} />
            ) : (
              <View style={styles.photoPlaceholder}>
                <Text style={styles.photoInitial}>{item.initial}</Text>
              </View>
            )}
            {item.isVerified && (
              <View style={styles.verifiedBadge}>
                <Ionicons name="checkmark-circle" size={16} color={COLORS.primary} />
              </View>
            )}
          </View>

          {/* Info section */}
          <View style={styles.infoSection}>
            <View style={styles.nameRow}>
              <Text style={styles.name} numberOfLines={1}>
                {item.otherUserName}, {item.otherUserAge}
              </Text>
              {item.crossingCount > 1 && (
                <View style={styles.crossingBadge}>
                  <Ionicons name="footsteps" size={12} color={COLORS.primary} />
                  <Text style={styles.crossingCount}>
                    {item.crossingCountDisplay ?? String(item.crossingCount)}x
                  </Text>
                </View>
              )}
            </View>

            <View style={styles.detailsRow}>
              <View style={styles.detailItem}>
                <Ionicons name="location-outline" size={14} color={COLORS.textLight} />
                <Text style={styles.detailText}>{item.areaName}</Text>
              </View>
            </View>
            {locationDisclosure && (
              <View style={styles.locationDisclosureRow}>
                <Ionicons
                  name={item.locationDisclosure === 'distance_hidden' ? 'eye-off-outline' : 'shield-checkmark-outline'}
                  size={13}
                  color={COLORS.textLight}
                />
                <Text style={styles.locationDisclosureText}>{locationDisclosure}</Text>
              </View>
            )}

            <View style={styles.timeRow}>
              <Ionicons name="time-outline" size={14} color={COLORS.textLight} />
              <Text style={styles.timeText}>{item.relativeTime}</Text>
            </View>

            {/* Why am I seeing this? */}
            {item.reasonText && (
              <View style={styles.reasonRow}>
                <Ionicons name="heart-outline" size={14} color={COLORS.primary} />
                <Text style={styles.reasonText} numberOfLines={1}>
                  {item.reasonText}
                </Text>
              </View>
            )}
          </View>

          {/* Options button */}
          <TouchableOpacity
            style={styles.optionsButton}
            onPress={() => handleOptionsPress(item)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="ellipsis-vertical" size={18} color={COLORS.textLight} />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  }, [handleProfilePress, handleOptionsPress]);

  // ---------------------------------------------------------------------------
  // Render "Just Crossed" highlight card (larger, more prominent)
  // ---------------------------------------------------------------------------
  const renderJustCrossedCard = useCallback((item: CrossedPathItem) => {
    const locationDisclosure = formatLocationDisclosure(item.locationDisclosure);
    return (
      <TouchableOpacity
        style={styles.justCrossedCard}
        onPress={() => handleProfilePress(item.otherUserId as string)}
        onLongPress={() => handleOptionsPress(item)}
        activeOpacity={0.7}
        delayLongPress={400}
      >
        <View style={styles.justCrossedGlow} />
        <View style={styles.justCrossedContent}>
          {/* Large profile photo */}
          <View style={styles.justCrossedPhotoContainer}>
            {item.photoUrl ? (
              <Image source={{ uri: item.photoUrl }} style={styles.justCrossedPhoto} />
            ) : (
              <View style={styles.justCrossedPhotoPlaceholder}>
                <Text style={styles.justCrossedPhotoInitial}>{item.initial}</Text>
              </View>
            )}
            {item.isVerified && (
              <View style={styles.justCrossedVerifiedBadge}>
                <Ionicons name="checkmark-circle" size={20} color={COLORS.primary} />
              </View>
            )}
          </View>

          {/* Info */}
          <View style={styles.justCrossedInfo}>
            <Text style={styles.justCrossedName}>
              {item.otherUserName}, {item.otherUserAge}
            </Text>
            <View style={styles.justCrossedTimeRow}>
              <Ionicons name="time-outline" size={14} color={COLORS.primary} />
              <Text style={styles.justCrossedTime}>{item.relativeTime}</Text>
            </View>
            <Text style={styles.justCrossedLocation}>Near your area</Text>
            {locationDisclosure && (
              <Text style={styles.justCrossedDisclosure}>{locationDisclosure}</Text>
            )}
            {item.reasonText && (
              <Text style={styles.justCrossedReason} numberOfLines={1}>
                {item.reasonText}
              </Text>
            )}
          </View>

          {/* CTA arrow */}
          <View style={styles.justCrossedArrow}>
            <Ionicons name="chevron-forward" size={24} color={COLORS.primary} />
          </View>
        </View>
      </TouchableOpacity>
    );
  }, [handleProfilePress, handleOptionsPress]);

  // ---------------------------------------------------------------------------
  // Render frequent crossing card (compact with crossing count emphasis)
  // ---------------------------------------------------------------------------
  const renderFrequentCard = useCallback((item: CrossedPathItem) => {
    return (
      <TouchableOpacity
        key={item.id}
        style={styles.frequentCard}
        onPress={() => handleProfilePress(item.otherUserId as string)}
        onLongPress={() => handleOptionsPress(item)}
        activeOpacity={0.7}
        delayLongPress={400}
      >
        <View style={styles.frequentContent}>
          {/* Photo */}
          <View style={styles.frequentPhotoContainer}>
            {item.photoUrl ? (
              <Image source={{ uri: item.photoUrl }} style={styles.frequentPhoto} />
            ) : (
              <View style={styles.frequentPhotoPlaceholder}>
                <Text style={styles.frequentPhotoInitial}>{item.initial}</Text>
              </View>
            )}
          </View>

          {/* Info */}
          <View style={styles.frequentInfo}>
            <Text style={styles.frequentName} numberOfLines={1}>
              {item.otherUserName}, {item.otherUserAge}
            </Text>
            <View style={styles.frequentStatsRow}>
              <View style={styles.frequentCountBadge}>
                <Ionicons name="footsteps" size={12} color="#fff" />
                <Text style={styles.frequentCountText}>
                  Crossed {item.crossingCountDisplay ?? String(item.crossingCount)}x
                </Text>
              </View>
            </View>
            <Text style={styles.frequentTime}>Last seen {item.relativeTime.toLowerCase()}</Text>
          </View>

          {/* Arrow */}
          <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
        </View>
      </TouchableOpacity>
    );
  }, [handleProfilePress, handleOptionsPress]);

  // ---------------------------------------------------------------------------
  // Section header component
  // ---------------------------------------------------------------------------
  const renderSectionHeader = useCallback((title: string, subtitle?: string) => {
    return (
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle && <Text style={styles.sectionSubtitle}>{subtitle}</Text>}
      </View>
    );
  }, []);

  // ---------------------------------------------------------------------------
  // Empty state
  // ---------------------------------------------------------------------------
  const renderEmpty = useCallback(() => {
    if (isLoading) return null;

    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="footsteps-outline" size={64} color={COLORS.textLight} />
        <Text style={styles.emptyTitle}>No crossings yet</Text>
        <Text style={styles.emptySubtitle}>
          Keep Nearby open when you're out and about. We'll let you know when someone interesting crosses your path.
        </Text>
      </View>
    );
  }, [isLoading]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Crossed Paths</Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Loading state */}
      {isLoading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      )}

      {/* Demo mode notice */}
      {isDemo && (
        <View style={styles.demoNotice}>
          <Ionicons name="flask-outline" size={16} color={COLORS.warning} />
          <Text style={styles.demoNoticeText}>Demo mode - showing sample data</Text>
        </View>
      )}

      {/* Sectioned Content */}
      {!isLoading && (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              colors={[COLORS.primary]}
              tintColor={COLORS.primary}
            />
          }
        >
          {/* Empty state */}
          {crossedPaths.length === 0 && renderEmpty()}

          {/* Just Crossed Section (if recent crossing exists) */}
          {justCrossed && (
            <Animated.View
              style={{
                opacity: justCrossedOpacity,
                transform: [{ translateY: justCrossedTranslateY }],
              }}
            >
              {renderSectionHeader('Just crossed', 'Someone crossed your path recently')}
              {renderJustCrossedCard(justCrossed)}
            </Animated.View>
          )}

          {/* Frequent Crosses Section */}
          {frequentCrosses.length > 0 && (
            <Animated.View
              style={{
                opacity: frequentOpacity,
                transform: [{ translateY: frequentTranslateY }],
              }}
            >
              {renderSectionHeader('You keep crossing paths')}
              {frequentCrosses.map(renderFrequentCard)}
            </Animated.View>
          )}

          {/* Recent Encounters Section */}
          {recentEncounters.length > 0 && (
            <Animated.View
              style={{
                opacity: recentOpacity,
                transform: [{ translateY: recentTranslateY }],
              }}
            >
              {renderSectionHeader('Recent encounters')}
              {recentEncounters.map(renderCard)}
            </Animated.View>
          )}

          {/* Bottom padding */}
          <View style={styles.bottomPadding} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

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
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
  },
  headerSpacer: {
    width: 32,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 15,
    color: COLORS.textLight,
  },
  demoNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `${COLORS.warning}15`,
    paddingVertical: 8,
    gap: 6,
  },
  demoNoticeText: {
    fontSize: 13,
    color: COLORS.warning,
  },
  headerInfo: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: `${COLORS.primary}08`,
  },
  headerInfoContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerInfoText: {
    fontSize: 13,
    color: COLORS.textLight,
    flex: 1,
  },
  listContent: {
    flexGrow: 1,
    paddingBottom: 24,
  },
  card: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
  },
  photoContainer: {
    position: 'relative',
  },
  photo: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: COLORS.border,
  },
  photoPlaceholder: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoInitial: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
  },
  verifiedBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: '#fff',
    borderRadius: 8,
  },
  infoSection: {
    flex: 1,
    marginLeft: 14,
    marginRight: 8,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  name: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.text,
    flex: 1,
  },
  crossingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: `${COLORS.primary}15`,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    gap: 4,
  },
  crossingCount: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.primary,
  },
  detailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 12,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  detailText: {
    fontSize: 13,
    color: COLORS.textLight,
  },
  locationDisclosureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
  },
  locationDisclosureText: {
    fontSize: 12,
    color: COLORS.textLight,
    fontWeight: '600',
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 4,
  },
  timeText: {
    fontSize: 13,
    color: COLORS.textLight,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 4,
  },
  reasonText: {
    fontSize: 12,
    color: COLORS.primary,
    flex: 1,
  },
  optionsButton: {
    padding: 4,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingTop: 60,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 16,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 15,
    color: COLORS.textLight,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 22,
  },

  // ScrollView styles
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  bottomPadding: {
    height: 24,
  },

  // Section header styles
  sectionHeader: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: COLORS.textLight,
    marginTop: 2,
  },

  // Just Crossed card (highlighted)
  justCrossedCard: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 16,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
    overflow: 'hidden',
  },
  justCrossedGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: COLORS.primary,
  },
  justCrossedContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  justCrossedPhotoContainer: {
    position: 'relative',
  },
  justCrossedPhoto: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.border,
  },
  justCrossedPhotoPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  justCrossedPhotoInitial: {
    fontSize: 32,
    fontWeight: '700',
    color: '#fff',
  },
  justCrossedVerifiedBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: '#fff',
    borderRadius: 10,
  },
  justCrossedInfo: {
    flex: 1,
    marginLeft: 16,
  },
  justCrossedName: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
  },
  justCrossedTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 4,
  },
  justCrossedTime: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
  },
  justCrossedLocation: {
    fontSize: 13,
    color: COLORS.textLight,
    marginTop: 2,
  },
  justCrossedDisclosure: {
    fontSize: 12,
    color: COLORS.textLight,
    fontWeight: '600',
    marginTop: 2,
  },
  justCrossedReason: {
    fontSize: 13,
    color: COLORS.primary,
    marginTop: 6,
  },
  justCrossedArrow: {
    padding: 8,
  },

  // Frequent crossing card
  frequentCard: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 12,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.primary,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
  frequentContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  frequentPhotoContainer: {
    position: 'relative',
  },
  frequentPhoto: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.border,
  },
  frequentPhotoPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frequentPhotoInitial: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  frequentInfo: {
    flex: 1,
    marginLeft: 12,
  },
  frequentName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  frequentStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  frequentCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    gap: 4,
  },
  frequentCountText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
  },
  frequentTime: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 2,
  },
});
