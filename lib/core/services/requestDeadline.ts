/** Bound the caller's wait even when native fetch/body reading ignores abort. */
export function requestDeadline(timeoutMs: number) {
  const controller = new AbortController();
  const error = new Error('Request timed out');
  let rejectDeadline!: (reason: Error) => void;
  const expired = new Promise<never>((_resolve, reject) => { rejectDeadline = reject; });
  // A caller can fail synchronously before starting its first stage.
  void expired.catch(() => {});
  const timer = setTimeout(() => {
    rejectDeadline(error);
    controller.abort();
  }, timeoutMs);

  return {
    signal: controller.signal,
    async wait<T>(pending: PromiseLike<T>): Promise<T> {
      // Check before continuing to the next stage: late headers must not start
      // an upload, and a late response must not update quota or a newer draft.
      if (controller.signal.aborted) {
        // Arguments are evaluated before wait(): observe a promise which may
        // already have been created by a late native callback.
        void Promise.resolve(pending).catch(() => {});
        throw error;
      }
      return Promise.race([pending, expired]);
    },
    dispose() { clearTimeout(timer); },
  };
}
