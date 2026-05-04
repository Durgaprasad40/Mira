/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Stand Out Composer Sheet
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Premium bottom-sheet composer that opens INLINE over the current Discover /
 * Deep Connect profile card when the user taps the Stand Out (★) button or
 * up-swipes a card. Replaces the previous full-screen `/(main)/stand-out`
 * route navigation, which felt non-premium and disconnected from the card.
 *
 * Design rules
 *  - Modal `transparent` so the profile card stays clearly visible behind a
 *    very light dim layer (no blur, no heavy black overlay).
 *  - No route transition / no plain white background flash.
 *  - Phase-aware theming:
 *      * `mode === 'phase1'`: warm light surface using `COLORS`.
 *      * `mode === 'phase2'`: dark glassy surface using `INCOGNITO_COLORS`.
 *  - Keyboard does NOT open automatically. The input is focused only when
 *    the user explicitly taps it. When focused, the sheet rises above the
 *    keyboard so the input, character counter, Send button and close button
 *    all remain visible.
 *  - Keyboard handling uses an explicit `Keyboard.addListener` height-tracker
 *    rather than `KeyboardAvoidingView`. Inside a `Modal`, KeyboardAvoidingView
 *    is unreliable on Android because the Activity's `windowSoftInputMode`
 *    does not propagate to the modal window. Driving the bottom inset from
 *    the measured keyboard height works consistently on iOS and Android.
 *  - Safe-area bottom padding so the sheet never overlaps the Android nav bar.
 *  - The component is presentational only. Send / close logic stays in the
 *    parent screen so Phase-1 and Phase-2 dispatch paths are not mixed.
 *
 * Behaviour contract
 *  - `onSend(message)` is called with the trimmed message string. Empty
 *    messages are allowed (current product permits message-less Stand Outs;
 *    backend stores message as optional).
 *  - `onClose` is called when the user taps the close button or the dim
 *    backdrop. Tapping the backdrop never sends.
 *  - The sheet does NOT call any Convex mutations directly. The parent owns
 *    that and continues to use the existing pipeline
 *    (`useInteractionStore.setStandOutResult` → DiscoverCardStack effect →
 *    `handleSwipe('up', message)`).
 * ─────────────────────────────────────────────────────────────────────────────
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  COLORS,
  FONT_SIZE,
  INCOGNITO_COLORS,
  SIZES,
  SPACING,
} from '@/lib/constants';

export const STANDOUT_COMPOSER_MAX_CHARS = 120;

export type StandOutComposerMode = 'phase1' | 'phase2';

export interface StandOutComposerSheetProps {
  visible: boolean;
  /** Display name of the profile being targeted. */
  targetName?: string | null;
  /** Stand Outs remaining today (already-clamped to >= 0 by parent). */
  standOutsLeft: number;
  /** Phase-1 = light/warm theme; Phase-2 = dark glassy theme. */
  mode: StandOutComposerMode;
  /** Optional initial message (e.g., resume after backgrounding). */
  initialMessage?: string;
  /** Called with the trimmed message. Parent owns the Convex side-effect. */
  onSend: (message: string) => void;
  /** Called when the user dismisses without sending. */
  onClose: () => void;
}

