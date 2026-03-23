import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
} from 'react-native';
import {
  COLORS,
  SPACING,
  SIZES,
  FONT_SIZE,
  FONT_WEIGHT,
  HAIRLINE,
} from '@/lib/constants';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  size?: 'small' | 'medium' | 'large';
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  style?: ViewStyle;
  textStyle?: TextStyle;
  fullWidth?: boolean;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'medium',
  disabled = false,
  loading = false,
  icon,
  style,
  textStyle,
  fullWidth = false,
}: ButtonProps) {
  const getButtonStyle = (): ViewStyle[] => {
    const styles: ViewStyle[] = [baseStyles.button, baseStyles[size]];

    if (fullWidth) {
      styles.push({ width: '100%' });
    }

    switch (variant) {
      case 'primary':
        styles.push(baseStyles.primary);
        break;
      case 'secondary':
        styles.push(baseStyles.secondary);
        break;
      case 'outline':
        styles.push(baseStyles.outline);
        break;
      case 'ghost':
        styles.push(baseStyles.ghost);
        break;
    }

    if (disabled || loading) {
      styles.push(baseStyles.disabled);
    }

    return styles;
  };

  const getTextStyle = (): TextStyle[] => {
    const styles: TextStyle[] = [baseStyles.text, baseStyles[`${size}Text`]];

    switch (variant) {
      case 'primary':
        styles.push(baseStyles.primaryText);
        break;
      case 'secondary':
        styles.push(baseStyles.secondaryText);
        break;
      case 'outline':
        styles.push(baseStyles.outlineText);
        break;
      case 'ghost':
        styles.push(baseStyles.ghostText);
        break;
    }

    return styles;
  };

  return (
    <TouchableOpacity
      style={[...getButtonStyle(), style]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.8}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === 'primary' ? COLORS.white : COLORS.primary}
          size={size === 'small' ? 'small' : 'small'}
        />
      ) : (
        <>
          {icon && icon}
          <Text style={[...getTextStyle(), textStyle]}>{title}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const baseStyles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: SIZES.radius.md,
    gap: SPACING.sm,
    minHeight: SIZES.touchTarget, // Accessibility: minimum touch target
  },
  text: {
    fontWeight: FONT_WEIGHT.semibold,
  },

  // Sizes - using responsive spacing
  small: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.base,
    minHeight: SIZES.button.sm,
  },
  medium: {
    paddingVertical: SPACING.md + 2,
    paddingHorizontal: SPACING.xl,
    minHeight: SIZES.button.md,
  },
  large: {
    paddingVertical: SPACING.base + 2,
    paddingHorizontal: SPACING.xxl,
    minHeight: SIZES.button.lg,
  },
  smallText: {
    fontSize: FONT_SIZE.md,
  },
  mediumText: {
    fontSize: FONT_SIZE.lg,
  },
  largeText: {
    fontSize: FONT_SIZE.xl,
  },

  // Variants
  primary: {
    backgroundColor: COLORS.primary,
  },
  primaryText: {
    color: COLORS.white,
  },
  secondary: {
    backgroundColor: COLORS.secondary,
  },
  secondaryText: {
    color: COLORS.white,
  },
  outline: {
    backgroundColor: 'transparent',
    borderWidth: HAIRLINE * 2, // Slightly thicker for visibility
    borderColor: COLORS.primary,
  },
  outlineText: {
    color: COLORS.primary,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  ghostText: {
    color: COLORS.primary,
  },
  disabled: {
    opacity: 0.5,
  },
});
