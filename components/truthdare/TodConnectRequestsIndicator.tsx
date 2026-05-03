import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

const COLORS = {
  coral: '#E94560',
  coralSoft: '#FF6B8A',
  orange: '#FF7849',
  textPrimary: '#F5F5F7',
  surface: '#252545',
};

type TodConnectRequestsIndicatorProps = {
  count: number;
  onPress: () => void;
};

export function TodConnectRequestsIndicator({
  count,
  onPress,
}: TodConnectRequestsIndicatorProps) {
  if (count <= 0) return null;

  return (
    <TouchableOpacity
      style={styles.touchTarget}
      activeOpacity={0.84}
      accessibilityRole="button"
      accessibilityLabel="View Truth or Dare connect requests"
      onPress={onPress}
    >
      <LinearGradient
        colors={[COLORS.coral, COLORS.orange]}
        style={styles.iconDisc}
      >
        <Ionicons name="git-merge" size={16} color="#FFF" />
      </LinearGradient>
      <View style={styles.countBadge}>
        <Text style={styles.countText}>{count > 9 ? '9+' : count}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  touchTarget: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  iconDisc: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.coral,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.32,
    shadowRadius: 8,
    elevation: 4,
  },
  countBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.textPrimary,
  },
  countText: {
    color: COLORS.textPrimary,
    fontSize: 9,
    fontWeight: '900',
  },
});
