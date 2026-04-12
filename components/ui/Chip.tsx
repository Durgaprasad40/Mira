import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import {
  COLORS,
  SPACING,
  SIZES,
  FONT_SIZE,
  FONT_WEIGHT,
  HAIRLINE,
} from '@/lib/constants';

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
    borderRadius: SIZES.radius.xl,
    borderWidth: HAIRLINE,
    borderColor: COLORS.border,
    gap: SPACING.xs,
  },
  small: {
    paddingVertical: SPACING.xs + 2,
    paddingHorizontal: SPACING.md,
  },
  medium: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.base,
  },
  large: {
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
  },
  chipSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  chipDisabled: {
    opacity: 0.5,
  },
  icon: {
    fontSize: FONT_SIZE.lg,
  },
  label: {
    color: COLORS.text,
    fontWeight: FONT_WEIGHT.medium,
  },
  smallText: {
    fontSize: FONT_SIZE.caption,
  },
  mediumText: {
    fontSize: FONT_SIZE.md,
  },
  largeText: {
    fontSize: FONT_SIZE.lg,
  },
  labelSelected: {
    color: COLORS.white,
  },
  count: {
    fontSize: FONT_SIZE.caption,
    fontWeight: FONT_WEIGHT.semibold,
    color: COLORS.textMuted,
    backgroundColor: COLORS.border,
    paddingHorizontal: SPACING.xs + 2,
    paddingVertical: SPACING.xxs,
    borderRadius: SIZES.radius.sm + 2,
    overflow: 'hidden',
    marginLeft: SPACING.xs,
  },
  countSelected: {
    color: COLORS.primary,
    backgroundColor: COLORS.white,
  },
});
