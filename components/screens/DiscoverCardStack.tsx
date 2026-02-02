import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
  Animated,
  PanResponder,
  TouchableOpacity,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { COLORS, INCOGNITO_COLORS, SWIPE_CONFIG } from "@/lib/constants";
import { getTrustBadges } from "@/lib/trustBadges";
import { useAuthStore } from "@/stores/authStore";
import { useDiscoverStore } from "@/stores/discoverStore";
import { ProfileCard, SwipeOverlay } from "@/components/cards";
import { isDemoMode } from "@/hooks/useConvex";
import { useNotifications } from "@/hooks/useNotifications";
import { DEMO_PROFILES, DEMO_USER } from "@/lib/demoData";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

const HEADER_H = 44;
const STANDOUT_MAX_CHARS = 120;

interface ProfileData {
  id: string;
  name: string;
  age: number;
  bio?: string;
  city?: string;
  isVerified?: boolean;
  verificationStatus?: string;
  distance?: number;
  photos: { url: string }[];
  activities?: string[];
  relationshipIntent?: string[];
  lastActive?: number;
  createdAt?: number;
  profilePrompts?: { question: string; answer: string }[];
}

export interface DiscoverCardStackProps {
  /** 'dark' applies INCOGNITO_COLORS to background/header only; card UI stays identical */
  theme?: "light" | "dark";
}

