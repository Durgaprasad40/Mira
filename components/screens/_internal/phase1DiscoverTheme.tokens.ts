/**
 * Phase-1 Discover Theme Tokens
 *
 * Light / shaded premium palette used ONLY by the public Phase-1 Discover
 * surfaces (the Discover card stack and the public opened profile screen).
 *
 * IMPORTANT — Phase isolation:
 *   - This file MUST NOT import any Phase-2 (Deep Connect / private) tokens
 *     such as INCOGNITO_COLORS, lib/privateConstants, or the Phase-2
 *     deepConnectActionRow tokens. Phase-1 has its own visual identity.
 *   - This file MUST NOT be imported by Phase-2 surfaces.
 *
 * Goal: give Phase-1 a quiet, warm, premium foundation (warm ivory page,
 * soft warm-white cards, warm hairline borders, deep cocoa text) that reads
 * as "premium light" without ever drifting into Phase-2's misty-blue dark
 * theme.
 */

export const PHASE1_DISCOVER_THEME = {
  // Page & surfaces — warm ivory premium
  pageBg: '#FBF7F1',          // warm ivory page background
  surface: '#FFFFFF',          // soft warm white card / sheet surface
  surfaceMuted: '#F4EEE5',     // section / chip / inset surface
  surfaceStrong: '#EFE6D9',    // stronger card inset (e.g. prompt cards)

  // Hairlines & dividers
  border: '#EFE6D9',           // warm hairline border
  borderStrong: '#E2D6C3',     // stronger separator

  // Typography (light theme — text on light surfaces)
  text: '#2A1F19',             // deep cocoa primary text
  textMuted: '#6B5C4F',        // secondary / muted body
  textSubtle: '#9D8E7E',       // eyebrow / metadata / hint

  // Photo overlay scrim (used by ProfileCard text-shadow stack so
  // white name/age remains legible over any photo).
  //
  // Polish (Batch C):
  //   - scrimText 0.9 → 0.55: the previous near-opaque shadow read as a
  //     heavy black halo around the name/age glyphs and made the photo
  //     overlay feel cheap. 0.55 keeps glyphs legible against bright
  //     photos but lets the photo show through as the dominant element.
  //   - scrimSoft is intentionally left at 0.55 (already balanced).
  scrimText: 'rgba(0,0,0,0.55)',
  scrimSoft: 'rgba(0,0,0,0.55)',

  // Soft premium drop-shadow values (for cards on the ivory page)
  shadowColor: '#1B0E04',
  shadowOpacity: 0.06,
  shadowRadius: 18,
  shadowOffsetY: 8,

  // Chip palette
  chipBg: '#F4EEE5',
  chipBgStrong: '#EBE0D1',
  chipText: '#3A2C22',
} as const;

export type Phase1DiscoverTheme = typeof PHASE1_DISCOVER_THEME;
