/**
 * Phase-3 Background Crossed Paths — deferred flush task definition.
 *
 * This task never requests location and never starts tracking. When the OS
 * gives Mira a best-effort background wake, it only tries to flush samples
 * already buffered by `tasks/backgroundLocationTask.ts`.
 *
 * STARTUP SAFETY:
 *   This file is side-effect-imported from `app/_layout.tsx`, which means it
 *   runs at app boot. Phase-2/dev builds may NOT include the native
 *   `expo-background-task` module. To prevent a startup crash like
 *   "Cannot find native module 'ExpoBackgroundTask'", we (a) skip the
 *   registration entirely while `BG_CROSSED_PATHS_FEATURE_READY === false`
 *   and (b) lazy-`require` `expo-background-task` so its native binding is
 *   only resolved when the feature is ON. If the require throws (native
 *   module missing), we fail-soft with a dev warning and never crash the
 *   route loader.
 */
import * as TaskManager from 'expo-task-manager';
import {
  BACKGROUND_FLUSH_TASK_NAME,
  BG_CROSSED_PATHS_FEATURE_READY,
} from '@/lib/backgroundCrossedPaths';
import { flushBufferedBackgroundSamplesFromStoredSession } from '@/lib/backgroundCrossedPathsFlush';
import { recordBgCrossedPathsBreadcrumb } from '@/lib/backgroundCrossedPathsTelemetry';

// Phase-3 OFF: do not touch the native ExpoBackgroundTask module at all.
// Registration is reserved for Phase-3 builds where the feature flag is ON
// AND the native module is bundled.
if (BG_CROSSED_PATHS_FEATURE_READY) {
  let BackgroundTaskMod: typeof import('expo-background-task') | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    BackgroundTaskMod = require('expo-background-task') as typeof import('expo-background-task');
  } catch (err) {
    BackgroundTaskMod = null;
    if (__DEV__) {
      console.warn(
        '[BG_FLUSH_TASK] expo-background-task native module unavailable; deferred flush task not defined.',
        (err as Error)?.message,
      );
    }
  }

  if (BackgroundTaskMod) {
    const BackgroundTask = BackgroundTaskMod;
    TaskManager.defineTask(BACKGROUND_FLUSH_TASK_NAME, async () => {
      try {
        const result = await flushBufferedBackgroundSamplesFromStoredSession();
        recordBgCrossedPathsBreadcrumb('deferred_flush_task_ran', {
          skipped: result.skipped,
          reason: result.reason ?? 'ok',
          flushedCount: result.flushed,
          acceptedCount: result.accepted,
        });
        if (result.skipped) {
          return BackgroundTask.BackgroundTaskResult.Success;
        }
        return BackgroundTask.BackgroundTaskResult.Success;
      } catch (err) {
        recordBgCrossedPathsBreadcrumb('deferred_flush_task_failed', {
          reason: 'unhandled',
        });
        if (__DEV__) {
          console.warn('[BG_FLUSH_TASK] failed reason=unhandled', (err as Error)?.message);
        }
        return BackgroundTask.BackgroundTaskResult.Failed;
      }
    });
  }
}
