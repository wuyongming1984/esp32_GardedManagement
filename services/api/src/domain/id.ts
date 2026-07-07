const counters = new Map<string, number>();

export function createDomainId(prefix: string) {
  const next = (counters.get(prefix) ?? 0) + 1;
  counters.set(prefix, next);
  return `${prefix}-${Date.now().toString(36)}-${next.toString(36)}`;
}
