import { CONFIG } from './config.js';

// Запоминаем адрес до того, как клиент Supabase уберёт токены из ссылки
export const INITIAL_HASH = location.hash;
export const sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
export const BRAND = CONFIG.BRAND;

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const pageUrl = (file, params = {}) => {
  const u = new URL(file, location.href);
  u.search = '';
  u.hash = '';
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
  return u.toString();
};

// ---------- Деньги и телефоны ----------
export const money = (n) => (n == null || n === '' ? '' : Number(n).toLocaleString('ru-RU').replace(/,/g, ' ') + ' ₸');

export function normPhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  if (d.length === 10) d = '7' + d;
  return d.length >= 11 && d.length <= 15 ? d : null;
}
export function fmtPhone(d) {
  d = String(d || '');
  if (/^7\d{10}$/.test(d)) return `+7 ${d.slice(1, 4)} ${d.slice(4, 7)} ${d.slice(7, 9)} ${d.slice(9, 11)}`;
  return d ? '+' + d : '';
}
export const waLink = (phone, text = '') => `https://wa.me/${normPhone(phone) || ''}${text ? '?text=' + encodeURIComponent(text) : ''}`;
export const telLink = (phone) => `tel:+${normPhone(phone) || ''}`;

// Маска ввода телефона +7 (___) ___-__-__
export function phoneMask(input) {
  const fmt = () => {
    const raw = input.value;
    let nat;
    if (raw.startsWith('+7')) nat = raw.slice(2).replace(/\D/g, '');
    else {
      const d = raw.replace(/\D/g, '');
      nat = d.length >= 11 && (d[0] === '7' || d[0] === '8') ? d.slice(1) : d;
    }
    if (nat[0] === '8') nat = nat.slice(1); // «8» после +7 — это привычный префикс, не часть номера
    nat = nat.slice(0, 10);
    if (!nat && !raw.startsWith('+7')) { input.value = ''; return; }
    let s = '+7';
    if (nat.length) s += ' (' + nat.slice(0, 3);
    if (nat.length > 3) s += ') ' + nat.slice(3, 6);
    if (nat.length > 6) s += '-' + nat.slice(6, 8);
    if (nat.length > 8) s += '-' + nat.slice(8, 10);
    input.value = s;
  };
  input.addEventListener('input', fmt);
  input.addEventListener('focus', () => { if (!input.value) input.value = '+7 ('; });
  input.addEventListener('blur', () => { if (input.value.replace(/\D/g, '').length <= 1) input.value = ''; });
  if (input.value) fmt();
}

// ---------- Даты в часовом поясе бизнеса ----------
const partsCache = new Map();
function dtf(tz) {
  if (!partsCache.has(tz)) {
    partsCache.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
  }
  return partsCache.get(tz);
}
export function tzParts(ts, tz) {
  const p = {};
  for (const x of dtf(tz).formatToParts(new Date(ts))) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour % 24, mm: +p.minute, ss: +p.second };
}
function tzOffsetMin(ts, tz) {
  const p = tzParts(ts, tz);
  return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - Math.floor(ts / 1000) * 1000) / 60000);
}
// "2026-11-09", "14:30", "Asia/Almaty" -> Date (UTC)
export function zonedToUtc(dateStr, timeStr, tz) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = (timeStr || '00:00').split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let res = guess - tzOffsetMin(guess, tz) * 60000;
  const off2 = tzOffsetMin(res, tz);
  res = guess - off2 * 60000;
  return new Date(res);
}
const pad = (n) => String(n).padStart(2, '0');
export const dateStrInTz = (ts, tz) => { const p = tzParts(ts, tz); return `${p.y}-${pad(p.m)}-${pad(p.d)}`; };
export const timeStrInTz = (ts, tz) => { const p = tzParts(ts, tz); return `${pad(p.hh)}:${pad(p.mm)}`; };
export const minutesInTz = (ts, tz) => { const p = tzParts(ts, tz); return p.hh * 60 + p.mm; };
export const todayInTz = (tz) => dateStrInTz(Date.now(), tz);
export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
export function isoWeekday(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}
export const WD_SHORT = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
export const WD_FULL = ['', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
export const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export function humanDate(dateStr, withWeekday = true) {
  const [, m, d] = dateStr.split('-').map(Number);
  return `${d} ${MONTHS_GEN[m - 1]}` + (withWeekday ? `, ${WD_SHORT[isoWeekday(dateStr)].toLowerCase()}` : '');
}
export function humanDateTime(ts, tz) {
  return `${humanDate(dateStrInTz(ts, tz))}, ${timeStrInTz(ts, tz)}`;
}
export function fmtDateShort(ts, tz) {
  const p = tzParts(ts, tz);
  return `${pad(p.d)}.${pad(p.m)}.${p.y}`;
}
export function minsToHHMM(m) { return `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`; }
export function durText(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return [h ? h + ' ч' : '', m ? m + ' мин' : ''].filter(Boolean).join(' ') || '0 мин';
}
export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

// ---------- Ошибки ----------
const ERR_MAP = [
  [/Invalid login credentials/i, 'Неверный email или пароль'],
  [/User already registered/i, 'Этот email уже зарегистрирован — войдите'],
  [/Password should be at least/i, 'Пароль должен быть не короче 6 символов'],
  [/Email not confirmed/i, 'Email не подтверждён — откройте письмо со ссылкой'],
  [/rate limit/i, 'Слишком много попыток. Подождите немного и попробуйте снова'],
  [/Unable to validate email address/i, 'Проверьте email'],
  [/bookings_no_overlap|exclusion/i, 'У этого сотрудника уже есть запись на это время'],
  [/Failed to fetch|NetworkError|Load failed/i, 'Нет связи с сервером. Проверьте интернет'],
  [/JWT expired/i, 'Сессия устарела — обновите страницу'],
];
export function errMsg(e) {
  const m = (e && (e.message || e.error_description || e.error)) || String(e || 'Ошибка');
  for (const [re, t] of ERR_MAP) if (re.test(m)) return t;
  return m;
}

// ---------- UI ----------
export function toast(msg, type = 'ok') {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.append(box); }
  const t = document.createElement('div');
  t.className = 'toast' + (type === 'err' ? ' err' : '');
  t.textContent = msg;
  box.append(t);
  setTimeout(() => t.remove(), type === 'err' ? 5000 : 3000);
}
export const toastErr = (e) => toast(errMsg(e), 'err');

