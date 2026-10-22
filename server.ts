/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';
import dotenv from 'dotenv';
import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { ALL_AIRLINES, getAirlineUrl } from './src/airlinesData.js';
import { AppConfig, FlightInfo, ScrapeLogEntry, ServerStatus } from './src/types.js';
import { getJalaliFromGregorianString } from './src/dateUtils.js';
import {
  TRAIN_MIN_CHECK_INTERVAL_MINUTES,
  buildMrBilitTrainUrl,
  fetchTrainAvailability,
  getTrainBackoffMs,
  resolveTrainRouteSlug,
  type TrainClassOffer,
} from './src/trainMonitor.js';
import {
  fetchFlytodayAvailability,
  fetchFlytodayCalendar,
  getFlytodayBackoffMs,
} from './src/flytodayTrainMonitor.js';
import {
  fetchGhasedakAvailability,
  getGhasedakBackoffMs,
} from './src/ghasedakTrainMonitor.js';
import puppeteer from 'puppeteer';

dotenv.config();

// Helper to scrape dynamic pages using a headless browser (Puppeteer)
async function fetchHtmlWithBrowser(url: string, proxyUrl?: string): Promise<{ html: string; usedBrowser: boolean; logMessage: string }> {
  let browser;
  try {
    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled'
    ];

    // Standard proxy configurations
    if (proxyUrl && !proxyUrl.includes('?url=') && !proxyUrl.includes('&url=')) {
      args.push(`--proxy-server=${proxyUrl}`);
    }

    browser = await puppeteer.launch({
      headless: true,
      args,
    });

    const page = await browser.newPage();
    
    // Set standard desktop dimensions and user agent to bypass simple bot protection
    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Opt-out of automation headers
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    // Speed up loading by blocking heavy non-essential assets
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      if (type === 'image' || type === 'media' || type === 'font') {
        req.abort();
      } else {
        req.continue();
      }
    });

    console.log(`[Puppeteer] Opening URL: ${url}`);
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 25000,
    });

    // Wait for the dynamic airline page to load (Sepehran, Zagros etc. use next.js/react)
    // Wait for either the search layout to load, or wait 4.5 seconds for complete AJAX hydration
    await new Promise((resolve) => setTimeout(resolve, 4500));

    const html = await page.content();
    await browser.close();

    return {
      html,
      usedBrowser: true,
      logMessage: 'با موفقیت توسط مرورگر هوشمند بارگذاری شد (کاملاً رندر شده)'
    };
  } catch (err: any) {
    console.warn(`[Puppeteer Error] Failed to fetch with browser: ${err.message}. Falling back to standard HTTP...`);
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
    return {
      html: '',
      usedBrowser: false,
      logMessage: `عدم لود با مرورگر (${err.message}) - در حال تلاش با متد ساده HTTP...`
    };
  }
}

const getFilename = () => {
  try {
    return fileURLToPath(import.meta.url);
  } catch {
    return '';
  }
};
const __filename = getFilename();
const __dirname = __filename ? path.dirname(__filename) : '';

const app = express();
app.use(express.json());

const PORT = 3000;
const CONFIG_FILE = path.join(process.cwd(), 'config.json');

// Default Configuration
const DEFAULT_CONFIG: AppConfig = {
  origin: 'IKA',
  destination: 'NJF',
  departureDateGregorian: '2026-07-25',
  departureDates: ['2026-07-25', '2026-07-26'],
  minSeatsRequired: 3,
  checkIntervalMinutes: 1,
  baleToken: '',
  baleChatId: '',
  isMonitoring: true,
  useSimulationMode: false,
  proxyUrl: 'https://208.ir/ali/p.php?token=MySecretToken123&url=',
  enabledAirlines: ['zagros', 'qeshm', 'kish', 'sepehran', 'aseman'],
  transportMode: 'train',
  trainOriginStationId: 1,
  trainDestinationStationId: 191,
  trainRouteSlug: 'tehran-mashhad',
  trainQuota: 'general',
  trainCheckIntervalMinutes: 5,
  trainProvider: 'mrbilit',
  trainFallbackToGhasedak: true,
  trainMaxPriceToman: 0,
};

// Load or initialize config
let config: AppConfig = { ...DEFAULT_CONFIG };
try {
  if (fs.existsSync(CONFIG_FILE)) {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    config = normalizeConfig({ ...DEFAULT_CONFIG, ...JSON.parse(raw) });
  } else {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  }
} catch (err) {
  console.error('Failed to load config, using defaults:', err);
}
config = normalizeConfig(config);

// In-Memory Stats & Logs
let checkCount = 0;
let alertsSentCount = 0;
let lastCheckTime: string | null = null;
let nextCheckTime: string | null = null;
let scrapeLogs: ScrapeLogEntry[] = [];
let monitoringTimeout: NodeJS.Timeout | null = null;
let monitoringCycleInFlight = false;
let lastTrainCheckAt = 0;
let trainBackoffUntil = 0;
let trainPollCounter = 0;

// Track already notified flight identifiers to prevent spamming the user
// Format: "airlineId-flightNo-departureTime-seatsCount"
const notifiedFlights = new Set<string>();
/** کلاس+تاریخ؛ فقط هنگام بازگشت ظرفیت بعد از تکمیل دوباره هشدار */
const trainOfferWasAvailable = new Map<string, boolean>();

