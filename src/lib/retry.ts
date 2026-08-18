export class HttpError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}

export function isRetryableError(err: unknown): boolean {
  if (isAbortError(err)) return false;
  if (err instanceof HttpError) {
    return err.status === 408 || err.status === 429 || err.status >= 500;
  }

  const status = (err as { status?: number })?.status;
  if (status === 400 || status === 401 || status === 403 || status === 404) return false;
  if (status === 408 || status === 429 || (typeof status === "number" && status >= 500)) {
    return true;
  }

  const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (
    message.includes("user rejected") ||
    message.includes("user denied") ||
    message.includes("no route") ||
    message.includes("no dex router")
  ) {
    return false;
  }

  return (
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("econnreset") ||
    message.includes("429") ||
    message.includes("502") ||
    message.includes("503") ||
    message.includes("504") ||
    message.includes("http 5")
  );
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export type RetryOptions = {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
  shouldRetry?: (err: unknown) => boolean;
};

/**
 * Retry a request with exponential backoff. Does not retry 4xx (except 408/429),
 * user rejections, or "no route" results.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    retries = 2,
    baseDelayMs = 250,
    maxDelayMs = 2000,
    signal,
    shouldRetry = isRetryableError,
  } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt >= retries || !shouldRetry(err)) throw err;
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      await sleep(delay, signal);
    }
  }
  throw lastError;
}

export function mergeAbortSignals(
  ...signals: Array<AbortSignal | undefined>
): AbortSignal | undefined {
  const active = signals.filter((s): s is AbortSignal => !!s);
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];
  if (typeof AbortSignal.any === "function") return AbortSignal.any(active);
  const controller = new AbortController();
  for (const signal of active) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}
