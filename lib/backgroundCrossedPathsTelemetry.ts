import { trackEvent } from '@/lib/sentry';

type SafeTelemetryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | string[]
  | number[];

const BLOCKED_KEY_RE = /(lat|lng|coord|token|secret|password|email|phone|auth|devicehash|userid)/i;

function normalizeTelemetryValue(value: unknown): SafeTelemetryValue {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    return value;
  }
  if (typeof value === 'string') {
    return value.length > 80 ? `${value.slice(0, 77)}...` : value;
  }
  if (Array.isArray(value)) {
    const safe = value
      .filter((item) => typeof item === 'string' || typeof item === 'number')
      .slice(0, 8) as string[] | number[];
    return safe;
  }
  return undefined;
}

export function recordBgCrossedPathsBreadcrumb(
  action: string,
  data: Record<string, unknown> = {},
): void {
  const safeData: Record<string, SafeTelemetryValue> = {};

  for (const [key, value] of Object.entries(data)) {
    if (BLOCKED_KEY_RE.test(key)) continue;
    const normalized = normalizeTelemetryValue(value);
    if (normalized !== undefined) {
      safeData[key] = normalized;
    }
  }

  try {
    trackEvent('background_crossed_paths', action, safeData);
  } catch {
    // Breadcrumbs must never affect app behavior.
  }

  if (__DEV__) {
    console.log(`[BG_BREADCRUMB] ${action}`, safeData);
  }
}
