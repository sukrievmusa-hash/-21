import {
  sb, $, $$, esc, money, toast, toastErr, errMsg, modal, confirmDlg, busy, copyText, qrDataUrl, store,
  normPhone, fmtPhone, phoneMask, waLink, telLink, zonedToUtc, dateStrInTz, timeStrInTz, minutesInTz,
  todayInTz, addDays, isoWeekday, WD_SHORT, WD_FULL, humanDate, humanDateTime, fmtDateShort, minsToHHMM,
  durText, plural, statusBadge, STATUS, slugify, pageUrl, BRAND, INITIAL_HASH,
} from './lib.js';
import { renderAuth, renderNewPassword } from './auth.js';

const root = $('#root');
const S = {
  user: null, biz: null, settings: {}, plans: [], staff: [], services: [], links: [], hours: [],
  day: null, view: store.get('kezek_view', 'grid'), dayBookings: [],
};
const TABS = [['journal', 'Журнал'], ['clients', 'Клиенты'], ['services', 'Услуги'], ['staff', 'Сотрудники'], ['ai', 'ИИ-ассистент'], ['settings', 'Настройки'], ['billing', 'Подписка']];
const CATS = ['Барбершоп', 'Салон красоты', 'Ногтевая студия', 'Брови и ресницы', 'Массаж', 'Косметология', 'Репетитор / курсы',
  'Автомойка / детейлинг', 'Фото / видео студия', 'Медицина / стоматология', 'Психолог / консультант', 'Фитнес / тренер', 'Другое'];
const TEMPLATES = {
  'Барбершоп': [['Мужская стрижка', 60, 6000], ['Стрижка бороды', 30, 3500], ['Стрижка + борода', 90, 8500], ['Детская стрижка', 45, 4000]],
  'Салон красоты': [['Женская стрижка', 60, 7000], ['Окрашивание', 150, 20000], ['Укладка', 45, 5000]],
  'Ногтевая студия': [['Маникюр с покрытием', 90, 7000], ['Педикюр с покрытием', 90, 9000], ['Снятие покрытия', 30, 2000]],
  'Брови и ресницы': [['Коррекция и окрашивание бровей', 45, 5000], ['Ламинирование ресниц', 60, 9000], ['Наращивание ресниц', 120, 12000]],
  'Массаж': [['Классический массаж', 60, 10000], ['Массаж спины', 30, 6000]],
  'Косметология': [['Чистка лица', 90, 15000], ['Консультация косметолога', 30, 5000]],
  'Репетитор / курсы': [['Индивидуальное занятие', 60, 6000], ['Пробный урок', 30, 0]],
  'Автомойка / детейлинг': [['Комплексная мойка', 60, 6000], ['Мойка кузова', 30, 3500], ['Химчистка салона', 180, 35000]],
  'Фото / видео студия': [['Аренда студии, 1 час', 60, 10000], ['Фотосессия', 60, 25000]],
  'Медицина / стоматология': [['Консультация врача', 30, 8000], ['Профессиональная чистка зубов', 60, 20000]],
  'Психолог / консультант': [['Первичная консультация', 50, 10000], ['Консультация', 50, 15000]],
  'Фитнес / тренер': [['Персональная тренировка', 60, 8000]],
};
const TIMEZONES = [
  ['Asia/Almaty', 'Казахстан (UTC+5)'], ['Asia/Tashkent', 'Узбекистан (UTC+5)'], ['Asia/Bishkek', 'Кыргызстан (UTC+6)'],
  ['Asia/Dushanbe', 'Таджикистан (UTC+5)'], ['Europe/Moscow', 'Москва (UTC+3)'], ['Asia/Yekaterinburg', 'Екатеринбург (UTC+5)'],
  ['Asia/Novosibirsk', 'Новосибирск (UTC+7)'], ['Asia/Baku', 'Азербайджан (UTC+4)'], ['Europe/Istanbul', 'Турция (UTC+3)'], ['Asia/Dubai', 'ОАЭ (UTC+4)'],
];
const tz = () => S.biz.timezone;
const bookUrl = () => pageUrl('book.html', { b: S.biz.slug });
const activeStaff = () => S.staff.filter((s) => s.is_active);
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const planOf = (code) => S.plans.find((p) => p.code === code) || { code, title: code, price: 0, staff_limit: 1, ai: false, ai_limit: 0 };
const curPlan = () => planOf(S.biz.plan);
async function fnErr(error) {
  try { const j = await error.context.json(); return j.error || errMsg(error); } catch { return errMsg(error); }
}

// ---------- Запуск ----------
let recovery = INITIAL_HASH.includes('type=recovery');
const afterRecovery = () => { recovery = false; boot(); };
sb.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') { recovery = true; renderNewPassword(root, afterRecovery); }
  if (event === 'SIGNED_OUT') { S.user = null; S.biz = null; showAuth(); }
});
window.addEventListener('hashchange', () => { if (S.biz) route(); });
boot();

function showAuth() {
  renderAuth(root, { mode: location.hash === '#signup' ? 'signup' : 'login', onDone: boot });
}

async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return showAuth();
  if (recovery) return renderNewPassword(root, afterRecovery);
  S.user = session.user;
  if (location.hash === '#signup') history.replaceState(null, '', location.pathname);
  const [{ data: biz, error }, { data: settings }, { data: plans }] = await Promise.all([
    sb.from('businesses').select('*').eq('owner_id', S.user.id).maybeSingle(),
    sb.from('platform_settings').select('*').eq('id', 1).maybeSingle(),
    sb.from('plans').select('*').order('sort'),
  ]);
  S.plans = plans || [];
  if (error) { root.innerHTML = `<div class="empty">Ошибка загрузки: ${esc(errMsg(error))}<br><button class="btn" onclick="location.reload()">Обновить</button></div>`; return; }
  S.settings = settings || {};
  if (!biz) return renderOnboarding();
  S.biz = biz;
  await loadRefs();
  renderShell();
  route();
}

async function reloadBiz() {
  const { data } = await sb.from('businesses').select('*').eq('id', S.biz.id).single();
  if (data) S.biz = data;
}

async function loadRefs() {
  const id = S.biz.id;
  const [st, sv, ln, wh] = await Promise.all([
    sb.from('staff').select('*').eq('business_id', id).order('sort').order('created_at'),
    sb.from('services').select('*').eq('business_id', id).order('sort').order('name'),
    sb.from('staff_services').select('*').eq('business_id', id),
    sb.from('working_hours').select('*').eq('business_id', id).order('start_time'),
  ]);
  S.staff = st.data || []; S.services = sv.data || []; S.links = ln.data || []; S.hours = wh.data || [];
}

// ---------- Онбординг ----------
function renderOnboarding() {
  root.innerHTML = `<div class="auth-wrap"><div class="auth-card" style="max-width:540px">
    <div class="center" style="margin-bottom:18px"><span class="logo"><i>K</i><span>${esc(BRAND)}</span></span></div>
    <div class="card"><form id="of" class="stack" novalidate>
      <div><h2 style="margin-bottom:4px">Расскажите о бизнесе</h2><p class="muted small" style="margin:0">Это займёт минуту. Всё можно изменить позже.</p></div>
      <label class="field"><span>Название</span><input class="input" name="name" required maxlength="80" placeholder="Например: Барбершоп «Сарбаз»"></label>
      <label class="field"><span>Сфера</span><select class="select" name="category">${CATS.map((c) => `<option>${esc(c)}</option>`).join('')}</select></label>
      <label class="field"><span>Адрес вашей страницы записи</span><input class="input" name="slug" required maxlength="40" placeholder="sarbaz-barber" autocapitalize="off" autocomplete="off">
        <small id="slugHint">Латинские буквы, цифры и дефис</small></label>
      <div class="form-grid">
        <label class="field"><span>Телефон для клиентов</span><input class="input" name="phone" type="tel" placeholder="+7 (___) ___-__-__"></label>
        <label class="field"><span>Ваше имя (как мастера)</span><input class="input" name="staff" maxlength="60" placeholder="Айгерим"></label>
        <label class="field full"><span>Адрес</span><input class="input" name="address" maxlength="160" placeholder="г. Алматы, ул. Толе би, 100"></label>
      </div>
      <button class="btn btn-pri btn-lg btn-block">Создать страницу записи</button>
      <button class="btn btn-ghost btn-block" type="button" id="lo">Выйти</button>
    </form></div></div></div>`;
  const f = $('#of');
  phoneMask(f.phone);
  let slugTouched = false, timer;
  const check = () => {
    clearTimeout(timer);
    const v = f.slug.value.trim().toLowerCase();
    const hint = $('#slugHint');
    if (!v) { hint.textContent = 'Латинские буквы, цифры и дефис'; return; }
    hint.textContent = '…';
    timer = setTimeout(async () => {
      const { data } = await sb.rpc('check_slug', { p_slug: v });
      if (f.slug.value.trim().toLowerCase() !== v) return;
      hint.innerHTML = data ? `✅ Свободно: <b>${esc(pageUrl('book.html', { b: v }))}</b>` : '❌ Занято или недопустимо — попробуйте другой вариант';
    }, 350);
  };
  f.name.oninput = () => { if (!slugTouched) { f.slug.value = slugify(f.name.value); check(); } };
  f.slug.oninput = () => { slugTouched = true; f.slug.value = f.slug.value.toLowerCase().replace(/[^a-z0-9-]/g, ''); check(); };
  $('#lo').onclick = () => sb.auth.signOut();
  f.onsubmit = async (e) => {
    e.preventDefault();
    if (f.name.value.trim().length < 2) return toastErr('Укажите название');
    if (f.slug.value.trim().length < 3) return toastErr('Адрес страницы — минимум 3 символа');
    await busy($('button.btn-pri', f), async () => {
      const { error } = await sb.rpc('create_business', {
        p_name: f.name.value.trim(), p_slug: f.slug.value.trim(), p_category: f.category.value,
        p_phone: f.phone.value.trim() || null, p_address: f.address.value.trim() || null, p_staff_name: f.staff.value.trim() || null,
      });
      if (error) return toastErr(error);
      toast('Готово! Теперь добавьте услуги');
      location.hash = '#services';
      await boot();
    });
  };
}

