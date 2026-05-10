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
import { COLORS, INCOGNITO_COLORS } from "@/lib/constants";
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

export default function MatchCelebrationScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    matchId,
    userId: routeUserId,
    otherUserId: routeOtherUserId,
    mode,
    phase,
    conversationId,
    source,
    alreadyMatched,
  } = useLocalSearchParams<{
    matchId?: string;
    userId?: string;
    otherUserId?: string;
    mode?: string;
    phase?: string;
    conversationId?: string;
    source?: string;
    alreadyMatched?: string;
  }>();
  const userId = useAuthStore((s) => s.userId);
  const otherUserId = routeOtherUserId ?? routeUserId;
  const isConfessionSource = source === 'confession';
  const confessionConversationId =
    typeof conversationId === 'string' && conversationId.trim().length > 0
      ? conversationId.trim()
      : null;
  const isPhase2 = mode === 'phase2' || phase === 'phase2';
  const isPhase2AlreadyMatched = isPhase2 && alreadyMatched === '1';
  const phase2Source =
    source === 'truth_dare' || source === 'rematch' || source === 'deep_connect'
      ? source
      : 'deep_connect';
  const phase2IsTruthDare = phase2Source === 'truth_dare';

  const isDemo = isDemoMode || matchId?.startsWith("demo_") || userId?.startsWith("demo_");
  const matchIdValue = !isPhase2 && matchId ? (matchId as unknown as Id<"matches">) : null;
  const otherUserIdValue = otherUserId
    ? (otherUserId as unknown as Id<"users">)
    : null;

  // FIX: Backend expects { matchId, userId }, not { token, authUserId }
  const matchQuery = useQuery(
    api.matches.getMatch as any,
    !isPhase2 && !isDemo && matchIdValue && userId
      ? { matchId: matchIdValue, userId }
      : "skip",
  );
  // FIX: Backend expects { userId, viewerId }, not { token, authUserId }
  const otherUserQuery = useQuery(
    api.users.getUserById as any,
    !isPhase2 && !isDemo && otherUserIdValue && userId
      ? { userId: otherUserIdValue, viewerId: userId }
      : "skip",
  );
  const phase2OtherProfileQuery = useQuery(
    api.privateDiscover.getProfileByUserId as any,
    isPhase2 && !isDemo && otherUserIdValue && userId
      ? { userId: otherUserIdValue, viewerAuthUserId: userId }
      : "skip",
  );
  const confessionConversationQuery = useQuery(
    api.messages.getConversation as any,
    isConfessionSource && !isDemo && confessionConversationId && userId
      ? { conversationId: confessionConversationId as any, authUserId: userId }
      : "skip",
  );
  // FIX: Use getCurrentUser with userId instead of getCurrentUserFromToken
  const currentUserQuery = useQuery(
    api.users.getCurrentUser,
    !isPhase2 && !isDemo && userId ? { userId } : "skip",
  );

  // In demo mode, use demo data directly; in live mode, use Convex queries
  const demoOtherUser = useMemo(() => {
    if (!isDemo) return null;
    const found = DEMO_PROFILES.find((p) => p._id === otherUserId);
    return found
      ? { name: found.name, photos: found.photos }
      : { name: "Someone", photos: [{ url: "https://via.placeholder.com/400" }] };
  }, [isDemo, otherUserId]);

  const match = isConfessionSource
    ? {
        _id: matchId ?? confessionConversationQuery?.matchId ?? `confession_${confessionConversationId ?? 'match'}`,
        conversationId: confessionConversationId,
      }
    : isPhase2
      ? { _id: matchId }
      : isDemo
        ? { _id: matchId }
        : matchQuery;
  const phase2OtherUser = phase2OtherProfileQuery
    ? {
        name: phase2OtherProfileQuery.name ?? phase2OtherProfileQuery.displayNameInitial ?? 'Someone',
        photos: Array.isArray(phase2OtherProfileQuery.photos) ? phase2OtherProfileQuery.photos : [],
      }
    : null;
  const confessionOtherUser = confessionConversationQuery?.otherUser
    ? {
        name: confessionConversationQuery.otherUser.name ?? 'Someone',
        photos: confessionConversationQuery.otherUser.photoUrl
          ? [{ url: confessionConversationQuery.otherUser.photoUrl }]
          : [],
      }
    : null;
  const otherUser = isConfessionSource
    ? confessionOtherUser
    : isPhase2
      ? phase2OtherUser
      : isDemo
        ? demoOtherUser
        : otherUserQuery;
  const demoCurrentUser = isDemo ? getDemoCurrentUser() : null;
  const currentUser = isDemo
    ? demoCurrentUser
      ? { name: demoCurrentUser.name, photos: demoCurrentUser.photos }
      : { name: 'You', photos: [{ url: 'https://via.placeholder.com/400' }] }
    : isPhase2
      ? { name: 'You', photos: [] }
      : currentUserQuery;
  const currentPhotoUrl = currentUser?.photos?.[0]?.url;
  const otherPhotoUrl = otherUser?.photos?.[0]?.url;
  const phase2Gradient = phase2IsTruthDare
    ? ['#24143E', '#7C6AEF', '#FF7849'] as const
    : ['#101426', INCOGNITO_COLORS.primary, '#E94560'] as const;
  const gradientColors = isPhase2 ? phase2Gradient : [COLORS.primary, COLORS.secondary] as const;
  const titleText = isConfessionSource
    ? 'You both connected'
    : isPhase2AlreadyMatched
    ? "You're already matched"
    : isPhase2
      ? phase2IsTruthDare
        ? 'Truth or Dare connection'
        : "It's a Deep Connect match"
      : "🎉 It's a Match! 🎉";
  const subtitleText = isConfessionSource
    ? "Start a conversation whenever you're ready."
    : isPhase2AlreadyMatched
    ? `You and ${otherUser?.name ?? 'this person'} already have a conversation.`
    : isPhase2
      ? phase2IsTruthDare
        ? `You and ${otherUser?.name ?? 'this person'} connected through Truth or Dare.`
        : `You and ${otherUser?.name ?? 'this person'} chose each other in Deep Connect.`
      : `You and ${otherUser?.name ?? 'this person'} liked each other!`;

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
  const scale1 = useRef(new Animated.Value(isPhase2AlreadyMatched ? 1 : 0)).current;
  const scale2 = useRef(new Animated.Value(isPhase2AlreadyMatched ? 1 : 0)).current;
  const rotation = useRef(new Animated.Value(0)).current;
  const confettiOpacity = useRef(new Animated.Value(0)).current;
  const heartScale = useRef(new Animated.Value(isPhase2AlreadyMatched ? 1 : 0)).current;

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
    if (isPhase2AlreadyMatched) return;
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
  }, [isPhase2AlreadyMatched]);

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
      if (__DEV__) console.log("[SayHi] demo mode — convoId=", demoConversationId);

      // Pre-fill draft so the chat input shows "Hi" ready to send.
      useDemoDmStore.getState().setDraft(demoConversationId, "Hi");

      // Clear the match celebration event.
      useDemoStore.getState().setNewMatchUserId(null);

      // E1: Single-fire navigation guard
      if (hasNavigatedRef.current) {
        sendingRef.current = false;
        return;
      }
      hasNavigatedRef.current = true;

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

    if (isPhase2) {
      const p2ConversationId =
        typeof conversationId === 'string' && conversationId.trim().length > 0
          ? conversationId.trim()
          : null;
      if (!p2ConversationId) {
        Toast.show("Couldn't open chat. Please try from Messages.");
        sendingRef.current = false;
        return;
      }
      if (hasNavigatedRef.current) {
        sendingRef.current = false;
        return;
      }
      hasNavigatedRef.current = true;
      router.replace(`/(main)/(private)/(tabs)/chats/${p2ConversationId}` as any);
      sendingRef.current = false;
      return;
    }

    if (isConfessionSource) {
      if (!confessionConversationId) {
        Toast.show("Couldn't open chat. Please try from Messages.");
        sendingRef.current = false;
        return;
      }
      if (hasNavigatedRef.current) {
        sendingRef.current = false;
        return;
      }
      hasNavigatedRef.current = true;
      router.replace({
        pathname: '/(main)/(tabs)/messages/chat/[conversationId]',
        params: { conversationId: confessionConversationId },
      } as any);
      sendingRef.current = false;
      return;
    }

    if (!matchIdValue || !userId) {
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
        authUserId: userId,
      });
      if (__DEV__) console.log("[SayHi] conversationId(after)", conversationIdFinal);

      // STEP B: Send the mandatory first message ("Hi 👋").
      // Must happen BEFORE navigation — otherwise the chat screen opens empty
      // and the message appears with a visible delay.
      // MSG-001 FIX: Use authUserId for server-side verification
      // FIX: Backend expects { authUserId }, not { token }
      await sendMessageMut({
        conversationId: conversationIdFinal,
        authUserId: userId ?? '',
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
    if (isPhase2) {
      router.replace('/(main)/(private)/(tabs)/deep-connect' as any);
      return;
    }
    if (isConfessionSource) {
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/(main)/(tabs)/confessions' as any);
      }
      return;
    }
    router.back();
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
      colors={gradientColors}
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
        <Text style={styles.title}>{titleText}</Text>
        <Text style={styles.subtitle}>{subtitleText}</Text>

        <View style={styles.photosContainer}>
          <Animated.View
            style={[styles.photoWrapper, { transform: [{ scale: scale1 }] }]}
          >
            {currentPhotoUrl ? (
              <Image source={{ uri: currentPhotoUrl }} style={styles.photo} />
            ) : (
              <View style={[styles.photo, styles.photoFallback]}>
                <Ionicons name="person" size={46} color="rgba(255,255,255,0.75)" />
              </View>
            )}
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
            {otherPhotoUrl ? (
              <Image source={{ uri: otherPhotoUrl }} style={styles.photo} />
            ) : (
              <View style={[styles.photo, styles.photoFallback]}>
                <Ionicons name="person" size={46} color="rgba(255,255,255,0.75)" />
              </View>
            )}
            <View style={styles.photoBadge}>
              <Text style={styles.photoName}>{otherUser.name}</Text>
            </View>
          </Animated.View>
        </View>

        <View style={styles.actions}>
          <Button
            title={isPhase2 ? (isPhase2AlreadyMatched ? "Continue Chat" : "Open Chat") : sending ? "Sending…" : isConfessionSource ? "Say Hi" : "Say Hi 👋"}
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
  photoFallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.18)",
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
