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
 * The keyboard-open math anchors the sheet bottom to the keyboard's reported
 * top edge (`endCoordinates.screenY`) instead of deriving that edge from a
 * static screen/window height minus keyboard height. This avoids OEM-specific
 * Android differences in nav-bar/window sizing while Chat Rooms suppresses
 * the surrounding group-chat KeyboardAvoidingView.
 *
 * SHEET-BOTTOM CORRECTION (P2-CHATROOM-SHEET-BOTTOM):
 * Earlier attempts applied a measured composer overlap as an additional
 * `translateY` lift on the sheet. KB-AUDIT runtime traces showed the
 * height/top math already pinned the sheet bottom flush with the keyboard
 * top, so the transform was either a no-op or risked double-correcting.
 * The current branch instead expresses the breathing-room gap directly as
 * a HEIGHT reduction: sheet bottom (in container coords) is computed from
 * `keyboardTopY - KEYBOARD_BOTTOM_GAP`, guaranteeing the visible sheet
 * bottom sits strictly ABOVE the keyboard top with no transform applied.
 *
 * ANIMATION: Reanimated only (no RN Animated mixing) to avoid frozen object
 * errors. Keyboard event listeners drive shared keyboard-top values which the
 * animated style reads on each frame.
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

// Resting sheet height as percentage of screen
const RESTING_HEIGHT_RATIO = 0.55;

// Threshold to consider keyboard "open" (accounts for minor fluctuations)
const KEYBOARD_OPEN_THRESHOLD = 50;

// P2-CHATROOM-SHEET-BOTTOM: Base device-independent comfort margin (px)
// between the sheet's bottom edge and the keyboard's reported top.
//
// Why so large? RN's `KeyboardEvent.endCoordinates.screenY` reports the
// top of the IME's primary key area on Android. Many OEMs (OnePlus's
// stock IME, Gboard's suggestion strip in some configurations, Samsung's
// gesture-nav floating handle) draw additional chrome ABOVE that
// coordinate that RN does not include in `endCoordinates`. KB-AUDIT
// runtime traces on OnePlus CPH2691 showed the math correctly placing
// the composer 8 px above `endCoordinates.screenY`, but user reports
// continued to show the composer obscured — i.e. the visible IME extends
// higher than the reported coordinate. This margin is applied uniformly
// (no manufacturer hardcoding) and is intentionally generous so the
// composer always clears OEM IME chrome.
//
// At runtime the effective gap is `KEYBOARD_BOTTOM_GAP + insets.bottom`
// (the latter is the gesture-nav area, which on devices with a software
// nav button is 0). Applied as a HEIGHT reduction (not a transform).
const KEYBOARD_BOTTOM_GAP = 40;

function getScreenBottomY(): number {
  return Dimensions.get('screen').height;
}

