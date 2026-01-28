import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
  Animated,
  PanResponder,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { COLORS, SWIPE_CONFIG } from "@/lib/constants";
import { useAuthStore } from "@/stores/authStore";
import { ProfileCard } from "@/components/cards/ProfileCard";
import { Button } from "@/components/ui";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

export default function DiscoverScreen() {
  const { userId } = useAuthStore();
  const [index, setIndex] = useState(0);

  const profiles = useQuery(
    api.discover.getDiscoverProfiles,
    userId
      ? { userId: userId as any, sortBy: "recommended", limit: 20 }
      : "skip",
  );

  const swipeMutation = useMutation(api.likes.swipe);

  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  const current = profiles && profiles[index];

  const remainingCount = profiles
    ? profiles.length - index - (current ? 0 : 1)
    : 0;

  const resetPosition = useCallback(() => {
    Animated.spring(pan, {
      toValue: { x: 0, y: 0 },
      useNativeDriver: true,
    }).start();
  }, [pan]);

  const goNext = useCallback(() => {
    setIndex((prev) => prev + 1);
    pan.setValue({ x: 0, y: 0 });
  }, [pan]);

  const currentRef = useRef(current);
  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  const handleSwipeAction = useCallback(
    async (action: "like" | "pass" | "super_like") => {
      const active = currentRef.current;
      if (!userId || !active) return;
      try {
        await swipeMutation({
          fromUserId: userId as any,
          toUserId: active.id,
          action,
        });
      } catch (e) {
        // swallow for now; TODO: show toast
      }
      goNext();
    },
    [goNext, swipeMutation, userId],
  );

  const thresholdX = SCREEN_WIDTH * SWIPE_CONFIG.SWIPE_THRESHOLD_X;
  const thresholdY = SCREEN_HEIGHT * SWIPE_CONFIG.SWIPE_THRESHOLD_Y;

  const animateOut = useCallback(
    (action: "like" | "pass" | "super_like") => {
      const targetX =
        action === "like"
          ? SCREEN_WIDTH * 1.5
          : action === "pass"
            ? -SCREEN_WIDTH * 1.5
            : 0;
      const targetY = action === "super_like" ? -SCREEN_HEIGHT : 0;

      Animated.parallel([
        Animated.timing(pan.x, {
          toValue: targetX,
          duration: SWIPE_CONFIG.ANIMATION_DURATION,
          useNativeDriver: true,
        }),
        Animated.timing(pan.y, {
          toValue: targetY,
          duration: SWIPE_CONFIG.ANIMATION_DURATION,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (!finished) return;
        pan.setValue({ x: 0, y: 0 });
        void handleSwipeAction(action);
      });
    },
    [handleSwipeAction, pan],
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) =>
          Math.abs(gestureState.dx) > 3 || Math.abs(gestureState.dy) > 3,
        onPanResponderMove: (_, gestureState) => {
          pan.setValue({ x: gestureState.dx, y: gestureState.dy });
        },
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dx > thresholdX) {
            animateOut("like");
            return;
          }
          if (gestureState.dx < -thresholdX) {
            animateOut("pass");
            return;
          }
          if (gestureState.dy < -thresholdY) {
            animateOut("super_like");
            return;
          }
          resetPosition();
        },
        onPanResponderTerminate: () => {
          resetPosition();
        },
      }),
    [animateOut, pan, resetPosition, thresholdX, thresholdY],
  );

  const rotateZ = pan.x.interpolate({
    inputRange: [-SCREEN_WIDTH / 2, 0, SCREEN_WIDTH / 2],
    outputRange: [
      `-${SWIPE_CONFIG.ROTATION_ANGLE}deg`,
      "0deg",
      `${SWIPE_CONFIG.ROTATION_ANGLE}deg`,
    ],
    extrapolate: "clamp",
  });

  const cardStyle = {
    transform: [{ translateX: pan.x }, { translateY: pan.y }, { rotateZ }],
  } as const;

  if (!userId) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Discover</Text>
        <Text style={styles.subtitle}>Log in to see people near you.</Text>
      </View>
    );
  }

  if (!profiles) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }

  if (!current) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>You’re all caught up</Text>
        <Text style={styles.subtitle}>
          Check back later for more recommendations.
        </Text>
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Discover</Text>
        <Text style={styles.headerSubtitle}>
          {remainingCount > 0
            ? `${remainingCount + 1} profiles today`
            : "Few profiles left for today"}
        </Text>
      </View>

      <View style={styles.cardContainer}>
        <Animated.View
          style={[styles.cardWrapper, cardStyle]}
          {...panResponder.panHandlers}
        >
          <ProfileCard
            name={current.name}
            age={current.age}
            bio={current.bio}
            city={current.city}
            isVerified={current.isVerified}
            distance={current.distance}
            photos={current.photos}
          />
        </Animated.View>
      </View>

      <View style={styles.actions}>
        <Button
          title="Pass"
          variant="outline"
          onPress={() => handleSwipeAction("pass")}
          style={styles.actionButton}
        />
        <Button
          title="Super Like"
          variant="secondary"
          onPress={() => handleSwipeAction("super_like")}
          style={styles.actionButton}
        />
        <Button
          title="Like"
          variant="primary"
          onPress={() => handleSwipeAction("like")}
          style={styles.actionButton}
        />
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  center: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: COLORS.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.textLight,
    textAlign: "center",
  },
  header: {
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: COLORS.text,
  },
  headerSubtitle: {
    fontSize: 14,
    color: COLORS.textLight,
  },
  cardContainer: {
    flex: 1,
    justifyContent: "center",
  },
  cardWrapper: {
    width: "100%",
    height: SCREEN_HEIGHT * 0.65,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 16,
  },
  actionButton: {
    flex: 1,
    marginHorizontal: 4,
  },
});
