export const clone = <T>(value: T): T => structuredClone(value);
export const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));
export const formatFrequency = (hz: number): string =>
  hz >= 1000 ? `${+(hz / 1000).toFixed(1)}k` : `${Math.round(hz)}`;
export const signed = (value: number): string => `${value > 0 ? '+' : ''}${value.toFixed(1)}`;
export const escapeHtml = (value: unknown): string =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
export const curveRoles = ['target', 'source'] as const;