// ---------- Оболочка ----------
function renderShell() {
  root.innerHTML = `
    <header class="topbar">
      <div class="container">
        <a class="logo" href="index.html"><i>K</i><span>${esc(BRAND)}</span></a>
        <span class="biz grow" id="bizName">${esc(S.biz.name)}</span>
        <a class="btn btn-sm" target="_blank" rel="noopener" href="${esc(bookUrl())}">Моя страница ↗</a>
        <button class="btn btn-sm btn-ghost" id="logout" title="Выйти">Выйти</button>
      </div>
      <div class="container"><nav class="tabs">${TABS.map(([k, t]) => `<a class="tab" href="#${k}" data-t="${k}">${t}</a>`).join('')}</nav></div>
    </header>
    <div class="container"><div id="banner" style="margin-top:14px"></div><main class="page" id="page"></main></div>`;
  $('#logout').onclick = () => sb.auth.signOut();
}

function route() {
  const t = location.hash.slice(1);
  const tab = TABS.some(([k]) => k === t) ? t : 'journal';
  $$('.tab').forEach((a) => a.classList.toggle('active', a.dataset.t === tab));
  renderBanner();
  const fn = { journal: renderJournal, clients: renderClients, services: renderServices, staff: renderStaff, ai: renderAi, settings: renderSettings, billing: renderBilling }[tab];
  fn();
}

function daysLeft() { return Math.ceil((new Date(S.biz.paid_until) - Date.now()) / 86400000); }

function renderBanner() {
  const b = $('#banner');
  const d = daysLeft();
  const support = S.settings.support_contact ? ` Поддержка: ${esc(S.settings.support_contact)}` : '';
  if (S.biz.is_blocked) b.innerHTML = `<div class="alert alert-danger">Аккаунт заблокирован.${support}</div>`;
  else if (d <= 0) b.innerHTML = `<div class="alert alert-danger">⛔ Подписка закончилась — онлайн-запись для клиентов отключена. <a href="#billing"><b>Продлить</b></a></div>`;
  else if (S.biz.plan === 'trial') b.innerHTML = `<div class="alert alert-info">🎁 Пробный период: осталось ${d} ${plural(d, 'день', 'дня', 'дней')}. <a href="#billing">Тарифы</a></div>`;
  else if (d <= 5) b.innerHTML = `<div class="alert alert-warn">⚠️ Подписка закончится через ${d} ${plural(d, 'день', 'дня', 'дней')}. <a href="#billing"><b>Продлить</b></a></div>`;
  else b.innerHTML = '';
}

// ---------- Журнал ----------
function checklistHtml() {
  const k = 'kezek_onb_' + S.biz.id;
  const st = store.get(k, {});
  if (st.hidden) return '';
  const items = [
    [S.services.length > 0, '#services', 'Добавьте услуги и цены'],
    [!!st.hours, '#staff', 'Проверьте график работы сотрудников'],
    [!!S.biz.tg_chat_id, '#settings', 'Подключите уведомления о записях в Telegram'],
    [!!st.shared, '#settings', 'Разместите ссылку для записи в Instagram, WhatsApp и 2GIS'],
  ];
  if (items.every((i) => i[0])) return '';
  const done = items.filter((i) => i[0]).length;
  return `<div class="card" style="margin-bottom:14px"><div class="row between"><h3 style="margin:0">Быстрый старт: ${done} из ${items.length}</h3>
    <button class="btn btn-sm btn-ghost" id="hideOnb">Скрыть</button></div>
    <ul class="checklist" style="margin:10px 0 0;padding-left:20px">${items.map(([ok, href, t]) => `<li class="${ok ? 'done' : ''}"><a href="${href}">${t}</a></li>`).join('')}</ul></div>`;
}
function onbFlag(key) {
  const k = 'kezek_onb_' + S.biz.id;
  store.set(k, { ...store.get(k, {}), [key]: true });
}

function renderJournal() {
  if (!S.day) S.day = todayInTz(tz());
  $('#page').innerHTML = `${checklistHtml()}
    <div class="page-h">
      <div class="day-nav">
        <button class="btn btn-sm" id="prev" aria-label="Предыдущий день">‹</button>
        <div class="day-title" id="dt"></div>
        <button class="btn btn-sm" id="next" aria-label="Следующий день">›</button>
        <button class="btn btn-sm btn-ghost" id="today">Сегодня</button>
        <input type="date" class="input input-sm" id="dpick" style="width:auto">
      </div>
      <div class="row">
        <div class="seg" style="margin:0"><button data-v="grid">Сетка</button><button data-v="list">Список</button></div>
        <button class="btn btn-pri" id="add">+ Запись</button>
      </div>
    </div>
    <div class="grid grid-4 keep-2" id="kpi" style="margin-bottom:14px"></div>
    <div id="jr"><div class="spinner"></div></div>`;
  $('#hideOnb') && ($('#hideOnb').onclick = () => { onbFlag('hidden'); renderJournal(); });
  $('#prev').onclick = () => { S.day = addDays(S.day, -1); drawDay(); };
  $('#next').onclick = () => { S.day = addDays(S.day, 1); drawDay(); };
  $('#today').onclick = () => { S.day = todayInTz(tz()); drawDay(); };
  $('#dpick').onchange = (e) => { if (e.target.value) { S.day = e.target.value; drawDay(); } };
  $$('[data-v]').forEach((b) => { b.onclick = () => { S.view = b.dataset.v; store.set('kezek_view', S.view); drawDay(); }; });
  $('#add').onclick = () => bookingModal(null, { date: S.day });
  drawDay();
}

