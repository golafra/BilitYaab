/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import axios, { AxiosInstance } from 'axios';
import { getJalaliFromGregorianString } from './dateUtils.js';
import type { TrainClassOffer, TrainFetchResult, TrainQuota } from './trainMonitor.js';
import { resolveTrainRouteSlug, resolveTrainStationCode } from './trainStations.js';

const GHASEDAK_TRAIN_API = 'https://ghasedak24.com/train';
const GHASEDAK_SITE = 'https://ghasedak24.com';

const QUOTA_PARAMS: Record<TrainQuota, { type: string; coupe: string; carTransport: string }> = {
  general: { type: '0', coupe: '0', carTransport: '0' },
  men: { type: '1', coupe: '0', carTransport: '0' },
  women: { type: '2', coupe: '0', carTransport: '0' },
  car: { type: '0', coupe: '0', carTransport: '1' },
};

let client: AxiosInstance | null = null;
let lastRequestAt = 0;
let consecutiveFailures = 0;

function getClient(): AxiosInstance {
  if (!client) {
    client = axios.create({
      timeout: 30_000,
      headers: {
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Accept-Language': 'fa-IR,fa;q=0.9',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Origin: GHASEDAK_SITE,
        Referer: `${GHASEDAK_SITE}/`,
        'X-Requested-With': 'XMLHttpRequest',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
      },
      validateStatus: () => true,
    });
  }
  return client;
}

function toToman(rial: number | undefined | null): number {
  if (!rial || rial <= 0) return 0;
  return Math.round(rial / 10);
}

async function waitGap(minMs: number): Promise<void> {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < minMs) {
    await new Promise((r) => setTimeout(r, minMs - elapsed + Math.floor(Math.random() * 1200)));
  }
}

export function getGhasedakBackoffMs(): number {
  if (consecutiveFailures <= 0) return 0;
  return Math.min(25 * 60_000, 75_000 * consecutiveFailures) + Math.floor(Math.random() * 15_000);
}

export function buildGhasedakTrainUrl(routeSlug: string, dateGregorian: string, quota: TrainQuota): string {
  const jalali = getJalaliFromGregorianString(dateGregorian);
  const q = QUOTA_PARAMS[quota];
  const params = new URLSearchParams({
    'departure-date': jalali,
    'adult-count': '1',
    'child-count': '0',
    'infant-count': '0',
    'transit-car': q.carTransport,
    'ticket-type': q.type,
    coupe: q.coupe,
    count: '1',
  });
  return `${GHASEDAK_SITE}/train-ticket/${encodeURIComponent(routeSlug)}?${params.toString()}`;
}

type GhasedakDepartureRow = {
  id?: number;
  train_number_en?: number;
  train_number?: string;
  wagon_name?: string;
  counting_en?: number;
  cost?: number;
  owner_name?: string;
  time?: string;
  time_of_arrival?: string;
  from_title?: string;
  to_title?: string;
  compartment_capacity?: number;
};

