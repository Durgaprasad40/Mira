/**
 * HeaderAvatarButton
 *
 * Compact circular avatar button shown in the top-right of every Phase-1 tab
 * header. Tapping it opens the existing Phase-1 Profile screen (which used to
 * live as a bottom tab).
 *
 * Behavior:
 * - Shows the current user's primary photo when available.
 * - Falls back to a clean person icon if no photo, no auth, or while loading.
 * - Works in both demo mode and live (Convex) mode.
 * - Never blocks the header — renders the icon fallback during data load.
 * - Respects dark surfaces via the optional `dark` prop (used by Discover).
 */
import React, { useMemo } from 'react';
import { TouchableOpacity, View, StyleSheet, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { COLORS, INCOGNITO_COLORS } from '@/lib/constants';
import { safePush } from '@/lib/safeRouter';
import { isDemoMode } from '@/hooks/useConvex';
import { useAuthStore } from '@/stores/authStore';
import { useDemoStore } from '@/stores/demoStore';
import { getPhase1PrimaryPhoto } from '@/lib/photoUtils';

interface HeaderAvatarButtonProps {
  /** Use dark surface styling (Phase-2 / dark Discover variants). Defaults to false. */
  dark?: boolean;
  /** Override visual size (px). Defaults to 40. */
  size?: number;
  /** Optional extra style for the outer touchable. */
  style?: ViewStyle;
}

// Slightly larger, premium feel. Touch target stays >= 44 thanks to hitSlop.
const DEFAULT_SIZE = 40;
// Visible gap between outer ring border and the inner image/fallback.
// Tuned so the ring reads as a refined accent halo, not a thick frame.
const INNER_INSET = 6;

export function HeaderAvatarButton({
  dark = false,
  size = DEFAULT_SIZE,
  style,
}: HeaderAvatarButtonProps) {
  const router = useRouter();
  const userId = useAuthStore((s) => s.userId);

  // Live-mode current user (skipped in demo)
  const convexUser = useQuery(
    api.users.getCurrentUser,
    !isDemoMode && userId ? { userId } : 'skip'
  );

  // Demo-mode fallback: pick the current demo user's profile from the store map
  const demoProfiles = useDemoStore((s) => s.demoProfiles);
  const currentDemoUserId = useDemoStore((s) => s.currentDemoUserId);
  const demoUser = useMemo(() => {
    if (!isDemoMode) return null;
    if (currentDemoUserId && demoProfiles[currentDemoUserId]) {
      return demoProfiles[currentDemoUserId];
    }
    const firstKey = Object.keys(demoProfiles)[0];
    return firstKey ? demoProfiles[firstKey] : null;
  }, [demoProfiles, currentDemoUserId]);

  // Resolve the primary Phase-1 photo URL using the existing helper
  const photoUrl = useMemo(() => {
    if (isDemoMode) {
      return getPhase1PrimaryPhoto(demoUser);
    }
    return getPhase1PrimaryPhoto(convexUser ?? null);
  }, [convexUser, demoUser]);

  const handlePress = () => {
    safePush(router, '/(main)/(tabs)/profile' as any, 'header->profile');
  };

  // Premium two-tone ring:
  // - Outer ring: subtle accent border (primary tint)
  // - Inner gap: surface-matching background that frames the photo cleanly
  const accent = dark ? INCOGNITO_COLORS.primary : COLORS.primary;
  const ringBorderColor = accent + (dark ? '88' : '66');
  const ringInnerBg = dark ? 'rgba(20,20,32,0.92)' : '#FFFFFF';
  const fallbackBg = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.035)';
  const fallbackIconColor = dark ? INCOGNITO_COLORS.text : COLORS.text;
  const innerSize = size - INNER_INSET;

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel="Open profile"
      onPress={handlePress}
      hitSlop={10}
      activeOpacity={0.75}
      style={[
        styles.touch,
        { width: size, height: size, borderRadius: size / 2 },
        style,
      ]}
    >
      <View
        style={[
          styles.ringOuter,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderColor: ringBorderColor,
            backgroundColor: ringInnerBg,
          },
        ]}
      >
        {photoUrl ? (
          <Image
            source={{ uri: photoUrl }}
            style={{
              width: innerSize,
              height: innerSize,
              borderRadius: innerSize / 2,
            }}
            contentFit="cover"
            transition={150}
          />
        ) : (
          <View
            style={[
              styles.fallbackInner,
              {
                width: innerSize,
                height: innerSize,
                borderRadius: innerSize / 2,
                backgroundColor: fallbackBg,
              },
            ]}
          >
            <Ionicons
              name="person"
              size={Math.round(size * 0.5)}
              color={fallbackIconColor}
            />
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  touch: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringOuter: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    overflow: 'hidden',
    // Subtle premium depth — light, not heavy
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  fallbackInner: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default HeaderAvatarButton;