async function drawDay() {
  const day = S.day;
  $('#dt').textContent = `${capital(WD_FULL[isoWeekday(day)])}, ${humanDate(day, false)}`;
  $('#dpick').value = day;
  $$('[data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v === S.view));
  const from = zonedToUtc(day, '00:00', tz()), to = zonedToUtc(addDays(day, 1), '00:00', tz());
  const { data, error } = await sb.from('bookings').select('*').eq('business_id', S.biz.id)
    .gte('starts_at', from.toISOString()).lt('starts_at', to.toISOString()).order('starts_at');
  if (S.day !== day || !$('#jr')) return;
  if (error) { $('#jr').innerHTML = `<div class="alert alert-danger">${esc(errMsg(error))}</div>`; return; }
  S.dayBookings = data;
  const act = data.filter((b) => b.status !== 'cancelled');
  $('#kpi').innerHTML = [
    [act.length, plural(act.length, 'запись', 'записи', 'записей')],
    [act.filter((b) => b.source === 'online').length, 'онлайн'],
    [money(act.reduce((s, b) => s + (b.status !== 'no_show' ? b.price || 0 : 0), 0)) || '0 ₸', 'ожидаемая выручка'],
    [data.filter((b) => b.status === 'cancelled').length + ' / ' + act.filter((b) => b.status === 'no_show').length, 'отмен / неявок'],
  ].map(([v, l]) => `<div class="card stat flat"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');
  if (S.view === 'list') drawList(data); else drawGrid(act, day);
}

function drawGrid(items, day) {
  const box = $('#jr');
  const staff = activeStaff();
  if (!staff.length) { box.innerHTML = '<div class="empty card">Добавьте сотрудника в разделе <a href="#staff">«Сотрудники»</a></div>'; return; }
  const wd = isoWeekday(day);
  const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const cols = staff.map((s) => ({ id: s.id, name: s.name, title: s.title, hours: S.hours.filter((h) => h.staff_id === s.id && h.weekday === wd) }));
  const orphans = items.filter((b) => !staff.some((s) => s.id === b.staff_id));
  if (orphans.length) cols.push({ id: null, name: 'Без мастера', hours: [] });

  let minM = 24 * 60, maxM = 0;
  for (const c of cols) for (const h of c.hours) { minM = Math.min(minM, toMin(h.start_time)); maxM = Math.max(maxM, toMin(h.end_time)); }
  for (const b of items) {
    const s = minutesInTz(b.starts_at, tz());
    minM = Math.min(minM, s);
    maxM = Math.max(maxM, Math.min(24 * 60, s + (new Date(b.ends_at) - new Date(b.starts_at)) / 60000));
  }
  if (minM >= maxM) { minM = 9 * 60; maxM = 20 * 60; }
  minM = Math.max(0, Math.floor(minM / 60) * 60 - 60);
  maxM = Math.min(24 * 60, Math.ceil(maxM / 60) * 60 + 60);
  const PX = 1.25;
  const H = (maxM - minM) * PX;
  const y = (m) => (m - minM) * PX;

  let times = '';
  for (let m = minM + 60; m < maxM; m += 60) times += `<div style="top:${y(m)}px">${minsToHHMM(m)}</div>`;
  let lines = '';
  for (let m = minM; m < maxM; m += 30) lines += `<div class="jr-line ${m % 60 ? 'half' : ''}" style="top:${y(m)}px"></div>`;
  const isToday = day === todayInTz(tz());
  const nowLine = isToday ? `<div class="jr-now" style="top:${y(minutesInTz(Date.now(), tz()))}px"></div>` : '';

  const colHtml = cols.map((c, i) => {
    const work = c.hours.map((h) => `<div class="jr-work" style="top:${y(toMin(h.start_time))}px;height:${(toMin(h.end_time) - toMin(h.start_time)) * PX}px"></div>`).join('');
    const evs = items.filter((b) => (c.id ? b.staff_id === c.id : !staff.some((s) => s.id === b.staff_id))).map((b) => {
      const s = minutesInTz(b.starts_at, tz());
      const dur = (new Date(b.ends_at) - new Date(b.starts_at)) / 60000;
      return `<div class="jr-ev ev-${b.status}" data-id="${b.id}" style="top:${y(s)}px;height:${Math.max(dur * PX - 2, 24)}px">
        <b>${timeStrInTz(b.starts_at, tz())}–${timeStrInTz(b.ends_at, tz())} ${esc(b.client_name)}</b>
        <span>${esc(b.service_name || '')}${b.source === 'online' ? ' · онлайн' : ''}</span></div>`;
    }).join('');
    return `<div class="jr-col" data-col="${i}" style="height:${H}px">${work}${lines}${nowLine}${evs}</div>`;
  }).join('');

  box.innerHTML = `<div class="jr-wrap"><div class="jr" style="grid-template-columns:52px repeat(${cols.length}, minmax(150px, 1fr))">
    <div class="jr-head"></div>${cols.map((c) => `<div class="jr-head">${esc(c.name)}${c.title ? `<small>${esc(c.title)}</small>` : ''}</div>`).join('')}
    <div class="jr-times" style="height:${H}px">${times}</div>${colHtml}</div></div>
    <p class="muted small" style="margin-top:8px">Нажмите на свободное место в колонке, чтобы добавить запись. Серым — нерабочее время.</p>`;

  $$('.jr-ev', box).forEach((el) => {
    el.onclick = (e) => { e.stopPropagation(); bookingModal(S.dayBookings.find((b) => b.id === el.dataset.id)); };
  });
  $$('.jr-col', box).forEach((el) => {
    el.onclick = (e) => {
      const c = cols[+el.dataset.col];
      const step = S.biz.slot_step || 30;
      const m = Math.floor((minM + (e.clientY - el.getBoundingClientRect().top) / PX) / step) * step;
      bookingModal(null, { date: day, time: minsToHHMM(Math.max(0, m)), staff_id: c.id });
    };
  });
  if (isToday && S.scrolledDay !== day) {
    S.scrolledDay = day;
    const wrap = $('.jr-wrap', box);
    const target = y(minutesInTz(Date.now(), tz())) - 120;
    if (target > 0) window.scrollTo({ top: wrap.getBoundingClientRect().top + window.scrollY + target - 80, behavior: 'smooth' });
  }
}

function drawList(items) {
  const box = $('#jr');
  if (!items.length) { box.innerHTML = '<div class="card empty"><div class="ico">🗓</div>На этот день записей нет</div>'; return; }
  box.innerHTML = `<div class="card day-list">${items.map((b) => `
    <div class="item ${b.status === 'cancelled' ? 'cancelled' : ''}" data-id="${b.id}" style="cursor:pointer">
      <div class="t">${timeStrInTz(b.starts_at, tz())}</div>
      <div class="grow"><div class="who"><b>${esc(b.client_name)}</b> <span class="muted small">${fmtPhone(b.client_phone)}</span></div>
        <div class="muted small">${[b.service_name, b.staff_name, b.price != null ? money(b.price) : '', b.source === 'online' ? 'онлайн' : ''].filter(Boolean).map(esc).join(' · ')}</div>
        ${b.comment ? `<div class="small">💬 ${esc(b.comment)}</div>` : ''}</div>
      ${statusBadge(b.status)}
      <a class="btn btn-sm btn-ghost" href="${telLink(b.client_phone)}" title="Позвонить" data-stop>📞</a>
      <a class="btn btn-sm btn-ghost" target="_blank" rel="noopener" href="${esc(waLink(b.client_phone, reminderText(b)))}" title="Напомнить в WhatsApp" data-stop>💬</a>
    </div>`).join('')}</div>`;
  $$('[data-stop]', box).forEach((a) => a.addEventListener('click', (e) => e.stopPropagation()));
  $$('.item', box).forEach((el) => { el.onclick = () => bookingModal(S.dayBookings.find((b) => b.id === el.dataset.id)); });
}

function reminderText(b) {
  return `Здравствуйте, ${b.client_name}! Напоминаем о записи в «${S.biz.name}» ${humanDateTime(b.starts_at, tz())}` +
    `${b.service_name ? ` (${b.service_name})` : ''}. Ждём вас!`;
}

// ---------- Модалка записи ----------
function bookingModal(b, pre = {}) {
  const isNew = !b;
  const services = S.services.filter((s) => s.is_active || (b && s.id === b.service_id));
  const staff = S.staff.filter((s) => s.is_active || (b && s.id === b.staff_id));
  if (isNew && !staff.length) return toastErr('Сначала добавьте сотрудника');
  const date = b ? dateStrInTz(b.starts_at, tz()) : (pre.date || S.day || todayInTz(tz()));
  const time = b ? timeStrInTz(b.starts_at, tz()) : (pre.time || '10:00');
  const svc0 = b ? services.find((s) => s.id === b.service_id) : services[0];
  const dur = b ? Math.round((new Date(b.ends_at) - new Date(b.starts_at)) / 60000) : (svc0?.duration_min || 60);
  const price = b ? b.price : svc0?.price;
  const staffSel = b ? b.staff_id : (pre.staff_id || staff[0]?.id);

  const body = document.createElement('div');
  body.innerHTML = `<form id="bf" class="form-grid" novalidate>
    ${!isNew ? `<div class="full row between"><div>${statusBadge(b.status)} <span class="muted small">${b.source === 'online' ? 'онлайн-запись' : 'добавлена вручную'}${b.tg_chat_id ? ' · 🔔 Telegram' : ''}</span></div>
      <div class="row"><a class="btn btn-sm" href="${telLink(b.client_phone)}">📞 Позвонить</a>
      <a class="btn btn-sm btn-wa" target="_blank" rel="noopener" href="${esc(waLink(b.client_phone, reminderText(b)))}">WhatsApp</a></div></div>` : ''}
    <label class="field"><span>Телефон клиента</span><input class="input" name="phone" type="tel" required placeholder="+7 (___) ___-__-__"></label>
    <label class="field"><span>Имя клиента</span><input class="input" name="name" required maxlength="80"></label>
    <label class="field"><span>Услуга</span><select class="select" name="service"><option value="">— без услуги —</option>
      ${services.map((s) => `<option value="${s.id}" ${svc0 && s.id === svc0.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
    <label class="field"><span>Сотрудник</span><select class="select" name="staff">
      ${staff.map((s) => `<option value="${s.id}" ${s.id === staffSel ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
    <label class="field"><span>Дата</span><input class="input" type="date" name="date" required value="${date}"></label>
    <label class="field"><span>Время</span><input class="input" type="time" name="time" step="300" required value="${time}"></label>
    <label class="field"><span>Длительность, мин</span><input class="input" type="number" name="dur" min="5" max="720" step="5" value="${dur}"></label>
    <label class="field"><span>Цена, ₸</span><input class="input" type="number" name="price" min="0" step="100" value="${price ?? ''}"></label>
    <label class="field full"><span>Комментарий</span><textarea class="textarea" name="comment" rows="2" maxlength="500">${esc(b?.comment || '')}</textarea></label>
    ${!isNew && b.status !== 'cancelled' ? `<div class="full"><span class="small muted">Статус визита</span>
      <div class="row" style="margin-top:6px">${['booked', 'confirmed', 'done', 'no_show'].map((s) => `<button type="button" class="btn btn-sm ${b.status === s ? 'btn-pri' : ''}" data-status="${s}">${STATUS[s]}</button>`).join('')}</div></div>` : ''}
  </form>`;
  const footer = `${!isNew && b.status !== 'cancelled' ? '<button class="btn btn-danger" data-a="cancel">Отменить запись</button>' : ''}
    ${!isNew && b.status === 'cancelled' ? '<button class="btn" data-a="restore">Восстановить</button>' : ''}
    <button class="btn" data-a="close">Закрыть</button><button class="btn btn-pri" data-a="save">${isNew ? 'Записать' : 'Сохранить'}</button>`;
  const m = modal({ title: isNew ? 'Новая запись' : 'Запись', body, footer });
  const f = $('#bf', m.el);
  f.phone.value = b ? fmtPhone(b.client_phone) : (pre.phone ? fmtPhone(pre.phone) : '');
  f.name.value = b ? b.client_name : (pre.name || '');
  phoneMask(f.phone);
  f.phone.addEventListener('blur', async () => {
    const p = normPhone(f.phone.value);
    if (!p || f.name.value.trim()) return;
    const { data } = await sb.from('clients').select('name').eq('business_id', S.biz.id).eq('phone', p).maybeSingle();
    if (data && !f.name.value.trim()) f.name.value = data.name;
  });
  f.service.onchange = () => {
    const s = S.services.find((x) => x.id === f.service.value);
    if (s) { f.dur.value = s.duration_min; f.price.value = s.price ?? ''; }
  };
  const close = () => m.close();
  $('[data-a=close]', m.el).onclick = close;

  const update = async (patch, okMsg) => {
    const { error } = await sb.from('bookings').update(patch).eq('id', b.id);
    if (error) return toastErr(error);
    toast(okMsg);
    close();
    drawDayIfJournal();
  };
  $$('[data-status]', m.el).forEach((btn) => { btn.onclick = () => update({ status: btn.dataset.status }, 'Статус: ' + STATUS[btn.dataset.status]); });
  const cancelBtn = $('[data-a=cancel]', m.el);
  if (cancelBtn) cancelBtn.onclick = async () => {
    if (!(await confirmDlg('Отменить запись? Если клиент подключил Telegram, он получит уведомление.', 'Отменить запись', true))) return;
    update({ status: 'cancelled' }, 'Запись отменена');
  };
  const restoreBtn = $('[data-a=restore]', m.el);
  if (restoreBtn) restoreBtn.onclick = () => update({ status: 'booked' }, 'Запись восстановлена');

  $('[data-a=save]', m.el).onclick = async (e) => {
    const phone = normPhone(f.phone.value);
    const name = f.name.value.trim();
    if (!phone) return toastErr('Укажите телефон клиента полностью');
    if (!name) return toastErr('Укажите имя клиента');
    if (!f.date.value || !f.time.value) return toastErr('Укажите дату и время');
    const durMin = Math.max(5, parseInt(f.dur.value, 10) || 60);
    const starts = zonedToUtc(f.date.value, f.time.value, tz());
    const payload = {
      client_phone: phone, client_name: name, service_id: f.service.value || null, staff_id: f.staff.value || null,
      starts_at: starts.toISOString(), ends_at: new Date(starts.getTime() + durMin * 60000).toISOString(),
      price: f.price.value === '' ? null : Math.max(0, parseInt(f.price.value, 10) || 0),
      comment: f.comment.value.trim() || null,
    };
    await busy(e.target, async () => {
      const q = isNew ? sb.from('bookings').insert({ ...payload, business_id: S.biz.id }) : sb.from('bookings').update(payload).eq('id', b.id);
      const { error } = await q;
      if (error) return toastErr(error);
      toast(isNew ? 'Запись добавлена' : 'Сохранено');
      close();
      S.day = f.date.value;
      drawDayIfJournal();
    });
  };
}

function drawDayIfJournal() {
  if ($('#jr')) drawDay();
}

// ---------- Клиенты ----------
async function renderClients() {
  $('#page').innerHTML = `<div class="page-h"><h2>Клиенты</h2>
      <div class="row"><input class="input" id="q" placeholder="Поиск по имени или телефону" style="min-width:240px"><button class="btn btn-pri" id="add">+ Клиент</button></div></div>
    <div class="grid grid-4 keep-2" id="kpi" style="margin-bottom:14px"></div>
    <div class="card" style="padding:0"><div class="table-wrap" id="tbl"><div class="spinner"></div></div></div>`;
  $('#add').onclick = () => clientModal(null);
  let timer;
  $('#q').oninput = (e) => { clearTimeout(timer); timer = setTimeout(() => load(e.target.value), 300); };
  const from = new Date(Date.now() - 30 * 86400000), to = new Date();
  sb.rpc('owner_stats', { p_from: from.toISOString(), p_to: to.toISOString() }).then(({ data }) => {
    if (!data || !$('#kpi')) return;
    $('#kpi').innerHTML = [
      [data.total, 'записей за 30 дней'], [data.online, 'из них онлайн'],
      [money(data.revenue) || '0 ₸', 'выручка (пришли)'], [data.new_clients, 'новых клиентов'],
    ].map(([v, l]) => `<div class="card stat flat"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');
  });
  load('');
  async function load(q) {
    const { data, error } = await sb.rpc('owner_clients', { p_search: q || null });
    const box = $('#tbl');
    if (!box) return;
    if (error) { box.innerHTML = `<div class="empty">${esc(errMsg(error))}</div>`; return; }
    if (!data.length) { box.innerHTML = `<div class="empty"><div class="ico">👥</div>${q ? 'Никого не нашли' : 'Клиенты появятся после первых записей'}</div>`; return; }
    box.innerHTML = `<table class="table"><thead><tr><th>Клиент</th><th>Телефон</th><th>Визитов</th><th>Неявок</th><th>Последняя запись</th><th>Сумма</th></tr></thead>
      <tbody>${data.map((c) => `<tr class="clickable" data-id="${c.id}"><td><b>${esc(c.name)}</b>${c.tg ? ' <span title="Подключён Telegram">🔔</span>' : ''}${c.notes ? `<div class="muted small">${esc(c.notes.slice(0, 60))}</div>` : ''}</td>
        <td class="nowrap">${fmtPhone(c.phone)}</td><td>${c.visits}</td><td>${c.no_shows || ''}</td>
        <td class="nowrap">${c.last_visit ? fmtDateShort(c.last_visit, tz()) : '—'}</td><td class="nowrap">${c.spent ? money(c.spent) : ''}</td></tr>`).join('')}</tbody></table>`;
    $$('tr[data-id]', box).forEach((tr) => { tr.onclick = () => clientModal(data.find((c) => c.id === tr.dataset.id), () => load($('#q').value)); });
  }
}

async function clientModal(c, onSaved) {
  const isNew = !c;
  const body = document.createElement('div');
  body.innerHTML = `<form id="cf" class="form-grid" novalidate>
      <label class="field"><span>Имя</span><input class="input" name="name" required maxlength="80" value="${esc(c?.name || '')}"></label>
      <label class="field"><span>Телефон</span><input class="input" name="phone" type="tel" required></label>
      <label class="field full"><span>Заметки</span><textarea class="textarea" name="notes" maxlength="2000" placeholder="Предпочтения, аллергии, любимый мастер…">${esc(c?.notes || '')}</textarea></label>
    </form>
    ${!isNew ? `<div class="row" style="margin:14px 0"><button class="btn btn-sm btn-pri" id="book">+ Записать</button>
      <a class="btn btn-sm" href="${telLink(c.phone)}">📞 Позвонить</a><a class="btn btn-sm btn-wa" target="_blank" rel="noopener" href="${esc(waLink(c.phone))}">WhatsApp</a></div>
      <h3>История</h3><div id="hist"><div class="spinner"></div></div>` : ''}`;
  const m = modal({
    title: isNew ? 'Новый клиент' : c.name, body, wide: !isNew,
    footer: `${!isNew ? '<button class="btn btn-danger" data-a="del">Удалить</button>' : ''}<button class="btn" data-a="close">Закрыть</button><button class="btn btn-pri" data-a="save">Сохранить</button>`,
  });
  const f = $('#cf', m.el);
  f.phone.value = c ? fmtPhone(c.phone) : '';
  phoneMask(f.phone);
  $('[data-a=close]', m.el).onclick = m.close;
  if (!isNew) {
    $('#book', m.el).onclick = () => { m.close(); bookingModal(null, { phone: c.phone, name: c.name, date: S.day || todayInTz(tz()) }); };
    const { data } = await sb.from('bookings').select('*').eq('client_id', c.id).order('starts_at', { ascending: false }).limit(50);
    const h = $('#hist', m.el);
    if (h) h.innerHTML = !data?.length ? '<p class="muted">Записей нет</p>' : `<div class="day-list">${data.map((b) => `
      <div class="item"><div class="t" style="min-width:110px">${fmtDateShort(b.starts_at, tz())} ${timeStrInTz(b.starts_at, tz())}</div>
      <div class="grow small">${esc([b.service_name, b.staff_name, b.price != null ? money(b.price) : ''].filter(Boolean).join(' · '))}</div>${statusBadge(b.status)}</div>`).join('')}</div>`;
    $('[data-a=del]', m.el).onclick = async () => {
      if (!(await confirmDlg(`Удалить клиента «${c.name}»? Прошлые записи останутся в журнале.`, 'Удалить', true))) return;
      const { error } = await sb.from('clients').delete().eq('id', c.id);
      if (error) return toastErr(error);
      toast('Клиент удалён'); m.close(); onSaved && onSaved();
    };
  }
  $('[data-a=save]', m.el).onclick = async (e) => {
    const phone = normPhone(f.phone.value);
    if (!f.name.value.trim()) return toastErr('Укажите имя');
    if (!phone) return toastErr('Укажите телефон полностью');
    const payload = { name: f.name.value.trim(), phone, notes: f.notes.value.trim() || null };
    await busy(e.target, async () => {
      const { error } = isNew ? await sb.from('clients').insert({ ...payload, business_id: S.biz.id }) : await sb.from('clients').update(payload).eq('id', c.id);
      if (error) return toastErr(/duplicate|unique/i.test(error.message) ? 'Клиент с таким телефоном уже есть' : error);
      toast('Сохранено'); m.close();
      if (onSaved) onSaved(); else renderClients();
    });
  };
}

// ---------- Услуги ----------
function serviceStaffNames(s) {
  const ids = S.links.filter((l) => l.service_id === s.id).map((l) => l.staff_id);
  if (!ids.length || activeStaff().length < 2) return '';
  return S.staff.filter((x) => ids.includes(x.id)).map((x) => x.name).join(', ');
}

function renderServices() {
  const tpl = TEMPLATES[S.biz.category];
  $('#page').innerHTML = `<div class="page-h"><h2>Услуги</h2><button class="btn btn-pri" id="add">+ Услуга</button></div>
    <div id="list"></div>`;
  $('#add').onclick = () => serviceModal(null);
  const list = $('#list');
  if (!S.services.length) {
    list.innerHTML = `<div class="card empty"><div class="ico">📋</div><h3>Добавьте услуги, на которые к вам записываются</h3>
      <p>Название, длительность и цена — клиенты увидят их на странице записи.</p>
      ${tpl ? `<button class="btn btn-pri" id="tpl">Добавить типовые услуги для «${esc(S.biz.category)}»</button><p class="small muted" style="margin-top:8px">${tpl.map((t) => esc(t[0])).join(', ')} — потом поправите цены</p>` : ''}</div>`;
    if (tpl) $('#tpl').onclick = async (e) => {
      await busy(e.target, async () => {
        const { error } = await sb.from('services').insert(tpl.map(([name, d, p], i) => ({ business_id: S.biz.id, name, duration_min: d, price: p, sort: i })));
        if (error) return toastErr(error);
        await loadRefs(); toast('Услуги добавлены — проверьте цены'); renderServices();
      });
    };
    return;
  }
  list.innerHTML = S.services.map((s) => `<div class="list-item ${s.is_active ? '' : 'inactive'}" data-id="${s.id}">
      <div class="grow"><b>${esc(s.name)}</b> ${s.is_active ? '' : '<span class="badge b-cancelled">скрыта</span>'}
        <div class="muted small">${durText(s.duration_min)}${serviceStaffNames(s) ? ' · ' + esc(serviceStaffNames(s)) : ''}</div></div>
      <b class="nowrap">${s.price != null ? money(s.price) : ''}</b><span class="muted">›</span></div>`).join('');
  $$('.list-item', list).forEach((el) => { el.onclick = () => serviceModal(S.services.find((s) => s.id === el.dataset.id)); });
}

function serviceModal(s) {
  const isNew = !s;
  const staff = activeStaff();
  const linked = s ? S.links.filter((l) => l.service_id === s.id).map((l) => l.staff_id) : [];
  const checked = (id) => isNew || !linked.length || linked.includes(id);
  const body = `<form id="sf" class="form-grid" novalidate>
      <label class="field full"><span>Название</span><input class="input" name="name" required maxlength="80" value="${esc(s?.name || '')}" placeholder="Например: Мужская стрижка"></label>
      <label class="field"><span>Длительность, мин</span><input class="input" type="number" name="dur" min="5" max="720" step="5" value="${s?.duration_min || 60}" list="durs">
        <datalist id="durs">${[15, 30, 45, 60, 90, 120, 150, 180].map((d) => `<option value="${d}">`).join('')}</datalist></label>
      <label class="field"><span>Цена, ₸</span><input class="input" type="number" name="price" min="0" step="100" value="${s?.price ?? ''}" placeholder="Можно оставить пустым"></label>
      <label class="field full"><span>Описание <span class="muted">(необязательно)</span></span><textarea class="textarea" name="desc" rows="2" maxlength="500">${esc(s?.description || '')}</textarea></label>
      ${staff.length > 1 ? `<div class="full"><span class="small" style="font-weight:600">Кто оказывает услугу</span>
        <div class="grid grid-2" style="margin-top:6px">${staff.map((x) => `<label class="check"><input type="checkbox" name="st" value="${x.id}" ${checked(x.id) ? 'checked' : ''}><span>${esc(x.name)}</span></label>`).join('')}</div></div>` : ''}
      <label class="check full"><input type="checkbox" name="active" ${!s || s.is_active ? 'checked' : ''}><span>Показывать на странице записи</span></label>
    </form>`;
  const m = modal({
    title: isNew ? 'Новая услуга' : 'Услуга', body,
    footer: `${!isNew ? '<button class="btn btn-danger" data-a="del">Удалить</button>' : ''}<button class="btn" data-a="close">Отмена</button><button class="btn btn-pri" data-a="save">Сохранить</button>`,
  });
  const f = $('#sf', m.el);
  $('[data-a=close]', m.el).onclick = m.close;
  if (!isNew) $('[data-a=del]', m.el).onclick = async () => {
    if (!(await confirmDlg(`Удалить услугу «${s.name}»? Прошлые записи сохранятся. Чтобы просто убрать с сайта — снимите галочку «Показывать».`, 'Удалить', true))) return;
    const { error } = await sb.from('services').delete().eq('id', s.id);
    if (error) return toastErr(error);
    await loadRefs(); toast('Услуга удалена'); m.close(); renderServices();
  };
  $('[data-a=save]', m.el).onclick = async (e) => {
    const name = f.name.value.trim();
    if (!name) return toastErr('Укажите название');
    const sel = $$('input[name=st]', f).filter((x) => x.checked).map((x) => x.value);
    if (staff.length > 1 && !sel.length) return toastErr('Выберите хотя бы одного сотрудника');
    const payload = {
      name, duration_min: Math.min(720, Math.max(5, parseInt(f.dur.value, 10) || 60)),
      price: f.price.value === '' ? null : Math.max(0, parseInt(f.price.value, 10) || 0),
      description: f.desc.value.trim() || null, is_active: f.active.checked,
    };
    await busy(e.target, async () => {
      const r = isNew
        ? await sb.from('services').insert({ ...payload, business_id: S.biz.id, sort: S.services.length }).select().single()
        : await sb.from('services').update(payload).eq('id', s.id).select().single();
      if (r.error) return toastErr(r.error);
      if (staff.length > 1) {
        const ids = sel.length === staff.length ? [] : sel;
        const { error } = await sb.rpc('owner_set_service_staff', { p_service: r.data.id, p_staff: ids });
        if (error) return toastErr(error);
      }
      await loadRefs(); toast('Сохранено'); m.close(); renderServices();
    });
  };
}

// ---------- Сотрудники ----------
function scheduleText(staffId) {
  const byDay = {};
  for (let d = 1; d <= 7; d++) {
    byDay[d] = S.hours.filter((h) => h.staff_id === staffId && h.weekday === d)
      .sort((a, b) => a.start_time.localeCompare(b.start_time))
      .map((h) => h.start_time.slice(0, 5) + '–' + h.end_time.slice(0, 5)).join(', ');
  }
  const out = [];
  let d = 1;
  while (d <= 7) {
    if (!byDay[d]) { d++; continue; }
    let e = d;
    while (e + 1 <= 7 && byDay[e + 1] === byDay[d]) e++;
    out.push(`${WD_SHORT[d]}${e > d ? '–' + WD_SHORT[e] : ''} ${byDay[d]}`);
    d = e + 1;
  }
  return out.join('; ') || 'Нет рабочих часов';
}

function renderStaff() {
  const p = curPlan(), limit = p.staff_limit, n = activeStaff().length;
  const bigger = S.plans.filter((x) => x.code !== 'trial' && x.staff_limit > limit).sort((a, b) => a.staff_limit - b.staff_limit)[0];
  $('#page').innerHTML = `<div class="page-h"><h2>Сотрудники</h2><button class="btn btn-pri" id="add">+ Сотрудник</button></div>
    <div class="alert ${n >= limit ? 'alert-warn' : 'alert-info'}" style="margin-bottom:12px">Работают ${n} из ${limit} по тарифу «${esc(p.title)}».${n >= limit && bigger ? ` Нужно больше — тариф <a href="#billing">«${esc(bigger.title)}»</a> (до ${bigger.staff_limit}).` : ''}</div>
    <div id="list">${S.staff.map((s) => `<div class="list-item ${s.is_active ? '' : 'inactive'}" data-id="${s.id}">
      <span class="avatar">${esc(s.name[0]?.toUpperCase() || '?')}</span>
      <div class="grow"><b>${esc(s.name)}</b>${s.title ? ` <span class="muted">· ${esc(s.title)}</span>` : ''} ${s.is_active ? '' : '<span class="badge b-cancelled">не работает</span>'}
        <div class="muted small">${esc(scheduleText(s.id))}</div></div><span class="muted">›</span></div>`).join('') || '<div class="card empty">Сотрудников пока нет</div>'}</div>`;
  $('#add').onclick = () => {
    if (activeStaff().length >= limit) return toastErr(`На вашем тарифе можно сотрудников: ${limit}. Выберите тариф побольше в разделе «Подписка»`);
    staffModal(null);
  };
  $$('.list-item', $('#list')).forEach((el) => { el.onclick = () => staffModal(S.staff.find((s) => s.id === el.dataset.id)); });
}

function staffModal(s) {
  const isNew = !s;
  const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const rows = [];
  for (let d = 1; d <= 7; d++) {
    const iv = s ? S.hours.filter((h) => h.staff_id === s.id && h.weekday === d).sort((a, b) => a.start_time.localeCompare(b.start_time)) : (d <= 6 ? [{ start_time: '10:00', end_time: '19:00' }] : []);
    const on = iv.length > 0;
    const start = on ? iv[0].start_time.slice(0, 5) : '10:00';
    const end = on ? iv[iv.length - 1].end_time.slice(0, 5) : '19:00';
    const brk = iv.length > 1 ? [iv[0].end_time.slice(0, 5), iv[1].start_time.slice(0, 5)] : null;
    rows.push(`<div class="hours-row" data-d="${d}">
      <label class="check"><input type="checkbox" name="on" ${on ? 'checked' : ''}><span>${WD_FULL[d]}</span></label>
      <div class="hours-times"><input class="input input-sm" type="time" name="s" value="${start}" step="900"> — <input class="input input-sm" type="time" name="e" value="${end}" step="900">
        <label class="check small" style="margin-left:6px"><input type="checkbox" name="br" ${brk ? 'checked' : ''}><span>перерыв</span></label>
        <span class="brk ${brk ? '' : 'hide'}"><input class="input input-sm" type="time" name="bs" value="${brk ? brk[0] : '13:00'}" step="900"> — <input class="input input-sm" type="time" name="be" value="${brk ? brk[1] : '14:00'}" step="900"></span></div></div>`);
  }
  const body = `<form id="stf" class="stack" novalidate>
      <div class="form-grid">
        <label class="field"><span>Имя</span><input class="input" name="name" required maxlength="60" value="${esc(s?.name || '')}"></label>
        <label class="field"><span>Должность <span class="muted">(необязательно)</span></span><input class="input" name="title" maxlength="60" value="${esc(s?.title || '')}" placeholder="Барбер, мастер маникюра…"></label>
      </div>
      <label class="check"><input type="checkbox" name="active" ${!s || s.is_active ? 'checked' : ''}><span>Работает и принимает записи</span></label>
      <div><h3 style="margin:8px 0 4px">График работы</h3>${rows.join('')}
        <button type="button" class="btn btn-sm btn-ghost" id="copyMon">Скопировать понедельник на все рабочие дни</button></div>
      ${!isNew ? '<div><h3 style="margin:8px 0 4px">Отпуск и выходные дни</h3><div id="off"></div></div>' : ''}
    </form>`;
  const m = modal({
    title: isNew ? 'Новый сотрудник' : s.name, body, wide: true,
    footer: `${!isNew ? '<button class="btn btn-danger" data-a="del">Удалить</button>' : ''}<button class="btn" data-a="close">Отмена</button><button class="btn btn-pri" data-a="save">Сохранить</button>`,
  });
  const f = $('#stf', m.el);
  $$('input[name=br]', f).forEach((c) => { c.onchange = () => c.closest('.hours-times').querySelector('.brk').classList.toggle('hide', !c.checked); });
  $('#copyMon', m.el).onclick = () => {
    const mon = $('.hours-row[data-d="1"]', f);
    $$('.hours-row', f).forEach((r) => {
      if (r === mon || !$('[name=on]', r).checked) return;
      for (const n of ['s', 'e', 'bs', 'be']) $(`[name=${n}]`, r).value = $(`[name=${n}]`, mon).value;
      $('[name=br]', r).checked = $('[name=br]', mon).checked;
      $('.brk', r).classList.toggle('hide', !$('[name=br]', mon).checked);
    });
    toast('Скопировано');
  };
  $('[data-a=close]', m.el).onclick = m.close;
  if (!isNew) {
    timeOffEditor($('#off', m.el), s.id);
    $('[data-a=del]', m.el).onclick = async () => {
      if (!(await confirmDlg(`Удалить «${s.name}»? Прошлые записи останутся в журнале без мастера.`, 'Удалить', true))) return;
      const { error } = await sb.from('staff').delete().eq('id', s.id);
      if (error) return toastErr(error);
      await loadRefs(); toast('Удалено'); m.close(); renderStaff();
    };
  }
  $('[data-a=save]', m.el).onclick = async (e) => {
    const name = f.name.value.trim();
    if (!name) return toastErr('Укажите имя');
    const hours = [];
    for (const r of $$('.hours-row', f)) {
      if (!$('[name=on]', r).checked) continue;
      const d = +r.dataset.d, st = $('[name=s]', r).value, en = $('[name=e]', r).value;
      if (!st || !en || toMin(en) <= toMin(st)) return toastErr(`${WD_FULL[d]}: конец работы должен быть позже начала`);
      if ($('[name=br]', r).checked) {
        const bs = $('[name=bs]', r).value, be = $('[name=be]', r).value;
        if (!(toMin(st) < toMin(bs) && toMin(bs) < toMin(be) && toMin(be) < toMin(en))) return toastErr(`${WD_FULL[d]}: перерыв должен быть внутри рабочего времени`);
        hours.push({ weekday: d, start: st, end: bs }, { weekday: d, start: be, end: en });
      } else hours.push({ weekday: d, start: st, end: en });
    }
    const payload = { name, title: f.title.value.trim() || null, is_active: f.active.checked };
    await busy(e.target, async () => {
      const r = isNew
        ? await sb.from('staff').insert({ ...payload, business_id: S.biz.id, sort: S.staff.length }).select().single()
        : await sb.from('staff').update(payload).eq('id', s.id).select().single();
      if (r.error) return toastErr(r.error);
      const { error } = await sb.rpc('owner_set_hours', { p_staff: r.data.id, p_hours: hours });
      if (error) return toastErr(error);
      onbFlag('hours');
      await loadRefs(); toast('Сохранено'); m.close(); renderStaff();
    });
  };
}

async function timeOffEditor(box, staffId) {
  const load = async () => {
    let q = sb.from('time_off').select('*').eq('business_id', S.biz.id).gt('ends_at', new Date().toISOString()).order('starts_at');
    q = staffId ? q.eq('staff_id', staffId) : q.is('staff_id', null);
    const { data } = await q;
    const today = todayInTz(tz());
    box.innerHTML = `${(data || []).map((t) => {
      const a = dateStrInTz(t.starts_at, tz()), z = dateStrInTz(new Date(t.ends_at).getTime() - 1, tz());
      return `<div class="row between" style="padding:6px 0;border-bottom:1px solid var(--line)"><span>${humanDate(a)}${z !== a ? ' — ' + humanDate(z) : ''}${t.reason ? ` · <span class="muted">${esc(t.reason)}</span>` : ''}</span>
        <button type="button" class="btn btn-sm btn-ghost" data-del="${t.id}">Удалить</button></div>`;
    }).join('') || '<p class="muted small">Нет запланированных выходных</p>'}
      <div class="row" style="margin-top:8px"><input class="input input-sm" type="date" name="ofrom" value="${today}" style="width:auto"> —
        <input class="input input-sm" type="date" name="oto" value="${today}" style="width:auto">
        <input class="input input-sm grow" name="oreason" placeholder="Причина (необязательно)" style="min-width:140px">
        <button type="button" class="btn btn-sm" id="offAdd">Добавить</button></div>`;
    $$('[data-del]', box).forEach((b) => { b.onclick = async () => { await sb.from('time_off').delete().eq('id', b.dataset.del); load(); }; });
    $('#offAdd', box).onclick = async () => {
      const a = $('[name=ofrom]', box).value, z = $('[name=oto]', box).value;
      if (!a || !z || z < a) return toastErr('Проверьте даты');
      const { error } = await sb.from('time_off').insert({
        business_id: S.biz.id, staff_id: staffId || null, reason: $('[name=oreason]', box).value.trim() || null,
        starts_at: zonedToUtc(a, '00:00', tz()).toISOString(), ends_at: zonedToUtc(addDays(z, 1), '00:00', tz()).toISOString(),
      });
      if (error) return toastErr(error);
      toast('Добавлено — в эти дни онлайн-запись закрыта'); load();
    };
  };
  load();
}

// ---------- Настройки ----------
function renderSettings() {
  const b = S.biz, url = bookUrl(), bot = S.settings.bot_username;
  const shareText = `Записаться онлайн в «${b.name}»: ${url}`;
  $('#page').innerHTML = `<div class="page-h"><h2>Настройки</h2></div>
    <div class="card"><h3>Ссылка для онлайн-записи</h3>
      <div class="qr-box"><img id="qr" alt="QR-код"><div class="grow stack">
        <div class="link-box"><input class="input grow" readonly value="${esc(url)}" id="url"><button class="btn btn-pri" id="copy">Скопировать</button></div>
        <div class="row"><a class="btn btn-sm" href="${esc(url)}" target="_blank" rel="noopener">Открыть ↗</a>
          <a class="btn btn-sm" id="qrdl" download="qr-zapis.png">Скачать QR</a>
          <a class="btn btn-sm btn-wa" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(shareText)}">Отправить в WhatsApp</a></div>
        <p class="muted small" style="margin:0">Куда поставить: шапка профиля Instagram, кнопка в WhatsApp Business, карточка в 2GIS, автоответ в мессенджерах. QR-код распечатайте на стойку или зеркало.</p>
      </div></div></div>

    <div class="card"><h3>Уведомления в Telegram</h3><div id="tg"></div></div>

    <div class="card"><h3>Профиль и правила записи</h3>
      <form id="pf" class="form-grid" novalidate>
        <label class="field"><span>Название</span><input class="input" name="name" maxlength="80" value="${esc(b.name)}"></label>
        <label class="field"><span>Сфера</span><select class="select" name="category">${CATS.map((c) => `<option ${c === b.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}${b.category && !CATS.includes(b.category) ? `<option selected>${esc(b.category)}</option>` : ''}</select></label>
        <label class="field"><span>Телефон для клиентов</span><input class="input" name="phone" maxlength="40" value="${esc(b.phone || '')}"></label>
        <label class="field"><span>Адрес</span><input class="input" name="address" maxlength="160" value="${esc(b.address || '')}"></label>
        <label class="field full"><span>Описание на странице записи</span><textarea class="textarea" name="description" maxlength="1000" rows="2" placeholder="Например: парковка во дворе, вход с торца">${esc(b.description || '')}</textarea></label>
        <label class="field"><span>Адрес страницы</span><input class="input" name="slug" maxlength="40" value="${esc(b.slug)}"><small>Если измените — старая ссылка и QR перестанут работать</small></label>
        <label class="field"><span>Часовой пояс</span><select class="select" name="timezone">${TIMEZONES.map(([v, t]) => `<option value="${v}" ${v === b.timezone ? 'selected' : ''}>${t}</option>`).join('')}${TIMEZONES.some(([v]) => v === b.timezone) ? '' : `<option selected value="${esc(b.timezone)}">${esc(b.timezone)}</option>`}</select></label>
        <label class="field"><span>Шаг времени записи</span><select class="select" name="slot_step">${[10, 15, 20, 30, 45, 60, 90, 120].map((v) => `<option value="${v}" ${v === b.slot_step ? 'selected' : ''}>каждые ${v} мин</option>`).join('')}</select></label>
        <label class="field"><span>Записываться не позже чем за</span><select class="select" name="min_notice_min">${[[0, 'в любой момент'], [30, '30 минут'], [60, '1 час'], [120, '2 часа'], [180, '3 часа'], [360, '6 часов'], [720, '12 часов'], [1440, 'сутки']].map(([v, t]) => `<option value="${v}" ${v === b.min_notice_min ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="field"><span>Открыта запись на</span><select class="select" name="max_days_ahead">${[7, 14, 30, 60, 90].map((v) => `<option value="${v}" ${v === b.max_days_ahead ? 'selected' : ''}>${v} дней вперёд</option>`).join('')}</select></label>
        <div class="field"><span>Напоминания клиентам в Telegram</span>
          <label class="check"><input type="checkbox" name="remind_24h" ${b.remind_24h ? 'checked' : ''}><span>за сутки</span></label>
          <label class="check"><input type="checkbox" name="remind_2h" ${b.remind_2h ? 'checked' : ''}><span>за 2 часа</span></label></div>
        <div class="full"><button class="btn btn-pri" type="submit">Сохранить</button></div>
      </form></div>

    <div class="card"><h3>Праздники и выходные для всех</h3><p class="muted small">В эти дни онлайн-запись закрыта для всех сотрудников.</p><div id="off"></div></div>

    <div class="card"><h3>Аккаунт</h3><p class="muted">Вход: ${esc(S.user.email)}</p>
      <div class="row"><button class="btn" id="pw">Сменить пароль</button><button class="btn btn-ghost" id="lo2">Выйти</button></div></div>`;

  const qr = qrDataUrl(url);
  $('#qr').src = qr; $('#qrdl').href = qr;
  $('#copy').onclick = () => { copyText(url); onbFlag('shared'); };
  $('#qrdl').addEventListener('click', () => onbFlag('shared'));
  $('#lo2').onclick = () => sb.auth.signOut();
  $('#pw').onclick = () => {
    const m = modal({ title: 'Новый пароль', body: '<input class="input" type="password" id="np" minlength="6" placeholder="Минимум 6 символов" autocomplete="new-password">', footer: '<button class="btn btn-pri" id="npS">Сохранить</button>' });
    $('#npS', m.el).onclick = async () => {
      const p = $('#np', m.el).value;
      if (p.length < 6) return toastErr('Минимум 6 символов');
      const { error } = await sb.auth.updateUser({ password: p });
      if (error) return toastErr(error);
      toast('Пароль изменён'); m.close();
    };
  };
  timeOffEditor($('#off'), null);
  renderTg();

  const f = $('#pf');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const slug = f.slug.value.trim().toLowerCase();
    if (slug !== b.slug && !(await confirmDlg('Вы меняете адрес страницы. Старая ссылка и QR-код перестанут работать. Продолжить?', 'Изменить'))) return;
    const patch = {
      name: f.name.value.trim(), category: f.category.value, phone: f.phone.value.trim() || null, address: f.address.value.trim() || null,
      description: f.description.value.trim() || null, slug, timezone: f.timezone.value, slot_step: +f.slot_step.value,
      min_notice_min: +f.min_notice_min.value, max_days_ahead: +f.max_days_ahead.value,
      remind_24h: f.remind_24h.checked, remind_2h: f.remind_2h.checked,
    };
    if (patch.name.length < 2) return toastErr('Укажите название');
    if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(slug)) return toastErr('Адрес страницы: латиница, цифры, дефис, 3–40 символов');
    await busy($('button[type=submit]', f), async () => {
      const { error } = await sb.from('businesses').update(patch).eq('id', b.id);
      if (error) return toastErr(/duplicate|unique/i.test(error.message) ? 'Этот адрес страницы уже занят' : error);
      await reloadBiz(); $('#bizName').textContent = S.biz.name; toast('Сохранено'); renderSettings();
    });
  };

  function renderTg() {
    const box = $('#tg');
    if (!bot) { box.innerHTML = '<p class="muted">Бот уведомлений ещё настраивается администратором платформы. Как только он заработает, здесь появится кнопка подключения.</p>'; return; }
    if (S.biz.tg_chat_id) {
      box.innerHTML = `<div class="alert alert-ok" style="margin-bottom:10px">✅ Подключено. Новые онлайн-записи и отмены приходят вам в Telegram от <b>@${esc(bot)}</b>.</div>
        <button class="btn btn-sm btn-ghost" id="tgOff">Отключить</button>`;
      $('#tgOff').onclick = async () => {
        if (!(await confirmDlg('Отключить уведомления в Telegram?', 'Отключить', true))) return;
        const { error } = await sb.rpc('owner_unlink_tg');
        if (error) return toastErr(error);
        await reloadBiz(); renderTg();
      };
      return;
    }
    box.innerHTML = `<p>Получайте сообщение о каждой новой онлайн-записи и отмене. Клиентам бот присылает напоминания сам.</p>
      <div class="row"><a class="btn btn-tg" target="_blank" rel="noopener" href="https://t.me/${esc(bot)}?start=o_${esc(S.biz.tg_link_code)}">Подключить Telegram</a>
      <button class="btn" id="tgCheck">Я нажал «Start» — проверить</button></div>
      <p class="muted small" style="margin-top:8px">Откроется бот @${esc(bot)} — нажмите «Start» (или «Запустить»), затем вернитесь сюда.</p>`;
    $('#tgCheck').onclick = async () => {
      await reloadBiz();
      if (S.biz.tg_chat_id) { toast('Telegram подключён'); renderTg(); } else toastErr('Пока не подключено. Нажмите «Start» в боте и попробуйте снова');
    };
  }
}

// ---------- ИИ-ассистент ----------
const KB_TEMPLATE = `Как к нам добраться: …
Парковка: …
Как оплатить: наличные, Kaspi QR, перевод
Предоплата: не нужна / нужна …
Опоздание: ждём до 15 минут, потом запись может сдвинуться
Отмена и перенос: предупредите минимум за … часов
Что взять с собой / как подготовиться: …
Гарантия: …
Акции и скидки: …
Частые вопросы клиентов: …`;

async function renderAi() {
  const page = $('#page');
  page.innerHTML = '<div class="page-h"><h2>ИИ-ассистент</h2></div><div class="spinner"></div>';
  const { data: info, error } = await sb.rpc('owner_ai_info');
  if (error) { page.innerHTML = `<div class="alert alert-danger">${esc(errMsg(error))}</div>`; return; }
  if (location.hash.slice(1) !== 'ai') return;
  const a = info.settings, bot = info.bot_username;
  const chatLink = bot ? `https://t.me/${bot}?start=s_${S.biz.slug}` : '';
  const aiPlans = S.plans.filter((p) => p.ai && p.code !== 'trial' && p.price > 0);
  const pct = info.limit ? Math.min(100, Math.round((info.used / info.limit) * 100)) : 0;
  let status;
  if (!info.plan_ai) status = `<div class="alert alert-warn">ИИ-ассистент работает на тарифе ${aiPlans.map((p) => `«${esc(p.title)}» (${money(p.price)}/мес)`).join(' или ') || 'с ИИ'}. Заполнить базу знаний можно уже сейчас — после смены тарифа ассистент сразу начнёт отвечать. <a href="#billing"><b>Сменить тариф</b></a></div>`;
  else if (!info.platform_ready) status = '<div class="alert alert-warn">ИИ ещё подключается администратором платформы. Заполните базу знаний — ассистент заработает автоматически.</div>';
  else if (!a.enabled) status = '<div class="alert alert-info">Ассистент выключен. Включите его ниже — и он начнёт отвечать клиентам в Telegram.</div>';
  else status = `<div class="alert alert-ok">✅ Ассистент <b>${esc(a.bot_name)}</b> отвечает клиентам 24/7 в Telegram${bot ? ` (@${esc(bot)})` : ''}.</div>`;

  page.innerHTML = `<div class="page-h"><h2>ИИ-ассистент</h2></div>
    <div class="card stack">${status}
      ${info.plan_ai ? `<div><div class="row between small"><span>Ответов в этом месяце: <b>${info.used}</b> из ${info.limit}</span><span class="muted">диалогов: ${info.chats}</span></div>
        <div style="height:8px;background:var(--line);border-radius:99px;overflow:hidden;margin-top:6px"><div style="height:100%;width:${pct}%;background:${pct > 90 ? 'var(--danger)' : 'var(--pri)'}"></div></div></div>` : ''}
      <div class="small muted">Как это работает: клиент пишет боту → ассистент отвечает по вашим услугам, ценам, графику и базе знаний, подбирает свободное время и записывает. Если не знает ответа — пересылает вопрос вам в Telegram, вы отвечаете кнопкой «Ответить».</div>
      ${chatLink ? `<div><b>Ссылка на чат с ассистентом</b> — поставьте в Instagram, 2GIS и WhatsApp:
        <div class="link-box" style="margin-top:6px"><input class="input grow" readonly value="${esc(chatLink)}"><button class="btn" id="cpChat">Скопировать</button></div>
        <div class="muted small">На вашей странице записи тоже появится кнопка «Задать вопрос».</div></div>` : ''}
    </div>

    <div class="card"><h3>Настройки и база знаний</h3>
      <form id="aif" class="stack" novalidate>
        <label class="check"><input type="checkbox" name="enabled" ${a.enabled ? 'checked' : ''}><span><b>Ассистент отвечает клиентам</b></span></label>
        <div class="form-grid">
          <label class="field"><span>Имя ассистента</span><input class="input" name="bot_name" maxlength="40" value="${esc(a.bot_name)}"></label>
          <div class="field"><span>Запись клиентов</span><label class="check"><input type="checkbox" name="can_book" ${a.can_book ? 'checked' : ''}><span>Ассистент может сам записывать</span></label></div>
        </div>
        <label class="field"><span>База знаний — всё, что должен знать ассистент</span>
          <textarea class="textarea" name="knowledge" rows="12" maxlength="15000" placeholder="Например:&#10;Парковка: бесплатная во дворе&#10;Оплата: наличные и Kaspi QR&#10;Опоздание больше 15 минут — запись переносится">${esc(a.knowledge)}</textarea>
          <small><span id="kbn">${a.knowledge.length}</span> / 15000 · Услуги, цены, адрес и график ассистент уже знает — их писать не нужно. Добавлять факты можно и из Telegram: напишите боту «Запомни: …»</small></label>
        <div><button type="button" class="btn btn-sm btn-ghost" id="kbTpl">Вставить шаблон вопросов</button></div>
        <label class="field"><span>Особые указания <span class="muted">(необязательно)</span></span>
          <textarea class="textarea" name="instructions" rows="3" maxlength="2000" placeholder="Например: обращайся на «вы», предлагай мастера Айгерим новым клиентам, не обещай скидки">${esc(a.instructions)}</textarea></label>
        <div><button class="btn btn-pri" type="submit">Сохранить</button></div>
      </form></div>

    <div class="card"><div class="row between"><h3 style="margin:0">Проверить ассистента</h3><button class="btn btn-sm btn-ghost" id="tReset">Начать заново</button></div>
      <p class="muted small">Напишите как клиент. В проверке запись не создаётся. Сначала сохраните изменения базы знаний.</p>
      <div class="chat" id="tChat"><div class="muted small center">Например: «Сколько стоит и когда есть время в субботу?»</div></div>
      <form class="link-box" id="tForm" style="margin-top:10px"><input class="input grow" id="tIn" maxlength="2000" placeholder="Сообщение…" autocomplete="off"><button class="btn btn-pri">Отправить</button></form></div>

    <div class="card"><h3>Диалоги с клиентами</h3><div id="dlg"><div class="spinner"></div></div></div>`;

  if (chatLink) $('#cpChat').onclick = () => copyText(chatLink);
  const f = $('#aif');
  f.knowledge.oninput = () => { $('#kbn').textContent = f.knowledge.value.length; };
  $('#kbTpl').onclick = () => { f.knowledge.value = (f.knowledge.value.trim() ? f.knowledge.value.trim() + '\n\n' : '') + KB_TEMPLATE; f.knowledge.oninput(); f.knowledge.focus(); };
  f.onsubmit = async (e) => {
    e.preventDefault();
    const patch = {
      enabled: f.enabled.checked, bot_name: f.bot_name.value.trim() || 'Ассистент', can_book: f.can_book.checked,
      knowledge: f.knowledge.value.trim(), instructions: f.instructions.value.trim(), updated_at: new Date().toISOString(),
    };
    await busy($('button[type=submit]', f), async () => {
      const { error: e2 } = await sb.from('business_ai').update(patch).eq('business_id', S.biz.id);
      if (e2) return toastErr(e2);
      toast('Сохранено'); renderAi();
    });
  };

  let reset = true;
  const chat = $('#tChat');
  const bubble = (role, text) => {
    if (reset && chat.querySelector('.muted')) chat.innerHTML = '';
    const el = document.createElement('div');
    el.className = 'msg ' + role; el.textContent = text;
    chat.append(el); chat.scrollTop = chat.scrollHeight;
    return el;
  };
  $('#tReset').onclick = () => { reset = true; chat.innerHTML = '<div class="muted small center">Диалог очищен</div>'; };
  $('#tForm').onsubmit = async (e) => {
    e.preventDefault();
    const text = $('#tIn').value.trim();
    if (!text) return;
    if (!info.plan_ai) return toastErr('Проверка доступна на тарифе с ИИ');
    if (!info.platform_ready) return toastErr('ИИ ещё не подключён администратором платформы');
    bubble('user', text); $('#tIn').value = '';
    const wait = bubble('assistant', '…печатает');
    const btn = $('button', e.target);
    await busy(btn, async () => {
      const { data, error: e3 } = await sb.functions.invoke('tg', { body: { action: 'ai_test', text, reset } });
      if (e3) { wait.remove(); return toastErr(await fnErr(e3)); }
      reset = false;
      wait.textContent = data.reply + (data.booked ? '\n\n(в реальном чате клиент был бы записан)' : '') + (data.handoff ? '\n\n(в реальном чате вопрос ушёл бы вам в Telegram)' : '');
      chat.scrollTop = chat.scrollHeight;
    });
  };
  loadDialogs();

  async function loadDialogs() {
    const { data, error: e4 } = await sb.rpc('owner_ai_dialogs');
    const box = $('#dlg');
    if (!box) return;
    if (e4) { box.innerHTML = `<div class="muted">${esc(errMsg(e4))}</div>`; return; }
    if (!data.length) { box.innerHTML = '<p class="muted">Пока никто не писал. Поделитесь ссылкой на чат с клиентами.</p>'; return; }
    box.innerHTML = data.map((d) => `<div class="list-item" data-c="${d.chat_id}"><span class="avatar">${esc((d.client_name || d.tg_name || '?')[0].toUpperCase())}</span>
      <div class="grow"><b>${esc(d.client_name || d.tg_name || 'Клиент')}</b>${d.tg_username ? ` <span class="muted small">@${esc(d.tg_username)}</span>` : ''}${d.muted ? ' <span class="badge b-booked">отвечаете вы</span>' : ''}
        <div class="muted small" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:520px">${esc(d.last_text || '')}</div></div>
      <span class="muted small nowrap">${fmtDateShort(d.last_at, tz())}</span></div>`).join('');
    $$('[data-c]', box).forEach((el) => { el.onclick = () => dialogModal(data.find((d) => String(d.chat_id) === el.dataset.c)); });
  }

  async function dialogModal(d) {
    const m = modal({
      title: d.client_name || d.tg_name || 'Клиент', wide: true,
      body: `<div class="chat" id="dChat" style="max-height:50vh"><div class="spinner"></div></div>
        <form class="link-box" id="dForm" style="margin-top:10px"><input class="input grow" id="dIn" maxlength="3500" placeholder="Ответить клиенту от имени бизнеса…"><button class="btn btn-pri">Отправить</button></form>
        <p class="muted small" style="margin:6px 0 0">После вашего ответа ассистент не вмешивается в этот диалог 3 часа.</p>`,
      footer: `${d.muted ? '<button class="btn" data-a="un">Вернуть ассистента</button>' : ''}${d.tg_username ? `<a class="btn" target="_blank" rel="noopener" href="https://t.me/${esc(d.tg_username)}">Открыть в Telegram</a>` : ''}`,
    });
    const load = async () => {
      const { data } = await sb.rpc('owner_ai_messages', { p_chat: d.chat_id });
      const box = $('#dChat', m.el);
      box.innerHTML = (data || []).map((x) => `<div class="msg ${x.role}"><div>${esc(x.content)}</div><div class="t">${x.role === 'owner' ? 'вы · ' : x.role === 'assistant' ? 'ассистент · ' : ''}${fmtDateShort(x.at, tz())} ${timeStrInTz(x.at, tz())}</div></div>`).join('');
      box.scrollTop = box.scrollHeight;
    };
    await load();
    const un = $('[data-a=un]', m.el);
    if (un) un.onclick = async () => { await sb.rpc('owner_ai_unmute', { p_chat: d.chat_id }); toast('Ассистент снова отвечает'); un.remove(); loadDialogs(); };
    $('#dForm', m.el).onsubmit = async (e) => {
      e.preventDefault();
      const text = $('#dIn', m.el).value.trim();
      if (!text) return;
      await busy($('button', e.target), async () => {
        const { error: e5 } = await sb.rpc('owner_ai_reply', { p_chat: d.chat_id, p_text: text });
        if (e5) return toastErr(e5);
        $('#dIn', m.el).value = ''; toast('Отправлено'); await load(); loadDialogs();
      });
    };
  }
}

// ---------- Подписка ----------
async function renderBilling() {
  const b = S.biz, s = S.settings;
  const d = daysLeft();
  const until = fmtDateShort(b.paid_until, tz());
  const cur = curPlan();
  const payable = S.plans.filter((p) => p.code !== 'trial' && p.is_active && p.price > 0);
  const n = activeStaff().length;
  const fits = payable.filter((p) => p.staff_limit >= n);
  const state = {
    plan: payable.some((p) => p.code === b.plan) ? b.plan : (fits.find((p) => p.code === 'business') || fits[0] || payable[0])?.code,
    months: 1,
  };
  const feats = (p) => (p.features || '').split('\n').map((x) => x.trim()).filter(Boolean);
  $('#page').innerHTML = `<div class="page-h"><h2>Подписка</h2></div>
    <div class="card"><div class="row between"><div><div class="muted small">Текущий тариф</div><h3 style="margin:2px 0">${esc(b.plan === 'trial' ? 'Пробный период' : cur.title)}</h3>
      <div class="${d <= 0 ? '' : 'muted'}">${d > 0 ? `Активен до ${until} · осталось ${d} ${plural(d, 'день', 'дня', 'дней')}` : `<b style="color:var(--danger)">Закончился ${until}</b> — онлайн-запись отключена`}</div>
      <div class="muted small">Сотрудников: до ${cur.staff_limit}${cur.ai ? ` · ИИ-ассистент: до ${cur.ai_limit} ответов в месяц` : ''}</div></div></div></div>

    <div class="card"><h3>Продлить или сменить тариф</h3>
      ${payable.length ? `<div class="grid grid-${payable.length === 4 ? 2 : Math.min(payable.length, 3)}" id="plans">
        ${payable.map((p) => `<div class="plan" data-p="${esc(p.code)}">${p.ai ? '<span class="badge b-booked" style="position:absolute;top:12px;right:12px">ИИ</span>' : ''}<b>${esc(p.title)}</b>
          <div class="price">${money(p.price)}<span class="muted small"> / мес</span></div>
          <ul>${feats(p).map((f) => `<li>${esc(f)}</li>`).join('') || `<li>До ${p.staff_limit} сотрудников</li>`}</ul>
          ${p.staff_limit < n ? `<div class="small" style="color:var(--danger);margin-top:6px">У вас ${n} сотрудников — сначала отключите лишних</div>` : ''}</div>`).join('')}
      </div>
      <div class="row" style="margin:14px 0"><span class="muted">Срок:</span><div class="row" id="months">
        ${[[1, '1 мес'], [3, '3 мес'], [6, '6 мес'], [12, '12 мес (−2 мес)']].map(([v, t]) => `<button type="button" class="btn btn-sm" data-m="${v}">${t}</button>`).join('')}</div></div>
      <div class="alert alert-info stack" id="pay"></div>` : '<p class="muted">Тарифы скоро появятся.</p>'}
      <p class="muted small" style="margin:12px 0 0">Нужно больше сотрудников или особые условия?${s.support_contact ? ` Напишите нам: <b>${esc(s.support_contact)}</b>` : ' Напишите в поддержку.'} Сделаем индивидуальный тариф.</p>
    </div>
    <div class="card"><h3>История оплат</h3><div id="hist"><div class="spinner"></div></div></div>`;

  const planObj = () => planOf(state.plan);
  const calc = () => planObj().price * (state.months === 12 ? 10 : state.months);
  const draw = () => {
    if (!state.plan) return;
    $$('.plan').forEach((p) => p.classList.toggle('sel', p.dataset.p === state.plan));
    $$('#months [data-m]').forEach((x) => x.classList.toggle('btn-pri', +x.dataset.m === state.months));
    const amount = calc();
    $('#pay').innerHTML = s.kaspi_details
      ? `<div><b>К оплате: ${money(amount)}</b> — тариф «${esc(planObj().title)}» на ${state.months} мес.</div>
        <div><div class="small muted">Переведите через Kaspi:</div><div class="pre" style="font-weight:600">${esc(s.kaspi_details)}</div></div>
        <button type="button" class="btn btn-pri" id="openKaspi">Оплатить в Kaspi · ${money(amount)}</button>
        <div class="small muted">Кнопка скопирует номер и откроет приложение Kaspi. Выберите «Переводы», вставьте номер и введите сумму ${money(amount)}.</div>
        <div class="small">В комментарии к переводу укажите: <b>${esc(b.slug)}</b></div>
        <label class="field"><span>Имя отправителя перевода (как в Kaspi)</span><input class="input" id="payer" maxlength="200" placeholder="Например: Айгерим С."></label>
        <button class="btn btn-pri" id="paid">Я оплатил(а)</button>
        <div class="small muted">После проверки перевода подписка продлится автоматически, обычно в течение нескольких часов. Автосписаний нет — вы платите только когда сами решите продлить.</div>`
      : `<div>Реквизиты для оплаты скоро появятся.${s.support_contact ? ` Напишите нам: <b>${esc(s.support_contact)}</b>` : ''}</div>`;
    const ok = $('#openKaspi');
    if (ok) ok.onclick = async () => {
      const phone = (String(s.kaspi_details).match(/[+\d][\d\s()-]{9,}/) || [''])[0].replace(/[^\d]/g, '');
      if (phone) await copyText(phone);
      window.location.href = 'kaspi://';
      setTimeout(() => { if (!document.hidden) window.open('https://kaspi.kz/', '_blank'); }, 1500);
    };
    const paid = $('#paid');
    if (paid) paid.onclick = async () => {
      if (planObj().staff_limit < activeStaff().length) return toastErr(`На тарифе «${planObj().title}» до ${planObj().staff_limit} сотрудников, а у вас ${activeStaff().length}. Выберите другой тариф или отключите лишних сотрудников`);
      const note = $('#payer').value.trim();
      if (note.length < 2) return toastErr('Укажите имя отправителя — так мы найдём перевод');
      await busy(paid, async () => {
        const { error } = await sb.rpc('request_payment', { p_plan: state.plan, p_months: state.months, p_note: note });
        if (error) return toastErr(error);
        toast('Спасибо! Заявка отправлена — проверим перевод и продлим подписку');
        loadHist();
      });
    };
  };
  $$('.plan').forEach((p) => { p.onclick = () => { state.plan = p.dataset.p; draw(); }; });
  $$('#months [data-m]').forEach((x) => { x.onclick = () => { state.months = +x.dataset.m; draw(); }; });
  draw();
  loadHist();

  async function loadHist() {
    const { data } = await sb.from('payment_requests').select('*').eq('business_id', b.id).order('created_at', { ascending: false }).limit(30);
    const box = $('#hist');
    if (!box) return;
    const st = { pending: 'проверяется', approved: 'подтверждена', rejected: 'не найдена' };
    box.innerHTML = !data?.length ? '<p class="muted">Оплат пока не было</p>' : `<div class="table-wrap"><table class="table"><thead><tr><th>Дата</th><th>Тариф</th><th>Сумма</th><th>Статус</th></tr></thead><tbody>
      ${data.map((p) => `<tr><td class="nowrap">${fmtDateShort(p.created_at, tz())}</td><td>${esc(planOf(p.plan).title)}, ${p.months} мес</td><td class="nowrap">${money(p.amount)}</td><td><span class="badge b-${p.status}">${st[p.status]}</span></td></tr>`).join('')}</tbody></table></div>`;
    if (data?.some((p) => p.status === 'approved' && new Date(p.processed_at) > new Date(Date.now() - 600000))) { await reloadBiz(); renderBanner(); }
  }
}
