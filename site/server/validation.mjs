export class ApiError extends Error {
  constructor(status, code, message = code) { super(message); this.status = status; this.code = code; }
}
export function requireThat(condition, code, status = 400) {
  if (!condition) throw new ApiError(status, code);
}
export function object(value) {
  requireThat(value && typeof value === 'object' && !Array.isArray(value), 'invalid_body');
  return value;
}
export function string(value, max = 1000, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  requireThat(typeof value === 'string' && value.length <= max && !value.includes('\0'), 'invalid_text');
  return value;
}
export function number(value, min, max, optional = false, integer = false) {
  if (optional && (value === undefined || value === null)) return null;
  requireThat(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value)), 'invalid_number');
  return value;
}
export function id(value) {
  requireThat(typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value), 'invalid_id');
  return value;
}
export function mode(value) { requireThat(['demo', 'real'].includes(value), 'invalid_mode'); return value; }
export function timestamp(value) {
  requireThat(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)), 'invalid_date');
  return new Date(value).toISOString();
}
export const ranges = {waterMl: [0, 10000], raw: [0, 65535], moisture: [0, 100], temperature: [-20, 60], humidity: [0, 100], lux: [0, 200000], weight: [0, 100000]};
export function metrics(body) {
  return Object.fromEntries(Object.entries(ranges).map(([key, bounds]) => [key, number(body[key], ...bounds, true, key === 'raw')]));
}
