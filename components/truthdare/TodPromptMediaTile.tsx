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
  /**
   * When true, render the tile as a covered/protected placeholder regardless
   * of media kind — the gradient background + centered icon chip is shown
   * and the photo thumbnail is intentionally NOT rendered. Used by the
   * Truth/Dare feed/thread so prompt-owner photos are not exposed inline;
   * the user must tap the tile to open the full media in a viewer/modal.
   *
   * Defaults to false for callers that intentionally want a raw thumbnail.
   */
  covered?: boolean;
  /**
   * Phase 4 (one-time view): unique-viewer count badge shown to the prompt
   * owner only. Pass `undefined` for non-owner views to hide the badge.
   * Only meaningful for photo/video; voice never displays a count.
   */
  ownerViewCount?: number;
  /**
   * Phase 4 (one-time view): when true, render a small "Viewed" badge to
   * tell a non-owner that they have already opened this prompt-owner
   * photo/video. The tap handler should surface a friendly "already
   * viewed" message instead of opening the viewer.
   */
  showViewedBadge?: boolean;
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
  covered = false,
  ownerViewCount,
  showViewedBadge = false,
}: TodPromptMediaTileProps) {
  if (!hasMedia || !isMediaKind(mediaKind)) return null;
  const kind: MediaKind = mediaKind;
  const iconName = getIconName(kind);
  const displayOwnerViewCount =
    typeof ownerViewCount === 'number' && Number.isFinite(ownerViewCount)
      ? Math.max(0, Math.floor(ownerViewCount))
      : 0;
  const ownerCountLabel = displayOwnerViewCount > 0
    ? displayOwnerViewCount === 1
      ? '1 view'
      : `${displayOwnerViewCount} views`
    : undefined;
  // Show duration for video/voice unless the owner view count needs the
  // bottom label area; on compact tiles the count is the more useful cue.
  const microtext =
    !ownerCountLabel && (kind === 'video' || kind === 'voice')
      ? formatDurationSec(durationSec)
      : undefined;
  // `covered` forces the gradient/icon-chip placeholder regardless of mediaUrl,
  // so prompt-owner photos are not exposed inline on feed/thread surfaces.
  const showThumb = !covered && kind === 'photo' && !!mediaUrl;
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
      {/* Phase 4: owner-only unique-viewer count, bottom of the tile. */}
      {ownerCountLabel ? (
        <View style={styles.viewCountBadge} pointerEvents="none">
          <Text style={styles.viewCountText} numberOfLines={1}>
            {ownerCountLabel}
          </Text>
        </View>
      ) : null}
      {/* Phase 4: non-owner already-viewed badge, bottom-left. Shown only
          for one-time-view photo/video; voice replays freely. */}
      {showViewedBadge && !ownerCountLabel ? (
        <View style={styles.viewedBadge} pointerEvents="none">
          <Ionicons name="checkmark" size={9} color="#FFF" />
          <Text style={styles.viewedBadgeText} numberOfLines={1}>
            Viewed
          </Text>
        </View>
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
  viewCountBadge: {
    position: 'absolute',
    left: 6,
    right: 6,
    bottom: 5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(13, 13, 26, 0.82)',
    borderRadius: 8,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    minHeight: 14,
  },
  viewCountText: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: '700',
    lineHeight: 11,
    letterSpacing: 0.1,
    textAlign: 'center',
  },
  viewedBadge: {
    position: 'absolute',
    bottom: 3,
    left: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: 'rgba(13, 13, 26, 0.85)',
    borderRadius: 8,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    minHeight: 13,
  },
  viewedBadgeText: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});

export default TodPromptMediaTile;
