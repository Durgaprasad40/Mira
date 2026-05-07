import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View, ViewStyle, StyleProp } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

/*
 * TodPromptMediaTile
 *
 * Phase 4 (Truth/Dare prompt-owner media):
 * Lightweight, presentational 68x68 media tile used to indicate that a prompt
 * has owner-attached media. Reuses the same visual language as the
 * answer/comment media tile in `prompt-thread.tsx` (gradient background +
 * coral icon chip) but is intentionally NOT coupled to the answer-side
 * one-time-view / claim flow, voice playback machine, or preload state. That
 * keeps the prompt media surface simple and auditable while still feeling
 * consistent with response/comment media at a glance.
 *
 * Behavior:
 *  - Renders nothing when `hasMedia` is false or `mediaKind` is unknown.
 *  - Photo: shows the thumbnail behind a soft scrim with a frosted icon chip.
 *  - Video / voice: shows a vertical gradient background + coral icon chip
 *    and (optionally) a small duration microtext — no autoplay, no preload.
 *  - When `onPress` is provided the tile is interactive (TouchableOpacity);
 *    otherwise it renders as a non-interactive View.
 */

type MediaKind = 'photo' | 'video' | 'voice';

const PALETTE = {
  bgBase: '#141428',
  bgElevated: '#1C1C36',
  bgHighlight: '#252545',
  borderSubtle: 'rgba(255, 255, 255, 0.06)',
  coral: '#E94560',
  textPrimary: '#F5F5F7',
};

export type TodPromptMediaTileProps = {
  hasMedia?: boolean;
  mediaUrl?: string | null;
  mediaKind?: string | null;
  durationSec?: number | null;
  onPress?: () => void;
  size?: number;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

function isMediaKind(kind: unknown): kind is MediaKind {
  return kind === 'photo' || kind === 'video' || kind === 'voice';
}

function getIconName(kind: MediaKind): keyof typeof Ionicons.glyphMap {
  if (kind === 'video') return 'videocam';
  if (kind === 'voice') return 'mic';
  return 'image';
}

function formatDurationSec(sec?: number | null): string | undefined {
  if (sec == null) return undefined;
  const total = Math.max(0, Math.round(sec));
  if (total <= 0) return undefined;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${total}s`;
}

export function TodPromptMediaTile({
  hasMedia,
  mediaUrl,
  mediaKind,
  durationSec,
  onPress,
  size = 68,
  style,
  accessibilityLabel,
}: TodPromptMediaTileProps) {
  if (!hasMedia || !isMediaKind(mediaKind)) return null;
  const kind: MediaKind = mediaKind;
  const iconName = getIconName(kind);
  const microtext =
    kind === 'video' || kind === 'voice' ? formatDurationSec(durationSec) : undefined;
  const showThumb = kind === 'photo' && !!mediaUrl;
  const interactive = !!onPress;

  const sizingStyle: ViewStyle = {
    width: size,
    height: size,
    borderRadius: Math.round(size * 0.19),
  };

  const inner = (
    <>
      {showThumb ? (
        <>
          <Image
            source={{ uri: mediaUrl ?? undefined }}
            style={StyleSheet.absoluteFillObject}
            contentFit="cover"
            transition={120}
          />
          <View style={styles.scrim} pointerEvents="none" />
        </>
      ) : (
        <LinearGradient
          colors={[PALETTE.bgHighlight, PALETTE.bgElevated] as const}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFillObject}
          pointerEvents="none"
        />
      )}
      <View style={[styles.iconChip, showThumb && styles.iconChipOnPhoto]}>
        <Ionicons
          name={iconName}
          size={18}
          color={showThumb ? '#FFF' : PALETTE.coral}
        />
      </View>
      {microtext ? (
        <Text
          style={[styles.microtext, showThumb && styles.microtextOnPhoto]}
          numberOfLines={1}
        >
          {microtext}
        </Text>
      ) : null}
    </>
  );

  if (interactive) {
    return (
      <TouchableOpacity
        style={[styles.tile, sizingStyle, style]}
        activeOpacity={0.85}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? `Open prompt ${kind}`}
      >
        {inner}
      </TouchableOpacity>
    );
  }
  return (
    <View
      style={[styles.tile, sizingStyle, style]}
      accessibilityLabel={accessibilityLabel ?? `Prompt ${kind} attachment`}
    >
      {inner}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    backgroundColor: PALETTE.bgElevated,
    borderWidth: 1,
    borderColor: PALETTE.borderSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
    paddingVertical: 5,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 2,
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.32)',
  },
  iconChip: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: `${PALETTE.coral}1A`,
    borderWidth: 1,
    borderColor: `${PALETTE.coral}30`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconChipOnPhoto: {
    backgroundColor: 'rgba(13, 13, 26, 0.55)',
    borderColor: 'rgba(255, 255, 255, 0.14)',
  },
  microtext: {
    fontSize: 10,
    fontWeight: '700',
    color: PALETTE.textPrimary,
    marginTop: 4,
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  microtextOnPhoto: {
    color: '#FFF',
    textShadowColor: 'rgba(0, 0, 0, 0.7)',
    textShadowRadius: 2,
  },
});

export default TodPromptMediaTile;
