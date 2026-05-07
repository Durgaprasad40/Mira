import AsyncStorage from '@react-native-async-storage/async-storage';

const QUEUE_STORAGE_KEY = 'mira_nearby_bg_location_queue_v1';
const MAX_QUEUE_SAMPLES = 50;
const MAX_UPLOAD_SAMPLES = 20;
const MAX_SAMPLE_AGE_MS = 6 * 60 * 60 * 1000;
const LOCATION_GRID_METERS = 300;

export type NearbyBackgroundSample = {
  lat: number;
  lng: number;
  capturedAt: number;
  accuracy?: number;
  source: 'bg' | 'fg' | 'slc';
};

type QueueWriteResult = {
  total: number;
  added: number;
  pruned: number;
};

type QueueLogMetadata = {
  trigger?: 'task' | 'foreground';
  sources?: string[];
};

type UploadBatch = {
  samples: NearbyBackgroundSample[];
  remainingSamples: NearbyBackgroundSample[];
  queuedCount: number;
  currentCount: number;
};

function metersToLatitudeDegrees(meters: number): number {
  return meters / 111_320;
}

function roundToGrid(lat: number, lng: number, gridMeters = LOCATION_GRID_METERS) {
  const latStep = metersToLatitudeDegrees(gridMeters);
  const cosLat = Math.max(0.1, Math.cos((lat * Math.PI) / 180));
  const lngStep = latStep / cosLat;

  return {
    lat: Math.round(lat / latStep) * latStep,
    lng: Math.round(lng / lngStep) * lngStep,
  };
}

function isValidSource(source: unknown): source is NearbyBackgroundSample['source'] {
  return source === 'bg' || source === 'fg' || source === 'slc';
}

function sampleKey(sample: NearbyBackgroundSample): string {
  return `${sample.capturedAt}:${sample.source}`;
}

function normalizeSample(input: unknown, now = Date.now()): NearbyBackgroundSample | null {
  if (!input || typeof input !== 'object') return null;
  const sample = input as Partial<NearbyBackgroundSample>;

  if (
    typeof sample.lat !== 'number' ||
    typeof sample.lng !== 'number' ||
    typeof sample.capturedAt !== 'number' ||
    !Number.isFinite(sample.lat) ||
    !Number.isFinite(sample.lng) ||
    !Number.isFinite(sample.capturedAt) ||
    sample.lat < -90 ||
    sample.lat > 90 ||
    sample.lng < -180 ||
    sample.lng > 180 ||
    sample.capturedAt < now - MAX_SAMPLE_AGE_MS ||
    sample.capturedAt > now + 5 * 60 * 1000 ||
    !isValidSource(sample.source)
  ) {
    return null;
  }

  const snapped = roundToGrid(sample.lat, sample.lng);
  const accuracy =
    typeof sample.accuracy === 'number' && Number.isFinite(sample.accuracy) && sample.accuracy >= 0
      ? sample.accuracy
      : undefined;

  return {
    lat: snapped.lat,
    lng: snapped.lng,
    capturedAt: Math.round(sample.capturedAt),
    accuracy,
    source: sample.source,
  };
}

function normalizeSamples(samples: unknown[], now = Date.now(), maxSamples = MAX_QUEUE_SAMPLES): {
  samples: NearbyBackgroundSample[];
  pruned: number;
} {
  const byKey = new Map<string, NearbyBackgroundSample>();
  let pruned = 0;

  for (const rawSample of samples) {
    const normalized = normalizeSample(rawSample, now);
    if (!normalized) {
      pruned += 1;
      continue;
    }
    byKey.set(sampleKey(normalized), normalized);
  }

  const normalizedSamples = Array.from(byKey.values()).sort(
    (a, b) => a.capturedAt - b.capturedAt,
  );
  const overflow = Math.max(0, normalizedSamples.length - maxSamples);

  return {
    samples: overflow > 0 ? normalizedSamples.slice(overflow) : normalizedSamples,
    pruned: pruned + overflow,
  };
}

async function readRawQueue(): Promise<unknown[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeQueue(samples: NearbyBackgroundSample[]): Promise<void> {
  if (samples.length === 0) {
    await AsyncStorage.removeItem(QUEUE_STORAGE_KEY);
    return;
  }
  await AsyncStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(samples));
}

export async function readQueuedNearbyBackgroundSamples(): Promise<NearbyBackgroundSample[]> {
  const rawSamples = await readRawQueue();
  const normalized = normalizeSamples(rawSamples);
  if (normalized.pruned > 0 || normalized.samples.length !== rawSamples.length) {
    await writeQueue(normalized.samples);
    if (__DEV__ && normalized.pruned > 0) {
      console.log('[BG_LOCATION_QUEUE] pruned', { count: normalized.pruned });
    }
  }
  return normalized.samples;
}

export async function getQueuedNearbyBackgroundSampleCount(): Promise<number> {
  const samples = await readQueuedNearbyBackgroundSamples();
  return samples.length;
}

export async function enqueueNearbyBackgroundSamples(
  samples: NearbyBackgroundSample[],
  metadata: QueueLogMetadata = {},
): Promise<QueueWriteResult> {
  const queuedSamples = await readQueuedNearbyBackgroundSamples();
  const normalized = normalizeSamples([...queuedSamples, ...samples]);
  await writeQueue(normalized.samples);

  if (__DEV__) {
    console.log('[BG_LOCATION_QUEUE] queued', {
      sampleCount: samples.length,
      queuedCount: normalized.samples.length,
      prunedCount: normalized.pruned,
      trigger: metadata.trigger,
      sources: metadata.sources,
    });
    if (normalized.pruned > 0) {
      console.log('[BG_LOCATION_QUEUE] pruned', { count: normalized.pruned });
    }
  }

  return {
    total: normalized.samples.length,
    added: samples.length,
    pruned: normalized.pruned,
  };
}

export async function replaceNearbyBackgroundSampleQueue(
  samples: NearbyBackgroundSample[],
): Promise<QueueWriteResult> {
  const normalized = normalizeSamples(samples);
  await writeQueue(normalized.samples);

  if (__DEV__ && normalized.pruned > 0) {
    console.log('[BG_LOCATION_QUEUE] pruned', { count: normalized.pruned });
  }

  return {
    total: normalized.samples.length,
    added: 0,
    pruned: normalized.pruned,
  };
}

export async function clearNearbyBackgroundSampleQueue(): Promise<void> {
  await writeQueue([]);
}

export async function buildNearbyBackgroundUploadBatch(
  currentSamples: NearbyBackgroundSample[] = [],
): Promise<UploadBatch> {
  const queuedSamples = await readQueuedNearbyBackgroundSamples();
  const normalizedCurrent = normalizeSamples(currentSamples).samples;
  const combined = normalizeSamples([...queuedSamples, ...normalizedCurrent]).samples;
  const samples = combined.slice(0, MAX_UPLOAD_SAMPLES);
  const remainingSamples = combined.slice(samples.length);

  return {
    samples,
    remainingSamples,
    queuedCount: queuedSamples.length,
    currentCount: normalizedCurrent.length,
  };
}
