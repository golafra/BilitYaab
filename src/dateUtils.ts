/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export function gregorianToJalali(g_y: number, g_m: number, g_d: number): { jy: number; jm: number; jd: number } {
  const g_days_in_month = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const j_days_in_month = [31, 31, 31, 31, 31, 31, 30, 30, 30, 30, 30, 29];

  let gy = g_y - 1600;
  let gm = g_m - 1;
  let gd = g_d - 1;

  let g_day_no = 365 * gy + Math.floor((gy + 3) / 4) - Math.floor((gy + 99) / 100) + Math.floor((gy + 399) / 400);

  for (let i = 0; i < gm; ++i) {
    g_day_no += g_days_in_month[i];
  }
  if (gm > 1 && ((gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0)) {
    /* leap and after Feb */
    g_day_no++;
  }
  g_day_no += gd;

  let j_day_no = g_day_no - 79;

  const j_np = Math.floor(j_day_no / 12053); /* 12053 = 33*365 + 8 */
  j_day_no = j_day_no % 12053;

  let jy = 979 + 33 * j_np + 4 * Math.floor(j_day_no / 1461); /* 1461 = 4*365 + 1 */

  j_day_no %= 1461;

  if (j_day_no >= 366) {
    jy += Math.floor((j_day_no - 1) / 365);
    j_day_no = (j_day_no - 1) % 365;
  }

  let i = 0;
  for (i = 0; i < 11 && j_day_no >= j_days_in_month[i]; ++i) {
    j_day_no -= j_days_in_month[i];
  }
  const jm = i + 1;
  const jd = j_day_no + 1;

  return { jy, jm, jd };
}

export function formatJalaliDate(jy: number, jm: number, jd: number, separator = "-"): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${jy}${separator}${pad(jm)}${separator}${pad(jd)}`;
}

export function getJalaliFromGregorianString(dateStr: string): string {
  try {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return '';
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const d = parseInt(parts[2], 10);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return '';
    const { jy, jm, jd } = gregorianToJalali(y, m, d);
    return formatJalaliDate(jy, jm, jd);
  } catch {
    return '';
  }
}