function resolveKeyboardTopY(event: any): number {
  const screenBottomY = getScreenBottomY();
  const screenY = event?.endCoordinates?.screenY;
  if (
    typeof screenY === 'number' &&
    Number.isFinite(screenY) &&
    screenY > 0 &&
    screenY < screenBottomY
  ) {
    return Math.max(0, Math.min(screenBottomY, screenY));
  }

  const height = event?.endCoordinates?.height;
  if (typeof height === 'number' && Number.isFinite(height) && height > 0) {
    return Math.max(0, screenBottomY - height);
  }

  return screenBottomY;
}

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
  const restingHeight = getScreenBottomY() * RESTING_HEIGHT_RATIO;

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

  // KEYBOARD FIX: Use keyboard event listeners instead of useAnimatedKeyboard().
  // Store the keyboard top screen coordinate so the sheet can sit directly
  // above it without depending on device-specific height/window math.
  const keyboardTopY = useSharedValue(getScreenBottomY());
  const screenBottomY = useSharedValue(getScreenBottomY());

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
      const screenBottom = getScreenBottomY();
      const offsetFromScreenBottom = screenBottom - containerBottomY;

      // Update shared values (accessible from UI thread in useAnimatedStyle)
      screenBottomY.value = screenBottom;
      containerBottomOffset.value = offsetFromScreenBottom;
      containerHeight.value = height;
      containerY.value = y;
    });
  }, [containerBottomOffset, containerHeight, containerY, screenBottomY]);

  // KEYBOARD FIX: Track keyboard state via event listeners (reliable on all Android devices)
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const handleKeyboardShow = (e: any) => {
      const screenBottom = getScreenBottomY();
      const keyboardTop = resolveKeyboardTopY(e);
      screenBottomY.value = screenBottom;
      // Animate to the keyboard top for smooth sheet transition.
      keyboardTopY.value = withTiming(keyboardTop, { duration: 250 });
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
            const measuredScreenBottom = getScreenBottomY();
            screenBottomY.value = measuredScreenBottom;
            containerBottomOffset.value = measuredScreenBottom - containerBottomY;
            containerHeight.value = h;
            containerY.value = y;
          });
        });
      }
    };

    const handleKeyboardHide = () => {
      // Animate back to the screen bottom for smooth sheet return.
      const screenBottom = getScreenBottomY();
      screenBottomY.value = screenBottom;
      keyboardTopY.value = withTiming(screenBottom, { duration: 200 });
      setIsKeyboardOpen(false);
    };

    const showSub = Keyboard.addListener(showEvent, handleKeyboardShow);
    const hideSub = Keyboard.addListener(hideEvent, handleKeyboardHide);

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [
    keyboardTopY,
    screenBottomY,
    containerBottomOffset,
    containerHeight,
    containerY,
  ]);

  // Safe area top for expanded mode calculations
  const safeTop = insets.top;

  // P0 GAP FIX: Animated style with measured offset correction
  // Always use absolute positioning for consistent behavior.
  // In resting mode: position at bottom with fixed height.
  // In keyboard mode: shrink height so sheet bottom stays above keyboard.
  const animatedSheetStyle = useAnimatedStyle(() => {
    const keyboardTop = keyboardTopY.value;
    const screenBottom = screenBottomY.value;
    const cHeight = containerHeight.value;
    const cY = containerY.value;
    const isOpen = screenBottom - keyboardTop > KEYBOARD_OPEN_THRESHOLD;

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
      // KEYBOARD OPEN: Anchor sheet bottom strictly ABOVE the keyboard.
      //
      // P2-CHATROOM-SHEET-BOTTOM: Visible sheet bottom (screen coords) is
      // pinned at `keyboardTop - KEYBOARD_BOTTOM_GAP`. We convert to
      // container coords by subtracting `cY` (the container's screen-Y
      // origin, which can be negative when the sheet sits inside an
      // absoluteFillObject parent above the safe-area top inset). The
      // sheet keeps its resting height unless that would push the top
      // edge above `safeTop + 8`, in which case we clamp the top and the
      // height shrinks accordingly.
      //
      // No transform is applied — height alone enforces the gap, so
      // double-correction with `translateY` cannot push the sheet's
      // actual bottom edge below the keyboard on any OEM.
      const visibleScreenBottom = keyboardTop - KEYBOARD_BOTTOM_GAP;
      const sheetBottom = Math.max(0, visibleScreenBottom - cY);

      // Sheet top if it kept restingHeight with its bottom flush above the
      // keyboard, clamped against the safe-area top (+8px breathing room).
      const idealSheetTop = sheetBottom - restingHeight;
      const minSheetTop = Math.max(0, safeTop + 8 - cY);
      const sheetTop = Math.min(sheetBottom, Math.max(minSheetTop, idealSheetTop));

      // Sheet keeps `restingHeight` unless clamped against the safe area;
      // then it shrinks to occupy the visible band above the keyboard.
      const sheetHeight = Math.max(0, sheetBottom - sheetTop);

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
