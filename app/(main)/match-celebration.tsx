import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Animated,
  InteractionManager,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS } from "@/lib/constants";
import { Button } from "@/components/ui";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuthStore } from "@/stores/authStore";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Id } from "@/convex/_generated/dataModel";
import { isDemoMode } from "@/hooks/useConvex";
import { DEMO_USER, DEMO_PROFILES, getDemoCurrentUser } from "@/lib/demoData";
import { useDemoDmStore } from "@/stores/demoDmStore";
import { useDemoStore } from "@/stores/demoStore";
import { trackEvent } from "@/lib/analytics";
import { Toast } from "@/components/ui/Toast";
import { getPrimaryPhotoUrl } from "@/lib/photoUtils";

export default function MatchCelebrationScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // P1-001 FIX: Read mode and conversationId for Phase-2 support
  // CONFESS-NAV-FIX: Added source param for proper "Keep Discovering" navigation
  const { matchId, userId: otherUserId, mode, conversationId, source } = useLocalSearchParams<{
    matchId: string;
    userId: string;
    mode?: string;
    conversationId?: string;
    source?: string; // 'confessions' = return to Confessions tab, undefined = router.back()
  }>();
  const { userId, token } = useAuthStore();

  // P1-001 FIX: Detect Phase-2 mode
  const isPhase2 = mode === 'phase2';

  const isDemo = isDemoMode || matchId?.startsWith("demo_") || matchId?.startsWith("match_") || userId?.startsWith("demo_");
  const viewerId = userId ? (userId as Id<"users">) : null;
  const matchIdValue = matchId ? (matchId as unknown as Id<"matches">) : null;
  const otherUserIdValue = otherUserId
    ? (otherUserId as unknown as Id<"users">)
    : null;

  // P1-001 FIX: Phase-1 match query - SKIP for Phase-2 (uses privateMatches table)
  const matchQuery = useQuery(
    api.matches.getMatch,
    !isDemo && !isPhase2 && matchIdValue && viewerId
      ? { matchId: matchIdValue, userId: viewerId }
      : "skip",
  );

  // P1-001 FIX: Phase-1 other user query - SKIP for Phase-2
  const otherUserQuery = useQuery(
    api.users.getUserById,
    !isDemo && !isPhase2 && otherUserIdValue && viewerId
      ? { userId: otherUserIdValue, viewerId }
      : "skip",
  );

  // P1-001 FIX: Phase-2 profile query - only for Phase-2
  const phase2ProfileQuery = useQuery(
    api.privateDiscover.getProfileByUserId,
    !isDemo && isPhase2 && otherUserIdValue && viewerId
      ? { userId: otherUserIdValue, viewerId }
      : "skip",
  );

  const currentUserQuery = useQuery(
    api.users.getCurrentUser,
    !isDemo && viewerId ? { userId: viewerId } : "skip",
  );

  // In demo mode, use demo data directly; in live mode, use Convex queries
  const demoOtherUser = useMemo(() => {
    if (!isDemo) return null;
    const found = DEMO_PROFILES.find((p) => p._id === otherUserId);
    return found
      ? { name: found.name, photos: found.photos }
      : { name: "Someone", photos: [{ url: "https://via.placeholder.com/400" }] };
  }, [isDemo, otherUserId]);

  const match = isDemo ? { _id: matchId } : (isPhase2 ? { _id: matchId } : matchQuery);
  // P1-001 FIX: Use Phase-2 profile query for Phase-2 matches
  const otherUser = isDemo
    ? demoOtherUser
    : isPhase2
      ? (phase2ProfileQuery ? { name: phase2ProfileQuery.name, photos: phase2ProfileQuery.photos } : null)
      : otherUserQuery;
  const demoCurrentUser = isDemo ? getDemoCurrentUser() : null;
  const currentUser = isDemo
    ? demoCurrentUser
      ? { name: demoCurrentUser.name, photos: demoCurrentUser.photos }
      : { name: 'You', photos: [{ url: 'https://via.placeholder.com/400' }] }
    : currentUserQuery;

  const ensureConversation = useMutation(api.conversations.getOrCreateForMatch);
  const sendMessageMut = useMutation(api.messages.sendMessage);
  const [sending, setSending] = useState(false);
  // Ref-based guard prevents double-press even if React hasn't re-rendered
  // yet (e.g. two rapid taps before `setSending(true)` takes effect).
  const sendingRef = useRef(false);
  // E1: Single-fire navigation guard to prevent dismiss+push races
  const hasNavigatedRef = useRef(false);
  const navTimeoutRefs = useRef<ReturnType<typeof setTimeout>[]>([]);
  const mountedRef = useRef(true);

  // E1: Cleanup nav timeouts on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      navTimeoutRefs.current.forEach(clearTimeout);
      navTimeoutRefs.current = [];
    };
  }, []);

  if (__DEV__) console.log(`[MatchCelebration] isDemo=${isDemo} match=${!!match} otherUser=${!!otherUser} currentUser=${!!currentUser}`);

  // Hard timeout: never stay on loading forever
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (isDemo) return; // demo data is immediate
    const t = setTimeout(() => setTimedOut(true), 8000);
    return () => clearTimeout(t);
  }, [isDemo]);

  // Animation values (React Native Animated)
  const scale1 = useRef(new Animated.Value(0)).current;
  const scale2 = useRef(new Animated.Value(0)).current;
  const rotation = useRef(new Animated.Value(0)).current;
  const confettiOpacity = useRef(new Animated.Value(0)).current;
  const heartScale = useRef(new Animated.Value(0)).current;

  const confettiPieces = useMemo(() => {
    type ConfettiPiece = {
      left: `${number}%`;
      top: `${number}%`;
      backgroundColor: string;
    };

    return Array.from(
      { length: 50 },
      (): ConfettiPiece => ({
        left: `${Math.random() * 100}%` as `${number}%`,
        top: `${Math.random() * 100}%` as `${number}%`,
        backgroundColor: [
          COLORS.white,
          COLORS.primary,
          COLORS.secondary,
          "#FFD700",
          "#FF69B4",
        ][Math.floor(Math.random() * 5)],
      }),
    );
  }, []);

  useEffect(() => {
    // Celebration animation sequence
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    const t1 = Animated.spring(scale1, {
      toValue: 1,
      useNativeDriver: true,
    });
    t1.start();

    const timeout1 = setTimeout(() => {
      Animated.spring(scale2, {
        toValue: 1,
        useNativeDriver: true,
      }).start();

      Animated.sequence([
        Animated.spring(heartScale, {
          toValue: 1.2,
          useNativeDriver: true,
        }),
        Animated.spring(heartScale, {
          toValue: 1,
          useNativeDriver: true,
        }),
      ]).start();
    }, 200);

    const rotateLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(rotation, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        }),
        Animated.timing(rotation, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ]),
    );
    rotateLoop.start();

    Animated.timing(confettiOpacity, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();

    const timeout2 = setTimeout(() => {
      Animated.timing(confettiOpacity, {
        toValue: 0,
        duration: 1000,
        useNativeDriver: true,
      }).start();
    }, 3000);

    return () => {
      clearTimeout(timeout1);
      clearTimeout(timeout2);
      rotateLoop.stop();
    };
  }, []);

  const rotationDeg = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  const handleSendMessage = async () => {
    // Guard: prevent double-press via ref (state may lag behind rapid taps)
    if (sendingRef.current) return;
    sendingRef.current = true;

    if (__DEV__) {
      console.log("[SayHi] matchId", matchId);
      console.log("[SayHi] otherUserId", otherUserId);
      console.log("[SayHi] conversationId(before)", (match as any)?.conversationId);
    }

    // Demo mode: match + DM already created by simulateMatch() in the swipe
    // handler. Just pre-fill a draft "Hi" and navigate to the chat.
    if (isDemo) {
      const demoConversationId = `demo_convo_${otherUserId}`;
      if (__DEV__) console.log("[SayHi] demo mode — convoId=", demoConversationId, "isPhase2=", isPhase2);

      // Clear the match celebration event.
      useDemoStore.getState().setNewMatchUserId(null);

      // E1: Single-fire navigation guard
      if (hasNavigatedRef.current) {
        sendingRef.current = false;
        return;
      }
      hasNavigatedRef.current = true;

      // P1-001 FIX: Phase-2 demo mode navigates to incognito-chat
      if (isPhase2) {
        router.dismiss();
        InteractionManager.runAfterInteractions(() => {
          if (!mountedRef.current) return;
          router.push("/(main)/(private)/(tabs)/chats" as any);
          const t = setTimeout(() => {
            if (!mountedRef.current) return;
            router.push(`/(main)/incognito-chat?id=${demoConversationId}` as any);
          }, 50);
          navTimeoutRefs.current.push(t);
        });
        sendingRef.current = false;
        return;
      }

      // Phase-1 demo mode
      // Pre-fill draft so the chat input shows "Hi" ready to send.
      useDemoDmStore.getState().setDraft(demoConversationId, "Hi");

      // NAV-RACE-FIX: Use InteractionManager for safer navigation sequencing
      // Stack becomes: Messages list → Chat, so router.back() from chat
      // returns to the Messages list instead of Discover.
      router.dismiss();
      InteractionManager.runAfterInteractions(() => {
        if (!mountedRef.current) return;
        router.push("/(main)/(tabs)/messages" as any);
        // Single short delay after messages tab push is sufficient
        const t = setTimeout(() => {
          if (!mountedRef.current) return;
          router.push(`/(main)/(tabs)/messages/chat/${demoConversationId}?source=match` as any);
        }, 50);
        navTimeoutRefs.current.push(t);
      });
      sendingRef.current = false;
      return;
    }

    // P1-001 FIX: Phase-2 flow - navigate directly to incognito-chat
    // Conversation already created by privateSwipes.swipe mutation
    if (isPhase2 && conversationId) {
      if (__DEV__) console.log("[SayHi] Phase-2 mode — conversationId=", conversationId);

      // E1: Single-fire navigation guard
      if (hasNavigatedRef.current) {
        sendingRef.current = false;
        return;
      }
      hasNavigatedRef.current = true;

      // Navigate to Phase-2 incognito chat (via Private tab)
      router.dismiss();
      InteractionManager.runAfterInteractions(() => {
        if (!mountedRef.current) return;
        // Go to Private chats tab first
        router.push("/(main)/(private)/(tabs)/chats" as any);
        const t = setTimeout(() => {
          if (!mountedRef.current) return;
          // Then open the specific conversation
          router.push(`/(main)/incognito-chat?id=${conversationId}` as any);
        }, 50);
        navTimeoutRefs.current.push(t);
      });
      sendingRef.current = false;
      return;
    }

    // Phase-1 flow continues below
    if (!matchIdValue || !viewerId) {
      Toast.show("Something went wrong. Please go back and try again.");
      sendingRef.current = false;
      return;
    }

    setSending(true);
    try {
      // STEP A: Ensure a conversation row exists for this match.
      // Idempotent — safe to retry if the previous attempt crashed mid-flow.
      // Returns the conversationId needed for Step B.
      // MSG-005 FIX: Use authUserId for server-side verification
      const { conversationId: conversationIdFinal } = await ensureConversation({
        matchId: matchIdValue,
        authUserId: viewerId,
      });
      if (__DEV__) console.log("[SayHi] conversationId(after)", conversationIdFinal);

      // STEP B: Send the mandatory first message ("Hi 👋").
      // Must happen BEFORE navigation — otherwise the chat screen opens empty
      // and the message appears with a visible delay.
      // MSG-001 FIX: Use authUserId for server-side verification
      await sendMessageMut({
        conversationId: conversationIdFinal,
        authUserId: viewerId,
        type: "text",
        content: "Hi 👋",
      });
      trackEvent({ name: 'first_message_sent', conversationId: conversationIdFinal as string });
      if (__DEV__) console.log("[SayHi] messageSent ok");

      // STEP C: Navigate LAST — dismiss the celebration modal, push Messages
      // list first, then chat. Stack becomes: Messages list → Chat, so
      // router.back() from chat returns to Messages, not Discover.
      // E1: Single-fire navigation guard
      if (hasNavigatedRef.current) return;
      hasNavigatedRef.current = true;

      const target = `/(main)/(tabs)/messages/chat/${conversationIdFinal}?source=match`;
      if (__DEV__) console.log("[SayHi] navigating to", target);
      // NAV-RACE-FIX: Use InteractionManager for safer navigation sequencing
      router.dismiss();
      InteractionManager.runAfterInteractions(() => {
        if (!mountedRef.current) return;
        router.push("/(main)/(tabs)/messages" as any);
        // Single short delay after messages tab push is sufficient
        const t = setTimeout(() => {
          if (!mountedRef.current) return;
          router.push(target as any);
        }, 50);
        navTimeoutRefs.current.push(t);
      });
    } catch (error: any) {
      if (__DEV__) console.error("[SayHi] error", error);
      Toast.show("Couldn\u2019t start chat. Please try again.");
    } finally {
      setSending(false);
      sendingRef.current = false;
    }
  };

  const handleKeepSwiping = () => {
    // Only clear the UI event — the match itself was already saved by
    // simulateMatch() before this screen opened.
    if (isDemo) {
      useDemoStore.getState().setNewMatchUserId(null);
    }

    // CONFESS-NAV-FIX: Navigate based on source param
    // - source=confessions: go to Confessions tab (avoids empty connect-requests page)
    // - undefined: use router.back() for Discover flow
    if (__DEV__) {
      console.log('[MatchCelebration] handleKeepSwiping source=', source);
    }

    if (source === 'confessions') {
      // Replace current screen with Confessions tab to avoid stale back stack
      router.replace('/(main)/(tabs)/confessions' as any);
    } else {
      router.back();
    }
  };

  if (!match || !otherUser || !currentUser) {
    return (
      <View style={[styles.container, styles.loadingContainer, { paddingTop: insets.top }]}>
        {timedOut ? (
          <>
            <Ionicons name="heart-dislike-outline" size={48} color={COLORS.textMuted} />
            <Text style={styles.loadingText}>Couldn't load match details</Text>
            <TouchableOpacity style={styles.loadingBackButton} onPress={() => router.back()}>
              <Text style={styles.loadingBackText}>Go Back</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.loadingText}>Loading...</Text>
            <TouchableOpacity style={styles.loadingBackButton} onPress={() => router.back()}>
              <Text style={styles.loadingBackText}>Go Back</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    );
  }

  return (
    <LinearGradient
      colors={[COLORS.primary, COLORS.secondary]}
      style={[styles.container, { paddingTop: insets.top }]}
    >
      {/* Confetti Effect */}
      <Animated.View
        style={[styles.confettiContainer, { opacity: confettiOpacity }]}
      >
        {confettiPieces.map((piece, i) => (
          <View
            key={i}
            style={[
              styles.confetti,
              {
                left: piece.left,
                top: piece.top,
                backgroundColor: piece.backgroundColor,
              },
            ]}
          />
        ))}
      </Animated.View>

      <View style={styles.content}>
        <Text style={styles.title}>🎉 It's a Match! 🎉</Text>
        <Text style={styles.subtitle}>
          You and {otherUser.name} liked each other!
        </Text>

        <View style={styles.photosContainer}>
          <Animated.View
            style={[styles.photoWrapper, { transform: [{ scale: scale1 }] }]}
          >
            <Image
              source={{ uri: getPrimaryPhotoUrl(currentUser.photos) || "https://via.placeholder.com/400" }}
              style={styles.photo}
            />
            <View style={styles.photoBadge}>
              <Text style={styles.photoName}>{currentUser.name}</Text>
            </View>
          </Animated.View>

          <Animated.View
            style={[
              styles.heartContainer,
              {
                transform: [{ scale: heartScale }, { rotate: rotationDeg }],
              },
            ]}
          >
            <Ionicons name="heart" size={60} color={COLORS.white} />
          </Animated.View>

          <Animated.View
            style={[styles.photoWrapper, { transform: [{ scale: scale2 }] }]}
          >
            <Image
              source={{ uri: getPrimaryPhotoUrl(otherUser.photos) || "https://via.placeholder.com/400" }}
              style={styles.photo}
            />
            <View style={styles.photoBadge}>
              <Text style={styles.photoName}>{otherUser.name}</Text>
            </View>
          </Animated.View>
        </View>

        <View style={styles.actions}>
          <Button
            title={sending ? "Sending…" : "Say Hi 👋"}
            variant="primary"
            onPress={handleSendMessage}
            loading={sending}
            disabled={sending}
            fullWidth
            style={styles.messageButton}
            textStyle={styles.messageButtonText}
          />
          <TouchableOpacity
            style={styles.keepSwipingButton}
            onPress={handleKeepSwiping}
          >
            <Text style={styles.keepSwipingText}>Keep Discovering</Text>
          </TouchableOpacity>
        </View>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  confettiContainer: {
    position: "absolute",
    width: "100%",
    height: "100%",
    zIndex: 1,
  },
  confetti: {
    position: "absolute",
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    zIndex: 2,
  },
  title: {
    fontSize: 42,
    fontWeight: "700",
    color: COLORS.white,
    marginBottom: 12,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 20,
    color: COLORS.white,
    marginBottom: 48,
    textAlign: "center",
    opacity: 0.9,
  },
  photosContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 48,
    gap: 12,
    // FIX: Ensure photos don't overflow screen on smaller devices
    paddingHorizontal: 8,
  },
  photoWrapper: {
    alignItems: "center",
    flexShrink: 1,
  },
  photo: {
    // FIX: Reduced from 120 to fit on smaller screens (total row ~280px vs ~340px before)
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 4,
    borderColor: COLORS.white,
  },
  photoBadge: {
    marginTop: 12,
    backgroundColor: COLORS.white + "20",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  photoName: {
    fontSize: 16,
    fontWeight: "600",
    color: COLORS.white,
  },
  heartContainer: {
    alignItems: "center",
    justifyContent: "center",
  },
  actions: {
    width: "100%",
    gap: 16,
  },
  messageButton: {
    backgroundColor: COLORS.white,
  },
  messageButtonText: {
    color: COLORS.primary,
  },
  keepSwipingButton: {
    padding: 16,
    alignItems: "center",
  },
  keepSwipingText: {
    fontSize: 16,
    color: COLORS.white,
    fontWeight: "500",
  },
  loadingContainer: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.background,
  },
  loadingText: {
    fontSize: 18,
    color: COLORS.textLight,
    textAlign: "center",
    marginTop: 16,
  },
  loadingBackButton: {
    marginTop: 24,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: COLORS.primary,
  },
  loadingBackText: {
    fontSize: 16,
    fontWeight: "600",
    color: COLORS.white,
  },
});
