import { invoke } from "@tauri-apps/api/core";

/**
 * Backend commands reject with a serialized `AppError` (`{ code, message }`)
 * rather than a JS `Error`, so `error instanceof Error` checks in the UI would
 * otherwise miss the real reason. Normalize every rejection into an `Error`
 * carrying the backend message so callers can surface it directly.
 */
export async function invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw new Error(extractErrorMessage(error));
  }
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object") {
    const record = error as { message?: unknown; code?: unknown };
    if (typeof record.message === "string" && record.message.trim()) {
      return record.message;
    }
    if (typeof record.code === "string" && record.code.trim()) {
      return record.code;
    }
  }
  return "操作失败，请稍后再试。";
}
