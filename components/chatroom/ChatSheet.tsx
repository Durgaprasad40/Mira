/**
 * ChatSheet - Bottom sheet container for one-on-one chat
 *
 * Layout behavior:
 * - RESTING STATE: 55% height sheet at bottom, above tab bar
 * - KEYBOARD OPEN: Sheet keeps its resting height and is translated upward
 *   as a single block so its bottom sits flush above the keyboard.
 *   - Sheet only shrinks if the keyboard is so tall that the lifted sheet
 *     would otherwise push above the safe-area top.
 *   - Rounded sheet corners preserved (sheet still feels like a sheet).
 *   - Composer remains pinned at the bottom of the sheet, above the keyboard.
 *
 * SYNC FIX: Uses Reanimated's useAnimatedKeyboard() for frame-perfect
 * synchronization with keyboard animation. The sheet moves WITH the keyboard,
 * not after it.
 *
 * ANIMATION FIX: Uses only Reanimated (no RN Animated mixing) to avoid
 * frozen object errors.
 *
 * P0 GAP FIX: Dynamically measures container position to calculate exact
 * bottom offset. This eliminates guesswork about tab bar height, safe areas,
 * and coordinate system mismatches.
 */
import React, { useEffect, useCallback, useState, useRef } from 'react';
import {
  View,
  StyleSheet,
  Dimensions,
  Keyboard,
  LayoutChangeEvent,
  Platform,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { INCOGNITO_COLORS } from '@/lib/constants';

const C = INCOGNITO_COLORS;
const { height: SCREEN_HEIGHT } = Dimensions.get('window');

// Resting sheet height as percentage of screen
const RESTING_HEIGHT_RATIO = 0.55;

// Threshold to consider keyboard "open" (accounts for minor fluctuations)
const KEYBOARD_OPEN_THRESHOLD = 50;

// Keyboard height fine-tuning constant
// Keyboard event height usually includes toolbar, so this may be 0 or small.
// Adjust if there's still a gap (+) or overlap (-) between composer and keyboard.
const KEYBOARD_TOOLBAR_HEIGHT = 0;

interface ChatSheetProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  peerId?: string;
  peerName?: string;
}

