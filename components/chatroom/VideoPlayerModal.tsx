import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useVideoPlayer, VideoView, VideoPlayer } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { getVideoUri } from '@/lib/videoCache';

const C = INCOGNITO_COLORS;

/**
 * BUGFIX: Safe pause helper to avoid crashes when:
 * 1. player is an integer (type mismatch from stale closure)
 * 2. player has already been released/unmounted
 */
function safePause(player: VideoPlayer | null | undefined): void {
  if (!player) return;
  // Guard: ensure player is a real object with a pause function
  if (typeof player !== 'object' || typeof (player as any).pause !== 'function') {
    return;
  }
  try {
    player.pause();
  } catch {
    // Ignore errors from already-released shared objects
  }
}

interface VideoPlayerModalProps {
  visible: boolean;
  videoUri: string;
  onClose: () => void;
}

export default function VideoPlayerModal({ visible, videoUri, onClose }: VideoPlayerModalProps) {
  // VIDEO-CACHE-FIX: Track cached URI state
  const [cachedUri, setCachedUri] = useState<string>(videoUri);
  const [isLoading, setIsLoading] = useState(true);

  // VIDEO-CACHE-FIX: Load cached URI when modal opens
  useEffect(() => {
    if (!visible || !videoUri) return;

    let mounted = true;
    setIsLoading(true);

    const loadCachedVideo = async () => {
      try {
        const cached = await getVideoUri(videoUri);
        if (mounted) {
          setCachedUri(cached);
          setIsLoading(false);
        }
      } catch {
        if (mounted) {
          setCachedUri(videoUri);
          setIsLoading(false);
        }
      }
    };

    loadCachedVideo();

    return () => {
      mounted = false;
    };
  }, [visible, videoUri]);

  // Use cached URI for player
  const player = useVideoPlayer(cachedUri, (p) => {
    p.loop = false;
    p.play();
  });

  // BUGFIX: Track player in ref to avoid stale closure in cleanup
  const playerRef = useRef<VideoPlayer | null>(null);
  useEffect(() => {
    playerRef.current = player ?? null;
  }, [player]);

  // CR-4: Cleanup video on close/unmount (using safePause)
  useEffect(() => {
    if (!visible) {
      safePause(playerRef.current);
    }
    return () => {
      safePause(playerRef.current);
    };
  }, [visible]);

  if (!visible || !videoUri) return null;

  // Show loading indicator while caching
  if (isLoading || !player) {
    return (
      <Modal visible={visible} animationType="fade" onRequestClose={onClose}>
        <View style={styles.container}>
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={onClose}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="close" size={28} color="#FFFFFF" />
          </TouchableOpacity>
          <ActivityIndicator size="large" color="#FFFFFF" />
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={styles.container}>
        {/* Close button */}
        <TouchableOpacity
          style={styles.closeBtn}
          onPress={onClose}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="close" size={28} color="#FFFFFF" />
        </TouchableOpacity>

        <VideoView
          player={player}
          style={styles.video}
          allowsFullscreen
          allowsPictureInPicture={false}
          nativeControls
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtn: {
    position: 'absolute',
    top: 56,
    right: 16,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  video: {
    width: '100%',
    height: '80%',
  },
});
