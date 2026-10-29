// Чистая логика утреннего отчёта по топливу («Degvielas Radars»): кому и что отправить. Без сети, поэтому проверяется тестами целиком.
import { langOf } from './push_logic.mjs';

const rigaDate = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Riga', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
const rigaHour = (ms) => parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Riga', hour: '2-digit', hourCycle: 'h23' }).format(ms), 10) % 24;

export const FUEL_LABELS = {
  ru: { 95: '95', 98: '98', diesel: 'дизель', lpg: 'газ' },
  en: { 95: '95', 98: '98', diesel: 'diesel', lpg: 'LPG' },
  lv: { 95: '95', 98: '98', diesel: 'dīzelis', lpg: 'gāze' },
};

// Улица без города: «Viada, Andreja Saharova iela 10» вместо «Viada, Andreja Saharova iela 10, Rīga»
const shortAddress = (a) => String(a || '').split(',')[0].trim();

export function fuelLine(lang, type, f) {
  const label = (FUEL_LABELS[lang] || FUEL_LABELS.ru)[type] || type;
  let line = label + ': ' + Number(f.price).toFixed(3) + ' €';
  const where = [f.chain, shortAddress(f.address)].filter(Boolean).join(', ');
  if (where) line += ' · ' + where;
  if (typeof f.delta === 'number' && Math.abs(f.delta) >= 0.0005) {
    line += ' (' + (f.delta < 0 ? '↓' : '↑') + Math.abs(f.delta * 100).toFixed(1) + ' c)';
  }
  if (f.low30) line += ' ★'; // самая низкая цена за 30 дней
  return line;
}

// Утренний отчёт уходит один раз в сутки в окне «заданный час по Риге + ещё час» (запуски идут с задержками)
// и только если отчёт сегодняшний: вчерашние цены как утренние не отправляем.
// -> { message|null, last: новая дата отправки или null, skipped: причина или null }
export function evaluateMorning(record, report, now, appUrl) {
  const m = record && record.morning;
  if (!m || !Number.isInteger(m.hour) || !Array.isArray(m.fuels) || !m.fuels.length) return { message: null, last: null, skipped: null };
  const t0 = now == null ? Date.now() : now;
  const today = rigaDate(t0);
  const h = rigaHour(t0);
  if (m.last === today || !(h === m.hour || h === (m.hour + 1) % 24)) return { message: null, last: null, skipped: null };
  if (!report || report.date !== today || !report.fuels) return { message: null, last: null, skipped: 'stale-report' };
  const lang = langOf(record);
  const lines = [];
  for (const type of m.fuels) {
    const f = report.fuels[type];
    if (f && typeof f.price === 'number') lines.push(fuelLine(lang, type, f));
  }
  if (!lines.length) return { message: null, last: null, skipped: 'no-prices' };
  const where = lang === 'lv' ? 'Rīga' : lang === 'en' ? 'Riga' : 'Рига';
  return {
    message: { title: 'Degvielas Radars · ' + where, body: lines.join('\n'), url: appUrl, tag: 'fuel-morning' },
    last: today,
    skipped: null,
  };
}
