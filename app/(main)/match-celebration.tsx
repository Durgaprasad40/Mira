import React, { useEffect, useMemo, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Animated,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { COLORS } from "@/lib/constants";
import { Button } from "@/components/ui";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuthStore } from "@/stores/authStore";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Id } from "@/convex/_generated/dataModel";

export default function MatchCelebrationScreen() {
  const router = useRouter();
  const { matchId, userId: otherUserId } = useLocalSearchParams<{
    matchId: string;
    userId: string;
  }>();
  const { userId } = useAuthStore();

  const isDemo = matchId?.startsWith("demo_") || userId?.startsWith("demo_");
  const viewerId = userId ? (userId as Id<"users">) : null;
  const matchIdValue = matchId ? (matchId as unknown as Id<"matches">) : null;
  const otherUserIdValue = otherUserId
    ? (otherUserId as unknown as Id<"users">)
    : null;

  // Fetch match and other user data (skip in demo mode)
  const match = useQuery(
    api.matches.getMatch,
    !isDemo && matchIdValue && viewerId
      ? { matchId: matchIdValue, userId: viewerId }
      : "skip",
  );
  const otherUser = useQuery(
    api.users.getUserById,
    !isDemo && otherUserIdValue && viewerId
      ? { userId: otherUserIdValue, viewerId }
      : "skip",
  );
  const currentUser = useQuery(
    api.users.getCurrentUser,
    !isDemo && viewerId ? { userId: viewerId } : "skip",
  );

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

  const handleSendMessage = () => {
    router.replace(`/(main)/chat/${otherUserId}`);
  };

  const handleKeepSwiping = () => {
    router.replace("/(main)/(tabs)/discover");
  };

  if (!match || !otherUser || !currentUser) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  return (
    <LinearGradient
      colors={[COLORS.primary, COLORS.secondary]}
      style={styles.container}
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
              source={{ uri: currentUser.photos?.[0]?.url }}
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
              source={{ uri: otherUser.photos?.[0]?.url }}
              style={styles.photo}
            />
            <View style={styles.photoBadge}>
              <Text style={styles.photoName}>{otherUser.name}</Text>
            </View>
          </Animated.View>
        </View>

        <View style={styles.actions}>
          <Button
            title="Say Hi 👋"
            variant="primary"
            onPress={handleSendMessage}
            fullWidth
            style={styles.messageButton}
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
    gap: 20,
  },
  photoWrapper: {
    alignItems: "center",
  },
  photo: {
    width: 120,
    height: 120,
    borderRadius: 60,
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
  keepSwipingButton: {
    padding: 16,
    alignItems: "center",
  },
  keepSwipingText: {
    fontSize: 16,
    color: COLORS.white,
    fontWeight: "500",
  },
  loadingText: {
    fontSize: 18,
    color: COLORS.white,
    textAlign: "center",
    marginTop: "50%",
  },
});
