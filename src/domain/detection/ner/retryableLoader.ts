export function createRetryableLoader<T>(factory: () => Promise<T>): {
  load: () => Promise<T>;
} {
  let pending: Promise<T> | undefined;

  return {
    async load() {
      const current = (pending ??= factory());

      try {
        return await current;
      } catch (error) {
        if (pending === current) {
          pending = undefined;
        }

        throw error;
      }
    },
  };
}
