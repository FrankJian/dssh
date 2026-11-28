/** Share an in-flight load; a rejected attempt must not poison future retries. */
export function createLazyResource<T extends object>(loader: () => Promise<T>) {
  let value: T | undefined;
  let pending: Promise<T> | undefined;
  return {
    get: () => value,
    load() {
      pending ??= Promise.resolve().then(loader).then(result => {
        value = result;
        return result;
      }).catch(error => {
        pending = undefined;
        throw error;
      });
      return pending;
    },
  };
}
