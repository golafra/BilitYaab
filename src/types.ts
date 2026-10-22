/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface AirlineConfig {
  id: string;
  name: string;
  nameFa: string;
  urlTemplate: string;
  systemType: 'nira' | 'sepehran' | 'mahan' | 'iranair' | 'iranairtour' | 'ata' | 'pars' | 'unknown';
}

export type TransportMode = 'flight' | 'train' | 'both';

export type TrainQuota = 'general' | 'men' | 'women' | 'car';

export interface AppConfig {
  origin: string;
  destination: string;
  departureDateGregorian: string; // e.g. "2026-07-25" (fallback / primary)
  departureDates: string[]; // e.g. ["2026-07-25", "2026-07-26"]
  minSeatsRequired: number; // e.g. 3
  checkIntervalMinutes: number; // e.g. 1
  baleToken: string;
  baleChatId: string;
  isMonitoring: boolean;
  useSimulationMode: boolean;
  proxyUrl: string;
  enabledAirlines: string[]; // List of airline IDs
  /** flight = فقط پرواز، train = فقط قطار، both = هر دو (با فاصلهٔ امن بین درخواست‌ها) */
  transportMode: TransportMode;
  trainOriginStationId: number;
  trainDestinationStationId: number;
  trainRouteSlug: string;
  trainQuota: TrainQuota;
  /** فاصلهٔ پایش قطار؛ حداقل ۳ دقیقه در سرور */
  trainCheckIntervalMinutes: number;
  /** منبع دادهٔ قطار؛ both = نوبتی (هر دور یکی) برای کم کردن فشار */
  trainProvider: 'mrbilit' | 'flytoday' | 'both' | 'ghasedak';
  /** در صورت خطا یا بلاک منبع اصلی، همان تاریخ از قاصدک۲۴ هم چک شود */
  trainFallbackToGhasedak: boolean;
}

export interface FlightInfo {
  airlineId: string;
  airlineName: string;
  flightNumber: string;
  departureTime: string;
  dateGregorian?: string; // e.g. "2026-07-25"
  origin: string;
  destination: string;
  capacity: number; // number of open seats
  price?: number;
  link: string;
}

export interface ScrapeResult {
  airlineId: string;
  airlineName: string;
  success: boolean;
  message: string;
  flightsFound: number;
  flights: FlightInfo[];
  timestamp: string;
}

export interface ScrapeLogEntry {
  id: string;
  timestamp: string;
  airlineId: string;
  airlineName: string;
  success: boolean;
  message: string;
  flightsFound: number;
  details?: string;
}

export interface BaleTestResult {
  success: boolean;
  message: string;
}

export interface ServerStatus {
  isMonitoring: boolean;
  lastCheckTime: string | null;
  nextCheckTime: string | null;
  checkCount: number;
  alertsSentCount: number;
  activeLogs: ScrapeLogEntry[];
}
