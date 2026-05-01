import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
// CONFESS-PARITY: use react-native Image's native `blurRadius` prop, identical
// to the Confessions tab (`components/confessions/ConfessionCard.tsx` line 358,
// `BLUR_PHOTO_RADIUS = 20`). Previously this component layered a `BlurView` +
// `rgba(5,7,14,0.32)` dark overlay on top of `expo-image`'s `<Image>`, which
// produced a "shaded/dark" look rather than a real photographic blur. Mirror
// Confess exactly so blurred-identity T/D posts (prompts + answers/comments)
// render the actual face genuinely blurred, not darkened.
import { Image as RNImage } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { FONT_SIZE } from '@/lib/constants';

const TEXT_MAX_SCALE = 1.2;
// T/D blur strength — slightly stronger than Confess (20) so faces are less
// recognizable in blurred-identity posts. Kept low enough that the photo still
// reads as a real person. No dark overlay/tint added.
const BLUR_PHOTO_RADIUS = 24;

type TodAvatarProps = {
  size: number;
  photoUrl?: string | null;
  isAnonymous?: boolean;
  photoBlurMode?: 'none' | 'blur' | string | null;
  label?: string | null;
  style?: StyleProp<ViewStyle>;
  borderWidth?: number;
  borderColor?: string;
  backgroundColor?: string;
  textColor?: string;
  iconColor?: string;
  iconSize?: number;
};

export const TodAvatar = React.memo(function TodAvatar({
  size,
  photoUrl,
  isAnonymous = false,
  photoBlurMode = 'none',
  label,
  style,
  borderWidth = 0,
  borderColor = 'transparent',
  backgroundColor = '#252545',
  textColor = '#F5F5F7',
  iconColor = '#6E6E82',
  iconSize,
}: TodAvatarProps) {
  const radius = size / 2;
  const avatarStyle = {
    width: size,
    height: size,
    borderRadius: radius,
    borderWidth,
    borderColor,
    backgroundColor,
  } as const;
  const resolvedIconSize = iconSize ?? Math.max(FONT_SIZE.body, Math.round(size * 0.38));
  const initial = label?.trim()?.charAt(0)?.toUpperCase() ?? '?';
  const showBlur = !isAnonymous && photoBlurMode === 'blur' && !!photoUrl;

  return (
    <View style={[styles.base, avatarStyle, style]}>
      {isAnonymous ? (
        <Ionicons name="eye-off" size={resolvedIconSize} color={iconColor} />
      ) : photoUrl ? (
        showBlur ? (
          // CONFESS-PARITY: real native blur via RN Image `blurRadius`, no dark
          // overlay, no BlurView. Identical technique to ConfessionCard line 358.
          <RNImage
            source={{ uri: photoUrl }}
            style={[styles.image, { borderRadius: radius }]}
            resizeMode="cover"
            blurRadius={BLUR_PHOTO_RADIUS}
          />
        ) : (
          <ExpoImage source={{ uri: photoUrl }} style={[styles.image, { borderRadius: radius }]} contentFit="cover" />
        )
      ) : label?.trim() ? (
        <Text
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          style={[styles.initial, { color: textColor, fontSize: Math.max(FONT_SIZE.body, Math.round(size * 0.34)) }]}
        >
          {initial}
        </Text>
      ) : (
        <Ionicons name={photoBlurMode === 'blur' ? 'person-circle-outline' : 'person'} size={resolvedIconSize} color={iconColor} />
      )}
    </View>
  );
});

TodAvatar.displayName = 'TodAvatar';

const styles = StyleSheet.create({
  base: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  initial: {
    fontWeight: '700',
  },
});