export async function fetchGhasedakAvailability(params: {
  originStationId: number;
  destinationStationId: number;
  dateGregorian: string;
  quota: TrainQuota;
  routeSlug?: string;
}): Promise<TrainFetchResult> {
  await waitGap(40_000);

  const routeSlug =
    params.routeSlug || resolveTrainRouteSlug(params.originStationId, params.destinationStationId);
  const jalali = getJalaliFromGregorianString(params.dateGregorian);
  if (!jalali) {
    return {
      success: false,
      message: 'تاریخ میلادی نامعتبر برای قاصدک',
      offers: [],
      shouldBackoff: false,
    };
  }

  const q = QUOTA_PARAMS[params.quota];
  const body = new URLSearchParams({
    route: routeSlug,
    car_transport: q.carTransport,
    date: jalali,
    count: '1',
    type: q.type,
    coupe: q.coupe,
    filter: '0',
  });

  try {
    const res = await getClient().post(`${GHASEDAK_TRAIN_API}/search_ajax`, body.toString());
    lastRequestAt = Date.now();
    const status = res.status;

    if (status === 403 || status === 429) {
      consecutiveFailures++;
      return {
        success: false,
        message: `قاصدک: محدودیت دسترسی (${status})`,
        offers: [],
        httpStatus: status,
        shouldBackoff: true,
      };
    }
    if (status >= 500) {
      consecutiveFailures++;
      return {
        success: false,
        message: `قاصدک: خطای سرور (${status})`,
        offers: [],
        httpStatus: status,
        shouldBackoff: true,
      };
    }
    if (status !== 200) {
      consecutiveFailures++;
      return {
        success: false,
        message: `قاصدک: پاسخ غیرمنتظره (${status})`,
        offers: [],
        httpStatus: status,
        shouldBackoff: status >= 400,
      };
    }

    const payload = res.data as {
      data?: { status?: string; message?: string; data?: { departure?: GhasedakDepartureRow[] } };
    };
    const inner = payload?.data;
    if (!inner || inner.status !== 'success') {
      consecutiveFailures++;
      return {
        success: false,
        message: `قاصدک: ${inner?.message || 'جستجو ناموفق'}`,
        offers: [],
        httpStatus: 200,
        shouldBackoff: false,
      };
    }

    consecutiveFailures = 0;
    const rows = inner.data?.departure || [];
    const buyLink = buildGhasedakTrainUrl(routeSlug, params.dateGregorian, params.quota);
    const offers: TrainClassOffer[] = [];

    for (const row of rows) {
      const capacity = Number(row.counting_en) || 0;
      const priceToman = toToman(Number(row.cost));
      if (capacity <= 0 || priceToman <= 0) continue;

      offers.push({
        classId: Number(row.id) || 0,
        trainNumber: row.train_number_en ?? row.train_number ?? '?',
        company: String(row.owner_name || 'قطار'),
        wagonName: String(row.wagon_name || '').trim(),
        compartmentType: row.compartment_capacity ? `کوپه ${row.compartment_capacity} نفره` : '',
        departureTime: String(row.time || 'نامعلوم'),
        arrivalTime: String(row.time_of_arrival || 'نامعلوم'),
        dateGregorian: params.dateGregorian,
        originName: String(row.from_title || ''),
        destinationName: String(row.to_title || ''),
        capacity,
        priceToman,
        bookable: true,
        buyLink,
      });
    }

    return {
      success: true,
      message: `${offers.length} کلاس با ظرفیت باز (قاصدک)`,
      offers,
      httpStatus: 200,
      shouldBackoff: false,
    };
  } catch (err: unknown) {
    lastRequestAt = Date.now();
    consecutiveFailures++;
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      message: `قاصدک: خطا در ارتباط — ${message}`,
      offers: [],
      shouldBackoff: true,
    };
  }
}

export async function fetchGhasedakCalendar(
  originStationId: number,
  destinationStationId: number
): Promise<{ dateGregorian: string; minPriceMillion?: number }[]> {
  const from = resolveTrainStationCode(originStationId);
  const to = resolveTrainStationCode(destinationStationId);
  await waitGap(35_000);

  try {
    const res = await getClient().get(`${GHASEDAK_TRAIN_API}/calendar/${from}/${to}`);
    lastRequestAt = Date.now();
    if (res.status !== 200 || !Array.isArray(res.data)) {
      consecutiveFailures++;
      return [];
    }
    consecutiveFailures = 0;
    return (res.data as { date_display?: string; price?: string }[])
      .map((row) => {
        const raw = String(row.date_display || '').replace(/\//g, '-');
        const price = row.price ? Number(row.price) : undefined;
        return { dateGregorian: raw, minPriceMillion: price };
      })
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.dateGregorian));
  } catch {
    consecutiveFailures++;
    return [];
  }
}