function addLog(airlineId: string, airlineName: string, success: boolean, message: string, flightsFound: number, details?: string) {
  const log: ScrapeLogEntry = {
    id: Math.random().toString(36).substring(2, 9),
    timestamp: new Date().toISOString(),
    airlineId,
    airlineName,
    success,
    message,
    flightsFound,
    details,
  };
  scrapeLogs.unshift(log);
  if (scrapeLogs.length > 200) {
    scrapeLogs.pop();
  }
  return log;
}

// Helper to send message to Bale Messenger
async function sendBaleMessage(token: string, chatId: string, text: string): Promise<{ success: boolean; message: string }> {
  if (!token || !chatId) {
    return { success: false, message: 'Bale Token or Chat ID is not configured' };
  }

  const url = `https://tapi.bale.ai/bot${token}/sendMessage`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return { success: false, message: `Bale API Error (${response.status}): ${errText}` };
    }

    return { success: true, message: 'Notification sent successfully' };
  } catch (error: any) {
    return { success: false, message: `Failed to connect to Bale API: ${error.message}` };
  }
}

// Format message for Bale flight alert
function formatBaleMessage(flight: FlightInfo, link: string): string {
  const flightDate = flight.dateGregorian || config.departureDateGregorian;
  const dateShamsi = getJalaliFromGregorianString(flightDate);
  return `✈️ ظرفیت پرواز ${config.origin} به ${config.destination} باز شد!

🏢 ایرلاین: ${flight.airlineName}
🔢 شماره پرواز: ${flight.flightNumber || 'نامعلوم'}
⏰ ساعت پرواز: ${flight.departureTime}
📅 تاریخ: ${dateShamsi} (${flightDate})
💺 ظرفیت خالی: ${flight.capacity} صندلی

🔗 رزرو و خرید:
${link}

🔔 بلیط‌یاب`;
}

