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

dotenv.config();

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
};

// Load or initialize config
let config: AppConfig = { ...DEFAULT_CONFIG };
try {
  if (fs.existsSync(CONFIG_FILE)) {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    config = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } else {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  }
} catch (err) {
  console.error('Failed to load config, using defaults:', err);
}

// In-Memory Stats & Logs
let checkCount = 0;
let alertsSentCount = 0;
let lastCheckTime: string | null = null;
let nextCheckTime: string | null = null;
let scrapeLogs: ScrapeLogEntry[] = [];
let monitoringInterval: NodeJS.Timeout | null = null;

// Track already notified flight identifiers to prevent spamming the user
// Format: "airlineId-flightNo-departureTime-seatsCount"
const notifiedFlights = new Set<string>();

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
        parse_mode: 'HTML',
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
  return `✈️ <b>پرواز تهران به نجف باز شد!</b>

🏢 <b>ایرلاین:</b> ${flight.airlineName}
🔢 <b>شماره پرواز:</b> ${flight.flightNumber || 'نامعلوم'}
⏰ <b>ساعت پرواز:</b> ${flight.departureTime}
📅 <b>تاریخ:</b> ${dateShamsi} (${flightDate})
💺 <b>ظرفیت خالی:</b> ${flight.capacity} صندلی

🔗 <a href="${link}">جهت رزرو و خرید کلیک کنید</a>

🔔 <i>ملخ هوشمند پرواز تهران نجف</i>`;
}

// The core scraping checker logic
async function runFlightChecks() {
  checkCount++;
  lastCheckTime = new Date().toISOString();
  
  // Calculate next check time
  const next = new Date();
  next.setMinutes(next.getMinutes() + config.checkIntervalMinutes);
  nextCheckTime = next.toISOString();

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
          addLog(airline.id, airline.nameFa, true, `[${dateShamsi}] در حال تلاش برای برقراری ارتباط واقعی با سایت ایرلاین...`, 0);

          // Build request headers to look like a real browser
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

          const html = response.data;
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

// Manage interval
function restartMonitoring() {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }

  if (config.isMonitoring) {
    // Run immediately on start
    runFlightChecks();

    const ms = config.checkIntervalMinutes * 60 * 1000;
    monitoringInterval = setInterval(runFlightChecks, ms);

    const next = new Date();
    next.setMilliseconds(next.getMilliseconds() + ms);
    nextCheckTime = next.toISOString();
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
    const newConfig: AppConfig = req.body;
    
    // Basic validation
    if (!newConfig.origin || !newConfig.destination || (!newConfig.departureDateGregorian && (!newConfig.departureDates || newConfig.departureDates.length === 0))) {
      return res.status(400).json({ error: 'Origin, Destination, and Departure Date are required.' });
    }

    const intervalChanged = config.checkIntervalMinutes !== newConfig.checkIntervalMinutes || config.isMonitoring !== newConfig.isMonitoring;

    config = { ...config, ...newConfig };
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
    await runFlightChecks();
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

  const testMsg = `🔔 <b>تست ربات هوشمند بلیط بله</b>\n\nسیستم مانیتورینگ پروازهای تهران نجف با موفقیت به پیام‌رسان بله متصل شد! 🎉\n\nزمان تست: ${new Date().toLocaleTimeString('fa-IR')}`;
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