export function StandOutComposerSheet({
  visible,
  targetName,
  standOutsLeft,
  mode,
  initialMessage,
  onSend,
  onClose,
}: StandOutComposerSheetProps) {
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState(initialMessage ?? '');
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const inputRef = useRef<TextInput | null>(null);
  const isPhase2 = mode === 'phase2';

  // Reset draft whenever the sheet opens; preserves "Close = no send" semantics.
  // Note: the input is intentionally NOT auto-focused. The keyboard only opens
  // when the user explicitly taps the TextInput. This avoids the keyboard
  // covering the sheet on slow Android devices and gives the user a moment to
  // read the prompt before composing.
  useEffect(() => {
    if (visible) {
      setMessage(initialMessage ?? '');
    }
  }, [visible, initialMessage]);

  // Track the on-screen keyboard height so the sheet can rise above it. Inside
  // a transparent Modal, KeyboardAvoidingView is unreliable on Android because
  // the Activity's `windowSoftInputMode` does not propagate to the modal's
  // window. Driving a `paddingBottom` from the measured keyboard height works
  // consistently on iOS and Android.
  useEffect(() => {
    if (!visible) {
      setKeyboardHeight(0);
      return;
    }
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvt, (e) => {
      setKeyboardHeight(e.endCoordinates?.height ?? 0);
    });
    const hideSub = Keyboard.addListener(hideEvt, () => {
      setKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [visible]);

  const handleSend = useCallback(() => {
    Keyboard.dismiss();
    onSend(message.trim());
  }, [message, onSend]);

  const handleClose = useCallback(() => {
    Keyboard.dismiss();
    onClose();
  }, [onClose]);

  // Theme tokens
  const theme = isPhase2
    ? {
        sheetBg: 'rgba(22,33,62,0.97)', // INCOGNITO_COLORS.surface @ 97%
        border: INCOGNITO_COLORS.border,
        title: '#F2F2F7',
        subtitle: 'rgba(224,224,224,0.72)',
        muted: 'rgba(224,224,224,0.56)',
        inputBg: 'rgba(255,255,255,0.06)',
        inputBorder: 'rgba(255,255,255,0.12)',
        inputText: '#F2F2F7',
        placeholder: 'rgba(224,224,224,0.42)',
        accent: '#4FC3F7', // Phase-2 stand-out accent (cyan/blue glow)
        sendBgFrom: '#3D8BFD',
        sendBgTo: '#2196F3',
        sendBgDisabledFrom: 'rgba(255,255,255,0.10)',
        sendBgDisabledTo: 'rgba(255,255,255,0.06)',
        starBadgeBg: 'rgba(33,150,243,0.18)',
        grabber: 'rgba(255,255,255,0.18)',
        closeBg: 'rgba(255,255,255,0.08)',
        closeIcon: '#E0E0E0',
      }
    : {
        sheetBg: '#FFFFFF',
        border: COLORS.border,
        title: COLORS.text,
        subtitle: COLORS.textLight,
        muted: COLORS.textMuted,
        inputBg: '#F7F7F9',
        inputBorder: COLORS.border,
        inputText: COLORS.text,
        placeholder: COLORS.textMuted,
        accent: '#2196F3', // Phase-1 stand-out blue, matches existing UI
        sendBgFrom: '#1E88E5',
        sendBgTo: '#2196F3',
        sendBgDisabledFrom: '#E5E7EB',
        sendBgDisabledTo: '#D1D5DB',
        starBadgeBg: 'rgba(33,150,243,0.12)',
        grabber: 'rgba(0,0,0,0.12)',
        closeBg: 'rgba(0,0,0,0.05)',
        closeIcon: COLORS.textLight,
      };

  // Send is always enabled — backend allows message-less stand-outs and the
  // current Phase-1/Phase-2 mutations both accept `message` as optional.
  const charCount = message.length;
  const charCountColor =
    charCount >= STANDOUT_COMPOSER_MAX_CHARS - 12
      ? '#E94560'
      : theme.muted;

  const sheetBottomPad = Math.max(insets.bottom, 12) + SPACING.lg;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      {/* Very light dim backdrop — the profile card behind must remain clearly
          visible. No BlurView (it visually obscures too much of the card on
          Android). Tap-to-close. */}
      <View style={styles.root} pointerEvents="box-none">
        <Pressable
          style={[
            styles.backdrop,
            {
              backgroundColor: isPhase2
                ? 'rgba(8,12,28,0.18)'
                : 'rgba(0,0,0,0.12)',
            },
          ]}
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel="Close Stand Out composer"
        />

        {/* Sheet container. `paddingBottom = keyboardHeight` lifts the sheet
            above the soft keyboard on both iOS and Android. When the keyboard
            is hidden, the sheet sits flush against the bottom of the screen
            (with the safe-area inset already baked into `sheetBottomPad`). */}
        <View
          style={[styles.keyboardWrap, { paddingBottom: keyboardHeight }]}
          pointerEvents="box-none"
        >
          {/* Stop touch-through: pressing the sheet should not trigger backdrop close. */}
          <Pressable onPress={() => {}} style={styles.sheetPressableWrap}>
            <View
              style={[
                styles.sheet,
                {
                  backgroundColor: theme.sheetBg,
                  borderColor: isPhase2 ? theme.inputBorder : 'transparent',
                  borderWidth: isPhase2 ? StyleSheet.hairlineWidth : 0,
                  paddingBottom: sheetBottomPad,
                },
              ]}
            >
              {/* Grabber */}
              <View style={styles.grabberRow}>
                <View style={[styles.grabber, { backgroundColor: theme.grabber }]} />
              </View>

              {/* Header */}
              <View style={styles.header}>
                <View style={[styles.starBadge, { backgroundColor: theme.starBadgeBg }]}>
                  <Ionicons name="star" size={SIZES.icon.sm} color={theme.accent} />
                </View>
                <View style={styles.headerCopy}>
                  <Text
                    style={[styles.title, { color: theme.title }]}
                    numberOfLines={1}
                  >
                    Stand Out to {targetName?.trim() || 'this person'}
                  </Text>
                  <Text style={[styles.remaining, { color: theme.accent }]}>
                    {Math.max(0, standOutsLeft)} Stand Out
                    {standOutsLeft === 1 ? '' : 's'} left today
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.closeBtn, { backgroundColor: theme.closeBg }]}
                  onPress={handleClose}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Ionicons name="close" size={18} color={theme.closeIcon} />
                </TouchableOpacity>
              </View>

              {/* Subtitle */}
              <Text style={[styles.subtitle, { color: theme.subtitle }]}>
                Write a short message to get noticed
              </Text>

              {/* Input */}
              <View
                style={[
                  styles.inputWrap,
                  {
                    backgroundColor: theme.inputBg,
                    borderColor: theme.inputBorder,
                  },
                ]}
              >
                <TextInput
                  ref={inputRef}
                  value={message}
                  onChangeText={setMessage}
                  style={[styles.input, { color: theme.inputText }]}
                  placeholder="Say something genuine..."
                  placeholderTextColor={theme.placeholder}
                  maxLength={STANDOUT_COMPOSER_MAX_CHARS}
                  multiline
                  textAlignVertical="top"
                  returnKeyType="default"
                  blurOnSubmit={false}
                  // Don't capture device-specific keyboard locks: rely on the
                  // platform default so existing locked-keyboard behaviour
                  // elsewhere is unaffected.
                />
              </View>

              {/* Footer: char count + send */}
              <View style={styles.footer}>
                <Text style={[styles.charCount, { color: charCountColor }]}>
                  {charCount}/{STANDOUT_COMPOSER_MAX_CHARS}
                </Text>
                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={handleSend}
                  accessibilityRole="button"
                  accessibilityLabel={`Send Stand Out${
                    targetName ? ` to ${targetName}` : ''
                  }`}
                  style={styles.sendWrap}
                >
                  <LinearGradient
                    colors={[theme.sendBgFrom, theme.sendBgTo]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.sendBtn}
                  >
                    <Ionicons
                      name="star"
                      size={16}
                      color="#FFFFFF"
                      style={{ marginRight: 8 }}
                    />
                    <Text style={styles.sendText}>Send Stand Out</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </View>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  keyboardWrap: {
    width: '100%',
    justifyContent: 'flex-end',
  },
  sheetPressableWrap: {
    width: '100%',
  },
  sheet: {
    width: '100%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    // Premium lift: shadow on iOS, elevation on Android.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 18,
  },
  grabberRow: {
    alignItems: 'center',
    paddingVertical: 6,
    marginBottom: SPACING.xs,
  },
  grabber: {
    width: 44,
    height: 4,
    borderRadius: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  starBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.sm,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: FONT_SIZE.lg,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  remaining: {
    marginTop: 2,
    fontSize: FONT_SIZE.xs,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: SPACING.xs,
  },
  subtitle: {
    fontSize: FONT_SIZE.sm,
    marginBottom: SPACING.sm,
    lineHeight: FONT_SIZE.sm * 1.4,
  },
  inputWrap: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    minHeight: 92,
    marginBottom: SPACING.md,
  },
  input: {
    fontSize: FONT_SIZE.md,
    lineHeight: FONT_SIZE.md * 1.4,
    minHeight: 72,
    padding: 0,
    margin: 0,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  charCount: {
    fontSize: FONT_SIZE.xs,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  sendWrap: {
    borderRadius: 999,
    overflow: 'hidden',
    shadowColor: '#2196F3',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 6,
  },
  sendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: 12,
    borderRadius: 999,
  },
  sendText: {
    color: '#FFFFFF',
    fontSize: FONT_SIZE.md,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});

export default StandOutComposerSheet;
