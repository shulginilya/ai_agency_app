import { ApiError } from '@/api/errors';

/**
 * Awaits a request that is expected to fail and returns the `ApiError`, typed.
 * Using `.catch(e => e)` instead would widen the type to `ApiError | Response`
 * and silently pass if the call ever started succeeding.
 */
export async function catchApiError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('Expected the request to reject with an ApiError, but it resolved.');
}
