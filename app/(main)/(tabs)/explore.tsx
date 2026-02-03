import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  BackHandler,
  Animated,
  PanResponder,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';
import { DEMO_PROFILES, DEMO_USER } from '@/lib/demoData';
import { seedDemoProfiles } from '@/lib/seedDemoProfiles';
import { COLORS, SWIPE_CONFIG } from '@/lib/constants';
import { ProfileCard, SwipeOverlay } from '@/components/cards';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import type { RelationshipIntent, ActivityFilter } from '@/types';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const H_PAD = 16;
const COL_GAP = 10;
const ROW_GAP = 10;
const CARD_W = (SCREEN_WIDTH - H_PAD * 2 - COL_GAP) / 2;
const CARD_H = 100;

// ---------------------------------------------------------------------------
// Category types & sections
// ---------------------------------------------------------------------------

type FilterType = 'intent' | 'activity' | 'distance' | 'verified' | 'interests_sort';

interface ExploreCategory {
  id: string;
  label: string;
  icon: string;
  filterType: FilterType;
  filterValue?: string;
  color: string;
  bg: string;
}

interface SectionData {
  title: string;
  cats: ExploreCategory[];
}

const SECTIONS: SectionData[] = [
  {
    title: 'Connection Goals',
    cats: [
      { id: 'long_term',       label: 'Long-term',         icon: 'heart',           filterType: 'intent',   filterValue: 'long_term',       color: '#E91E63', bg: '#FCE4EC' },
      { id: 'short_term',      label: 'Casual Dating',     icon: 'flash',           filterType: 'intent',   filterValue: 'short_term',      color: '#FF9800', bg: '#FFF3E0' },
      { id: 'new_friends',     label: 'New Friends',       icon: 'people',          filterType: 'intent',   filterValue: 'new_friends',     color: '#4CAF50', bg: '#E8F5E9' },
      { id: 'fwb',             label: 'Non-committal',     icon: 'flame',           filterType: 'intent',   filterValue: 'fwb',             color: '#F44336', bg: '#FFEBEE' },
      { id: 'figuring_out',    label: 'Open to Exploring', icon: 'help-circle',     filterType: 'intent',   filterValue: 'figuring_out',    color: '#795548', bg: '#EFEBE9' },
      { id: 'open_to_anything',label: 'Open to All',       icon: 'sparkles',        filterType: 'intent',   filterValue: 'open_to_anything',color: '#607D8B', bg: '#ECEFF1' },
      { id: 'free_tonight',    label: 'Free Tonight',      icon: 'moon',            filterType: 'activity', filterValue: 'free_tonight',    color: '#7C4DFF', bg: '#EDE7F6' },
      { id: 'this_weekend',    label: 'This Weekend',      icon: 'calendar',        filterType: 'activity', filterValue: 'this_weekend',    color: '#2196F3', bg: '#E3F2FD' },
      { id: 'near_me',         label: 'Near Me',           icon: 'location',        filterType: 'distance', filterValue: '5',               color: '#00BCD4', bg: '#E0F7FA' },
      { id: 'verified',        label: 'Verified Only',     icon: 'checkmark-circle',filterType: 'verified',                                 color: '#43A047', bg: '#E8F5E9' },
    ],
  },
  {
    title: 'Interests',
    cats: [
      { id: 'sort_interests', label: 'Like-Minded', icon: 'sparkles', filterType: 'interests_sort', color: '#E91E63', bg: '#FCE4EC' },
      { id: 'coffee',      label: 'Coffee & Cafe',  icon: 'cafe',            filterType: 'activity', filterValue: 'coffee',      color: '#795548', bg: '#EFEBE9' },
      { id: 'foodie',      label: 'Foodies',        icon: 'restaurant',      filterType: 'activity', filterValue: 'foodie',      color: '#FF5722', bg: '#FBE9E7' },
      { id: 'travel',      label: 'Travel',         icon: 'airplane',        filterType: 'activity', filterValue: 'travel',      color: '#00BCD4', bg: '#E0F7FA' },
      { id: 'gym_partner', label: 'Fitness',        icon: 'barbell',         filterType: 'activity', filterValue: 'gym_partner', color: '#F44336', bg: '#FFEBEE' },
      { id: 'movies',      label: 'Movies',         icon: 'film',            filterType: 'activity', filterValue: 'movies',      color: '#673AB7', bg: '#EDE7F6' },
      { id: 'nightlife',   label: 'Nightlife',      icon: 'wine',            filterType: 'activity', filterValue: 'nightlife',   color: '#9C27B0', bg: '#F3E5F5' },
      { id: 'concerts',    label: 'Music',          icon: 'musical-notes',   filterType: 'activity', filterValue: 'concerts',    color: '#E91E63', bg: '#FCE4EC' },
      { id: 'gaming',      label: 'Gaming',         icon: 'game-controller', filterType: 'activity', filterValue: 'gaming',      color: '#4CAF50', bg: '#E8F5E9' },
      { id: 'outdoors',    label: 'Outdoors',       icon: 'leaf',            filterType: 'activity', filterValue: 'outdoors',    color: '#388E3C', bg: '#E8F5E9' },
      { id: 'art_culture', label: 'Art & Culture',  icon: 'color-palette',   filterType: 'activity', filterValue: 'art_culture', color: '#FF9800', bg: '#FFF3E0' },
      { id: 'photography', label: 'Photography',    icon: 'camera',          filterType: 'activity', filterValue: 'photography', color: '#455A64', bg: '#ECEFF1' },
      { id: 'beach_pool',  label: 'Beach & Pool',   icon: 'water',           filterType: 'activity', filterValue: 'beach_pool',  color: '#0097A7', bg: '#E0F7FA' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Profile data type
// ---------------------------------------------------------------------------

interface ProfileData {
  id: string;
  name: string;
  age: number;
  bio?: string;
  city?: string;
  isVerified?: boolean;
  distance?: number;
  photos: { url: string }[];
  relationshipIntent?: string[];
  activities?: string[];
  /** True when the profile owner has opted to blur their photo */
  photoBlurred?: boolean;
}

// ---------------------------------------------------------------------------
// Merged demo profiles (hand-written 50 + generated 300 = 350)
// ---------------------------------------------------------------------------

let _allDemoProfiles: ProfileData[] | null = null;

function getAllDemoProfiles(): ProfileData[] {
  if (_allDemoProfiles) return _allDemoProfiles;

  const handWritten: ProfileData[] = DEMO_PROFILES.map((p: any) => ({
    id: p._id,
    name: p.name,
    age: p.age,
    bio: p.bio,
    city: p.city,
    isVerified: p.isVerified,
    distance: p.distance,
    photos: p.photos,
    relationshipIntent: p.relationshipIntent,
    activities: p.activities,
  }));

  const generated: ProfileData[] = seedDemoProfiles().map((p) => ({
    id: p._id,
    name: p.name,
    age: p.age,
    bio: p.bio,
    city: p.city,
    isVerified: p.isVerified,
    distance: p.distance,
    photos: p.photos,
    relationshipIntent: p.relationshipIntent,
    activities: p.activities,
  }));

  _allDemoProfiles = [...handWritten, ...generated];
  return _allDemoProfiles;
}

// ---------------------------------------------------------------------------
// Image preloader — prefetches the next N images
// ---------------------------------------------------------------------------

const preloadedUrls = new Set<string>();

function preloadImages(profiles: ProfileData[], startIndex: number, count: number = 5) {
  for (let i = startIndex; i < Math.min(startIndex + count, profiles.length); i++) {
    const url = profiles[i]?.photos?.[0]?.url;
    if (url && !preloadedUrls.has(url)) {
      preloadedUrls.add(url);
      Image.prefetch(url).catch(console.error);
    }
  }
}

// ---------------------------------------------------------------------------
// Memoized card wrapper — prevents re-render of cards that haven't changed
// ---------------------------------------------------------------------------

const MemoizedProfileCard = React.memo(ProfileCard);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ExploreScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { userId } = useAuthStore();
  const [selected, setSelected] = useState<ExploreCategory | null>(null);
  const [cardIndex, setCardIndex] = useState(0);

  // Reset card index when category changes
  useEffect(() => {
    setCardIndex(0);
  }, [selected?.id]);

  // --- Back gesture handling ---
  const goBack = useCallback(() => {
    if (selected) {
      setSelected(null);
      return true;
    }
    return false;
  }, [selected]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', goBack);
    return () => sub.remove();
  }, [goBack]);

  // iOS edge-swipe-from-left gesture
  const edgeSwipePan = useRef(new Animated.Value(0)).current;
  const edgeSwipeResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (evt, gs) =>
          selected !== null && evt.nativeEvent.pageX < 30 && gs.dx > 5 && Math.abs(gs.dx) > Math.abs(gs.dy),
        onMoveShouldSetPanResponderCapture: (evt, gs) =>
          selected !== null && evt.nativeEvent.pageX < 30 && gs.dx > 5 && Math.abs(gs.dx) > Math.abs(gs.dy),
        onPanResponderMove: (_, gs) => { if (gs.dx > 0) edgeSwipePan.setValue(gs.dx); },
        onPanResponderRelease: (_, gs) => {
          if (gs.dx > SCREEN_WIDTH * 0.35 || gs.vx > 0.5) {
            Animated.timing(edgeSwipePan, { toValue: SCREEN_WIDTH, duration: 200, useNativeDriver: true }).start(() => {
              setSelected(null);
              edgeSwipePan.setValue(0);
            });
          } else {
            Animated.spring(edgeSwipePan, { toValue: 0, useNativeDriver: true }).start();
          }
        },
        onPanResponderTerminate: () => { Animated.spring(edgeSwipePan, { toValue: 0, useNativeDriver: true }).start(); },
      }),
    [selected, edgeSwipePan],
  );

  // --- Data fetching (Convex — live mode only) ---
  const convexQueryArgs = (() => {
    if (isDemoMode || !userId || !selected) return 'skip' as const;
    if (selected.filterType === 'intent') {
      return { userId: userId as any, relationshipIntent: [selected.filterValue as RelationshipIntent] };
    }
    if (selected.filterType === 'interests_sort') {
      return { userId: userId as any, sortByInterests: true };
    }
    return 'skip' as const;
  })();

  const convexProfiles = useQuery(api.discover.getExploreProfiles, convexQueryArgs);

  // --- Profile list builder ---
  const getProfiles = useCallback((cat: ExploreCategory): ProfileData[] => {
    if (!isDemoMode) {
      return (convexProfiles?.profiles || []).map((p: any) => ({
        id: p.id, name: p.name, age: p.age, bio: p.bio, city: p.city,
        isVerified: p.isVerified, distance: p.distance, photos: p.photos,
        relationshipIntent: p.relationshipIntent, activities: p.activities,
        photoBlurred: p.photoBlurred,
      }));
    }

    // Demo mode: use merged 350+ profiles
    let list = getAllDemoProfiles();
    switch (cat.filterType) {
      case 'intent':
        list = list.filter((p) => p.relationshipIntent?.includes(cat.filterValue as RelationshipIntent));
        break;
      case 'activity':
        list = list.filter((p) => p.activities?.includes(cat.filterValue as ActivityFilter));
        break;
      case 'distance':
        list = list.filter((p) => (p.distance ?? 999) <= Number(cat.filterValue));
        break;
      case 'verified':
        list = list.filter((p) => p.isVerified);
        break;
      case 'interests_sort':
        list = [...list].sort((a, b) => {
          const sharedA = (a.activities || []).filter((act) => DEMO_USER.activities.includes(act)).length;
          const sharedB = (b.activities || []).filter((act) => DEMO_USER.activities.includes(act)).length;
          return sharedB - sharedA;
        });
        break;
    }
    return list;
  }, [convexProfiles]);

  const getCount = (cat: ExploreCategory): number => {
    if (!isDemoMode) return 0;
    return getProfiles(cat).length;
  };

  // ========================
  // SWIPE CARD LOGIC
  // ========================

  const overlayDirectionRef = useRef<'left' | 'right' | 'up' | null>(null);
  const overlayOpacityAnim = useRef(new Animated.Value(0)).current;
  const [overlayDirection, setOverlayDirection] = useState<'left' | 'right' | 'up' | null>(null);

  const panA = useRef(new Animated.ValueXY()).current;
  const panB = useRef(new Animated.ValueXY()).current;
  const activeSlotRef = useRef<0 | 1>(0);
  const [activeSlot, setActiveSlot] = useState<0 | 1>(0);
  const getActivePan = () => (activeSlotRef.current === 0 ? panA : panB);
  const activePan = activeSlot === 0 ? panA : panB;

  const swipeMutation = useMutation(api.likes.swipe);

  useEffect(() => {
    activeSlotRef.current = 0;
    setActiveSlot(0);
    panA.setValue({ x: 0, y: 0 });
    panB.setValue({ x: 0, y: 0 });
  }, [selected?.id]);

  const advanceCard = useCallback(() => {
    const newSlot: 0 | 1 = activeSlotRef.current === 0 ? 1 : 0;
    activeSlotRef.current = newSlot;

    const newPan = newSlot === 0 ? panA : panB;
    newPan.setValue({ x: 0, y: 0 });

    overlayOpacityAnim.setValue(0);
    overlayDirectionRef.current = null;
    setOverlayDirection(null);

    setActiveSlot(newSlot);
    setCardIndex((prev) => prev + 1);

    const oldPan = newSlot === 0 ? panB : panA;
    requestAnimationFrame(() => oldPan.setValue({ x: 0, y: 0 }));
  }, [panA, panB, overlayOpacityAnim]);

  const resetPosition = useCallback(() => {
    const currentPan = getActivePan();
    Animated.spring(currentPan, { toValue: { x: 0, y: 0 }, friction: 6, tension: 80, useNativeDriver: true }).start();
    overlayDirectionRef.current = null;
    overlayOpacityAnim.setValue(0);
    setOverlayDirection(null);
  }, [panA, panB, overlayOpacityAnim]);

  const handleCategorySwipe = useCallback(
    (direction: 'left' | 'right' | 'up', profiles: ProfileData[]) => {
      const current = profiles[cardIndex];
      if (!current) return;
      const action = direction === 'left' ? 'pass' : direction === 'up' ? 'super_like' : 'like';
      const swipedProfile = current;

      // Advance card immediately (optimistic) — no waiting for network
      advanceCard();

      if (isDemoMode) {
        if (direction === 'right' && Math.random() > 0.7) {
          Alert.alert("It's a Match!", `You and ${swipedProfile.name} liked each other!`);
        }
        return;
      }

      // Fire mutation in background — never blocks the UI
      swipeMutation({
        fromUserId: userId as any,
        toUserId: swipedProfile.id as any,
        action: action as any,
      }).then((result) => {
        if (result?.isMatch) {
          router.push(`/(main)/match-celebration?matchId=${result.matchId}&userId=${swipedProfile.id}`);
        }
      }).catch(console.error);
    },
    [cardIndex, userId, swipeMutation, advanceCard, router],
  );

  const animateCategorySwipe = useCallback(
    (direction: 'left' | 'right' | 'up', profiles: ProfileData[], velocity?: number) => {
      const currentPan = getActivePan();
      const targetX = direction === 'left' ? -SCREEN_WIDTH * 1.5 : direction === 'right' ? SCREEN_WIDTH * 1.5 : 0;
      const targetY = direction === 'up' ? -SCREEN_HEIGHT * 1.5 : 0;
      const speed = Math.abs(velocity || 0);
      const duration = speed > 1.5 ? 120 : speed > 0.5 ? 180 : 250;

      setOverlayDirection(direction);
      overlayOpacityAnim.setValue(1);

      Animated.parallel([
        Animated.timing(currentPan.x, { toValue: targetX, duration, useNativeDriver: true }),
        Animated.timing(currentPan.y, { toValue: targetY, duration, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (!finished) return;
        handleCategorySwipe(direction, profiles);
      });
    },
    [handleCategorySwipe, panA, panB, overlayOpacityAnim],
  );

  const thresholdX = SCREEN_WIDTH * SWIPE_CONFIG.SWIPE_THRESHOLD_X;
  const thresholdY = SCREEN_HEIGHT * SWIPE_CONFIG.SWIPE_THRESHOLD_Y;
  const velX = SWIPE_CONFIG.SWIPE_VELOCITY_X;
  const velY = SWIPE_CONFIG.SWIPE_VELOCITY_Y;

  const rotation = activePan.x.interpolate({
    inputRange: [-SCREEN_WIDTH / 2, 0, SCREEN_WIDTH / 2],
    outputRange: [`-${SWIPE_CONFIG.ROTATION_ANGLE}deg`, '0deg', `${SWIPE_CONFIG.ROTATION_ANGLE}deg`],
    extrapolate: 'clamp',
  });

  const cardStyle = {
    transform: [{ translateX: activePan.x }, { translateY: activePan.y }, { rotate: rotation }, { scale: 1 }],
  } as const;

  const nextScale = activePan.x.interpolate({
    inputRange: [-SCREEN_WIDTH / 2, 0, SCREEN_WIDTH / 2],
    outputRange: [1, 0.95, 1],
    extrapolate: 'clamp',
  });

  const profilesRef = useRef<ProfileData[]>([]);

  const categoryPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (evt, gs) => {
          if (evt.nativeEvent.pageX < 30) return false;
          return Math.abs(gs.dx) > 8 || Math.abs(gs.dy) > 8;
        },
        onMoveShouldSetPanResponderCapture: (evt, gs) => {
          if (evt.nativeEvent.pageX < 30) return false;
          return Math.abs(gs.dx) > 8 || Math.abs(gs.dy) > 8;
        },
        onPanResponderMove: (_, gs) => {
          getActivePan().setValue({ x: gs.dx, y: gs.dy });
          const absX = Math.abs(gs.dx);
          const absY = Math.abs(gs.dy);
          if (gs.dy < -15 && absY > absX) overlayDirectionRef.current = 'up';
          else if (gs.dx < -10) overlayDirectionRef.current = 'left';
          else if (gs.dx > 10) overlayDirectionRef.current = 'right';
          else overlayDirectionRef.current = null;
          overlayOpacityAnim.setValue(Math.min(Math.max(absX, absY) / 60, 1));
          const newDir = overlayDirectionRef.current;
          setOverlayDirection((prev) => (prev === newDir ? prev : newDir));
        },
        onPanResponderRelease: (_, gs) => {
          if (gs.dx < -thresholdX || gs.vx < -velX) { animateCategorySwipe('left', profilesRef.current, gs.vx); return; }
          if (gs.dx > thresholdX  || gs.vx > velX)  { animateCategorySwipe('right', profilesRef.current, gs.vx); return; }
          if (gs.dy < -thresholdY || gs.vy < -velY)  { animateCategorySwipe('up', profilesRef.current, gs.vy); return; }
          resetPosition();
        },
        onPanResponderTerminate: () => resetPosition(),
      }),
    [animateCategorySwipe, panA, panB, overlayOpacityAnim, resetPosition, thresholdX, thresholdY, velX, velY],
  );

  // ========================
  // CATEGORY DETAIL VIEW
  // ========================

  if (selected) {
    const profiles = getProfiles(selected);
    profilesRef.current = profiles;
    const current = cardIndex < profiles.length ? profiles[cardIndex] : undefined;
    const nextProfile = cardIndex + 1 < profiles.length ? profiles[cardIndex + 1] : undefined;
    const exhausted = cardIndex >= profiles.length;

    // Preload next 5 images whenever cardIndex changes
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => {
      preloadImages(profiles, cardIndex + 2, 5);
    }, [cardIndex, profiles]);

    // Live mode: loading state (convex query pending)
    if (!isDemoMode && convexProfiles === undefined) {
      return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
          <View style={[styles.detailHeader, { paddingTop: insets.top + 8 }]}>
            <TouchableOpacity onPress={goBack} style={styles.detailBackBtn}>
              <Ionicons name="arrow-back" size={22} color={COLORS.text} />
            </TouchableOpacity>
            <Ionicons name={selected.icon as any} size={20} color={selected.color} style={{ marginRight: 6 }} />
            <Text style={styles.detailTitle}>{selected.label}</Text>
          </View>
          <View style={styles.loadingCenter}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.loadingText}>Finding profiles...</Text>
          </View>
        </View>
      );
    }

    return (
      <Animated.View
        style={[styles.container, { transform: [{ translateX: edgeSwipePan }] }]}
        {...edgeSwipeResponder.panHandlers}
      >
        {/* Category header */}
        <View style={[styles.detailHeader, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity onPress={goBack} style={styles.detailBackBtn}>
            <Ionicons name="arrow-back" size={22} color={COLORS.text} />
          </TouchableOpacity>
          <Ionicons name={selected.icon as any} size={20} color={selected.color} style={{ marginRight: 6 }} />
          <Text style={styles.detailTitle}>
            {selected.filterType === 'interests_sort' ? 'Sort by Interests' : selected.label}
          </Text>
          <Text style={styles.detailCount}>
            {exhausted ? 0 : profiles.length - cardIndex} left
          </Text>
        </View>

        {/* Card stack — or exhausted / empty state */}
        {exhausted || profiles.length === 0 ? (
          <View style={styles.emptyCenter}>
            <Ionicons name={selected.icon as any} size={48} color={COLORS.border} />
            <Text style={styles.emptyTitle}>
              {profiles.length === 0 ? 'No profiles yet' : 'No more profiles'}
            </Text>
            <Text style={styles.emptySubtitle}>
              {profiles.length === 0
                ? selected.filterType === 'interests_sort'
                  ? 'No profiles with shared interests found.'
                  : `No one matches "${selected.label}" yet.`
                : "You've seen everyone in this category. Check back later!"}
            </Text>
            <TouchableOpacity
              style={styles.reloadButton}
              onPress={() => setCardIndex(0)}
            >
              <Ionicons name="refresh" size={18} color={COLORS.white} style={{ marginRight: 6 }} />
              <Text style={styles.reloadText}>Start Over</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.cardsContainer}>
              {/* Back card */}
              {nextProfile && (
                <Animated.View
                  style={[
                    styles.swipeCard,
                    { zIndex: 0, transform: [{ scale: nextScale }] },
                  ]}
                >
                  <MemoizedProfileCard
                    name={nextProfile.name}
                    age={nextProfile.age}
                    bio={nextProfile.bio}
                    city={nextProfile.city}
                    isVerified={nextProfile.isVerified}
                    distance={nextProfile.distance}
                    photos={nextProfile.photos}
                    photoBlurred={nextProfile.photoBlurred}
                  />
                </Animated.View>
              )}
              {/* Top card */}
              {current && (
                <Animated.View
                  style={[styles.swipeCard, { zIndex: 1 }, cardStyle]}
                  {...categoryPanResponder.panHandlers}
                >
                  <MemoizedProfileCard
                    name={current.name}
                    age={current.age}
                    bio={current.bio}
                    city={current.city}
                    isVerified={current.isVerified}
                    distance={current.distance}
                    photos={current.photos}
                    photoBlurred={current.photoBlurred}
                    showCarousel
                    onOpenProfile={() => router.push(`/profile/${current.id}` as any)}
                  />
                  <SwipeOverlay direction={overlayDirection} opacity={overlayOpacityAnim} />
                </Animated.View>
              )}
            </View>

            {/* Action buttons */}
            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.actionButton, styles.passBtn]}
                onPress={() => animateCategorySwipe('left', profiles)}
              >
                <Text style={styles.actionIcon}>✕</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionButton, styles.superBtn]}
                onPress={() => animateCategorySwipe('up', profiles)}
              >
                <Text style={styles.actionIcon}>⭐</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionButton, styles.likeBtn]}
                onPress={() => animateCategorySwipe('right', profiles)}
              >
                <Text style={styles.actionIcon}>❤️</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </Animated.View>
    );
  }

  // ========================
  // Profile completeness nudge
  // ========================

  const completeness = useQuery(
    api.users.getProfileCompleteness,
    !isDemoMode && userId ? { userId: userId as any } : 'skip',
  );

  const [nudgeDismissed, setNudgeDismissed] = useState(false);
  const showNudge = !nudgeDismissed && completeness && completeness.score < 70;

  // ========================
  // MAIN EXPLORE GRID
  // ========================

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.title}>Explore</Text>
      </View>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {showNudge && (
          <View style={styles.nudgeBanner}>
            <View style={styles.nudgeContent}>
              <Ionicons name="sparkles-outline" size={20} color={COLORS.primary} />
              <View style={styles.nudgeText}>
                <Text style={styles.nudgeTitle}>
                  Complete your profile ({completeness.score}%)
                </Text>
                <Text style={styles.nudgeSubtitle}>
                  {completeness.recommendations[0] || 'Finish your profile for better matches'}
                </Text>
              </View>
            </View>
            <View style={styles.nudgeActions}>
              <TouchableOpacity
                style={styles.nudgeBtn}
                onPress={() => router.push('/(main)/edit-profile')}
              >
                <Text style={styles.nudgeBtnText}>Complete</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setNudgeDismissed(true)}>
                <Ionicons name="close" size={18} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>
          </View>
        )}
        {SECTIONS.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionLabel}>{section.title}</Text>
            <View style={styles.grid}>
              {section.cats.map((cat) => {
                const count = getCount(cat);
                return (
                  <TouchableOpacity
                    key={cat.id}
                    style={[styles.card, { backgroundColor: cat.bg }]}
                    onPress={() => setSelected(cat)}
                    activeOpacity={0.75}
                  >
                    <View style={[styles.iconCircle, { backgroundColor: cat.color + '20' }]}>
                      <Ionicons name={cat.icon as any} size={24} color={cat.color} />
                    </View>
                    <Text style={[styles.cardLabel, { color: cat.color }]}>{cat.label}</Text>
                    {isDemoMode && count > 0 && (
                      <View style={[styles.badge, { backgroundColor: cat.color }]}>
                        <Text style={styles.badgeText}>{count}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },

  // Header
  header: {
    paddingHorizontal: H_PAD,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  title: { fontSize: 24, fontWeight: '700', color: COLORS.text },

  // Scroll & sections
  scroll: { paddingHorizontal: H_PAD, paddingTop: 16, paddingBottom: 40 },
  section: { marginBottom: 22 },
  sectionLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 10,
  },

  // 2-column grid
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: COL_GAP,
    rowGap: ROW_GAP,
  },
  card: {
    width: CARD_W,
    height: CARD_H,
    borderRadius: 16,
    padding: 14,
    justifyContent: 'space-between',
    position: 'relative',
    overflow: 'hidden',
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardLabel: {
    fontSize: 15,
    fontWeight: '700',
  },
  badge: {
    position: 'absolute',
    top: 10,
    right: 10,
    borderRadius: 10,
    minWidth: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },

  // Detail header
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: H_PAD,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  detailBackBtn: { marginRight: 8, padding: 2 },
  detailTitle: { flex: 1, fontSize: 20, fontWeight: '700', color: COLORS.text },
  detailCount: { fontSize: 14, fontWeight: '600', color: COLORS.textLight },

  // Swipe card stack
  cardsContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  swipeCard: {
    position: 'absolute',
    width: SCREEN_WIDTH - 32,
    height: SCREEN_HEIGHT * 0.6,
  },

  // Action buttons
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  actionButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  passBtn: { backgroundColor: '#FFEBEE', width: 62, height: 62, borderRadius: 31 },
  superBtn: { backgroundColor: '#E3F2FD' },
  likeBtn: { backgroundColor: '#E8F5E9', width: 62, height: 62, borderRadius: 31 },
  actionIcon: { fontSize: 24 },

  // Loading state
  loadingCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  loadingText: { fontSize: 15, color: COLORS.textLight, marginTop: 12 },

  // Empty / exhausted states
  emptyCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: COLORS.text, marginTop: 12, marginBottom: 6 },
  emptySubtitle: { fontSize: 13, color: COLORS.textLight, textAlign: 'center', marginBottom: 20 },

  // Reload button
  reloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 24,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  reloadText: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '600',
  },

  // Nudge banner
  nudgeBanner: {
    backgroundColor: COLORS.primary + '10',
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.primary + '25',
  },
  nudgeContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 10,
  },
  nudgeText: {
    flex: 1,
  },
  nudgeTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 2,
  },
  nudgeSubtitle: {
    fontSize: 12,
    color: COLORS.textLight,
    lineHeight: 16,
  },
  nudgeActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  nudgeBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 16,
  },
  nudgeBtnText: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: '600',
  },
});
