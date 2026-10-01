export type WorldId = 'pelagic' | 'styx' | 'y2k' | 'hydros' | 'raymarch';

export const worldNames: Record<WorldId, string> = {
  pelagic: 'PELAGIC / FIELD STUDY',
  styx: 'STYX / METALHEART',
  y2k: 'Y2K / DREAM CIRCUIT',
  hydros: 'HYDROS / BLUE HOUR',
  raymarch: 'SDF / GHOST CIRCUIT',
};

export function isWorldId(value: unknown): value is WorldId {
  return value === 'pelagic' || value === 'styx' || value === 'y2k' || value === 'hydros' || value === 'raymarch';
}
