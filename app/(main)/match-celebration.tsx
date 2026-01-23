import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Dimensions } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withRepeat,
  withSequence,
  withTiming,
  interpolate,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS } from '@/lib/constants';
import { Button } from '@/components/ui';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

const { width, height } = Dimensions.get('window');

export default function MatchCelebrationScreen() {
  const router = useRouter();
  const { matchId, userId: otherUserId } = useLocalSearchParams<{ matchId: string; userId: string }>();
  const { userId } = useAuthStore();

  // Fetch match and other user data
  const match = useQuery(
    api.matches.getMatch,
    matchId ? { matchId: matchId as any } : 'skip'
  );
  const otherUser = useQuery(
    api.users.getUserById,
    otherUserId ? { userId: otherUserId as any, viewerId: userId } : 'skip'
  );
  const currentUser = useQuery(
    api.users.getCurrentUser,
    userId ? { userId } : 'skip'
  );

  // Animation values
  const scale1 = useSharedValue(0);
  const scale2 = useSharedValue(0);
  const rotation = useSharedValue(0);
  const confettiOpacity = useSharedValue(0);
  const heartScale = useSharedValue(0);

  useEffect(() => {
    // Celebration animation sequence
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    
    scale1.value = withSpring(1, { damping: 8 });
    setTimeout(() => {
      scale2.value = withSpring(1, { damping: 8 });
      heartScale.value = withSequence(
        withSpring(1.2, { damping: 6 }),
        withSpring(1, { damping: 8 })
      );
    }, 200);
    
    rotation.value = withRepeat(
      withSequence(
        withTiming(360, { duration: 2000 }),
        withTiming(0, { duration: 0 })
      ),
      -1,
      false
    );
    
    confettiOpacity.value = withTiming(1, { duration: 500 });
    
    // Auto-hide confetti after 3 seconds
    setTimeout(() => {
      confettiOpacity.value = withTiming(0, { duration: 1000 });
    }, 3000);
  }, []);

  const photo1Style = useAnimatedStyle(() => ({
    transform: [{ scale: scale1.value }],
  }));

  const photo2Style = useAnimatedStyle(() => ({
    transform: [{ scale: scale2.value }],
  }));

  const heartStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: heartScale.value },
      { rotate: `${rotation.value}deg` },
    ],
  }));

  const confettiStyle = useAnimatedStyle(() => ({
    opacity: confettiOpacity.value,
  }));

  const handleSendMessage = () => {
    router.replace(`/(main)/chat/${otherUserId}`);
  };

  const handleKeepSwiping = () => {
    router.replace('/(main)/(tabs)/discover');
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
      <Animated.View style={[styles.confettiContainer, confettiStyle]}>
        {[...Array(50)].map((_, i) => (
          <Animated.View
            key={i}
            style={[
              styles.confetti,
              {
                left: `${Math.random() * 100}%`,
                top: `${Math.random() * 100}%`,
                backgroundColor: [
                  COLORS.white,
                  COLORS.primary,
                  COLORS.secondary,
                  '#FFD700',
                  '#FF69B4',
                ][Math.floor(Math.random() * 5)],
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
          <Animated.View style={[styles.photoWrapper, photo1Style]}>
            <Image
              source={{ uri: currentUser.photos?.[0]?.url }}
              style={styles.photo}
            />
            <View style={styles.photoBadge}>
              <Text style={styles.photoName}>{currentUser.name}</Text>
            </View>
          </Animated.View>

          <Animated.View style={[styles.heartContainer, heartStyle]}>
            <Ionicons name="heart" size={60} color={COLORS.white} />
          </Animated.View>

          <Animated.View style={[styles.photoWrapper, photo2Style]}>
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
            title="Send a Message 💬"
            variant="primary"
            onPress={handleSendMessage}
            fullWidth
            style={styles.messageButton}
          />
          <TouchableOpacity
            style={styles.keepSwipingButton}
            onPress={handleKeepSwiping}
          >
            <Text style={styles.keepSwipingText}>Keep Swiping</Text>
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
    position: 'absolute',
    width: '100%',
    height: '100%',
    zIndex: 1,
  },
  confetti: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    zIndex: 2,
  },
  title: {
    fontSize: 42,
    fontWeight: '700',
    color: COLORS.white,
    marginBottom: 12,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 20,
    color: COLORS.white,
    marginBottom: 48,
    textAlign: 'center',
    opacity: 0.9,
  },
  photosContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 48,
    gap: 20,
  },
  photoWrapper: {
    alignItems: 'center',
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
    backgroundColor: COLORS.white + '20',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  photoName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.white,
  },
  heartContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: {
    width: '100%',
    gap: 16,
  },
  messageButton: {
    backgroundColor: COLORS.white,
  },
  keepSwipingButton: {
    padding: 16,
    alignItems: 'center',
  },
  keepSwipingText: {
    fontSize: 16,
    color: COLORS.white,
    fontWeight: '500',
  },
  loadingText: {
    fontSize: 18,
    color: COLORS.white,
    textAlign: 'center',
    marginTop: '50%',
  },
});
