import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
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

export default function MediaMessage({
  mediaUrl,
  type,
  onPress,
  width = 200,
  height = 150,
}: MediaMessageProps) {
  if (type === 'video') {
    return (
      <TouchableOpacity
        style={[styles.container, { width, height }]}
        onPress={onPress}
        activeOpacity={0.8}
      >
        <View style={styles.videoThumb}>
          <Ionicons name="play-circle" size={44} color="rgba(255,255,255,0.9)" />
          <Text style={styles.videoLabel}>Video</Text>
        </View>
      </TouchableOpacity>
    );
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
  videoThumb: {
    width: '100%',
    height: '100%',
    backgroundColor: '#2C2C3A',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  videoLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8E8E9A',
  },
});