function formatBaleTrainMessage(offer: TrainClassOffer): string {
  const dateShamsi = getJalaliFromGregorianString(offer.dateGregorian);
  return `🚆 ظرفیت قطار ${offer.originName} به ${offer.destinationName} باز شد!

🏢 شرکت: ${offer.company}
🔢 شماره قطار: ${offer.trainNumber}
🛏 واگن: ${offer.wagonName}${offer.compartmentType ? ` (${offer.compartmentType})` : ''}
⏰ حرکت: ${offer.departureTime} — رسیدن: ${offer.arrivalTime}
📅 تاریخ: ${dateShamsi} (${offer.dateGregorian})
💺 صندلی خالی: ${offer.capacity}
💰 قیمت (تومان): ${offer.priceToman.toLocaleString('fa-IR')}

🔗 رزرو در مستربلیط:
${offer.buyLink}

🔔 بلیط‌یاب`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function modeIncludesFlight(mode: AppConfig['transportMode']): boolean {
  return mode === 'flight' || mode === 'both';
}

function modeIncludesTrain(mode: AppConfig['transportMode']): boolean {
  return mode === 'train' || mode === 'both';
}

function includesFlightMonitoring(): boolean {
  return modeIncludesFlight(config.transportMode);
}

function includesTrainMonitoring(): boolean {
  return modeIncludesTrain(config.transportMode);
}

function getEffectiveTrainIntervalMinutes(): number {
  return Math.max(TRAIN_MIN_CHECK_INTERVAL_MINUTES, config.trainCheckIntervalMinutes || TRAIN_MIN_CHECK_INTERVAL_MINUTES);
}

function getSchedulerIntervalMinutes(): number {
  const flightInterval = config.checkIntervalMinutes || 1;
  const trainInterval = getEffectiveTrainIntervalMinutes();
  if (config.transportMode === 'train') return trainInterval;
  if (config.transportMode === 'flight') return flightInterval;
  return Math.max(flightInterval, trainInterval);
}

function scheduleNextMonitoringRun(): void {
  if (!config.isMonitoring) {
    nextCheckTime = null;
    return;
  }
  const baseMs = getSchedulerIntervalMinutes() * 60 * 1000;
  const jitterMs = Math.floor(Math.random() * 90_000);
  const nextAt = Date.now() + baseMs + jitterMs;
  nextCheckTime = new Date(nextAt).toISOString();

  if (monitoringTimeout) clearTimeout(monitoringTimeout);
  monitoringTimeout = setTimeout(() => {
    void runMonitoringCycle();
  }, baseMs + jitterMs);
}

async function runMonitoringCycle(): Promise<void> {
  if (!config.isMonitoring) {
    nextCheckTime = null;
    return;
  }
  if (monitoringCycleInFlight) {
    return;
  }
  monitoringCycleInFlight = true;
  checkCount++;
  lastCheckTime = new Date().toISOString();

  try {
    if (includesTrainMonitoring()) {
      const trainGapMs = getEffectiveTrainIntervalMinutes() * 60 * 1000;
      if (Date.now() >= trainBackoffUntil && Date.now() - lastTrainCheckAt >= trainGapMs) {
        await runTrainChecks();
        lastTrainCheckAt = Date.now();
      }
      if (includesFlightMonitoring()) {
        await sleep(4000 + Math.floor(Math.random() * 3000));
      }
    }
    if (includesFlightMonitoring()) {
      await runFlightChecks();
    }
  } finally {
    monitoringCycleInFlight = false;
    scheduleNextMonitoringRun();
  }
}

async function runTrainChecks(): Promise<void> {
  const datesToCheck =
    config.departureDates && config.departureDates.length > 0
      ? config.departureDates
      : [config.departureDateGregorian];

  const routeSlug =
    config.trainRouteSlug ||
    resolveTrainRouteSlug(config.trainOriginStationId, config.trainDestinationStationId);

  trainPollCounter++;
  const provider = pickTrainProviderForCycle();
  const providerLabel =
    provider === 'mrbilit'
      ? 'مستربلیط'
      : provider === 'flytoday'
        ? 'فلای‌تودی'
        : 'قاصدک';
  let flytodayCalendar: Map<string, boolean> | null = null;
  if (provider === 'flytoday' && !config.useSimulationMode) {
    const days = await fetchFlytodayCalendar(config.trainOriginStationId, config.trainDestinationStationId);
    flytodayCalendar = new Map(days.map((d) => [d.date, d.soldOut]));
    if (days.length > 0) {
      addLog(
        'train',
        'فلای‌تودی',
        true,
        `تقویم ${days.length} روزه در یک درخواست دریافت شد.`,
        0,
        JSON.stringify(days.slice(0, 12), null, 2)
      );
    }
  }

  for (let i = 0; i < datesToCheck.length; i++) {
    const dateGregorian = datesToCheck[i];
    const dateShamsi = getJalaliFromGregorianString(dateGregorian);

    if (i > 0) {
      await sleep(2500 + Math.floor(Math.random() * 3500));
    }

    if (config.useSimulationMode) {
      const roll = Math.random();
      if (roll < 0.15) {
        const seats = Math.floor(Math.random() * 4) + config.minSeatsRequired;
        const offer: TrainClassOffer = {
          classId: Math.floor(Math.random() * 1_000_000),
          trainNumber: 300 + Math.floor(Math.random() * 50),
          company: 'رجا (شبیه‌سازی)',
          wagonName: 'پنج ستاره زندگی',
          compartmentType: 'کوپه ۴ نفره',
          departureTime: '21:00',
          arrivalTime: '07:30',
          dateGregorian,
          originName: 'تهران',
          destinationName: 'مشهد',
          capacity: seats,
          priceToman: 900_000 + Math.floor(Math.random() * 200_000),
          bookable: true,
          buyLink: buildMrBilitTrainUrl(routeSlug, dateGregorian),
        };
        await processTrainOffers([offer], dateGregorian, dateShamsi);
        addLog('train', 'قطار', true, `[${dateShamsi}] شبیه‌سازی: ظرفیت قطار باز شد (${seats} صندلی)`, 1);
      } else {
        addLog('train', 'قطار', true, `[${dateShamsi}] شبیه‌سازی: ظرفیت باز نیست.`, 0);
      }
      continue;
    }

    const calendarSoldOut =
      flytodayCalendar?.get(dateGregorian) === true;
    if (calendarSoldOut === true) {
      addLog('train', providerLabel, true, `[${dateShamsi}] تقویم: ظرفیت این روز پر است (جستجوی جزئی رد شد).`, 0);
      continue;
    }

    let result = await fetchTrainFromProvider(provider, routeSlug, dateGregorian);
    let activeLabel = providerLabel;
    let triedGhasedakFallback = false;

    const useGhasedakFallback =
      config.trainFallbackToGhasedak !== false && provider !== 'ghasedak';
    if (useGhasedakFallback && (!result.success || result.shouldBackoff)) {
      addLog(
        'train',
        'قاصدک',
        true,
        `[${dateShamsi}] منبع «${providerLabel}» در دسترس نبود؛ بررسی پشتیبان قاصدک…`,
        0
      );
      triedGhasedakFallback = true;
      const fallback = await fetchGhasedakAvailability({
        originStationId: config.trainOriginStationId,
        destinationStationId: config.trainDestinationStationId,
        dateGregorian,
        quota: config.trainQuota || 'general',
        routeSlug,
      });
      if (fallback.success) {
        result = fallback;
        activeLabel = 'قاصدک (پشتیبان)';
      } else if (!result.success) {
        result = fallback;
        activeLabel = 'قاصدک';
      }
    }

    if (!result.success) {
      addLog('train', activeLabel, false, `[${dateShamsi}] ${result.message}`, 0);
      if (result.shouldBackoff) {
        const backoff = trainBackoffMsForFailure(provider, triedGhasedakFallback && activeLabel.includes('قاصدک'));
        if (backoff > 0) {
          trainBackoffUntil = Date.now() + backoff;
          addLog(
            'train',
            activeLabel,
            true,
            `⏳ فاصلهٔ پایش تا ${Math.ceil(backoff / 60_000)} دقیقه افزایش یافت.`,
            0
          );
        }
      }
      continue;
    }

    const matched = filterTrainOffersForAlert(result.offers);
    const priceHint =
      config.trainMaxPriceToman > 0 ? `، حداکثر ${config.trainMaxPriceToman.toLocaleString('fa-IR')} تومان` : '';
    addLog(
      'train',
      activeLabel,
      true,
      `[${dateShamsi}] ${result.offers.length} کلاس باز — ${matched.length} مورد با حداقل ${config.minSeatsRequired} صندلی${priceHint}`,
      matched.length,
      matched.length > 0 ? JSON.stringify(matched.slice(0, 8), null, 2) : undefined
    );
    await processTrainOffers(matched, dateGregorian, dateShamsi);
  }
}

function filterTrainOffersForAlert(offers: TrainClassOffer[]): TrainClassOffer[] {
  const maxPrice = config.trainMaxPriceToman > 0 ? config.trainMaxPriceToman : Number.POSITIVE_INFINITY;
  return offers.filter(
    (o) => o.capacity >= config.minSeatsRequired && o.priceToman > 0 && o.priceToman <= maxPrice
  );
}

function trainDedupeKey(offer: TrainClassOffer, dateGregorian: string): string {
  return `${offer.trainNumber}-${dateGregorian}-${offer.wagonName}`;
}

async function processTrainOffers(
  offers: TrainClassOffer[],
  dateGregorian: string,
  dateShamsi: string
): Promise<void> {
  const seenThisRound = new Set<string>();

  for (const offer of offers) {
    const stateKey = trainDedupeKey(offer, dateGregorian);
    seenThisRound.add(stateKey);
    const wasAvailable = trainOfferWasAvailable.get(stateKey) === true;
    trainOfferWasAvailable.set(stateKey, true);

    if (wasAvailable) continue;

    const msg = formatBaleTrainMessage(offer);
    const notifyRes = await sendBaleMessage(config.baleToken, config.baleChatId, msg);
    if (notifyRes.success) {
      alertsSentCount++;
      addLog(
        'train',
        offer.company,
        true,
        `🔔 [${dateShamsi}] هشدار قطار به بله ارسال شد (قطار ${offer.trainNumber})`,
        1,
        `${offer.wagonName} — ${offer.capacity} صندلی`
      );
    } else {
      addLog('train', offer.company, false, `❌ خطا در ارسال بله: ${notifyRes.message}`, 1);
    }
    await sleep(800);
  }

  for (const [key, was] of [...trainOfferWasAvailable.entries()]) {
    if (!key.includes(`-${dateGregorian}-`)) continue;
    if (was && !seenThisRound.has(key)) {
      trainOfferWasAvailable.set(key, false);
    }
  }
}

type TrainProviderId = 'mrbilit' | 'flytoday' | 'ghasedak';

function pickTrainProviderForCycle(): TrainProviderId {
  if (config.trainProvider === 'mrbilit') return 'mrbilit';
  if (config.trainProvider === 'flytoday') return 'flytoday';
  if (config.trainProvider === 'ghasedak') return 'ghasedak';
  return trainPollCounter % 2 === 0 ? 'mrbilit' : 'flytoday';
}

function trainBackoffMsForFailure(provider: TrainProviderId, ghasedakWasLastResort: boolean): number {
  if (ghasedakWasLastResort) return getGhasedakBackoffMs();
  if (provider === 'flytoday') return getFlytodayBackoffMs();
  if (provider === 'ghasedak') return getGhasedakBackoffMs();
  return getTrainBackoffMs();
}

async function fetchTrainFromProvider(
  provider: TrainProviderId,
  routeSlug: string,
  dateGregorian: string
) {
  if (provider === 'ghasedak') {
    return fetchGhasedakAvailability({
      originStationId: config.trainOriginStationId,
      destinationStationId: config.trainDestinationStationId,
      dateGregorian,
      quota: config.trainQuota || 'general',
      routeSlug,
    });
  }
  if (provider === 'flytoday') {
    return fetchFlytodayAvailability({
      originStationId: config.trainOriginStationId,
      destinationStationId: config.trainDestinationStationId,
      dateGregorian,
      quota: config.trainQuota || 'general',
      routeSlug,
    });
  }
  return fetchTrainAvailability({
    originStationId: config.trainOriginStationId,
    destinationStationId: config.trainDestinationStationId,
    dateGregorian,
    quota: config.trainQuota || 'general',
    routeSlug,
    checkIndex: trainPollCounter,
  });
}

// The core scraping checker logic
async function runFlightChecks() {
  const activeAirlines = ALL_AIRLINES.filter((a) => config.enabledAirlines.includes(a.id));
  if (activeAirlines.length === 0) {
    addLog('system', 'سیستم', true, 'هیچ ایرلاینی برای بررسی فعال نیست.', 0);
    return;
  }

  // Get list of dates to check
  const datesToCheck = (config.departureDates && config.departureDates.length > 0)
    ? config.departureDates
    : [config.departureDateGregorian];

  for (const dateGregorian of datesToCheck) {
    const dateShamsi = getJalaliFromGregorianString(dateGregorian);

    for (const airline of activeAirlines) {
      try {
        const link = getAirlineUrl(airline, {
          origin: config.origin,
          destination: config.destination,
          dateGregorian,
          dateShamsi,
          minSeats: config.minSeatsRequired,
        });

        if (config.useSimulationMode) {
          // --- SIMULATION MODE ---
          const roll = Math.random();
          let flights: FlightInfo[] = [];

          if (roll < 0.12) {
            // Found flight!
            const seats = Math.floor(Math.random() * 5) + config.minSeatsRequired; // e.g. 3 to 7 seats
            const hour = Math.floor(Math.random() * 12) + 8;
            const min = ['00', '15', '30', '45'][Math.floor(Math.random() * 4)];
            flights.push({
              airlineId: airline.id,
              airlineName: airline.nameFa,
              flightNumber: `${airline.id.toUpperCase().substring(0, 2)}-${Math.floor(Math.random() * 9000) + 1000}`,
              departureTime: `${hour}:${min}`,
              dateGregorian,
              origin: config.origin,
              destination: config.destination,
              capacity: seats,
              price: Math.floor(Math.random() * 3000000) + 5000000,
              link,
            });
            
            addLog(
              airline.id,
              airline.nameFa,
              true,
              `[${dateShamsi}] شبیه‌سازی: پرواز باز پیدا شد! ظرفیت: ${seats} صندلی`,
              1,
              `یک پرواز خالی در شبیه‌سازی برای تاریخ ${dateShamsi} با موفقیت شناسایی شد.`
            );
          } else if (roll < 0.3) {
            // Found flight but too few seats
            const seats = Math.floor(Math.random() * 2) + 1; // 1 or 2 seats
            const hour = Math.floor(Math.random() * 12) + 8;
            const min = ['00', '15', '30', '45'][Math.floor(Math.random() * 4)];
            flights.push({
              airlineId: airline.id,
              airlineName: airline.nameFa,
              flightNumber: `${airline.id.toUpperCase().substring(0, 2)}-${Math.floor(Math.random() * 9000) + 1000}`,
              departureTime: `${hour}:${min}`,
              dateGregorian,
              origin: config.origin,
              destination: config.destination,
              capacity: seats,
              price: Math.floor(Math.random() * 3000000) + 5000000,
              link,
            });
            addLog(
              airline.id,
              airline.nameFa,
              true,
              `[${dateShamsi}] شبیه‌سازی: پرواز پیدا شد اما صندلی کافی نیست (${seats} صندلی)`,
              1,
              `پرواز پیدا شد ولی صندلی خالی کمتر از حداقل مجاز (${config.minSeatsRequired}) است.`
            );
          } else {
            // No flights
            addLog(
              airline.id,
              airline.nameFa,
              true,
              `[${dateShamsi}] شبیه‌سازی: پروازی یافت نشد یا تکمیل ظرفیت است.`,
              0,
              'تمام پروازها در سیستم شبیه‌ساز تکمیل ظرفیت گزارش شدند.'
            );
          }

          // Handle notifications for open flights
          for (const flight of flights) {
            if (flight.capacity >= config.minSeatsRequired) {
              const key = `${flight.airlineId}-${flight.flightNumber}-${dateGregorian}-${flight.departureTime}-${flight.capacity}`;
              if (!notifiedFlights.has(key)) {
                const msg = formatBaleMessage(flight, link);
                const notifyRes = await sendBaleMessage(config.baleToken, config.baleChatId, msg);
                if (notifyRes.success) {
                  notifiedFlights.add(key);
                  alertsSentCount++;
                  addLog(
                    flight.airlineId,
                    flight.airlineName,
                    true,
                    `🔔 [${dateShamsi}] هشدار پیام‌رسان بله با موفقیت ارسال شد!`,
                    1,
                    `پرواز ${flight.flightNumber} با ظرفیت ${flight.capacity} به بله فرستاده شد.`
                  );
                } else {
                  addLog(
                    flight.airlineId,
                    flight.airlineName,
                    false,
                    `❌ خطا در ارسال پیام به بله: ${notifyRes.message}`,
                    1
                  );
                }
              }
            }
          }
        } else {
          // --- REAL SCRAPING MODE ---
          addLog(airline.id, airline.nameFa, true, `[${dateShamsi}] شروع تلاش برای مانیتورینگ سایت ایرلاین...`, 0);

          // Build request headers to look like a real browser (for fallback)
          const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'fa,en-US;q=0.9,en;q=0.8',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
          };

          let finalLink = link;
          const options: any = {
            headers,
            timeout: 15000,
            validateStatus: () => true, // don't throw on error status codes
          };

          if (config.proxyUrl) {
            if (config.proxyUrl.includes('?url=') || config.proxyUrl.includes('&url=')) {
              // It's a PHP web-tunnel proxy (e.g. 208.ir)
              const separator = config.proxyUrl.endsWith('=') ? '' : '=';
              finalLink = `${config.proxyUrl}${separator}${encodeURIComponent(link)}`;
            } else if (config.proxyUrl.includes('p.php')) {
              const hasQuery = config.proxyUrl.includes('?');
              finalLink = `${config.proxyUrl}${hasQuery ? '&' : '?'}url=${encodeURIComponent(link)}`;
            } else {
              // Standard SOCKS/HTTP proxy agent
              const agent = new HttpsProxyAgent(config.proxyUrl);
              options.httpsAgent = agent;
              options.httpAgent = agent;
            }
          }

          let html = '';
          const browserResult = await fetchHtmlWithBrowser(finalLink, config.proxyUrl);

          if (browserResult.usedBrowser) {
            html = browserResult.html;
            addLog(airline.id, airline.nameFa, true, `[${dateShamsi}] ${browserResult.logMessage}`, 0);
          } else {
            // Fallback to Axios HTTP request
            addLog(airline.id, airline.nameFa, true, `[${dateShamsi}] ${browserResult.logMessage}`, 0);

            let response: any;
            try {
              response = await axios.get(finalLink, options);
            } catch (fetchErr: any) {
              throw new Error(`خطای ارتباطی یا اتمام زمان (Timeout): ${fetchErr.message}`);
            }

            if (response.status !== 200) {
              if (response.status === 403) {
                throw new Error(`خطای ۴۰۳ عدم دسترسی (احتمالاً به دلیل مسدود بودن IP خارجی سرور توسط ایرلاین ایرانی. لطفاً از شبیه‌ساز یا پروکسی ایران در تنظیمات استفاده کنید)`);
              }
              throw new Error(`سایت ایرلاین خطای وضعیت ${response.status} بازگرداند.`);
            }

            html = response.data;
          }

          const flights: FlightInfo[] = [];

          // Parse using Cheerio based on system type
          if (airline.systemType === 'nira') {
            const $ = cheerio.load(html);
            
            $('tr').each((i, row) => {
              const rowText = $(row).text();
              
              if (rowText.includes('ظرفیت') || rowText.includes('صندلی') || rowText.includes('جا دارد') || rowText.includes('موجود')) {
                const flightNoMatch = rowText.match(/([a-zA-Z0-9]{2,}\s*\d{3,4})/);
                const flightNo = flightNoMatch ? flightNoMatch[0].trim() : 'NIRA-' + i;
                
                let capacity = 0;
                const capMatch = rowText.match(/(?:ظرفیت|صندلی|باقیمانده)\s*[:\s]*(&gt;|>)?\s*(\d+)/);
                if (capMatch) {
                  capacity = parseInt(capMatch[2], 10);
                } else if (rowText.includes('>9') || rowText.includes('9+')) {
                  capacity = 9;
                } else if (rowText.includes('جا دارد') || rowText.includes('موجود')) {
                  capacity = 4;
                }

                const timeMatch = rowText.match(/(\d{2}:\d{2})/);
                const depTime = timeMatch ? timeMatch[0] : 'نامعلوم';

                if (capacity > 0) {
                  flights.push({
                    airlineId: airline.id,
                    airlineName: airline.nameFa,
                    flightNumber: flightNo,
                    departureTime: depTime,
                    dateGregorian,
                    origin: config.origin,
                    destination: config.destination,
                    capacity: capacity,
                    link,
                  });
                }
              }
            });

            if (flights.length === 0) {
              $('.flight-list, .flight-item, .availability-item, .flight-row, .card-flight').each((i, el) => {
                const text = $(el).text();
                const timeMatch = text.match(/(\d{2}:\d{2})/);
                const capMatch = text.match(/(?:ظرفیت|صندلی)\s*[:\s]*(\d+)/);
                
                if (timeMatch && (capMatch || text.includes('جا دارد') || text.includes('موجود'))) {
                  const capacity = capMatch ? parseInt(capMatch[1], 10) : 4;
                  flights.push({
                    airlineId: airline.id,
                    airlineName: airline.nameFa,
                    flightNumber: 'NIRA-' + (i + 1),
                    departureTime: timeMatch[0],
                    dateGregorian,
                    origin: config.origin,
                    destination: config.destination,
                    capacity,
                    link,
                  });
                }
              });
            }
          } else if (airline.id === 'sepehran' || airline.systemType === 'sepehran') {
            const $ = cheerio.load(html);
            
            // Helper to convert Persian/Arabic digits to English digits
            const toEnglishDigits = (str: string) => {
              return str
                .replace(/[۰-۹]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 1776))
                .replace(/[٠-٩]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 1632));
            };

            const flightBlocks = $('[data-test="reservePlace"]');
            
            if (flightBlocks.length > 0) {
              flightBlocks.each((i, block) => {
                const blockEl = $(block);
                
                // 1. Time extraction: expect strings like 12:00, 23:00, etc.
                const times: string[] = [];
                blockEl.find('*').each((_, el) => {
                  const t = $(el).text().trim();
                  if (/^\d{2}:\d{2}$/.test(t)) {
                    times.push(t);
                  }
                });
                const departureTime = times[0] || 'نامعلوم';
                
                // 2. Flight Number: Look for 3-4 digits number in elements, or in the whole block
                let flightNo = '';
                blockEl.find('p, span, div').each((_, el) => {
                  const text = $(el).text().trim();
                  if (/^\d{3,4}$/.test(text)) {
                    flightNo = 'IS-' + text;
                  }
                });
                
                if (!flightNo) {
                  const match = blockEl.text().match(/\b\d{3,4}\b/);
                  if (match) {
                    flightNo = 'IS-' + match[0];
                  } else {
                    flightNo = 'IS-' + (4000 + i);
                  }
                }
                
                // 3. Capacity / Seats extraction: Search for text containing "صندلی" or "ظرفیت"
                let capacity = 0;
                blockEl.find('p, span, div').each((_, el) => {
                  const text = $(el).text().trim();
                  const converted = toEnglishDigits(text);
                  if (converted.includes('صندلی') || converted.includes('ظرفیت') || converted.includes('صندلى')) {
                    const capMatch = converted.match(/(\d+)/);
                    if (capMatch) {
                      capacity = parseInt(capMatch[1], 10);
                    } else if (converted.includes('جا دارد') || converted.includes('موجود')) {
                      capacity = 4;
                    }
                  }
                });
                
                if (capacity === 0) {
                  const blockText = toEnglishDigits(blockEl.text());
                  const capMatch = blockText.match(/(\d+)\s*(?:صندلی|ظرفیت)/) || blockText.match(/(?:صندلی|ظرفیت)\s*[:\s]*(\d+)/);
                  if (capMatch) {
                    capacity = parseInt(capMatch[1], 10);
                  }
                }
                
                // 4. Price extraction: Look for text containing "تومان" or "ریال"
                let price = 0;
                blockEl.find('p, span, div').each((_, el) => {
                  const text = $(el).text().trim();
                  const cleanText = text.replace(/٬/g, '').replace(/,/g, '');
                  const converted = toEnglishDigits(cleanText);
                  if (converted.includes('تومان') || converted.includes('ریال')) {
                    const priceMatch = converted.match(/(\d+)/);
                    if (priceMatch) {
                      price = parseInt(priceMatch[1], 10);
                      if (converted.includes('ریال')) {
                        price = Math.floor(price / 10);
                      }
                    }
                  }
                });

                if (capacity > 0) {
                  flights.push({
                    airlineId: airline.id,
                    airlineName: airline.nameFa,
                    flightNumber: flightNo,
                    departureTime,
                    dateGregorian,
                    origin: config.origin,
                    destination: config.destination,
                    capacity,
                    price: price || undefined,
                    link,
                  });
                }
              });
            } else {
              // Fallback if data-test="reservePlace" is not found on the page
              $('div, tr, section').each((i, el) => {
                const text = $(el).text();
                if (text.length < 800) {
                  const converted = toEnglishDigits(text);
                  const timeMatch = converted.match(/(\d{2}:\d{2})/);
                  const capMatch = converted.match(/(\d+)\s*(?:صندلی|ظرفیت)/) || converted.match(/(?:صندلی|ظرفیت)\s*[:\s]*(\d+)/);
                  
                  if (timeMatch && (capMatch || converted.includes('صندلی') || converted.includes('ظرفیت'))) {
                    const capacity = capMatch ? parseInt(capMatch[1], 10) : 4;
                    if (capacity > 0) {
                      flights.push({
                        airlineId: airline.id,
                        airlineName: airline.nameFa,
                        flightNumber: 'IS-' + (4000 + i),
                        departureTime: timeMatch[0],
                        dateGregorian,
                        origin: config.origin,
                        destination: config.destination,
                        capacity,
                        link,
                      });
                    }
                  }
                }
              });
            }
          } else {
            const $ = cheerio.load(html);
            
            // Helper to convert Persian/Arabic digits to English digits
            const toEnglishDigits = (str: string) => {
              return str
                .replace(/[۰-۹]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 1776))
                .replace(/[٠-٩]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 1632));
            };

            $('div, tr, section').each((i, el) => {
              const text = $(el).text();
              const converted = toEnglishDigits(text);
              if (text.length < 500 && (converted.includes('پرواز') || converted.includes('ریال') || converted.includes('تومان')) && (converted.includes('ظرفیت') || converted.includes('صندلی'))) {
                const timeMatch = converted.match(/(\d{2}:\d{2})/);
                const capMatch = converted.match(/(?:ظرفیت|صندلی)\s*[:\s]*(\d+)/);
                if (timeMatch) {
                  const capacity = capMatch ? parseInt(capMatch[1], 10) : 0;
                  if (capacity > 0) {
                    flights.push({
                      airlineId: airline.id,
                      airlineName: airline.nameFa,
                      flightNumber: `${airline.id.toUpperCase().substring(0, 2)}-${1000 + i}`,
                      departureTime: timeMatch[0],
                      dateGregorian,
                      origin: config.origin,
                      destination: config.destination,
                      capacity,
                      link,
                    });
                  }
                }
              }
            });
          }

          if (flights.length === 0) {
            addLog(
              airline.id,
              airline.nameFa,
              true,
              `[${dateShamsi}] بررسی شد: پرواز بازی پیدا نشد (تکمیل ظرفیت).`,
              0,
              `پاسخ سایت با موفقیت دریافت شد ولی در حال حاضر ظرفیت خالی صندلی یافت نشد.`
            );
          } else {
            const matched = flights.filter((f) => f.capacity >= config.minSeatsRequired);
            addLog(
              airline.id,
              airline.nameFa,
              true,
              `[${dateShamsi}] بررسی شد: تعداد ${flights.length} پرواز یافت شد (${matched.length} پرواز با ظرفیت مجاز).`,
              flights.length,
              JSON.stringify(flights, null, 2)
            );

            // Alert for open flights
            for (const flight of matched) {
              const key = `${flight.airlineId}-${flight.flightNumber}-${dateGregorian}-${flight.departureTime}-${flight.capacity}`;
              if (!notifiedFlights.has(key)) {
                const msg = formatBaleMessage(flight, link);
                const notifyRes = await sendBaleMessage(config.baleToken, config.baleChatId, msg);
                if (notifyRes.success) {
                  notifiedFlights.add(key);
                  alertsSentCount++;
                  addLog(
                    flight.airlineId,
                    flight.airlineName,
                    true,
                    `🔔 [${dateShamsi}] هشدار پیام‌رسان بله با موفقیت ارسال شد!`,
                    flights.length,
                    `پرواز ${flight.flightNumber} با ظرفیت ${flight.capacity} به بله فرستاده شد.`
                  );
                } else {
                  addLog(
                    flight.airlineId,
                    flight.airlineName,
                    false,
                    `❌ خطا در ارسال پیام به بله: ${notifyRes.message}`,
                    flights.length
                  );
                }
              }
            }
          }
        }
      } catch (err: any) {
        addLog(
          airline.id,
          airline.nameFa,
          false,
          `[${dateShamsi}] خطا در بررسی: ${err.message}`,
          0,
          `خطای کامل:\n${err.stack || err.message}`
        );
      }
    }
  }
}

