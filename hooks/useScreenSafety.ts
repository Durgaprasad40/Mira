import { useCallback, useEffect, useRef } from 'react';
import { useFocusEffect } from 'expo-router';

/**
 * Hook that provides safe timer/listener utilities.
 * All timers are automatically cleaned up when the screen blurs or unmounts.
 */
export function useScreenSafety() {
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const intervalsRef = useRef<Set<ReturnType<typeof setInterval>>>(new Set());

  const clearAll = useCallback(() => {
    timersRef.current.forEach((id) => clearTimeout(id));
    timersRef.current.clear();
    intervalsRef.current.forEach((id) => clearInterval(id));
    intervalsRef.current.clear();
  }, []);

  // Clear on blur
  useFocusEffect(
    useCallback(() => {
      return () => {
        clearAll();
      };
    }, [clearAll]),
  );

  // Clear on unmount
  useEffect(() => {
    return () => {
      clearAll();
    };
  }, [clearAll]);

  const safeTimeout = useCallback(
    (fn: () => void, ms: number) => {
      const id = setTimeout(() => {
        timersRef.current.delete(id);
        fn();
      }, ms);
      timersRef.current.add(id);
      return id;
    },
    [],
  );

  const safeInterval = useCallback(
    (fn: () => void, ms: number) => {
      const id = setInterval(fn, ms);
      intervalsRef.current.add(id);
      return id;
    },
    [],
  );

  const clearSafeTimeout = useCallback((id: ReturnType<typeof setTimeout>) => {
    clearTimeout(id);
    timersRef.current.delete(id);
  }, []);

  const clearSafeInterval = useCallback((id: ReturnType<typeof setInterval>) => {
    clearInterval(id);
    intervalsRef.current.delete(id);
  }, []);

  return { safeTimeout, safeInterval, clearSafeTimeout, clearSafeInterval };
}
