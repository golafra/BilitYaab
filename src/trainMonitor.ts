/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import axios, { AxiosInstance } from 'axios';
import { getJalaliFromGregorianString } from './dateUtils.js';
import { resolveTrainRouteSlug as resolveRouteSlug } from './trainStations.js';

const TRAIN_API_BASE = 'https://train.mrbilit.com';

/** حداقل فاصله بین دو درخواست به API قطار (میلی‌ثانیه) */
export const TRAIN_MIN_REQUEST_GAP_MS = 45_000;

/** حداقل فاصلهٔ دورهٔ پایش قطار (دقیقه) — در سرور enforce می‌شود */
export const TRAIN_MIN_CHECK_INTERVAL_MINUTES = 3;

export type TrainQuota = 'general' | 'men' | 'women' | 'car';

const QUOTA_CODES: Record<TrainQuota, number> = {
  general: 3,
  men: 1,
  women: 2,
  car: 4,
};

export interface TrainClassOffer {
  classId: number;
  trainNumber: number | string;
  company: string;
  wagonName: string;
  compartmentType: string;
  departureTime: string;
  arrivalTime: string;
  dateGregorian: string;
  originName: string;
  destinationName: string;
  capacity: number;
  priceToman: number;
  bookable: boolean;
  buyLink: string;
}

export interface TrainFetchResult {
  success: boolean;
  message: string;
  offers: TrainClassOffer[];
  httpStatus?: number;
  shouldBackoff: boolean;
}

let sharedClient: AxiosInstance | null = null;
let lastRequestFinishedAt = 0;
let consecutiveFailures = 0;

function getClient(): AxiosInstance {
  if (!sharedClient) {
    sharedClient = axios.create({
      timeout: 25_000,
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'fa-IR,fa;q=0.9,en-US;q=0.8,en;q=0.7',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Origin: 'https://mrbilit.com',
        Referer: 'https://mrbilit.com/',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-site',
      },
      validateStatus: () => true,
    });
  }
  return sharedClient;
}

export function buildMrBilitTrainUrl(routeSlug: string, dateGregorian: string): string {
  const jalali = getJalaliFromGregorianString(dateGregorian);
  return `https://mrbilit.com/trains/${routeSlug}?departureDate=${jalali}`;
}

function toToman(rial: number | undefined | null): number {
  if (!rial || rial <= 0) return 0;
  return Math.round(rial / 10);
}

function formatTime(iso: string | undefined): string {
  if (!iso) return 'نامعلوم';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return iso;
  }
}

async function waitForRequestGap(): Promise<void> {
  const elapsed = Date.now() - lastRequestFinishedAt;
  if (elapsed < TRAIN_MIN_REQUEST_GAP_MS) {
    const wait = TRAIN_MIN_REQUEST_GAP_MS - elapsed + Math.floor(Math.random() * 2000);
    await new Promise((r) => setTimeout(r, wait));
  }
}

export function getTrainBackoffMs(): number {
  if (consecutiveFailures <= 0) return 0;
  const base = Math.min(30 * 60_000, 60_000 * Math.pow(2, consecutiveFailures - 1));
  return base + Math.floor(Math.random() * 15_000);
}

export function resetTrainBackoff(): void {
  consecutiveFailures = 0;
}

export async function fetchTrainAvailability(params: {
  originStationId: number;
  destinationStationId: number;
  dateGregorian: string;
  quota: TrainQuota;
  routeSlug: string;
  originName?: string;
  destinationName?: string;
  /** هر چندمین بار یک‌بار disableCache=true (کمتر فشار به سرور) */
  checkIndex: number;
}): Promise<TrainFetchResult> {
  await waitForRequestGap();

  const disableCache = params.checkIndex % 4 === 0;
  const query = {
    from: params.originStationId,
    to: params.destinationStationId,
    date: params.dateGregorian,
    genderCode: QUOTA_CODES[params.quota],
    adultCount: 1,
    childCount: 0,
    infantCount: 0,
    exclusive: 'false',
    availableStatus: 'Both',
    disableCache: disableCache ? 'true' : 'false',
  };

  try {
    const response = await getClient().get(`${TRAIN_API_BASE}/api/GetAvailable/v2`, {
      params: query,
    });
    lastRequestFinishedAt = Date.now();

    const status = response.status;
    if (status === 429 || status === 403) {
      consecutiveFailures++;
      return {
        success: false,
        message: `محدودیت دسترسی API قطار (${status}). پایش موقتاً کند می‌شود.`,
        offers: [],
        httpStatus: status,
        shouldBackoff: true,
      };
    }
    if (status >= 500) {
      consecutiveFailures++;
      return {
        success: false,
        message: `خطای سرور API قطار (${status})`,
        offers: [],
        httpStatus: status,
        shouldBackoff: true,
      };
    }
    if (status !== 200) {
      consecutiveFailures++;
      return {
        success: false,
        message: `پاسخ غیرمنتظره API قطار: ${status}`,
        offers: [],
        httpStatus: status,
        shouldBackoff: status >= 400,
      };
    }

    consecutiveFailures = 0;
    const body = response.data as { trains?: unknown[] };
    const trains = body.trains || [];
    const buyBase = buildMrBilitTrainUrl(params.routeSlug, params.dateGregorian);
    const offers: TrainClassOffer[] = [];

    for (const t of trains as Record<string, unknown>[]) {
      const trainNumber = (t.trainNumber as number | string) ?? '?';
      const company = String(t.corporationName || t.providerName || 'قطار');
      const departureTime = formatTime(t.departureTime as string);
      const arrivalTime = formatTime(t.arrivalTime as string);
      const originName = String(t.fromName || params.originName || '');
      const destinationName = String(t.toName || params.destinationName || '');

      for (const priceGroup of (t.prices as Record<string, unknown>[]) || []) {
        for (const c of (priceGroup.classes as Record<string, unknown>[]) || []) {
          const capacity = Number(c.capacity) || 0;
          const priceRaw = Number(c.price) || 0;
          const bookable = Boolean(c.isAvailable) && priceRaw > 0 && capacity > 0;
          if (!bookable) continue;

          offers.push({
            classId: Number(c.id),
            trainNumber,
            company,
            wagonName: String(c.wagonName || c.shortTitle || '').trim(),
            compartmentType: String(c.compartmentType || ''),
            departureTime,
            arrivalTime,
            dateGregorian: params.dateGregorian,
            originName,
            destinationName,
            capacity,
            priceToman: toToman(priceRaw),
            bookable,
            buyLink: buyBase,
          });
        }
      }
    }

    return {
      success: true,
      message: `${offers.length} کلاس با ظرفیت باز`,
      offers,
      httpStatus: 200,
      shouldBackoff: false,
    };
  } catch (err: unknown) {
    lastRequestFinishedAt = Date.now();
    consecutiveFailures++;
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      message: `خطا در ارتباط با API قطار: ${message}`,
      offers: [],
      shouldBackoff: true,
    };
  }
}

export const resolveTrainRouteSlug = resolveRouteSlug;
