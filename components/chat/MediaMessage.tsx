import React, { useState, useEffect, useRef } from 'react';
import { View, TouchableOpacity, StyleSheet, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';

interface MediaMessageProps {
  mediaUrl: string;
  type: 'image' | 'video';
  onPress?: () => void;
  /** Bubble width — defaults to 200 */
  width?: number;
  /** Bubble height — defaults to 150 */
  height?: number;
}

// Video player component using expo-video
function VideoMessage({
  mediaUrl,
  width,
  height,
}: {
  mediaUrl: string;
  width: number;
  height: number;
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasError, setHasError] = useState(false);
  const mountedRef = useRef(true);

  const player = useVideoPlayer(mediaUrl, (p) => {
    p.loop = false;
  });

  // Track mounted state for safe setState
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Listen for playback status changes
  useEffect(() => {
    if (!player) return;

    const subscription = player.addListener('statusChange', (status) => {
      if (!mountedRef.current) return;
      if (status.status === 'error') {
        console.error('[MediaMessage][Video] Playback error:', status.error);
        setHasError(true);
      }
    });

    const playingSubscription = player.addListener('playingChange', (event) => {
      if (!mountedRef.current) return;
      setIsPlaying(event.isPlaying);
    });

    return () => {
      subscription.remove();
      playingSubscription.remove();
    };
  }, [player]);

  const handleVideoPress = () => {
    if (!player) return;

    if (player.playing) {
      player.pause();
    } else {
      player.play();
    }
  };

  if (hasError) {
    return (
      <View style={[styles.container, { width, height }]}>
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle" size={32} color="rgba(255,255,255,0.6)" />
        </View>
      </View>
    );
  }

  return (
    <Pressable
      style={[styles.container, { width, height }]}
      onPress={handleVideoPress}
    >
      <VideoView
        player={player}
        style={styles.video}
        contentFit="cover"
        nativeControls={false}
      />
      {!isPlaying && (
        <View style={styles.playOverlay}>
          <Ionicons name="play-circle" size={44} color="rgba(255,255,255,0.9)" />
        </View>
      )}
    </Pressable>
  );
}

export default function MediaMessage({
  mediaUrl,
  type,
  onPress,
  width = 200,
  height = 150,
}: MediaMessageProps) {
  console.log('[MediaMessage] Rendering:', { type, mediaUrl: mediaUrl?.slice(0, 50) });

  if (type === 'video') {
    return <VideoMessage mediaUrl={mediaUrl} width={width} height={height} />;
  }

  return (
    <TouchableOpacity
      style={[styles.container, { width, height }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <Image
        source={{ uri: mediaUrl }}
        style={styles.image}
        contentFit="cover"
        recyclingKey={mediaUrl}
      />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#1E1E2E',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  video: {
    width: '100%',
    height: '100%',
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2C2C3A',
  },
});
