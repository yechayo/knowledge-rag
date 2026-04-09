/**
 * 指数退避重试工具函数
 * Agent 防死循环系统的第6道防线（网络层防死循环）
 */

export interface RetryOptions {
  maxRetries: number;      // 默认 3
  baseDelayMs: number;     // 默认 500
  maxDelayMs: number;      // 默认 32_000
  jitterFactor: number;    // 默认 0.25
  signal?: AbortSignal;
}

/**
 * 检查错误是否不可重试
 */
function isNonRetryableError(err: any): boolean {
  // 4xx 错误（除了 429）不可重试
  if (err?.status && typeof err.status === 'number') {
    return err.status >= 400 && err.status < 500 && err.status !== 429;
  }

  // 如果错误有 response 对象，检查其状态码
  if (err?.response?.status) {
    const status = err.response.status;
    return status >= 400 && status < 500 && status !== 429;
  }

  // DOMException，通常是 AbortError 或网络相关错误
  if (err instanceof DOMException) {
    // AbortError 可以重试（在检查到 abort 后会抛出新的错误）
    return false;
  }

  // TypeError 通常是网络错误，可以重试
  if (err instanceof TypeError) {
    return false;
  }

  // 其他错误（普通 Error 等）：默认可重试
  // 只有明确的 4xx 非429 才不可重试
  return false;
}

/**
 * 计算重试延迟时间
 */
function calculateDelay(attempt: number, opts: RetryOptions): number {
  const exponentialDelay = opts.baseDelayMs * Math.pow(2, attempt);
  const cappedDelay = Math.min(exponentialDelay, opts.maxDelayMs);

  // 添加抖动：0 到 jitterFactor * cappedDelay 之间的随机数
  const jitter = Math.random() * opts.jitterFactor * cappedDelay;

  return cappedDelay + jitter;
}

/**
 * sleep 函数，支持 AbortSignal
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    const timeoutId = setTimeout(() => {
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
      } else {
        resolve();
      }
    }, ms);

    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timeoutId);
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    }
  });
}

/**
 * 指数退避重试函数
 *
 * @param fn 要执行的异步函数
 * @param options 重试选项
 * @returns Promise<T> 执行结果
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options?: Partial<RetryOptions>
): Promise<T> {
  // 合并默认选项
  const opts: RetryOptions = {
    maxRetries: 3,
    baseDelayMs: 500,
    maxDelayMs: 32_000,
    jitterFactor: 0.25,
    ...options
  };

  let lastError: any;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    // 每次执行前检查是否已中止
    if (opts.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    try {
      // 执行函数
      const result = await fn();
      return result;
    } catch (error) {
      lastError = error;

      // 检查是否已中止
      if (opts.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      // 检查是否是最后一次尝试
      if (attempt === opts.maxRetries) {
        break;
      }

      // 检查错误是否可重试
      if (isNonRetryableError(error)) {
        throw error;
      }

      // 计算延迟时间
      const delay = calculateDelay(attempt, opts);

      // 执行延迟（支持中止）
      await sleep(delay, opts.signal);
    }
  }

  // 所有尝试都失败，抛出最后的错误
  throw lastError;
}