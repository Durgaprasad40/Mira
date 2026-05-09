/**
 * Phase-3 Background Crossed Paths — deferred flush task definition.
 *
 * This task never requests location and never starts tracking. When the OS
 * gives Mira a best-effort background wake, it only tries to flush samples
 * already buffered by `tasks/backgroundLocationTask.ts`.
 */
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { BACKGROUND_FLUSH_TASK_NAME } from '@/lib/backgroundCrossedPaths';
import { flushBufferedBackgroundSamplesFromStoredSession } from '@/lib/backgroundCrossedPathsFlush';
import { recordBgCrossedPathsBreadcrumb } from '@/lib/backgroundCrossedPathsTelemetry';

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
