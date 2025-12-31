/**
 * Sleep for a specified duration.
 * @param ms - Duration in milliseconds
 * @returns Promise that resolves after the specified duration
 * @example
 * await sleep(1000); // 等待 1 秒
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