export default function ChatSheet({
  visible,
  onClose,
  children,
  peerId,
  peerName,
}: ChatSheetProps) {
  const insets = useSafeAreaInsets();

  // Heights
  const restingHeight = SCREEN_HEIGHT * RESTING_HEIGHT_RATIO;

  // State
  const [isVisible, setIsVisible] = useState(false);
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);

  // P0 GAP FIX: Ref for container measurement
  const containerRef = useRef<View>(null);

  // P0 GAP FIX: Shared value for container bottom offset (distance from screen bottom to container bottom)
  const containerBottomOffset = useSharedValue(0);

  // STABLE TOP FIX: Store container height to calculate stable sheet top position
  const containerHeight = useSharedValue(0);

  // EXPAND FIX: Store container Y position to calculate how much we can expand upward
  const containerY = useSharedValue(0);

  // ANIMATION FIX: Use Reanimated shared value for opacity (not RN Animated)
  const opacity = useSharedValue(0);

  // KEYBOARD FIX: Use keyboard event listeners instead of useAnimatedKeyboard()
  // useAnimatedKeyboard() doesn't report height correctly on some Android/Samsung devices
  // Keyboard events are reliable and provide the actual keyboard height
  const keyboardHeight = useSharedValue(0);

  // P0 GAP FIX: Measure container position when layout changes
  // This calculates how far the container's bottom edge is from the screen bottom.
  const handleContainerLayout = useCallback((event: LayoutChangeEvent) => {
    const containerView = containerRef.current;
    if (!containerView) return;

    // measureInWindow gives position relative to the screen (not parent)
    containerView.measureInWindow((x, y, width, height) => {
      // Container bottom in screen coordinates
      const containerBottomY = y + height;
      // Distance from container bottom to screen bottom
      const offsetFromScreenBottom = SCREEN_HEIGHT - containerBottomY;

      // Update shared values (accessible from UI thread in useAnimatedStyle)
      containerBottomOffset.value = offsetFromScreenBottom;
      containerHeight.value = height;
      containerY.value = y;
    });
  }, [containerBottomOffset, containerHeight, containerY]);

  // KEYBOARD FIX: Track keyboard state via event listeners (reliable on all Android devices)
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const handleKeyboardShow = (e: any) => {
      const height = e.endCoordinates.height;
      // Animate to new keyboard height for smooth sheet transition
      keyboardHeight.value = withTiming(height, { duration: 250 });
      setIsKeyboardOpen(true);

      // ONEPLUS-OVERLAP FIX: On Android with softwareKeyboardLayoutMode="resize",
      // the OS resizes the window when the keyboard opens. The container layout
      // event for that resize sometimes lands AFTER the keyboard event on certain
      // OEM ROMs (e.g. OnePlus), leaving stale containerHeight/containerY values
      // in the animated style during the transition. Re-measure on the next frame
      // so the sheet's anchored bottom matches the actual post-resize container.
      if (Platform.OS === 'android') {
        requestAnimationFrame(() => {
          const containerView = containerRef.current;
          if (!containerView) return;
          containerView.measureInWindow((x, y, width, h) => {
            const containerBottomY = y + h;
            const winHeight = Dimensions.get('window').height;
            containerBottomOffset.value = winHeight - containerBottomY;
            containerHeight.value = h;
            containerY.value = y;
          });
        });
      }
    };

    const handleKeyboardHide = () => {
      // Animate back to 0 for smooth sheet return
      keyboardHeight.value = withTiming(0, { duration: 200 });
      setIsKeyboardOpen(false);
    };

    const showSub = Keyboard.addListener(showEvent, handleKeyboardShow);
    const hideSub = Keyboard.addListener(hideEvent, handleKeyboardHide);

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [keyboardHeight, containerBottomOffset, containerHeight, containerY]);

  // Safe area top for expanded mode calculations
  const safeTop = insets.top;

  // P0 GAP FIX: Animated style with measured offset correction
  // Always use absolute positioning for consistent behavior.
  // In resting mode: position at bottom with fixed height.
  // In keyboard mode: EXPAND UPWARD to use available space, keep bottom anchored to keyboard.
  const animatedSheetStyle = useAnimatedStyle(() => {
    const kbHeight = keyboardHeight.value;
    const offset = containerBottomOffset.value;
    const cHeight = containerHeight.value;
    const cY = containerY.value;
    const isOpen = kbHeight > KEYBOARD_OPEN_THRESHOLD;

    // Calculate stable top position: where the sheet top would be in resting mode
    const stableTop = cHeight > 0 ? cHeight - restingHeight : SCREEN_HEIGHT - restingHeight;

    // If container hasn't been measured yet, use simple bottom positioning
    if (cHeight === 0) {
      return {
        position: 'absolute' as const,
        left: 0,
        right: 0,
        bottom: 0,
        height: restingHeight,
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        opacity: opacity.value,
      };
    }

    // CONSISTENT POSITIONING FIX: Always use top + height in both modes
    // This prevents stale 'top' values from persisting when switching modes
    // (Reanimated merges styles, so unused properties aren't cleared)

    if (isOpen) {
      // KEYBOARD OPEN: BLOCK-MOVE.
      // Lift the entire sheet upward as a single block while preserving its
      // resting height/shape. The sheet only shrinks when the keyboard is so
      // tall that even a fully translated sheet would push above the safe area.
      //
      // Previously this branch stretched the sheet from `safeTop` down to the
      // keyboard top, which made the chat box look elongated when the keyboard
      // opened. The new math keeps `restingHeight` and just translates the
      // sheet upward so its bottom sits flush above the keyboard.
      //
      // Android with softwareKeyboardLayoutMode="resize": cHeight is already
      // the post-resize area above the keyboard, so no extra subtraction is
      // needed. iOS does not resize the window, so subtract kbHeight (clamped
      // >= 0 for OEM/IME reporting safety) to get the available area.
      const keyboardEatsBottom = Platform.OS === 'ios'
        ? Math.max(0, kbHeight - offset + KEYBOARD_TOOLBAR_HEIGHT)
        : 0;
      const availableBottom = cHeight - keyboardEatsBottom;

      // Minimum top within the container: don't push above the status bar.
      const minTop = Math.max(0, safeTop - cY + 8);

      // Where the sheet would sit if it kept restingHeight with its bottom
      // flush above the keyboard.
      const desiredTop = availableBottom - restingHeight;

      // Translate up to desiredTop unless that would cross the safe-area top.
      const sheetTop = Math.max(minTop, desiredTop);

      // Sheet keeps its restingHeight when not clamped; otherwise shrinks to
      // fit the available area without going behind the keyboard.
      const sheetHeight = Math.max(100, availableBottom - sheetTop);

      return {
        position: 'absolute' as const,
        top: sheetTop,
        left: 0,
        right: 0,
        height: sheetHeight,
        // Keep the rounded sheet corners — visually it's still the same sheet,
        // just lifted up; do not flatten into a full-screen surface.
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        opacity: opacity.value,
      };
    } else {
      // RESTING MODE: Use top + height (same properties as keyboard-open for clean transitions)
      // restingTop positions the sheet at the bottom with restingHeight
      const restingTop = cHeight - restingHeight;

      return {
        position: 'absolute' as const,
        top: restingTop, // Positions sheet at bottom with correct height
        left: 0,
        right: 0,
        height: restingHeight,
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        opacity: opacity.value,
      };
    }
  }, [restingHeight, safeTop]);

  // Callback to hide component after fade out
  const hideComponent = useCallback(() => {
    setIsVisible(false);
    setIsKeyboardOpen(false);
  }, []);

  // Show/hide animation using Reanimated
  useEffect(() => {
    if (visible) {
      setIsVisible(true);
      opacity.value = withTiming(1, { duration: 200 });
    } else {
      opacity.value = withTiming(0, { duration: 200 }, (finished) => {
        if (finished) {
          runOnJS(hideComponent)();
        }
      });
    }
  }, [visible, opacity, hideComponent]);

  // Close handler
  const handleClose = useCallback(() => {
    Keyboard.dismiss();
    onClose();
  }, [onClose]);

  // Send complete handler - NO keyboard dismiss here!
  // Keyboard should stay open after send so user can continue typing.
  // Sheet only returns to resting when user explicitly dismisses keyboard (back button).
  const handleSendComplete = useCallback(() => {
    // Intentionally empty - do NOT dismiss keyboard on send
  }, []);

  if (!isVisible && !visible) return null;

  return (
    <View
      ref={containerRef}
      style={styles.container}
      pointerEvents="box-none"
      onLayout={handleContainerLayout}
    >
      <Animated.View
        style={[
          styles.sheet,
          animatedSheetStyle,
        ]}
      >
        {/* Content fills the sheet */}
        <View style={styles.content}>
          {React.Children.map(children, (child) => {
            if (React.isValidElement(child)) {
              return React.cloneElement(child as React.ReactElement<any>, {
                onSendComplete: handleSendComplete,
                hideBackButton: true,
                isInSheet: true,
                onSheetClose: handleClose,
                isKeyboardOpen: isKeyboardOpen,
                safeAreaTop: insets.top,
              });
            }
            return child;
          })}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    // Allow sheet to render in full-screen mode
    overflow: 'visible',
  },
  sheet: {
    backgroundColor: C.background,
    overflow: 'hidden',
    // Explicit flex container - required for children to fill correctly
    flexDirection: 'column',
    // Shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 20,
  },
  content: {
    // Flex: 1 fills the sheet, flexDirection ensures proper column layout
    flex: 1,
    flexDirection: 'column',
  },
});
