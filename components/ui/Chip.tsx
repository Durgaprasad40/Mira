import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import { COLORS } from '@/lib/constants';

interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: string;
  disabled?: boolean;
  style?: ViewStyle;
  size?: 'small' | 'medium' | 'large';
  count?: number;
}

export function Chip({
  label,
  selected = false,
  onPress,
  icon,
  disabled = false,
  style,
  size = 'medium',
  count,
}: ChipProps) {
  return (
    <TouchableOpacity
      style={[
        styles.chip,
        styles[size],
        selected && styles.chipSelected,
        disabled && styles.chipDisabled,
        style,
      ]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
    >
      {icon && <Text style={styles.icon}>{icon}</Text>}
      <Text
        style={[
          styles.label,
          styles[`${size}Text`],
          selected && styles.labelSelected,
        ]}
      >
        {label}
      </Text>
      {count !== undefined && count > 0 && (
        <Text style={[styles.count, selected && styles.countSelected]}>
          {count > 99 ? '99+' : count}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 4,
  },
  small: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  medium: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  large: {
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  chipSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  chipDisabled: {
    opacity: 0.5,
  },
  icon: {
    fontSize: 16,
  },
  label: {
    color: COLORS.text,
    fontWeight: '500',
  },
  smallText: {
    fontSize: 12,
  },
  mediumText: {
    fontSize: 14,
  },
  largeText: {
    fontSize: 16,
  },
  labelSelected: {
    color: COLORS.white,
  },
  count: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textMuted,
    backgroundColor: COLORS.border,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: 'hidden',
    marginLeft: 4,
  },
  countSelected: {
    color: COLORS.primary,
    backgroundColor: COLORS.white,
  },
});
