export const lines = [];

export function log(message) {
  lines.push(message);
  globalThis.__out?.push(message);
}
