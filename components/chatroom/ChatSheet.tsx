/**
 * ChatSheet - Bottom sheet container for one-on-one chat
 *
 * Layout behavior:
 * - RESTING STATE: 55% height sheet at bottom, above tab bar.
 * - KEYBOARD OPEN: Sheet keeps its resting height and is lifted as a single
 *   block so its bottom sits flush above the keyboard.
 *   - Sheet only shrinks if the keyboard is so tall that the lifted sheet
 *     would otherwise push above the safe-area top.
 *   - Rounded sheet corners preserved (sheet still feels like a sheet).
 *   - Composer remains pinned at the bottom of the sheet, above the keyboard.
 *
 * KEYBOARD MATH (D2 — decoupled from container resize):
 * The keyboard-open math computes sheet position from SCREEN_HEIGHT and the
 * reported keyboard frame, independent of `containerHeight`. This is needed
 * because Chat Rooms suppresses the surrounding group-chat
 * KeyboardAvoidingView while the private sheet is open (so the background
 * doesn't move), which removes the indirect resize cascade the previous
 * formula depended on. See `[roomId].tsx` keyboard listeners.
 *
 * ANIMATION: Reanimated only (no RN Animated mixing) to avoid frozen object
 * errors. Keyboard event listeners drive a shared keyboard-height value
 * which the animated style reads on each frame.
 *
 * P0 GAP FIX: Dynamically measures container position so the sheet anchors
 * correctly against tab bar height, safe areas, and coordinate system
 * mismatches.
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
      // KEYBOARD OPEN: BLOCK-LIFT (decoupled from container resize).
      //
      // Lift the entire sheet upward as a single block, anchoring its
      // BOTTOM edge flush above the keyboard. This formula is computed
      // from the reported keyboard frame and SCREEN_HEIGHT, NOT from the
      // measured `containerHeight`. The sheet only shrinks when the
      // keyboard is so tall that lifting `restingHeight` would push it
      // above the safe-area top.
      //
      // WHY DECOUPLED: the previous formula used `availableBottom = cHeight
      // - keyboardEatsBottom`, which depended on the parent layout
      // shrinking when the keyboard opened. That cascade fired indirectly
      // when the parent <KeyboardAvoidingView behavior="height"> reflowed
      // its content. In Chat Rooms, that KAV is now suppressed while the
      // private sheet is open (so the background group chat stays fixed —
      // see app/(main)/(private)/(tabs)/chat-rooms/[roomId].tsx). The
      // OS-level `softwareKeyboardLayoutMode="resize"` alone does not
      // propagate a fresh measurement into our absoluteFillObject
      // container in time on every Android OEM/Metro build, so cHeight
      // can stay at the pre-keyboard value and the old math positioned
      // the sheet's composer behind the keyboard. SCREEN_HEIGHT is the
      // activity window height (portrait-locked app), kbHeight comes
      // straight from the keyboard event, and `cY` is the container's
      // top in screen coords (re-measured on keyboardDidShow above), so
      // converting to a container-relative `top` stays correct without
      // depending on cHeight.
      const visibleScreenBottom = SCREEN_HEIGHT - kbHeight;

      // Sheet top in screen coords if it kept restingHeight with its
      // bottom flush above the keyboard.
      const idealSheetTopScreen = visibleScreenBottom - restingHeight;

      // Never cross the safe-area top (+8px breathing room).
      const minSheetTopScreen = safeTop + 8;
      const sheetTopScreen = Math.max(minSheetTopScreen, idealSheetTopScreen);

      // Sheet keeps `restingHeight` unless clamped against the safe area;
      // then it shrinks to occupy the visible band above the keyboard.
      const sheetHeight = Math.max(100, visibleScreenBottom - sheetTopScreen);

      // Convert screen-coord top to container-relative top. cY reflects
      // the container's current screen position; cHeight is intentionally
      // not used.
      const sheetTop = Math.max(0, sheetTopScreen - cY);

      // Suppress unused-value warning — `offset` is kept tracked for
      // potential future use, but the new math does not consume it.
      void offset;
      void cHeight;

      return {
        position: 'absolute' as const,
        top: sheetTop,
        left: 0,
        right: 0,
        height: sheetHeight,
        // Keep the rounded sheet corners — visually it's still the same
        // sheet, just lifted up; do not flatten into a full-screen surface.
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
