/**
 * StartupCoordinator — Manages post-first-paint tasks for optimal startup performance.
 *
 * This module coordinates heavy initialization tasks to run AFTER the first usable
 * screen renders, preventing startup blocking and perceived "stuck" feeling.
 *
 * Usage:
 * 1. Call `schedulePostFirstPaint()` from the first tab screen's useEffect
 * 2. Tasks run after InteractionManager or 500ms delay (whichever is later)
 * 3. Watchdog ensures tasks complete within 3 seconds or are skipped
 *
 * SAFETY:
 * - All tasks wrapped in try/catch
 * - Watchdog prevents infinite blocking
 * - Only runs once per app session (in-memory flag)
 */
import { InteractionManager } from 'react-native';
import { markTiming } from './startupTiming';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StartupTask {
  name: string;
  fn: () => Promise<void> | void;
  critical?: boolean; // If true, log error on failure (vs silent skip)
}

interface StartupReport {
  startedAt: number;
  completedAt?: number;
  totalMs?: number;
  tasksRun: string[];
  tasksFailed: string[];
  tasksSkipped: string[];
  watchdogTriggered: boolean;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let _hasRun = false;
let _isRunning = false;
let _report: StartupReport | null = null;
let _watchdogTriggered = false;

// Configurable timeouts
const POST_PAINT_DELAY_MS = 500; // Delay after interactions settle
const WATCHDOG_TIMEOUT_MS = 3000; // Max time for all tasks
const TASK_TIMEOUT_MS = 1500; // Max time per individual task

// ---------------------------------------------------------------------------
// Task Registry
// ---------------------------------------------------------------------------

const _tasks: StartupTask[] = [];

/**
 * Register a task to run after first paint.
 * Tasks are run in registration order.
 */
export function registerStartupTask(task: StartupTask): void {
  if (_hasRun) {
    // If already run, execute immediately (late registration)
    if (__DEV__) {
      console.log(`[StartupCoordinator] Late registration: ${task.name}`);
    }
    safeRunTask(task);
    return;
  }
  _tasks.push(task);
}

/**
 * Clear all registered tasks (for testing).
 */
export function clearStartupTasks(): void {
  _tasks.length = 0;
}

// ---------------------------------------------------------------------------
// Task Execution
// ---------------------------------------------------------------------------

/**
 * Run a single task with timeout and error handling.
 */
async function safeRunTask(task: StartupTask): Promise<boolean> {
  try {
    const result = task.fn();
    if (result instanceof Promise) {
      // Race against timeout
      await Promise.race([
        result,
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('Task timeout')), TASK_TIMEOUT_MS)
        ),
      ]);
    }
    return true;
  } catch (e) {
    if (task.critical && __DEV__) {
      console.warn(`[StartupCoordinator] Task failed: ${task.name}`, e);
    }
    return false;
  }
}

/**
 * Run all registered tasks with watchdog protection.
 */
async function runAllTasks(): Promise<void> {
  if (_hasRun || _isRunning) return;
  _isRunning = true;

  const report: StartupReport = {
    startedAt: Date.now(),
    tasksRun: [],
    tasksFailed: [],
    tasksSkipped: [],
    watchdogTriggered: false,
  };
  _report = report;

  markTiming('startup_tasks_begin' as any);

  // Watchdog timer
  const watchdogPromise = new Promise<'watchdog'>((resolve) => {
    setTimeout(() => {
      _watchdogTriggered = true;
      report.watchdogTriggered = true;
      resolve('watchdog');
    }, WATCHDOG_TIMEOUT_MS);
  });

  // Run tasks sequentially
  const tasksPromise = (async () => {
    for (const task of _tasks) {
      if (_watchdogTriggered) {
        report.tasksSkipped.push(task.name);
        continue;
      }

      const success = await safeRunTask(task);
      if (success) {
        report.tasksRun.push(task.name);
      } else {
        report.tasksFailed.push(task.name);
      }
    }
    return 'done' as const;
  })();

  // Race against watchdog
  await Promise.race([tasksPromise, watchdogPromise]);

  report.completedAt = Date.now();
  report.totalMs = report.completedAt - report.startedAt;

  _hasRun = true;
  _isRunning = false;

  markTiming('startup_tasks_end' as any);

  // Log report in dev
  if (__DEV__) {
    if (report.watchdogTriggered) {
      console.warn(
        `[StartupCoordinator] WATCHDOG: Tasks exceeded ${WATCHDOG_TIMEOUT_MS}ms`,
        { skipped: report.tasksSkipped }
      );
    }
    console.log('[StartupCoordinator] Complete', {
      totalMs: report.totalMs,
      run: report.tasksRun.length,
      failed: report.tasksFailed.length,
      skipped: report.tasksSkipped.length,
    });
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Schedule startup tasks to run after first paint.
 * Call this from the first usable screen's useEffect.
 * Safe to call multiple times — only runs once.
 */
export function schedulePostFirstPaint(): void {
  if (_hasRun || _isRunning) return;

  // Wait for interactions to settle, then add a small delay
  InteractionManager.runAfterInteractions(() => {
    setTimeout(() => {
      runAllTasks();
    }, POST_PAINT_DELAY_MS);
  });
}

/**
 * Get the startup report (for debugging/instrumentation).
 */
export function getStartupReport(): StartupReport | null {
  return _report;
}

/**
 * Check if startup tasks have completed.
 */
export function hasStartupCompleted(): boolean {
  return _hasRun;
}

/**
 * Reset coordinator state (for testing only).
 */
export function resetStartupCoordinator(): void {
  _hasRun = false;
  _isRunning = false;
  _report = null;
  _watchdogTriggered = false;
  _tasks.length = 0;
}
