/**
 * RoomBackground
 *
 * Constant premium background for the public Chat Room screen.
 *
 * - Not theme-controlled (intentional: public room is a brand surface).
 * - Subtle dark-violet vertical gradient with a soft top glow.
 * - No animation, no texture, no patterns.
 *
 * Use as a flex:1 wrapper around the room body.
 */
import React from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

const BASE_GRADIENT: readonly [string, string] = ['#13111C', '#0E0C18'] as const;
const TOP_GLOW_GRADIENT: readonly [string, string] = [
  'rgba(109,40,217,0.06)',
  'rgba(109,40,217,0)',
] as const;

interface RoomBackgroundProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function RoomBackground({ children, style }: RoomBackgroundProps) {
  return (
    <LinearGradient
      colors={BASE_GRADIENT}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={[styles.root, style]}
    >
      <LinearGradient
        colors={TOP_GLOW_GRADIENT}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        pointerEvents="none"
        style={styles.topGlow}
      />
      {children}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  topGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 140,
  },
});

export default RoomBackground;
