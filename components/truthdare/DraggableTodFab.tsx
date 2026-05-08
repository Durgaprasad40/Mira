import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  LayoutChangeEvent,
  PanResponder,
  StyleProp,
  StyleSheet,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';

type FabPosition = {
  x: number;
  y: number;
};

type ContainerSize = {
  width: number;
  height: number;
};

type Props = {
  storageKey: string;
  buttonSize: number;
  defaultRight: number;
  defaultBottom: number;
  topInset: number;
  bottomInset: number;
  positionStyle: StyleProp<ViewStyle>;
  touchableStyle?: StyleProp<ViewStyle>;
  activeOpacity?: number;
  accessibilityLabel?: string;
  onPress: () => void;
  children: React.ReactNode;
};

export const PHASE2_TOD_FAB_STORAGE_KEYS = {
  mainList: 'mira:phase2-truth-dare:fab:main-list:v1',
  promptThread: 'mira:phase2-truth-dare:fab:prompt-thread:v1',
} as const;

const EDGE_INSET = 8;
const DRAG_MOVE_THRESHOLD = 5;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isSamePosition(a: FabPosition, b: FabPosition): boolean {
  return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;
}

function parseStoredPosition(raw: string | null): FabPosition | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<FabPosition>;
    if (
      typeof parsed.x === 'number' &&
      Number.isFinite(parsed.x) &&
      typeof parsed.y === 'number' &&
      Number.isFinite(parsed.y)
    ) {
      return { x: parsed.x, y: parsed.y };
    }
  } catch {
    // Ignore corrupt local UI preferences and fall back to the default spot.
  }

  return null;
}

