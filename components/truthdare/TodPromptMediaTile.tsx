import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View, ViewStyle, StyleProp } from 'react-native';
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

/**
 * Phase 4 (prompt-owner media preload):
 * Per-tile load state for the two-tap UX. Owners always see `ready` (their
 * own media). Non-owners see `idle` until they tap once to preload, then
 * `loading` while the secure URL is resolved + asset is warmed, then
 * `ready` so a second tap opens the viewer instantly. `failed` flips back
 * to a retry affordance.
 *
 * `undefined` is treated identically to `ready` for backward compatibility
 * with callers that don't opt into the preload state machine.
 */
export type TodPromptMediaPreloadStatus = 'idle' | 'loading' | 'ready' | 'failed';

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
  /**
   * Phase 4 (prompt-owner preload): drives the tile-level two-tap UX.
   *  - 'idle'    → tile shows a download/arrow affordance ("tap to preload")
   *  - 'loading' → tile shows an inline ActivityIndicator (no viewer opens)
   *  - 'ready'   → tile shows the normal kind icon; next tap opens viewer
   *  - 'failed'  → tile shows a refresh affordance ("tap to retry")
   *  - undefined → behaves like 'ready' (back-compat with answer-side
   *                callers that have their own preload pipeline)
   *
   * The preload status is purely visual; tap-handling lives in the parent
   * (feed/thread) so URL resolution + Convex one-time-view recording stays
   * centralized and never leaks the secure mediaUrl into this component
   * before the user has explicitly opted in.
   */
  preloadStatus?: TodPromptMediaPreloadStatus;
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
  preloadStatus,
}: TodPromptMediaTileProps) {
  if (!hasMedia || !isMediaKind(mediaKind)) return null;
  const kind: MediaKind = mediaKind;
  // Treat undefined as 'ready' so legacy callers (no preload pipeline) keep
  // their existing visuals — only opted-in callers see idle/loading/failed.
  const effectivePreloadStatus: TodPromptMediaPreloadStatus = preloadStatus ?? 'ready';
  const isPreloadIdle = effectivePreloadStatus === 'idle';
  const isPreloadLoading = effectivePreloadStatus === 'loading';
  const isPreloadFailed = effectivePreloadStatus === 'failed';
  // When the tile is in idle/loading/failed we swap the kind glyph for a
  // status glyph so the user has a single, unambiguous affordance: tap to
  // preload, wait, or retry. The kind glyph returns once we're ready.
  const iconName: keyof typeof Ionicons.glyphMap = isPreloadIdle
    ? 'arrow-down-circle'
    : isPreloadFailed
      ? 'refresh'
      : getIconName(kind);
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
        {isPreloadLoading ? (
          <ActivityIndicator
            size="small"
            color={showThumb ? '#FFF' : PALETTE.coral}
          />
        ) : (
          <Ionicons
            name={iconName}
            size={18}
            color={showThumb ? '#FFF' : PALETTE.coral}
          />
        )}
      </View>
      {microtext ? (
        <Text
          style={[styles.microtext, showThumb && styles.microtextOnPhoto]}
          numberOfLines={1}
          maxFontSizeMultiplier={1.15}
        >
          {microtext}
        </Text>
      ) : null}
      {/* Phase 4: owner-only unique-viewer count, bottom of the tile. */}
      {ownerCountLabel ? (
        <View style={styles.viewCountBadge} pointerEvents="none">
          <Text style={styles.viewCountText} numberOfLines={1} maxFontSizeMultiplier={1.15}>
            {ownerCountLabel}
          </Text>
        </View>
      ) : null}
      {/* Phase 4: non-owner already-viewed badge, bottom-left. Shown only
          for one-time-view photo/video; voice replays freely. */}
      {showViewedBadge && !ownerCountLabel ? (
        <View style={styles.viewedBadge} pointerEvents="none">
          <Ionicons name="checkmark" size={9} color="#FFF" />
          <Text style={styles.viewedBadgeText} numberOfLines={1} maxFontSizeMultiplier={1.15}>
            Viewed
          </Text>
        </View>
      ) : null}
    </>
  );

  if (interactive) {
    const preloadVerb = isPreloadIdle
      ? 'Preload prompt'
      : isPreloadLoading
        ? 'Loading prompt'
        : isPreloadFailed
          ? 'Retry prompt'
          : 'Open prompt';
    return (
      <TouchableOpacity
        style={[styles.tile, sizingStyle, style]}
        activeOpacity={0.85}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? `${preloadVerb} ${kind}`}
        accessibilityState={isPreloadLoading ? { busy: true } : undefined}
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
