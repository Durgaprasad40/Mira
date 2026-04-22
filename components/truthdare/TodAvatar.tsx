import React from 'react';
import { Platform, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { FONT_SIZE } from '@/lib/constants';

const TEXT_MAX_SCALE = 1.2;

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
        <>
          <Image source={{ uri: photoUrl }} style={[styles.image, { borderRadius: radius }]} contentFit="cover" />
          {showBlur && (
            <>
              <BlurView
                intensity={Platform.OS === 'ios' ? 80 : 100}
                tint="dark"
                style={StyleSheet.absoluteFill}
              />
              <View style={styles.blurOverlay} />
            </>
          )}
        </>
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
  blurOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(5, 7, 14, 0.32)',
  },
  initial: {
    fontWeight: '700',
  },
});
