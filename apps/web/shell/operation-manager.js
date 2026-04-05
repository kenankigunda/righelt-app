const createDeferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  promise.catch(() => {});
  return { promise, resolve, reject };
};

const cloneError = (error) => {
  if (error instanceof Error) {
    return error;
  }
  const nextError = new Error(typeof error === "string" ? error : "operation_failed");
  if (error && typeof error === "object" && "code" in error) {
    nextError.code = error.code;
  }
  return nextError;
};

const createHandle = ({ id, gameId = null, result, status = "pending", error = null }) => {
  const deferred = createDeferred();
  const handle = {
    id,
    gameId,
    status,
    result,
    committed: deferred.promise,
    error,
  };
  return { deferred, handle };
};

export const createOperationManager = () => {
  const recordsById = new Map();

  const getHandle = (id) => recordsById.get(id)?.handle ?? null;

  const enqueue = ({ id, gameId = null, result }) => {
    const existing = getHandle(id);
    if (existing) {
      return existing;
    }
    const record = createHandle({ id, gameId, result, status: "pending", error: null });
    recordsById.set(id, record);
    return record.handle;
  };

  const createCommitted = ({ id, gameId = null, result }) => {
    const existing = getHandle(id);
    if (existing) {
      return existing;
    }
    const record = createHandle({ id, gameId, result, status: "committed", error: null });
    record.deferred.resolve(result);
    recordsById.set(id, record);
    return record.handle;
  };

  const createFailed = ({ id, gameId = null, result = null, error }) => {
    const existing = getHandle(id);
    if (existing) {
      return existing;
    }
    const nextError = cloneError(error);
    const record = createHandle({ id, gameId, result, status: "failed", error: nextError });
    record.deferred.reject(nextError);
    recordsById.set(id, record);
    return record.handle;
  };

  const confirm = (id, finalResult = getHandle(id)?.result ?? null) => {
    const record = recordsById.get(id);
    if (!record || record.handle.status === "committed") {
      return record?.handle ?? null;
    }
    record.handle.status = "committed";
    record.handle.result = finalResult;
    record.handle.error = null;
    record.deferred.resolve(finalResult);
    return record.handle;
  };

  const fail = (id, error) => {
    const record = recordsById.get(id);
    if (!record || record.handle.status === "failed") {
      return record?.handle ?? null;
    }
    const nextError = cloneError(error);
    record.handle.status = "failed";
    record.handle.error = nextError;
    record.deferred.reject(nextError);
    return record.handle;
  };

  const dismiss = (id) => {
    recordsById.delete(id);
  };

  const getPendingOperations = (gameId) =>
    [...recordsById.values()]
      .map((record) => record.handle)
      .filter((handle) => handle.status === "pending" && (gameId == null || handle.gameId === gameId));

  const getFailedOperations = (gameId) =>
    [...recordsById.values()]
      .map((record) => record.handle)
      .filter((handle) => handle.status === "failed" && (gameId == null || handle.gameId === gameId));

  return {
    enqueue,
    createCommitted,
    createFailed,
    confirm,
    fail,
    dismiss,
    getHandle,
    getPendingOperations,
    getFailedOperations,
  };
};
