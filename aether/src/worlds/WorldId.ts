export type WorldId = 'pelagic' | 'styx';

export const worldNames: Record<WorldId, string> = {
  pelagic: 'PELAGIC / FIELD STUDY',
  styx: 'STYX / METALHEART',
};

export function isWorldId(value: unknown): value is WorldId {
  return value === 'pelagic' || value === 'styx';
}