function normalizeConfig(input: AppConfig): AppConfig {
  const merged = { ...DEFAULT_CONFIG, ...input };
  merged.trainCheckIntervalMinutes = Math.max(
    TRAIN_MIN_CHECK_INTERVAL_MINUTES,
    merged.trainCheckIntervalMinutes || TRAIN_MIN_CHECK_INTERVAL_MINUTES
  );
  if (!merged.trainRouteSlug) {
    merged.trainRouteSlug = resolveTrainRouteSlug(merged.trainOriginStationId, merged.trainDestinationStationId);
  }
  if (merged.transportMode === 'train' && merged.checkIntervalMinutes < TRAIN_MIN_CHECK_INTERVAL_MINUTES) {
    merged.checkIntervalMinutes = TRAIN_MIN_CHECK_INTERVAL_MINUTES;
  }
  if (merged.trainFallbackToGhasedak === undefined) {
    merged.trainFallbackToGhasedak = true;
  }
  if (merged.trainMaxPriceToman === undefined || merged.trainMaxPriceToman < 0) {
    merged.trainMaxPriceToman = 0;
  }
  return merged;
}

// Manage interval (با jitter و بدون هم‌پوشانی درخواست‌ها)
function restartMonitoring() {
  if (monitoringTimeout) {
    clearTimeout(monitoringTimeout);
    monitoringTimeout = null;
  }

  if (config.isMonitoring) {
    void runMonitoringCycle();
  } else {
    nextCheckTime = null;
  }
}

