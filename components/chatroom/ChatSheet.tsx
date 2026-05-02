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
 * COMPOSER-MEASURE LIFT (P2-CHATROOM-COMPOSER-MEASURE):
 * On top of the layout-driven anchoring, we measure the composer wrapper's
 * actual screen position via `View.measureInWindow` after the keyboard opens
 * (and on wrapper layout changes). If the composer's bottom edge sits at or
 * within `COMPOSER_KEYBOARD_PADDING` of the keyboard top, we apply an extra
 * upward `translateY` on the sheet so the composer always shows visible
 * breathing room above the keyboard (or any OEM IME toolbar that wasn't
 * included in the keyboard's reported `screenY`). The lift is clamped so
 * the sheet's visible top edge never crosses above `safeTop + 8`.
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

// P2-CHATROOM-COMPOSER-MEASURE: Padding (px) we want between the composer's
// bottom edge and the keyboard's reported top. Picked at 8px so the composer
// always shows a small visible gap above the keyboard (or IME toolbar) rather
// than sitting flush against it. Applies to all OEMs equally.
const COMPOSER_KEYBOARD_PADDING = 8;

// P2-CHATROOM-COMPOSER-MEASURE: Delay (ms) after `keyboardDidShow` before we
// measure the composer's screen position. Must exceed the 250ms `withTiming`
// that animates the sheet up to the keyboard top, plus a small Android layout
// settle buffer. Used as an additional safety net beyond the `onLayout`-
// driven measurement, in case the wrapper's size doesn't change but its
// screen Y does (e.g. parent reflow).
const COMPOSER_MEASURE_DELAY_MS = 280;

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

  // P2-CHATROOM-COMPOSER-MEASURE: Extra upward shift applied via translateY on
  // the sheet whenever a real-screen measurement of the composer wrapper
  // shows its bottom edge sitting at/below the keyboard's reported top
  // (within `COMPOSER_KEYBOARD_PADDING`). Reset to 0 on keyboard hide and
  // when the sheet unmounts. Defaults to 0 so this branch is a no-op until
  // the first measurement fires.
  const composerExtraLift = useSharedValue(0);

  // P2-CHATROOM-COMPOSER-MEASURE: Callback ref + pending-measure timer for
  // the composer wrapper inside PrivateChatView. PrivateChatView attaches
  // `onComposerRef` to its inputWrapper <View>; we keep the latest node here
  // and re-measure after keyboard show / wrapper layout changes.
  const composerNodeRef = useRef<View | null>(null);
  const composerMeasureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const setComposerNodeRef = useCallback((node: View | null) => {
    composerNodeRef.current = node;
  }, []);

  // P2-CHATROOM-COMPOSER-MEASURE: Read the composer's current screen-bottom
  // and compare to `keyboardTopY`. If the wrapper sits at/within
  // `COMPOSER_KEYBOARD_PADDING` of the keyboard top, push the sheet up by
  // the missing gap so the composer shows a visible margin above the
  // keyboard (or any OEM IME toolbar that wasn't included in `screenY`).
  const measureComposerOverlap = useCallback(() => {
    const node = composerNodeRef.current;
    if (!node) return;
    node.measureInWindow((_x, y, _w, height) => {
      if (
        !Number.isFinite(y) ||
        !Number.isFinite(height) ||
        height <= 0
      ) {
        return;
      }
      const composerBottomY = y + height;
      const kbTop = keyboardTopY.value;
      const screenBottom = screenBottomY.value;
      // If the keyboard isn't actually open, don't apply any lift.
      if (screenBottom - kbTop <= KEYBOARD_OPEN_THRESHOLD) {
        composerExtraLift.value = withTiming(0, { duration: 150 });
        return;
      }
      // Required lift: composer should sit at least COMPOSER_KEYBOARD_PADDING
      // above the keyboard top. If composerBottomY > kbTop - padding, lift by
      // (composerBottomY - kbTop + padding).
      const overlap =
        composerBottomY - (kbTop - COMPOSER_KEYBOARD_PADDING);
      if (overlap > 0) {
        composerExtraLift.value = withTiming(overlap, { duration: 180 });
      } else {
        composerExtraLift.value = withTiming(0, { duration: 180 });
      }
    });
  }, [composerExtraLift, keyboardTopY, screenBottomY]);

  const scheduleComposerMeasure = useCallback(
    (delayMs: number) => {
      if (composerMeasureTimerRef.current) {
        clearTimeout(composerMeasureTimerRef.current);
      }
      composerMeasureTimerRef.current = setTimeout(() => {
        composerMeasureTimerRef.current = null;
        measureComposerOverlap();
      }, delayMs);
    },
    [measureComposerOverlap],
  );

  // P2-CHATROOM-COMPOSER-MEASURE: PrivateChatView forwards the wrapper's
  // onLayout to this handler. While the keyboard is open, a wrapper height
  // change (e.g. multi-line input growth, mute notice appearing) means our
  // last measurement is stale -> re-measure on next frame.
  const handleComposerLayout = useCallback(() => {
    // Use a short delay to let layout settle before measuring.
    scheduleComposerMeasure(50);
  }, [scheduleComposerMeasure]);

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

      // P2-CHATROOM-COMPOSER-MEASURE: Schedule a measurement after the
      // 250ms sheet animation settles. If the composer's actual screen
      // bottom is at/below the keyboard top (within
      // COMPOSER_KEYBOARD_PADDING), we apply an additional translateY lift.
      scheduleComposerMeasure(COMPOSER_MEASURE_DELAY_MS);
    };

    const handleKeyboardHide = () => {
      // Animate back to the screen bottom for smooth sheet return.
      const screenBottom = getScreenBottomY();
      screenBottomY.value = screenBottom;
      keyboardTopY.value = withTiming(screenBottom, { duration: 200 });
      setIsKeyboardOpen(false);

      // P2-CHATROOM-COMPOSER-MEASURE: Cancel any pending measurement and
      // release the extra lift; the sheet returns to its resting layout.
      if (composerMeasureTimerRef.current) {
        clearTimeout(composerMeasureTimerRef.current);
        composerMeasureTimerRef.current = null;
      }
      composerExtraLift.value = withTiming(0, { duration: 200 });
    };

    const showSub = Keyboard.addListener(showEvent, handleKeyboardShow);
    const hideSub = Keyboard.addListener(hideEvent, handleKeyboardHide);

    return () => {
      showSub.remove();
      hideSub.remove();
      // P2-CHATROOM-COMPOSER-MEASURE: Cancel any pending measure on unmount.
      if (composerMeasureTimerRef.current) {
        clearTimeout(composerMeasureTimerRef.current);
        composerMeasureTimerRef.current = null;
      }
    };
  }, [
    keyboardTopY,
    screenBottomY,
    containerBottomOffset,
    containerHeight,
    containerY,
    composerExtraLift,
    scheduleComposerMeasure,
  ]);

  // Safe area top for expanded mode calculations
  const safeTop = insets.top;

  // P0 GAP FIX: Animated style with measured offset correction
  // Always use absolute positioning for consistent behavior.
  // In resting mode: position at bottom with fixed height.
  // In keyboard mode: EXPAND UPWARD to use available space, keep bottom anchored to keyboard.
  const animatedSheetStyle = useAnimatedStyle(() => {
    const keyboardTop = keyboardTopY.value;
    const screenBottom = screenBottomY.value;
    const offset = containerBottomOffset.value;
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
        // P2-CHATROOM-COMPOSER-MEASURE: lift is 0 here (no measurement yet),
        // but we still apply the transform so style merging stays consistent
        // with the keyboard-open branch.
        transform: [{ translateY: 0 }],
      };
    }

    // CONSISTENT POSITIONING FIX: Always use top + height in both modes
    // This prevents stale 'top' values from persisting when switching modes
    // (Reanimated merges styles, so unused properties aren't cleared)

    if (isOpen) {
      // KEYBOARD OPEN: BLOCK-LIFT (decoupled from container resize).
      //
      // Lift the entire sheet upward as a single block, anchoring its
      // BOTTOM edge flush above the keyboard's top screen coordinate. The
      // sheet only shrinks when the keyboard is so tall that lifting
      // `restingHeight` would push it above the safe-area top.
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
      // container in time on every Android OEM/release build, so cHeight
      // can stay at the pre-keyboard value. The keyboard event's `screenY`
      // is the keyboard top; `cY` is the container's top in the same screen
      // coordinate space, so converting to a container-relative `top`
      // stays correct without subtracting keyboard height from a stale
      // window/screen height.
      const visibleScreenBottom = keyboardTop;

      // Convert the keyboard top to container-relative bottom first. This
      // keeps the sheet bottom flush with the keyboard even if Android reports
      // a non-zero container Y after resize.
      const sheetBottom = Math.max(0, visibleScreenBottom - cY);

      // Sheet top if it kept restingHeight with its bottom flush above the
      // keyboard, clamped against the safe-area top (+8px breathing room).
      const idealSheetTop = sheetBottom - restingHeight;
      const minSheetTop = Math.max(0, safeTop + 8 - cY);
      const sheetTop = Math.min(sheetBottom, Math.max(minSheetTop, idealSheetTop));

      // Sheet keeps `restingHeight` unless clamped against the safe area;
      // then it shrinks to occupy the visible band above the keyboard.
      const sheetHeight = Math.max(0, sheetBottom - sheetTop);

      // Suppress unused-value warning — `offset` is kept tracked for
      // potential future use, but the new math does not consume it.
      void offset;
      void cHeight;

      // P2-CHATROOM-COMPOSER-MEASURE: Apply the measured composer-overlap
      // lift on top of the layout-driven `sheetTop`. Clamp so the sheet's
      // visible top edge never crosses above `safeTop + 8` in screen coords.
      // Visible top in screen coords = sheetTop + cY - lift.
      const rawLift = composerExtraLift.value;
      const visibleTopScreen = sheetTop + cY;
      const maxLift = Math.max(0, visibleTopScreen - (safeTop + 8));
      const clampedLift = Math.max(0, Math.min(rawLift, maxLift));

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
        transform: [{ translateY: -clampedLift }],
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
        // P2-CHATROOM-COMPOSER-MEASURE: At rest the lift should be 0 (we
        // reset it on keyboardDidHide), but we still emit the transform so
        // Reanimated style merging stays consistent across mode changes.
        transform: [{ translateY: 0 }],
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
                // P2-CHATROOM-COMPOSER-MEASURE: PrivateChatView attaches
                // these to its inputWrapper <View> in modal mode so we can
                // measure the composer's screen position and lift the sheet
                // when an OEM IME overlaps it.
                onComposerRef: setComposerNodeRef,
                onComposerLayout: handleComposerLayout,
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