export function modal({ title, body, footer = '', wide = false, onClose }) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
    <div class="modal-h"><h3>${esc(title)}</h3><button class="x" aria-label="Закрыть">×</button></div>
    <div class="modal-b"></div>${footer ? `<div class="modal-f">${footer}</div>` : ''}</div>`;
  const b = $('.modal-b', bg);
  if (typeof body === 'string') b.innerHTML = body; else if (body) b.append(body);
  const close = () => { bg.remove(); document.body.style.overflow = ''; onClose && onClose(); };
  $('.x', bg).onclick = close;
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
  document.addEventListener('keydown', function k(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', k); } });
  document.body.append(bg);
  document.body.style.overflow = 'hidden';
  return { el: bg, body: b, close };
}

export function confirmDlg(text, okText = 'Да', danger = false) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title: 'Подтвердите действие',
      body: `<p>${esc(text)}</p>`,
      footer: `<button class="btn" data-a="no">Отмена</button><button class="btn ${danger ? 'btn-danger' : 'btn-pri'}" data-a="yes">${esc(okText)}</button>`,
      onClose: () => { if (!done) resolve(false); },
    });
    $('[data-a=no]', m.el).onclick = () => { done = true; m.close(); resolve(false); };
    $('[data-a=yes]', m.el).onclick = () => { done = true; m.close(); resolve(true); };
  });
}

export async function busy(btn, fn) {
  const t = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '…';
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = t; }
}

export function copyText(text) {
  const done = () => toast('Скопировано');
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px';
    document.body.append(ta);
    ta.focus(); ta.select(); ta.setSelectionRange(0, text.length);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    if (ok) return done();
    // Совсем старый браузер: показываем ссылку, чтобы скопировать вручную
    const m = modal({ title: 'Скопируйте вручную', body: `<p class="muted small">Нажмите на текст и удерживайте, затем «Скопировать».</p><textarea class="textarea" rows="3" readonly>${esc(text)}</textarea>` });
    const t = m.el.querySelector('textarea'); t.focus(); t.select();
  };
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(done).catch(fallback);
  fallback();
}

export function qrDataUrl(text, size = 600) {
  const qr = window.qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount(), quiet = 4, cell = Math.floor(size / (n + quiet * 2));
  const px = cell * (n + quiet * 2);
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, px, px);
  g.fillStyle = '#0f172a';
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (qr.isDark(r, k)) g.fillRect((k + quiet) * cell, (r + quiet) * cell, cell, cell);
  return c.toDataURL('image/png');
}

export const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* приватный режим */ } },
};

export const STATUS = {
  booked: 'Записан', confirmed: 'Подтвердил', done: 'Пришёл', no_show: 'Не пришёл', cancelled: 'Отменена',
};
export const statusBadge = (s) => `<span class="badge b-${s}">${STATUS[s] || s}</span>`;

const TR = { а: 'a', ә: 'a', б: 'b', в: 'v', г: 'g', ғ: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', і: 'i', й: 'y', к: 'k', қ: 'k', л: 'l', м: 'm', н: 'n', ң: 'n', о: 'o', ө: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ұ: 'u', ү: 'u', ф: 'f', х: 'h', һ: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
export function slugify(s) {
  return String(s || '').toLowerCase().split('').map((c) => (c in TR ? TR[c] : c)).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

export function brandify(root = document) {
  $$('[data-brand]', root).forEach((el) => { el.textContent = BRAND; });
}

// Предоплата: сумма от цены услуги (округление до тенге)
export const prepayAmount = (price, percent) => (price == null ? null : Math.round((Number(price) * Number(percent)) / 100));
