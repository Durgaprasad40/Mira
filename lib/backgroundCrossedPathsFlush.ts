import { ConvexHttpClient } from 'convex/browser';
import { Platform } from 'react-native';
import { api } from '@/convex/_generated/api';
import {
  BG_CROSSED_PATHS_FEATURE_READY,
  getLocalBackgroundCrossedPathsEnabled,
} from '@/lib/backgroundCrossedPaths';
import { getOrCreateInstallId } from '@/lib/deviceFingerprint';
import { getAuthBootCache } from '@/stores/authBootCache';
import {
  backgroundLocationBuffer,
  type BufferedSample,
} from '@/stores/backgroundLocationBufferStore';
import { recordBgCrossedPathsBreadcrumb } from '@/lib/backgroundCrossedPathsTelemetry';
import { captureException as sentryCaptureException } from '@/lib/sentry';

const FLUSH_BATCH_LIMIT = 50;
const SENTRY_THROTTLE_MS = 10 * 60 * 1000;
const sentryLastCapturedAt = new Map<string, number>();

export type BackgroundFlushResult = {
  flushed: number;
  accepted: number;
  skipped: boolean;
  reason?: string;
};

type RecordLocationBatchResult = {
  success?: boolean;
  accepted?: number;
  reason?: string;
};

export type RecordLocationBatchUploader = (args: {
  userId: string;
  samples: BufferedSample[];
  deviceHash: string;
}) => Promise<RecordLocationBatchResult | undefined>;

function isTransientFlushReason(reason: string | undefined): boolean {
  return (
    reason === 'rate_limited' ||
    reason === 'rate_limited_short' ||
    reason === 'rate_limited_daily' ||
    reason === 'feature_not_ready' ||
    reason === 'feature_disabled_server' ||
    reason === 'consent_required' ||
    reason === 'bg_consent_required' ||
    reason === 'background_consent_required'
  );
}

function normalizeServerBackgroundReason(reason: string | undefined | null):
  | 'feature_disabled_server'
  | 'consent_required'
  | null {
  if (reason === 'feature_not_ready' || reason === 'feature_disabled_server') {
    return 'feature_disabled_server';
  }
  if (
    reason === 'consent_required' ||
    reason === 'bg_consent_required' ||
    reason === 'background_consent_required'
  ) {
    return 'consent_required';
  }
  return null;
}

function captureFlushBlockOnce(reason: string): void {
  const key = `flush_background_samples:${reason}`;
  const now = Date.now();
  const lastCapturedAt = sentryLastCapturedAt.get(key) ?? 0;
  if (now - lastCapturedAt < SENTRY_THROTTLE_MS) return;
  sentryLastCapturedAt.set(key, now);

  try {
    sentryCaptureException(new Error(`Nearby background flush blocked: ${reason}`), {
      tags: {
        area: 'nearby',
        feature: 'background_crossed_paths',
        action: 'flush_background_samples',
        reason,
        platform: Platform.OS,
      },
      level: 'warning',
    });
  } catch {}
}

function logFlushSkipped(logPrefix: string, reason: string): void {
  recordBgCrossedPathsBreadcrumb('flush_skipped', { reason });
  if (__DEV__) console.log(`[${logPrefix}] skipped reason=${reason}`);
}

export async function flushBufferedBackgroundSamples(args: {
  userId: string | null | undefined;
  token: string | null | undefined;
  uploadBatch: RecordLocationBatchUploader;
  logPrefix?: string;
  requireLocalEnablement?: boolean;
}): Promise<BackgroundFlushResult> {
  const logPrefix = args.logPrefix ?? 'BG_FLUSH_TASK';

  if (!BG_CROSSED_PATHS_FEATURE_READY) {
    logFlushSkipped(logPrefix, 'feature_not_ready');
    return { flushed: 0, accepted: 0, skipped: true, reason: 'feature_not_ready' };
  }

  if (args.requireLocalEnablement !== false) {
    const locallyEnabled = await getLocalBackgroundCrossedPathsEnabled();
    if (!locallyEnabled) {
      logFlushSkipped(logPrefix, 'locally_disabled');
      return { flushed: 0, accepted: 0, skipped: true, reason: 'locally_disabled' };
    }
  }

  const userId = typeof args.userId === 'string' ? args.userId.trim() : '';
  const token = typeof args.token === 'string' ? args.token.trim() : '';
  if (!userId || !token) {
    logFlushSkipped(logPrefix, 'not_authenticated');
    return { flushed: 0, accepted: 0, skipped: true, reason: 'not_authenticated' };
  }

  const pending = backgroundLocationBuffer.getPending();
  if (pending.length === 0) {
    logFlushSkipped(logPrefix, 'empty');
    return { flushed: 0, accepted: 0, skipped: true, reason: 'empty' };
  }

  const slice = pending.slice(0, FLUSH_BATCH_LIMIT);
  const sources = Array.from(new Set(slice.map((sample) => sample.source)));
  try {
    const deviceHash = await getOrCreateInstallId();
    const res = await args.uploadBatch({
      userId,
      samples: slice,
      deviceHash,
    });
    const reason = res?.reason;
    const accepted = typeof res?.accepted === 'number' ? res.accepted : 0;
    const retained = isTransientFlushReason(reason);
    const blockedReason = normalizeServerBackgroundReason(reason);
    if (blockedReason) {
      captureFlushBlockOnce(blockedReason);
    }
    if (!retained) {
      backgroundLocationBuffer.drainFirst(slice.length);
    }
    recordBgCrossedPathsBreadcrumb(
      retained ? 'flush_failed_retained' : 'flush_succeeded',
      {
        flushedCount: slice.length,
        acceptedCount: accepted,
        pendingCount: pending.length,
        retained,
        reason: reason ?? 'ok',
        sources,
      },
    );
    if (__DEV__) {
      console.log(`[${logPrefix}] flushed ${slice.length} samples`, {
        accepted,
        reason,
        retained,
      });
    }
    return {
      flushed: slice.length,
      accepted,
      skipped: false,
      reason,
    };
  } catch (err) {
    recordBgCrossedPathsBreadcrumb('flush_failed_retained', {
      flushedCount: 0,
      pendingCount: pending.length,
      retained: true,
      reason: 'network_error',
      sources,
    });
    if (__DEV__) {
      console.warn(`[${logPrefix}] failed reason=network_error`, (err as Error)?.message);
    }
    return { flushed: 0, accepted: 0, skipped: true, reason: 'network_error' };
  }
}

export async function flushBufferedBackgroundSamplesFromStoredSession(): Promise<BackgroundFlushResult> {
  const auth = await getAuthBootCache();
  return flushBufferedBackgroundSamples({
    userId: auth.userId,
    token: auth.token,
    logPrefix: 'BG_FLUSH_TASK',
    requireLocalEnablement: true,
    uploadBatch: async ({ userId, samples, deviceHash }) => {
      const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
      if (!convexUrl) {
        throw new Error('missing_convex_url');
      }
      const client = new ConvexHttpClient(convexUrl, {
        auth: auth.token ?? undefined,
        logger: false,
      });
      return (await client.mutation(api.crossedPaths.recordLocationBatch, {
        userId: userId as any,
        token: auth.token ?? undefined,
        samples,
        deviceHash,
      })) as RecordLocationBatchResult | undefined;
    },
  });
}