export function DiscoverCardStack({ theme = "light" }: DiscoverCardStackProps) {
  const dark = theme === "dark";
  const C = dark ? INCOGNITO_COLORS : COLORS;

  const insets = useSafeAreaInsets();
  const { userId } = useAuthStore();
  const [index, setIndex] = useState(0);

  // Daily limits store
  const discoverStore = useDiscoverStore();

  // Reset daily limits if new day
  useEffect(() => {
    discoverStore.checkAndResetIfNewDay();
  }, []);

  // Overlay refs + animated value (no React re-renders during drag)
  const overlayDirectionRef = useRef<"left" | "right" | "up" | null>(null);
  const overlayOpacityAnim = useRef(new Animated.Value(0)).current;
  const [overlayDirection, setOverlayDirection] = useState<"left" | "right" | "up" | null>(null);

  // Stand Out modal
  const [showStandOutModal, setShowStandOutModal] = useState(false);
  const [standOutMessage, setStandOutMessage] = useState("");

  // Notifications
  const { unseenCount } = useNotifications();

  // Profile data
  const convexProfiles = useQuery(
    api.discover.getDiscoverProfiles,
    !isDemoMode && userId
      ? { userId: userId as any, sortBy: "recommended" as any, limit: 20 }
      : "skip",
  );

  const latestProfiles: ProfileData[] = isDemoMode
    ? DEMO_PROFILES.map((p) => ({
        id: p._id,
        name: p.name,
        age: p.age,
        bio: p.bio,
        city: p.city,
        isVerified: p.isVerified,
        distance: p.distance,
        photos: p.photos,
        activities: p.activities,
        relationshipIntent: p.relationshipIntent,
        lastActive: Date.now() - 2 * 60 * 60 * 1000,
        createdAt: Date.now() - 60 * 24 * 60 * 60 * 1000,
        profilePrompts: (p as any).profilePrompts,
      }))
    : (convexProfiles || []).map((p: any) => ({
        id: p._id || p.id,
        name: p.name,
        age: p.age,
        bio: p.bio,
        city: p.city,
        isVerified: p.isVerified,
        verificationStatus: p.verificationStatus,
        distance: p.distance,
        photos: p.photos?.map((photo: any) => ({ url: photo.url || photo })) || [],
        activities: p.activities,
        relationshipIntent: p.relationshipIntent,
        lastActive: p.lastActive,
        createdAt: p.createdAt,
        profilePrompts: p.profilePrompts,
      }));

  // Keep last non-empty profiles to prevent blank-frame flicker
  const stableProfilesRef = useRef<ProfileData[]>([]);
  if (latestProfiles.length > 0) {
    stableProfilesRef.current = latestProfiles;
  }
  const profiles = latestProfiles.length > 0 ? latestProfiles : stableProfilesRef.current;

  // Trust badges
  const getBadges = (p: ProfileData) =>
    getTrustBadges({
      isVerified: p.isVerified,
      verificationStatus: p.verificationStatus,
      lastActive: p.lastActive,
      createdAt: p.createdAt,
      photoCount: p.photos?.length,
    });

  const swipeMutation = useMutation(api.likes.swipe);

  // Two-pan alternating approach
  const panA = useRef(new Animated.ValueXY()).current;
  const panB = useRef(new Animated.ValueXY()).current;
  const activeSlotRef = useRef<0 | 1>(0);
  const [activeSlot, setActiveSlot] = useState<0 | 1>(0);
  const getActivePan = () => (activeSlotRef.current === 0 ? panA : panB);

  const activePan = activeSlot === 0 ? panA : panB;

  const rotation = activePan.x.interpolate({
    inputRange: [-SCREEN_WIDTH / 2, 0, SCREEN_WIDTH / 2],
    outputRange: [`-${SWIPE_CONFIG.ROTATION_ANGLE}deg`, "0deg", `${SWIPE_CONFIG.ROTATION_ANGLE}deg`],
    extrapolate: "clamp",
  });

  const cardStyle = {
    transform: [{ translateX: activePan.x }, { translateY: activePan.y }, { rotate: rotation }, { scale: 1 }],
  } as const;

  const nextScale = activePan.x.interpolate({
    inputRange: [-SCREEN_WIDTH / 2, 0, SCREEN_WIDTH / 2],
    outputRange: [1, 0.95, 1],
    extrapolate: "clamp",
  });

  const current = profiles.length > 0 ? profiles[index % profiles.length] : undefined;
  const next = profiles.length > 0 ? profiles[(index + 1) % profiles.length] : undefined;

  const resetPosition = useCallback(() => {
    const currentPan = getActivePan();
    Animated.spring(currentPan, {
      toValue: { x: 0, y: 0 },
      friction: 6,
      tension: 80,
      useNativeDriver: true,
    }).start();
    overlayDirectionRef.current = null;
    overlayOpacityAnim.setValue(0);
    setOverlayDirection(null);
  }, [panA, panB, overlayOpacityAnim]);

  const advanceCard = useCallback(() => {
    const newSlot: 0 | 1 = activeSlotRef.current === 0 ? 1 : 0;
    activeSlotRef.current = newSlot;
    const newPan = newSlot === 0 ? panA : panB;
    newPan.setValue({ x: 0, y: 0 });
    overlayOpacityAnim.setValue(0);
    overlayDirectionRef.current = null;
    setOverlayDirection(null);
    setActiveSlot(newSlot);
    setIndex((prev) => prev + 1);
    const oldPan = newSlot === 0 ? panB : panA;
    requestAnimationFrame(() => oldPan.setValue({ x: 0, y: 0 }));
  }, [panA, panB, overlayOpacityAnim]);

  const handleSwipe = useCallback(
    (direction: "left" | "right" | "up", message?: string) => {
      if (!current) return;
      const action = direction === "left" ? "pass" : direction === "up" ? "super_like" : "like";

      // Check daily limits for likes and stand outs
      if (direction === "right" && discoverStore.hasReachedLikeLimit()) return;
      if (direction === "up" && discoverStore.hasReachedStandOutLimit()) return;

      const swipedProfile = current;
      advanceCard();

      // Increment counters
      if (direction === "right") discoverStore.incrementLikes();
      if (direction === "up") discoverStore.incrementStandOuts();

      if (isDemoMode) {
        if (direction === "right" && Math.random() > 0.7) {
          router.push(`/(main)/match-celebration?matchId=demo_match&userId=${swipedProfile.id}` as any);
        }
        return;
      }

      swipeMutation({
        fromUserId: userId as any,
        toUserId: swipedProfile.id as any,
        action: action as any,
        message: message,
      }).then((result) => {
        if (result?.isMatch) {
          router.push(`/(main)/match-celebration?matchId=${result.matchId}&userId=${swipedProfile.id}`);
        }
      }).catch((error: any) => {
        Alert.alert("Error", error.message || "Failed to swipe");
      });
    },
    [current, userId, swipeMutation, advanceCard, discoverStore],
  );

  const animateSwipe = useCallback(
    (direction: "left" | "right" | "up", velocity?: number) => {
      // Check limits before animating
      if (direction === "right" && discoverStore.hasReachedLikeLimit()) return;
      if (direction === "up" && discoverStore.hasReachedStandOutLimit()) return;

      const currentPan = getActivePan();
      const targetX = direction === "left" ? -SCREEN_WIDTH * 1.5 : direction === "right" ? SCREEN_WIDTH * 1.5 : 0;
      const targetY = direction === "up" ? -SCREEN_HEIGHT * 1.5 : 0;
      const speed = Math.abs(velocity || 0);
      const duration = speed > 1.5 ? 120 : speed > 0.5 ? 180 : 250;

      setOverlayDirection(direction);
      overlayOpacityAnim.setValue(1);

      Animated.parallel([
        Animated.timing(currentPan.x, { toValue: targetX, duration, useNativeDriver: true }),
        Animated.timing(currentPan.y, { toValue: targetY, duration, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (!finished) return;
        handleSwipe(direction);
      });
    },
    [handleSwipe, panA, panB, overlayOpacityAnim, discoverStore],
  );

  const thresholdX = SCREEN_WIDTH * SWIPE_CONFIG.SWIPE_THRESHOLD_X;
  const thresholdY = SCREEN_HEIGHT * SWIPE_CONFIG.SWIPE_THRESHOLD_Y;
  const velocityX = SWIPE_CONFIG.SWIPE_VELOCITY_X;
  const velocityY = SWIPE_CONFIG.SWIPE_VELOCITY_Y;

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) > 8 || Math.abs(gs.dy) > 8,
        onPanResponderGrant: () => {},
        onPanResponderMove: (_, gs) => {
          getActivePan().setValue({ x: gs.dx, y: gs.dy });
          const absX = Math.abs(gs.dx);
          const absY = Math.abs(gs.dy);
          if (gs.dy < -15 && absY > absX) overlayDirectionRef.current = "up";
          else if (gs.dx < -10) overlayDirectionRef.current = "left";
          else if (gs.dx > 10) overlayDirectionRef.current = "right";
          else overlayDirectionRef.current = null;
          overlayOpacityAnim.setValue(Math.min(Math.max(absX, absY) / 60, 1));
          const newDir = overlayDirectionRef.current;
          setOverlayDirection((prev) => (prev === newDir ? prev : newDir));
        },
        onPanResponderRelease: (_, gs) => {
          if (gs.dx < -thresholdX || gs.vx < -velocityX) { animateSwipe("left", gs.vx); return; }
          if (gs.dx > thresholdX  || gs.vx > velocityX)  { animateSwipe("right", gs.vx); return; }
          if (gs.dy < -thresholdY || gs.vy < -velocityY)  {
            // Up swipe triggers Stand Out modal instead of instant swipe
            resetPosition();
            if (!discoverStore.hasReachedStandOutLimit()) {
              setShowStandOutModal(true);
            }
            return;
          }
          resetPosition();
        },
        onPanResponderTerminate: () => resetPosition(),
      }),
    [animateSwipe, panA, panB, overlayOpacityAnim, resetPosition, thresholdX, thresholdY, velocityX, velocityY, discoverStore],
  );

  // Stand Out send handler
  const handleSendStandOut = useCallback(() => {
    if (!current) return;
    const msg = standOutMessage.trim();
    setShowStandOutModal(false);
    setStandOutMessage("");

    // Animate the card out (up direction)
    const currentPan = getActivePan();
    const targetY = -SCREEN_HEIGHT * 1.5;

    setOverlayDirection("up");
    overlayOpacityAnim.setValue(1);

    Animated.timing(currentPan.y, { toValue: targetY, duration: 250, useNativeDriver: true }).start(({ finished }) => {
      if (!finished) return;
      handleSwipe("up", msg || undefined);
    });
  }, [current, standOutMessage, handleSwipe, overlayOpacityAnim]);

  // Loading state
  if (!isDemoMode && !convexProfiles) {
    return (
      <View style={[styles.center, dark && { backgroundColor: INCOGNITO_COLORS.background }]}>
        <ActivityIndicator size="large" color={C.primary} />
        <Text style={[styles.loadingText, dark && { color: INCOGNITO_COLORS.textLight }]}>Loading profiles...</Text>
      </View>
    );
  }

  // Empty state
  if (profiles.length === 0) {
    return (
      <View style={[styles.center, dark && { backgroundColor: INCOGNITO_COLORS.background }]}>
        <Text style={styles.emptyEmoji}>🔍</Text>
        <Text style={[styles.emptyTitle, dark && { color: INCOGNITO_COLORS.text }]}>No profiles available</Text>
        <Text style={[styles.emptySubtitle, dark && { color: INCOGNITO_COLORS.textLight }]}>Check back later for new matches!</Text>
      </View>
    );
  }

  // Daily like limit reached state
  if (discoverStore.hasReachedLikeLimit()) {
    return (
      <View style={[styles.container, dark && { backgroundColor: INCOGNITO_COLORS.background }]}>
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top, height: insets.top + HEADER_H }, dark && { backgroundColor: INCOGNITO_COLORS.background }]}>
          <TouchableOpacity style={styles.headerBtn} onPress={() => router.push("/(main)/settings" as any)}>
            <Ionicons name="options-outline" size={22} color={dark ? INCOGNITO_COLORS.text : COLORS.text} />
          </TouchableOpacity>
          <Text style={[styles.headerLogo, dark && { color: INCOGNITO_COLORS.primary }]}>mira</Text>
          <TouchableOpacity style={styles.headerBtn} onPress={() => router.push("/(main)/likes" as any)}>
            <Ionicons name="heart" size={22} color={dark ? INCOGNITO_COLORS.text : COLORS.text} />
          </TouchableOpacity>
        </View>

        <View style={styles.limitContainer}>
          <Ionicons name="heart-circle-outline" size={80} color={COLORS.primary} />
          <Text style={[styles.limitTitle, dark && { color: INCOGNITO_COLORS.text }]}>You've used today's likes!</Text>
          <Text style={[styles.limitSubtitle, dark && { color: INCOGNITO_COLORS.textLight }]}>Likes refresh at midnight</Text>
          <TouchableOpacity
            style={styles.limitButton}
            onPress={() => router.push("/(main)/likes" as any)}
          >
            <Ionicons name="heart" size={18} color={COLORS.white} />
            <Text style={styles.limitButtonText}>Check who liked you</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Layout: card fills from header to bottom of content area
  const cardTop = insets.top + HEADER_H;
  const cardBottom = 4;
  const actionRowBottom = 16;

  const likesLeft = discoverStore.likesRemaining();
  const standOutsLeft = discoverStore.standOutsRemaining();

  return (
    <View style={[styles.container, dark && { backgroundColor: INCOGNITO_COLORS.background }]}>
      {/* Compact Header */}
      <View style={[styles.header, { paddingTop: insets.top, height: insets.top + HEADER_H }, dark && { backgroundColor: INCOGNITO_COLORS.background }]}>
        <TouchableOpacity style={styles.headerBtn} onPress={() => router.push("/(main)/settings" as any)}>
          <Ionicons name="options-outline" size={22} color={dark ? INCOGNITO_COLORS.text : COLORS.text} />
        </TouchableOpacity>
        <Text style={[styles.headerLogo, dark && { color: INCOGNITO_COLORS.primary }]}>mira</Text>
        <TouchableOpacity style={styles.headerBtn} onPress={() => router.push("/(main)/likes" as any)}>
          <Ionicons name="heart" size={22} color={dark ? INCOGNITO_COLORS.text : COLORS.text} />
          {unseenCount > 0 && (
            <View style={styles.bellBadge}>
              <Text style={styles.bellBadgeText}>{unseenCount > 9 ? "9+" : unseenCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Card Area (fills between header and tab bar) */}
      <View style={[styles.cardArea, { top: cardTop, bottom: cardBottom }]}>
        {/* Back card */}
        {next && (
          <Animated.View
            style={[styles.card, { zIndex: 0, transform: [{ scale: nextScale }] }]}
          >
            <ProfileCard
              name={next.name}
              age={next.age}
              city={next.city}
              isVerified={next.isVerified}
              distance={next.distance}
              photos={next.photos}
              trustBadges={getBadges(next)}
              profilePrompt={next.profilePrompts?.[0]}
            />
          </Animated.View>
        )}
        {/* Top card */}
        {current && (
          <Animated.View style={[styles.card, { zIndex: 1 }, cardStyle]} {...panResponder.panHandlers}>
            <ProfileCard
              name={current.name}
              age={current.age}
              city={current.city}
              isVerified={current.isVerified}
              distance={current.distance}
              photos={current.photos}
              trustBadges={getBadges(current)}
              profilePrompt={current.profilePrompts?.[0]}
              showCarousel
              onOpenProfile={() => router.push(`/profile/${current.id}` as any)}
            />
            <SwipeOverlay direction={overlayDirection} opacity={overlayOpacityAnim} />
          </Animated.View>
        )}
      </View>

      {/* 3-Button Action Bar */}
      <View style={[styles.actions, { bottom: actionRowBottom }]} pointerEvents="box-none">
        {/* Skip (X) */}
        <TouchableOpacity
          style={[styles.actionButton, styles.skipBtn]}
          onPress={() => animateSwipe("left")}
        >
          <Ionicons name="close" size={30} color="#F44336" />
        </TouchableOpacity>

        {/* Stand Out (star) */}
        <TouchableOpacity
          style={[
            styles.actionButton,
            styles.standOutBtn,
            discoverStore.hasReachedStandOutLimit() && styles.actionBtnDisabled,
          ]}
          onPress={() => {
            if (!discoverStore.hasReachedStandOutLimit()) {
              setShowStandOutModal(true);
            }
          }}
          disabled={discoverStore.hasReachedStandOutLimit()}
        >
          <Ionicons name="star" size={24} color={COLORS.white} />
          <View style={styles.standOutBadge}>
            <Text style={styles.standOutBadgeText}>{standOutsLeft}</Text>
          </View>
        </TouchableOpacity>

        {/* Like (heart) */}
        <TouchableOpacity
          style={[styles.actionButton, styles.likeBtn]}
          onPress={() => animateSwipe("right")}
        >
          <Ionicons name="heart" size={30} color={COLORS.white} />
        </TouchableOpacity>
      </View>

      {/* Stand Out Modal */}
      <Modal visible={showStandOutModal} transparent animationType="slide" onRequestClose={() => setShowStandOutModal(false)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Stand Out to {current?.name}</Text>
                <Text style={styles.modalRemaining}>{standOutsLeft} Stand Out{standOutsLeft !== 1 ? "s" : ""} left today</Text>
              </View>
              <TouchableOpacity onPress={() => { setShowStandOutModal(false); setStandOutMessage(""); }}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>Add a short message to get noticed.</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Write something memorable..."
              placeholderTextColor={COLORS.textMuted}
              value={standOutMessage}
              onChangeText={setStandOutMessage}
              maxLength={STANDOUT_MAX_CHARS}
              autoFocus
            />
            <View style={styles.modalFooter}>
              <Text style={styles.modalCharCount}>{standOutMessage.length}/{STANDOUT_MAX_CHARS}</Text>
              <TouchableOpacity
                style={styles.modalSend}
                onPress={handleSendStandOut}
              >
                <Ionicons name="star" size={16} color={COLORS.white} style={{ marginRight: 6 }} />
                <Text style={styles.modalSendText}>Send Stand Out</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  center: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: COLORS.textLight,
  },
  emptyEmoji: { fontSize: 64, marginBottom: 16 },
  emptyTitle: { fontSize: 24, fontWeight: "700", color: COLORS.text, marginBottom: 8 },
  emptySubtitle: { fontSize: 16, color: COLORS.textLight, textAlign: "center" },

  // Compact Header
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 8,
    backgroundColor: COLORS.background,
    zIndex: 10,
  },
  headerBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  headerLogo: {
    fontSize: 22,
    fontWeight: "800",
    color: COLORS.primary,
    letterSpacing: 1,
  },
  bellBadge: {
    position: "absolute",
    top: 0,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: COLORS.error,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: COLORS.background,
  },
  bellBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: COLORS.white,
  },

  // Card Area
  cardArea: {
    position: "absolute",
    left: 0,
    right: 0,
  },
  card: {
    position: "absolute",
    top: 4,
    left: 8,
    right: 8,
    bottom: 4,
    borderRadius: 16,
    overflow: "hidden",
  },

  // 3-Button Action Bar
  actions: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 20,
    zIndex: 50,
  },
  actionButton: {
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  skipBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.95)",
  },
  standOutBtn: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: "#2196F3",
    position: "relative",
  },
  likeBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.primary,
  },
  actionBtnDisabled: {
    opacity: 0.4,
  },
  standOutBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.white,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#2196F3",
  },
  standOutBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#2196F3",
  },

  // Daily limit reached
  limitContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  limitTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: COLORS.text,
    marginTop: 16,
    marginBottom: 8,
    textAlign: "center",
  },
  limitSubtitle: {
    fontSize: 15,
    color: COLORS.textLight,
    marginBottom: 24,
    textAlign: "center",
  },
  limitButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 28,
  },
  limitButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: COLORS.white,
  },

  // Stand Out Modal
  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: COLORS.overlay },
  modalBox: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 8,
  },
  modalTitle: { fontSize: 18, fontWeight: "700", color: COLORS.text },
  modalRemaining: { fontSize: 13, color: "#2196F3", fontWeight: "600", marginTop: 2 },
  modalClose: { fontSize: 20, color: COLORS.textLight, padding: 4 },
  modalSubtitle: { fontSize: 14, color: COLORS.textLight, marginBottom: 16 },
  modalInput: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: COLORS.text,
    minHeight: 60,
    textAlignVertical: "top",
    marginBottom: 12,
  },
  modalFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  modalCharCount: { fontSize: 13, color: COLORS.textMuted },
  modalSend: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#2196F3",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
  },
  modalSendText: { color: COLORS.white, fontSize: 16, fontWeight: "600" },
});
