/**
 * UserPinMarker — Premium profile pin marker for Nearby map.
 *
 * Design: View-based pink pin with circular photo and connected tail.
 * All content fits INSIDE the root container bounds (no clipping on Android).
 *
 * Android Rendering Fixes:
 * 1. Root container has explicit width/height (64x78)
 * 2. collapsable={false} prevents Android view flattening
 * 3. renderToHardwareTextureAndroid={true} for GPU rendering
 * 4. All content fits within stated bounds (no overflow clipping)
 * 5. overflow: 'visible' on root container
 *
 * Usage in Marker:
 *   <Marker anchor={{ x: 0.5, y: 1 }} tracksViewChanges={...}>
 *     <UserPinMarker ... />
 *   </Marker>
 */
import React, { memo } from 'react';
import { View, Image, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UserPinMarkerProps {
  /** URL of the user's photo (null shows placeholder) */
  photoUrl: string | null;
  /** User's display name (first char used for placeholder) */
  name: string;
  /** Whether user is verified (shows badge) */
  isVerified?: boolean;
  /** Whether marker should be faded (old location) */
  faded?: boolean;
  /** Callback when image finishes loading */
  onImageLoad?: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Root container: generous size to fit all content without clipping
const ROOT_WIDTH = 64;
const ROOT_HEIGHT = 78;

// Pin head (circular)
const HEAD_SIZE = 48;
const HEAD_RADIUS = 24;

// Photo ring (white border inside head)
const RING_SIZE = 38;
const RING_RADIUS = 19;

// Photo
const PHOTO_SIZE = 32;
const PHOTO_RADIUS = 16;

// Tail (CSS border triangle)
const TAIL_WIDTH = 12; // borderLeftWidth + borderRightWidth
const TAIL_HEIGHT = 20; // borderTopWidth

// Colors
const PIN_PINK = '#FF4B6E';
const PIN_BORDER = '#E91E63';
const PLACEHOLDER_BG = '#FFF0F3';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function UserPinMarkerComponent({
  photoUrl,
  name,
  isVerified = false,
  faded = false,
  onImageLoad,
}: UserPinMarkerProps) {
  const initial = name?.charAt(0)?.toUpperCase() || '?';

  return (
    <View
      style={[styles.root, faded && styles.faded]}
      collapsable={false}
      renderToHardwareTextureAndroid={true}
    >
      {/* Pin head - circular container */}
      <View style={styles.head} collapsable={false}>
        {/* White photo ring */}
        <View style={styles.photoRing}>
          {photoUrl ? (
            <Image
              source={{ uri: photoUrl }}
              style={styles.photo}
              resizeMode="cover"
              onLoad={onImageLoad}
              onError={onImageLoad}
            />
          ) : (
            <View style={styles.placeholder}>
              <Text style={styles.initial}>{initial}</Text>
            </View>
          )}
        </View>

        {/* Verified badge */}
        {isVerified && (
          <View style={styles.verifiedBadge}>
            <Ionicons name="checkmark-circle" size={14} color={COLORS.primary} />
          </View>
        )}
      </View>

      {/* Pin tail - CSS border triangle */}
      <View style={styles.tail} collapsable={false} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  // Root container: fits head (48) + tail (20) - overlap (6) = 62px in 78px height
  root: {
    width: ROOT_WIDTH,
    height: ROOT_HEIGHT,
    alignItems: 'center',
    justifyContent: 'flex-start',
    backgroundColor: 'transparent',
    overflow: 'visible',
  },

  faded: {
    opacity: 0.6,
  },

  // Pin head: circular with border
  head: {
    width: HEAD_SIZE,
    height: HEAD_SIZE,
    borderRadius: HEAD_RADIUS,
    backgroundColor: PIN_PINK,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: PIN_BORDER,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 6,
  },

  // White ring inside head
  photoRing: {
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_RADIUS,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden', // Clip photo to circle
  },

  // Profile photo
  photo: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE,
    borderRadius: PHOTO_RADIUS,
  },

  // Placeholder when no photo
  placeholder: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE,
    borderRadius: PHOTO_RADIUS,
    backgroundColor: PLACEHOLDER_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Initial letter in placeholder
  initial: {
    fontSize: 16,
    fontWeight: '700',
    color: PIN_BORDER,
  },

  // Verified badge: positioned at bottom-right of head
  verifiedBadge: {
    position: 'absolute',
    bottom: -1,
    right: -1,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 1,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },

  // Pin tail: CSS border triangle, overlaps head slightly
  tail: {
    width: 0,
    height: 0,
    borderLeftWidth: TAIL_WIDTH / 2,
    borderRightWidth: TAIL_WIDTH / 2,
    borderTopWidth: TAIL_HEIGHT,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: PIN_PINK,
    marginTop: -6, // Overlap with head for connected look
  },
});

// ---------------------------------------------------------------------------
// Export (memoized)
// ---------------------------------------------------------------------------

export const UserPinMarker = memo(UserPinMarkerComponent);