export function DraggableTodFab({
  storageKey,
  buttonSize,
  defaultRight,
  defaultBottom,
  topInset,
  bottomInset,
  positionStyle,
  touchableStyle,
  activeOpacity = 0.85,
  accessibilityLabel,
  onPress,
  children,
}: Props) {
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const positionRef = useRef<FabPosition | null>(null);
  const storedPositionRef = useRef<FabPosition | null>(null);
  const containerSizeRef = useRef<ContainerSize | null>(null);
  const dragStartRef = useRef<FabPosition>({ x: 0, y: 0 });
  const didDragRef = useRef(false);
  const suppressNextPressRef = useRef(false);
  const positionReadyRef = useRef(false);
  const [containerSize, setContainerSize] = useState<ContainerSize | null>(null);
  const [storageLoaded, setStorageLoaded] = useState(false);
  const [positionReady, setPositionReady] = useState(false);

  const sideMargin = Math.max(EDGE_INSET, defaultRight);

  const getDefaultPosition = useCallback(
    (size: ContainerSize): FabPosition => ({
      x: size.width - buttonSize - defaultRight,
      y: size.height - buttonSize - defaultBottom,
    }),
    [buttonSize, defaultBottom, defaultRight]
  );

  const clampPosition = useCallback(
    (position: FabPosition, size: ContainerSize): FabPosition => {
      const maxX = Math.max(sideMargin, size.width - buttonSize - sideMargin);
      const minY = Math.max(EDGE_INSET, topInset);
      const maxY = Math.max(minY, size.height - buttonSize - bottomInset);

      return {
        x: clamp(position.x, sideMargin, maxX),
        y: clamp(position.y, minY, maxY),
      };
    },
    [bottomInset, buttonSize, sideMargin, topInset]
  );

  const snapPosition = useCallback(
    (position: FabPosition, size: ContainerSize): FabPosition => {
      const clamped = clampPosition(position, size);
      const rightX = Math.max(sideMargin, size.width - buttonSize - sideMargin);
      const buttonCenterX = clamped.x + buttonSize / 2;

      return {
        x: buttonCenterX < size.width / 2 ? sideMargin : rightX,
        y: clamped.y,
      };
    },
    [buttonSize, clampPosition, sideMargin]
  );

  const persistPosition = useCallback(
    (position: FabPosition) => {
      AsyncStorage.setItem(storageKey, JSON.stringify(position)).catch(() => {});
    },
    [storageKey]
  );

  const applyPosition = useCallback(
    (position: FabPosition, animated = false) => {
      positionRef.current = position;
      if (animated) {
        Animated.spring(pan, {
          toValue: position,
          useNativeDriver: false,
          speed: 24,
          bounciness: 0,
        }).start(() => {
          pan.setValue(position);
        });
      } else {
        pan.setValue(position);
      }
      if (!positionReadyRef.current) {
        positionReadyRef.current = true;
        setPositionReady(true);
      }
    },
    [pan]
  );

  const resolveCurrentPosition = useCallback(() => {
    if (positionRef.current) return positionRef.current;
    const size = containerSizeRef.current;
    if (!size) return { x: 0, y: 0 };
    return clampPosition(getDefaultPosition(size), size);
  }, [clampPosition, getDefaultPosition]);

  useEffect(() => {
    let cancelled = false;

    setStorageLoaded(false);
    storedPositionRef.current = null;
    positionRef.current = null;
    positionReadyRef.current = false;
    setPositionReady(false);

    AsyncStorage.getItem(storageKey)
      .then((raw) => {
        if (cancelled) return;
        storedPositionRef.current = parseStoredPosition(raw);
      })
      .catch(() => {
        if (cancelled) return;
        storedPositionRef.current = null;
      })
      .finally(() => {
        if (!cancelled) {
          setStorageLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  useEffect(() => {
    if (!containerSize || !storageLoaded) return;

    const target =
      positionRef.current ?? storedPositionRef.current ?? getDefaultPosition(containerSize);
    const snapped = snapPosition(target, containerSize);

    applyPosition(snapped);

    if (storedPositionRef.current && !isSamePosition(storedPositionRef.current, snapped)) {
      storedPositionRef.current = snapped;
      persistPosition(snapped);
    }
  }, [
    applyPosition,
    containerSize,
    getDefaultPosition,
    persistPosition,
    snapPosition,
    storageLoaded,
  ]);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width <= 0 || height <= 0) return;

    const nextSize = { width, height };
    containerSizeRef.current = nextSize;
    setContainerSize((prev) => {
      if (prev && prev.width === width && prev.height === height) {
        return prev;
      }
      return nextSize;
    });
  }, []);

  const finishDrag = useCallback(() => {
    const size = containerSizeRef.current;
    if (size && didDragRef.current) {
      const finalPosition = snapPosition(resolveCurrentPosition(), size);
      applyPosition(finalPosition, true);
      storedPositionRef.current = finalPosition;
      persistPosition(finalPosition);
    }
  }, [applyPosition, persistPosition, resolveCurrentPosition, snapPosition]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_, gestureState) =>
          Math.hypot(gestureState.dx, gestureState.dy) > DRAG_MOVE_THRESHOLD,
        onMoveShouldSetPanResponderCapture: (_, gestureState) =>
          Math.hypot(gestureState.dx, gestureState.dy) > DRAG_MOVE_THRESHOLD,
        onPanResponderGrant: (_, gestureState) => {
          didDragRef.current = true;
          suppressNextPressRef.current = true;
          const startPosition = resolveCurrentPosition();
          dragStartRef.current = startPosition;
          const size = containerSizeRef.current;
          if (size) {
            const nextPosition = clampPosition(
              {
                x: startPosition.x + gestureState.dx,
                y: startPosition.y + gestureState.dy,
              },
              size
            );
            positionRef.current = nextPosition;
            pan.setValue(nextPosition);
          }
        },
        onPanResponderMove: (_, gestureState) => {
          const size = containerSizeRef.current;
          if (!size) return;

          const nextPosition = clampPosition(
            {
              x: dragStartRef.current.x + gestureState.dx,
              y: dragStartRef.current.y + gestureState.dy,
            },
            size
          );
          positionRef.current = nextPosition;
          pan.setValue(nextPosition);
        },
        onPanResponderRelease: finishDrag,
        onPanResponderTerminate: finishDrag,
      }),
    [clampPosition, finishDrag, pan, resolveCurrentPosition]
  );

  const handlePressIn = useCallback(() => {
    didDragRef.current = false;
    suppressNextPressRef.current = false;
  }, []);

  const handlePress = useCallback(() => {
    if (suppressNextPressRef.current || didDragRef.current) {
      suppressNextPressRef.current = false;
      didDragRef.current = false;
      return;
    }

    onPress();
  }, [onPress]);

  const draggablePositionStyle = positionReady
    ? {
        left: pan.x,
        top: pan.y,
        right: undefined,
        bottom: undefined,
      }
    : null;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFillObject} onLayout={handleLayout}>
      <Animated.View
        {...panResponder.panHandlers}
        style={[positionStyle, draggablePositionStyle]}
      >
        <TouchableOpacity
          style={touchableStyle}
          onPress={handlePress}
          onPressIn={handlePressIn}
          activeOpacity={activeOpacity}
          accessibilityLabel={accessibilityLabel}
        >
          {children}
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}
