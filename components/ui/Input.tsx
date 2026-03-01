import React, { useState, forwardRef, useRef, useImperativeHandle } from 'react';
import {
  View,
  TextInput,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  TextInputProps,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  hint?: string;
  leftIcon?: keyof typeof Ionicons.glyphMap;
  rightIcon?: keyof typeof Ionicons.glyphMap;
  onRightIconPress?: () => void;
  containerStyle?: ViewStyle;
  /**
   * HARD BLOCK: Allow auth autofill for this input.
   * Default is FALSE - Google Password Manager is completely blocked.
   * Set to TRUE **ONLY** for:
   *   - Onboarding email input
   *   - Login email input
   * DO NOT use anywhere else.
   */
  allowAuthAutofill?: boolean;
}

export interface InputRef {
  focus: () => void;
  blur: () => void;
}

export const Input = forwardRef<InputRef, InputProps>(({
  label,
  error,
  hint,
  leftIcon,
  rightIcon,
  onRightIconPress,
  containerStyle,
  secureTextEntry,
  allowAuthAutofill = false,
  keyboardType,
  ...props
}, ref) => {
  const [isFocused, setIsFocused] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const isPassword = secureTextEntry !== undefined;

  // Expose focus/blur methods via ref
  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    blur: () => inputRef.current?.blur(),
  }));

  // Handle tap anywhere in the input container to focus the TextInput
  const handleContainerPress = () => {
    if (props.editable !== false) {
      inputRef.current?.focus();
    }
  };

  return (
    <View style={[styles.container, containerStyle]}>
      {label && <Text style={styles.label}>{label}</Text>}

      {/* Pressable wrapper ensures tapping anywhere in the box focuses the input */}
      <Pressable onPress={handleContainerPress}>
        <View
          style={[
            styles.inputContainer,
            isFocused && styles.inputContainerFocused,
            error && styles.inputContainerError,
          ]}
        >
          {leftIcon && (
            <Ionicons
              name={leftIcon}
              size={20}
              color={error ? COLORS.error : isFocused ? COLORS.primary : COLORS.textMuted}
              style={styles.leftIcon}
            />
          )}

          <TextInput
            ref={inputRef}
            style={[styles.input, leftIcon && styles.inputWithLeftIcon]}
            placeholderTextColor={COLORS.textMuted}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            secureTextEntry={isPassword && !showPassword}
            {...props}
            // HARD BLOCK: Autofill settings applied AFTER props spread to override any passed values
            // Only auth screens (onboarding email, login email) may use allowAuthAutofill={true}
            autoComplete={allowAuthAutofill ? 'email' : 'off'}
            textContentType={allowAuthAutofill ? 'emailAddress' : 'none'}
            importantForAutofill={allowAuthAutofill ? 'yes' : 'noExcludeDescendants'}
            keyboardType={allowAuthAutofill ? 'email-address' : (keyboardType === 'email-address' ? 'default' : keyboardType)}
          />

          {isPassword && (
            <TouchableOpacity
              onPress={() => setShowPassword(!showPassword)}
              style={styles.rightIconButton}
            >
              <Ionicons
                name={showPassword ? 'eye-off' : 'eye'}
                size={20}
                color={COLORS.textMuted}
              />
            </TouchableOpacity>
          )}

          {rightIcon && !isPassword && (
            <TouchableOpacity
              onPress={onRightIconPress}
              style={styles.rightIconButton}
              disabled={!onRightIconPress}
            >
              <Ionicons name={rightIcon} size={20} color={COLORS.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </Pressable>

      {error && <Text style={styles.error}>{error}</Text>}
      {hint && !error && <Text style={styles.hint}>{hint}</Text>}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  inputContainerFocused: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.white,
  },
  inputContainerError: {
    borderColor: COLORS.error,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: COLORS.text,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  inputWithLeftIcon: {
    paddingLeft: 0,
  },
  leftIcon: {
    marginLeft: 16,
  },
  rightIconButton: {
    padding: 12,
  },
  error: {
    fontSize: 12,
    color: COLORS.error,
    marginTop: 4,
  },
  hint: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 4,
  },
});
