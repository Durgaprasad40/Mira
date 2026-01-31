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
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { COLORS, SWIPE_CONFIG, ACTIVITY_FILTERS, MICRO_SURVEY_QUESTIONS } from "@/lib/constants";
import { computeIntentCompat } from "@/lib/intentCompat";
import { getTrustBadges } from "@/lib/trustBadges";
import { useAuthStore } from "@/stores/authStore";
import { ProfileCard, SwipeOverlay } from "@/components/cards";
import { isDemoMode } from "@/hooks/useConvex";
import { useNotifications } from "@/hooks/useNotifications";
import { DEMO_PROFILES, DEMO_USER } from "@/lib/demoData";
import { MicroSurveyModal } from "@/components/discover/MicroSurveyModal";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

// Compact header height
const HEADER_H = 44;

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
}

export default function DiscoverScreen() {
  const insets = useSafeAreaInsets();
  const { userId } = useAuthStore();
  const [index, setIndex] = useState(0);
  const lastSwipedProfile = useRef<ProfileData | null>(null);

  // Use refs + Animated.Value for overlay — avoids React re-renders during drag
  const overlayDirectionRef = useRef<"left" | "right" | "up" | null>(null);
  const overlayOpacityAnim = useRef(new Animated.Value(0)).current;
  const [overlayDirection, setOverlayDirection] = useState<"left" | "right" | "up" | null>(null);
  const [showTextModal, setShowTextModal] = useState(false);
  const [textMessage, setTextMessage] = useState("");

  // ── Notifications: single source of truth for badge + list ──
  const { unseenCount } = useNotifications();

  // ── Micro Surveys ──
  const [showSurvey, setShowSurvey] = useState(false);
  const [surveyQuestion, setSurveyQuestion] = useState(MICRO_SURVEY_QUESTIONS[0]);
  const swipeCountRef = useRef(0);
  const surveyCheckedRef = useRef(false);
  const submitSurveyMutation = useMutation(api.surveys.submitSurveyResponse);

  useEffect(() => {
    AsyncStorage.getItem("mira_session_count").then((val) => {
      const count = (parseInt(val || "0", 10) || 0) + 1;
      AsyncStorage.setItem("mira_session_count", String(count));
    });
  }, []);

  const checkSurveyEligibility = useCallback(async () => {
    if (surveyCheckedRef.current) return;
    const sessionCount = parseInt(await AsyncStorage.getItem("mira_session_count") || "0", 10);
    if (sessionCount > 0 && sessionCount % 3 === 0) {
      const questionIdx = (sessionCount / 3 - 1) % MICRO_SURVEY_QUESTIONS.length;
      setSurveyQuestion(MICRO_SURVEY_QUESTIONS[Math.floor(questionIdx)]);
      setShowSurvey(true);
      surveyCheckedRef.current = true;
    }
  }, []);

  const handleSurveySubmit = useCallback((questionId: string, questionText: string, response: string) => {
    setShowSurvey(false);
    if (!isDemoMode && userId) {
      submitSurveyMutation({ userId: userId as any, questionId, questionText, response });
    }
  }, [isDemoMode, userId, submitSurveyMutation]);

  // ── Profile data ──
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
      }));

  // Keep last non-empty profiles to prevent blank-frame flicker
  const stableProfilesRef = useRef<ProfileData[]>([]);
  if (latestProfiles.length > 0) {
    stableProfilesRef.current = latestProfiles;
  }
  const profiles = latestProfiles.length > 0 ? latestProfiles : stableProfilesRef.current;

  // Shared interests
  const myActivities: string[] = isDemoMode ? DEMO_USER.activities : [];
  const getSharedInterestLabels = (profileActivities?: string[]): string[] => {
    if (!profileActivities || myActivities.length === 0) return [];
    return profileActivities
      .filter((a) => myActivities.includes(a))
      .map((a) => ACTIVITY_FILTERS.find((f) => f.value === a)?.label || a);
  };

  // Intent compatibility
  const myIntents: string[] = isDemoMode ? DEMO_USER.relationshipIntent : [];
  const getIntentProps = (profileIntents?: string[]) => {
    if (!profileIntents || profileIntents.length === 0) return {};
    const { compat, theirPrimaryLabel, theirPrimaryEmoji } = computeIntentCompat(myIntents, profileIntents);
    return { intentLabel: theirPrimaryLabel, intentEmoji: theirPrimaryEmoji, intentCompat: compat };
  };

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
  const rewindMutation = useMutation(api.likes.rewind);

  // ── Two-pan alternating approach ──
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
  }, [panA, panB, overlayOpacityAnim, profiles]);

  const handleSwipe = useCallback(
    (direction: "left" | "right" | "up") => {
      if (!current) return;
      const action = direction === "left" ? "pass" : direction === "up" ? "super_like" : "like";
      const swipedProfile = current;
      lastSwipedProfile.current = swipedProfile;
      swipeCountRef.current++;
      if (swipeCountRef.current === 3) checkSurveyEligibility();
      advanceCard();

      if (isDemoMode) {
        if (direction === "right" && Math.random() > 0.7) {
          Alert.alert("It's a Match!", `You and ${swipedProfile.name} liked each other!`);
        }
        return;
      }

      swipeMutation({
        fromUserId: userId as any,
        toUserId: swipedProfile.id as any,
        action: action as any,
      }).then((result) => {
        if (result?.isMatch) {
          router.push(`/(main)/match-celebration?matchId=${result.matchId}&userId=${swipedProfile.id}`);
        }
      }).catch((error: any) => {
        Alert.alert("Error", error.message || "Failed to swipe");
      });
    },
    [current, userId, swipeMutation, advanceCard],
  );

  const animateSwipe = useCallback(
    (direction: "left" | "right" | "up", velocity?: number) => {
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
    [handleSwipe, panA, panB, overlayOpacityAnim],
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
          if (gs.dy < -thresholdY || gs.vy < -velocityY)  { animateSwipe("up", gs.vy); return; }
          resetPosition();
        },
        onPanResponderTerminate: () => resetPosition(),
      }),
    [animateSwipe, panA, panB, overlayOpacityAnim, resetPosition, thresholdX, thresholdY, velocityX, velocityY],
  );

  const rewindCard = useCallback(() => {
    if (index <= 0) return;
    const newSlot: 0 | 1 = activeSlotRef.current === 0 ? 1 : 0;
    activeSlotRef.current = newSlot;
    const newPan = newSlot === 0 ? panA : panB;
    newPan.setValue({ x: 0, y: 0 });
    overlayOpacityAnim.setValue(0);
    overlayDirectionRef.current = null;
    setOverlayDirection(null);
    setActiveSlot(newSlot);
    setIndex((prev) => prev - 1);
    const oldPan = newSlot === 0 ? panB : panA;
    requestAnimationFrame(() => oldPan.setValue({ x: 0, y: 0 }));
    lastSwipedProfile.current = null;
  }, [index, panA, panB, overlayOpacityAnim]);

  const handleRewind = useCallback(async () => {
    if (!lastSwipedProfile.current) { Alert.alert("Rewind", "No recent swipe to undo"); return; }
    if (isDemoMode) { rewindCard(); return; }
    try {
      await rewindMutation({ userId: userId as any });
      rewindCard();
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to rewind");
    }
  }, [userId, rewindMutation, rewindCard]);

  const handleSendText = useCallback(() => {
    if (!current || !textMessage.trim()) return;
    const sentTo = current;
    lastSwipedProfile.current = sentTo;
    setShowTextModal(false);
    setTextMessage("");
    advanceCard();
    if (isDemoMode) {
      Alert.alert("Message Sent", `Your message to ${sentTo.name} has been sent!`);
      return;
    }
    swipeMutation({
      fromUserId: userId as any,
      toUserId: sentTo.id as any,
      action: "text" as any,
      message: textMessage.trim(),
    }).then(() => {
      Alert.alert("Message Sent", `Your message to ${sentTo.name} has been sent!`);
    }).catch((error: any) => {
      Alert.alert("Error", error.message || "Failed to send message");
    });
  }, [current, textMessage, userId, swipeMutation, advanceCard]);

  // ── Loading state ──
  if (!isDemoMode && !convexProfiles) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading profiles...</Text>
      </View>
    );
  }

  // ── Empty state ──
  if (profiles.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyEmoji}>🔍</Text>
        <Text style={styles.emptyTitle}>No profiles available</Text>
        <Text style={styles.emptySubtitle}>Check back later for new matches!</Text>
      </View>
    );
  }

  // Layout: card fills from header to bottom of content area.
  const cardTop = insets.top + HEADER_H;
  const cardBottom = 4;
  const actionRowBottom = 16;

  return (
    <View style={styles.container}>
      {/* ── Compact Header ── */}
      <View style={[styles.header, { paddingTop: insets.top, height: insets.top + HEADER_H }]}>
        <TouchableOpacity style={styles.headerBtn} onPress={() => router.push("/(main)/settings" as any)}>
          <Ionicons name="options-outline" size={22} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerLogo}>mira</Text>
        <TouchableOpacity style={styles.headerBtn} onPress={() => router.push("/(main)/notifications" as any)}>
          <Ionicons name="notifications-outline" size={22} color={COLORS.text} />
          {unseenCount > 0 && (
            <View style={styles.bellBadge}>
              <Text style={styles.bellBadgeText}>{unseenCount > 9 ? "9+" : unseenCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* ── Card Area (fills between header and tab bar) ── */}
      <View style={[styles.cardArea, { top: cardTop, bottom: cardBottom }]}>
        {/* Back card */}
        {next && (
          <Animated.View
            style={[styles.card, { zIndex: 0, transform: [{ scale: nextScale }] }]}
          >
            <ProfileCard
              name={next.name}
              age={next.age}
              bio={next.bio}
              city={next.city}
              isVerified={next.isVerified}
              distance={next.distance}
              photos={next.photos}
              sharedInterests={getSharedInterestLabels(next.activities)}
              {...getIntentProps(next.relationshipIntent)}
              trustBadges={getBadges(next)}
            />
          </Animated.View>
        )}
        {/* Top card */}
        {current && (
          <Animated.View style={[styles.card, { zIndex: 1 }, cardStyle]} {...panResponder.panHandlers}>
            <ProfileCard
              name={current.name}
              age={current.age}
              bio={current.bio}
              city={current.city}
              isVerified={current.isVerified}
              distance={current.distance}
              photos={current.photos}
              sharedInterests={getSharedInterestLabels(current.activities)}
              {...getIntentProps(current.relationshipIntent)}
              trustBadges={getBadges(current)}
              showCarousel
              onOpenProfile={() => router.push(`/profile/${current.id}` as any)}
            />
            <SwipeOverlay direction={overlayDirection} opacity={overlayOpacityAnim} />
          </Animated.View>
        )}
      </View>

      {/* ── Action Buttons (overlaid on bottom of card, above tab bar) ── */}
      <View style={[styles.actions, { bottom: actionRowBottom }]}>
        <TouchableOpacity style={[styles.actionButton, styles.smallBtn]} onPress={handleRewind}>
          <Ionicons name="arrow-undo" size={24} color="#FF9800" />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionButton, styles.bigBtn]} onPress={() => animateSwipe("left")}>
          <Ionicons name="close" size={34} color="#F44336" />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionButton, styles.medBtn]} onPress={() => animateSwipe("up")}>
          <Ionicons name="star" size={26} color="#2196F3" />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionButton, styles.bigBtn]} onPress={() => animateSwipe("right")}>
          <Ionicons name="heart" size={34} color="#4CAF50" />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionButton, styles.smallBtn]} onPress={() => setShowTextModal(true)}>
          <Ionicons name="chatbubble" size={22} color="#9C27B0" />
        </TouchableOpacity>
      </View>

      {/* Micro Survey Modal */}
      <MicroSurveyModal
        visible={showSurvey}
        question={surveyQuestion}
        onSubmit={handleSurveySubmit}
        onCancel={() => setShowSurvey(false)}
      />

      {/* Text Message Modal */}
      <Modal visible={showTextModal} transparent animationType="slide" onRequestClose={() => setShowTextModal(false)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Send a message to {current?.name}</Text>
              <TouchableOpacity onPress={() => { setShowTextModal(false); setTextMessage(""); }}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>Write a message to express your interest.</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Type your message..."
              placeholderTextColor={COLORS.textMuted}
              value={textMessage}
              onChangeText={setTextMessage}
              multiline
              maxLength={300}
              autoFocus
            />
            <View style={styles.modalFooter}>
              <Text style={styles.modalCharCount}>{textMessage.length}/300</Text>
              <TouchableOpacity
                style={[styles.modalSend, !textMessage.trim() && styles.modalSendDisabled]}
                onPress={handleSendText}
                disabled={!textMessage.trim()}
              >
                <Text style={styles.modalSendText}>Send</Text>
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

  // ── Compact Header ──
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

  // ── Card Area ──
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

  // ── Action Buttons ──
  actions: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 14,
    zIndex: 50,
  },
  actionButton: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.95)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  smallBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  medBtn: {
    width: 54,
    height: 54,
    borderRadius: 27,
  },
  bigBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },

  // ── Modal ──
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
    alignItems: "center",
    marginBottom: 8,
  },
  modalTitle: { fontSize: 18, fontWeight: "700", color: COLORS.text, flex: 1 },
  modalClose: { fontSize: 20, color: COLORS.textLight, padding: 4 },
  modalSubtitle: { fontSize: 14, color: COLORS.textLight, marginBottom: 16 },
  modalInput: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: COLORS.text,
    minHeight: 100,
    textAlignVertical: "top",
    marginBottom: 12,
  },
  modalFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  modalCharCount: { fontSize: 13, color: COLORS.textMuted },
  modalSend: { backgroundColor: COLORS.primary, paddingHorizontal: 28, paddingVertical: 12, borderRadius: 24 },
  modalSendDisabled: { opacity: 0.5 },
  modalSendText: { color: COLORS.white, fontSize: 16, fontWeight: "600" },
});
