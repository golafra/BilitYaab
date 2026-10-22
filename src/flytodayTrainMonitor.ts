/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import axios, { AxiosInstance } from 'axios';
import type { TrainClassOffer, TrainFetchResult, TrainQuota } from './trainMonitor.js';
import { resolveTrainRouteSlug } from './trainStations.js';

const GATEWAY = 'https://www.flytoday.ir/api/gateway';
const API_ORIGIN = 'https://api.flytoday.ir/api';

const QUOTA_SEX: Record<TrainQuota, number> = {
  general: 3,
  men: 1,
  women: 2,
  car: 3,
};

let client: AxiosInstance | null = null;
let lastRequestAt = 0;
let consecutiveFailures = 0;

function getClient(): AxiosInstance {
  if (!client) {
    client = axios.create({
      timeout: 35_000,
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'fa-IR,fa;q=0.9',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Origin: 'https://www.flytoday.ir',
        Referer: 'https://www.flytoday.ir/',
        'x-app': 'www.flytoday.ir',
        'x-origin': 'https://www.flytoday.ir',
        'x-currency': 'IRR',
        'x-proxy-origin': API_ORIGIN,
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
      },
      validateStatus: () => true,
    });
  }
  return client;
}

export function buildFlytodayTrainUrl(
  routeSlug: string,
  dateGregorian: string,
  originId: number,
  destId: number,
  quota: TrainQuota
): string {
  return `https://www.flytoday.ir/train/${routeSlug}?origin=${originId}&destination=${destId}&departureDate=${dateGregorian}&adt=1&chd=0&inf=0&genderType=${QUOTA_SEX[quota]}`;
}

function toToman(rial: number | undefined | null): number {
  if (!rial || rial <= 0) return 0;
  return Math.round(rial / 10);
}

function formatHm(iso: string | undefined): string {
  if (!iso) return 'نامعلوم';
  const m = String(iso).match(/T(\d{2}:\d{2})/);
  return m ? m[1] : String(iso).slice(11, 16);
}

async function waitGap(minMs: number): Promise<void> {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < minMs) {
    await new Promise((r) => setTimeout(r, minMs - elapsed + Math.floor(Math.random() * 1500)));
  }
}

async function gatewayPost(path: string, body: unknown, retries = 3): Promise<{ status: number; data: unknown }> {
  await waitGap(50_000);
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await getClient().post(`${GATEWAY}${path}`, body);
    lastRequestAt = Date.now();
    if (res.status === 599 && attempt < retries) {
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    return { status: res.status, data: res.data };
  }
  return { status: 599, data: null };
}

async function gatewayGet(path: string): Promise<{ status: number; data: unknown }> {
  await waitGap(50_000);
  const res = await getClient().get(`${GATEWAY}${path}`);
  lastRequestAt = Date.now();
  return { status: res.status, data: res.data };
}

export function getFlytodayBackoffMs(): number {
  if (consecutiveFailures <= 0) return 0;
  return Math.min(30 * 60_000, 90_000 * consecutiveFailures) + Math.floor(Math.random() * 20_000);
}

export async function fetchFlytodayCalendar(
  originStationId: number,
  destinationStationId: number
): Promise<{ date: string; soldOut: boolean; cheapestToman?: number }[]> {
  const path = `/V1/DomesticRails/FareLookUp?fromStation=${originStationId}&toStation=${destinationStationId}&carIncluded=false`;
  const { status, data } = await gatewayGet(path);
  if (status !== 200) {
    consecutiveFailures++;
    return [];
  }
  consecutiveFailures = 0;
  const rows = ((data as { data?: unknown[] })?.data || []) as Record<string, unknown>[];
  const byDay = new Map<string, number[]>();
  for (const r of rows) {
    const day = String(r.departureDate || '').slice(0, 10);
    if (!day) continue;
    if (!r.isFull && r.cheapestPrice) {
      const list = byDay.get(day) || [];
      list.push(Number(r.cheapestPrice));
      byDay.set(day, list);
    } else if (!byDay.has(day)) {
      byDay.set(day, []);
    }
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, prices]) =>
      prices.length > 0
        ? { date, soldOut: false, cheapestToman: toToman(Math.min(...prices)) }
        : { date, soldOut: true }
    );
}

export async function fetchFlytodayAvailability(params: {
  originStationId: number;
  destinationStationId: number;
  dateGregorian: string;
  quota: TrainQuota;
  routeSlug: string;
}): Promise<TrainFetchResult> {
  const body = {
    sexCode: QUOTA_SEX[params.quota],
    adultsCount: 1,
    childCount: 0,
    infantCount: 0,
    isExclusive: false,
    tripType: 'OneWay',
    originDestination: [
      {
        origin: params.originStationId,
        destination: params.destinationStationId,
        moveDate: params.dateGregorian,
      },
    ],
  };

  const { status, data } = await gatewayPost('/V2/DomesticRails/Search', body);
  const buyBase = buildFlytodayTrainUrl(
    params.routeSlug,
    params.dateGregorian,
    params.originStationId,
    params.destinationStationId,
    params.quota
  );

  if (status === 403 || status === 429) {
    consecutiveFailures++;
    return {
      success: false,
      message: `محدودیت فلای‌تودی (${status})`,
      offers: [],
      httpStatus: status,
      shouldBackoff: true,
    };
  }
  if (status === 599) {
    consecutiveFailures++;
    return {
      success: false,
      message: 'لینک ریلی فلای‌تودی موقتاً در دسترس نیست (599)',
      offers: [],
      httpStatus: status,
      shouldBackoff: true,
    };
  }
  if (status !== 200) {
    consecutiveFailures++;
    return {
      success: false,
      message: `پاسخ غیرمنتظره فلای‌تودی: ${status}`,
      offers: [],
      httpStatus: status,
      shouldBackoff: status >= 500,
    };
  }

  consecutiveFailures = 0;
  const root = data as Record<string, unknown>;
  const day = ((root.itinerariesList as unknown[]) || [{}])[0] as Record<string, unknown>;
  const originName = String((day.origin as { nameFa?: string })?.nameFa || '');
  const destName = String((day.destination as { nameFa?: string })?.nameFa || '');
  const offers: TrainClassOffer[] = [];

  for (const row of (day.itineraries as Record<string, unknown>[]) || []) {
    const seats = Number(row.remainingSeats) || 0;
    const bookable = seats > 0 && Boolean(row.isCapacityEnough);
    if (!bookable) continue;
    const priceRial = Number(row.finalPrice || row.price) || 0;
    offers.push({
      classId: Number(row.wagonId) || Number(row.searchId) || Math.floor(Math.random() * 1e6),
      trainNumber: row.trainNumber as number | string,
      company: String(row.railCompanyName || ''),
      wagonName: String(row.wagonName || '').replace(/\s+/g, ' ').trim(),
      compartmentType: String(row.trainType || ''),
      departureTime: formatHm(String(row.moveDate)),
      arrivalTime: formatHm(String(row.arrivalDate)),
      dateGregorian: params.dateGregorian,
      originName,
      destinationName: destName,
      capacity: seats,
      priceToman: toToman(priceRial),
      bookable: true,
      buyLink: buyBase,
    });
  }

  return {
    success: true,
    message: `${offers.length} کلاس باز (فلای‌تودی)`,
    offers,
    httpStatus: 200,
    shouldBackoff: false,
  };
}

export function flytodayRouteSlug(originStationId: number, destinationStationId: number): string {
  return resolveTrainRouteSlug(originStationId, destinationStationId);
}