// Start monitoring on startup
restartMonitoring();

// --- API ENDPOINTS ---

// Get Status
app.get('/api/status', (req, res) => {
  const status: ServerStatus = {
    isMonitoring: config.isMonitoring,
    lastCheckTime,
    nextCheckTime,
    checkCount,
    alertsSentCount,
    activeLogs: scrapeLogs,
  };
  res.json(status);
});

// Get Configuration
app.get('/api/config', (req, res) => {
  res.json(config);
});

// Update Configuration
app.post('/api/config', (req, res) => {
  try {
    const newConfig = normalizeConfig(req.body as AppConfig);

    if (!newConfig.departureDateGregorian && (!newConfig.departureDates || newConfig.departureDates.length === 0)) {
      return res.status(400).json({ error: 'حداقل یک تاریخ پایش الزامی است.' });
    }
    if (modeIncludesFlight(newConfig.transportMode) && (!newConfig.origin || !newConfig.destination)) {
      return res.status(400).json({ error: 'برای پایش پرواز، مبدا و مقصد الزامی است.' });
    }
    if (modeIncludesTrain(newConfig.transportMode) && (!newConfig.trainOriginStationId || !newConfig.trainDestinationStationId)) {
      return res.status(400).json({ error: 'برای پایش قطار، شناسه ایستگاه مبدا و مقصد الزامی است.' });
    }

    const intervalChanged =
      config.checkIntervalMinutes !== newConfig.checkIntervalMinutes ||
      config.trainCheckIntervalMinutes !== newConfig.trainCheckIntervalMinutes ||
      config.transportMode !== newConfig.transportMode ||
      config.isMonitoring !== newConfig.isMonitoring;

    config = newConfig;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));

    if (intervalChanged) {
      restartMonitoring();
    }

    res.json({ success: true, config });
  } catch (err: any) {
    res.status(500).json({ error: `Failed to save config: ${err.message}` });
  }
});

