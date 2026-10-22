/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export const TRAIN_STATION_PRESETS: Record<
  string,
  { id: number; nameFa: string; slug: string }
> = {
  tehran: { id: 1, nameFa: 'تهران', slug: 'tehran' },
  mashhad: { id: 191, nameFa: 'مشهد', slug: 'mashhad' },
  isfahan: { id: 25, nameFa: 'اصفهان', slug: 'isfahan' },
  shiraz: { id: 61, nameFa: 'شیراز', slug: 'shiraz' },
  tabriz: { id: 3, nameFa: 'تبریز', slug: 'tabriz' },
  ahvaz: { id: 13, nameFa: 'اهواز', slug: 'ahvaz' },
};

export function resolveTrainRouteSlug(originStationId: number, destinationStationId: number): string {
  const byId = Object.values(TRAIN_STATION_PRESETS);
  const from = byId.find((s) => s.id === originStationId)?.slug ?? `station-${originStationId}`;
  const to = byId.find((s) => s.id === destinationStationId)?.slug ?? `station-${destinationStationId}`;
  return `${from}-${to}`;
}

/** کد مسیر در URL قاصدک (مثلاً tehran، mashhad) */
export function resolveTrainStationCode(stationId: number): string {
  const entry = Object.values(TRAIN_STATION_PRESETS).find((s) => s.id === stationId);
  return entry?.slug ?? `station-${stationId}`;
}
