export type ApiErrorResponse = {
  message: string;
};

export function apiError(message: string): ApiErrorResponse {
  return { message };
}