// Trigger Manual Immediate Check
app.post('/api/trigger-check', async (req, res) => {
  try {
    if (monitoringCycleInFlight) {
      return res.status(409).json({ error: 'یک دور پایش در حال اجراست؛ لطفاً چند لحظه بعد دوباره تلاش کنید.' });
    }
    await runMonitoringCycle();
    res.json({ success: true, message: 'Check triggered successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Test Bale Notification
app.post('/api/test-bale', async (req, res) => {
  const { token, chatId } = req.body;
  if (!token || !chatId) {
    return res.status(400).json({ error: 'Token and Chat ID are required for testing' });
  }

  const testMsg = `🔔 <b>تست بلیط‌یاب</b>\n\nاتصال به پیام‌رسان بله با موفقیت برقرار شد! 🎉\n\nزمان تست: ${new Date().toLocaleTimeString('fa-IR')}`;
  const result = await sendBaleMessage(token, chatId, testMsg);

  if (result.success) {
    res.json({ success: true, message: 'پیام تست با موفقیت ارسال شد. لطفاً صندوق بله خود را بررسی کنید.' });
  } else {
    res.status(500).json({ error: result.message });
  }
});

// Clear Logs
app.post('/api/clear-logs', (req, res) => {
  scrapeLogs = [];
  res.json({ success: true });
});

// --- VITE MIDDLEWARE SETUP ---

async function setupVite() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

setupVite();
