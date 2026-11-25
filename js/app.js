import {
  sb, $, $$, esc, money, toast, toastErr, errMsg, modal, confirmDlg, busy, copyText, qrDataUrl, store,
  normPhone, fmtPhone, phoneMask, waLink, telLink, zonedToUtc, dateStrInTz, timeStrInTz, minutesInTz,
  todayInTz, addDays, isoWeekday, WD_SHORT, WD_FULL, humanDate, humanDateTime, fmtDateShort, minsToHHMM,
  durText, plural, statusBadge, STATUS, slugify, pageUrl, BRAND, INITIAL_HASH, photoUrl, resizeImage, STAFF_AUTH_KEY,
} from './lib.js?v=20261125b';
import { renderAuth, renderNewPassword } from './auth.js?v=20261125b';
import { downloadXlsx } from './xlsx.js?v=20261125b';

const root = $('#root');
const S = {
  user: null, biz: null, settings: {}, plans: [], staff: [], services: [], links: [], hours: [],
  day: null, view: store.get('kezek_view', 'list'), dayBookings: [], role: 'owner', mgr: null,
};
const TABS = [['journal', 'Главная'], ['acc', 'Бухгалтерия'], ['payroll', 'Зарплата'], ['ledger', 'Проводки'], ['clients', 'Клиенты'], ['services', 'Услуги'], ['staff', 'Сотрудники'], ['billing', 'Тарифы'], ['settings', 'Настройки'], ['ai', 'ИИ-ассистент']];
const MGR_TABS = [['journal', 'Журнал записей'], ['clients', 'Клиенты'], ['services', 'Прайс услуг']];
const THEMES = [['graphite', 'Светлая (Графит)', '#18181b'], ['emerald', 'Изумрудная', '#116d5b'], ['dark', 'Тёмная', '#0f1115']];
function applyTheme(t) { document.documentElement.dataset.theme = t; store.set('jz_theme', t); }
applyTheme(store.get('jz_theme', 'graphite'));
function cycleTheme() {
  const i = THEMES.findIndex(([k]) => k === document.documentElement.dataset.theme);
  const n = THEMES[(i + 1) % THEMES.length];
  applyTheme(n[0]); toast('Оформление: ' + n[1]);
}
const tabsNow = () => (S.role === 'manager' ? MGR_TABS : TABS);
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
  if (event === 'SIGNED_OUT') { S.user = null; S.biz = null; S.role = 'owner'; S.mgr = null; showAuth(); }
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
  if (!biz) {
    // Менеджер входит в тот же app.html, но видит урезанный кабинет
    const { data: mm } = await sb.rpc('manager_me');
    if (mm) {
      S.role = 'manager'; S.mgr = mm.manager; S.biz = mm.business;
      await loadRefs(); renderShell(); route(); return;
    }
    // Аккаунт сотрудника — у него свой кабинет
    const { data: me } = await sb.rpc('staff_me');
    if (me) {
      try {
        const k = Object.keys(localStorage).find((x) => /^sb-.*-auth-token$/.test(x));
        if (k) { localStorage.setItem(STAFF_AUTH_KEY, localStorage.getItem(k)); localStorage.removeItem(k); }
      } catch { /* приватный режим — войдёт ещё раз */ }
      location.replace(pageUrl('staff.html')); return;
    }
    return renderOnboarding();
  }
  S.role = 'owner'; S.mgr = null;
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
    S.role === 'manager' ? sb.rpc('manager_staff') : sb.from('staff').select('*').eq('business_id', id).order('sort').order('created_at'),
    sb.from('services').select('*').eq('business_id', id).order('sort').order('name'),
    sb.from('staff_services').select('*').eq('business_id', id),
    sb.from('working_hours').select('*').eq('business_id', id).order('start_time'),
  ]);
  S.staff = st.data || []; S.services = sv.data || []; S.links = ln.data || []; S.hours = wh.data || [];
}

// ---------- Онбординг ----------
function renderOnboarding() {
  root.innerHTML = `<div class="auth-wrap"><div class="auth-card" style="max-width:540px">
    <div class="center" style="margin-bottom:18px"><span class="logo"><i>J</i><span>${esc(BRAND)}</span></span></div>
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
        <a class="logo" href="index.html"><i>J</i><span>${esc(BRAND)}</span></a>
        <span class="biz grow" id="bizName">${esc(S.biz.name)}${S.role === 'manager' ? ` · <span class="muted">менеджер ${esc(S.mgr.name)}</span>` : ''}</span>
        <button class="btn btn-sm" id="themeBtn" title="Оформление: светлая, изумрудная, тёмная">🌓</button>
        <button class="btn btn-sm" id="shareBtn" title="Ссылка для записи, QR-код, отправить клиентам">🔗<span class="lbl-lg"> Ссылка и QR</span></button>
        <button class="btn btn-sm btn-pri" id="walkBtn" title="Клиент без записи — сразу в кассу">+<span class="lbl-lg"> Без записи</span><span class="lbl-sm"> Касса</span></button>
        <button class="btn btn-sm btn-ghost" id="logout" title="Выйти"><span class="lbl-lg">Выйти</span><span class="lbl-sm">⎋</span></button>
      </div>
      <div class="container"><nav class="tabs">${tabsNow().map(([k, t]) => `<a class="tab" href="#${k}" data-t="${k}">${t}</a>`).join('')}</nav></div>
    </header>
    <div class="container"><div id="banner" style="margin-top:14px"></div><main class="page" id="page"></main></div>`;
  $('#logout').onclick = () => sb.auth.signOut();
  $('#shareBtn').onclick = () => shareModal();
  $('#themeBtn').onclick = () => cycleTheme();
  $('#walkBtn').onclick = () => walkInModal();
}

function route() {
  let t = location.hash.slice(1);
  if (t === 'cash') t = S.role === 'manager' ? 'journal' : 'ledger';
  const tab = tabsNow().some(([k]) => k === t) ? t : 'journal';
  $$('.tab').forEach((a) => a.classList.toggle('active', a.dataset.t === tab));
  renderBanner();
  const fn = { journal: renderJournal, clients: renderClients, services: S.role === 'manager' ? renderPriceList : renderServices, staff: renderStaff, acc: renderAcc, payroll: renderPayroll, ledger: renderLedger, ai: renderAi, settings: renderSettings, billing: renderBilling }[tab];
  fn();
}

function daysLeft() { return Math.ceil((new Date(S.biz.paid_until) - Date.now()) / 86400000); }

function renderBanner() {
  const b = $('#banner');
  const d = daysLeft();
  const support = S.settings.support_contact ? ` Поддержка: ${esc(S.settings.support_contact)}` : '';
  if (S.role === 'manager') {
    b.innerHTML = S.biz.is_blocked || d <= 0 ? '<div class="alert alert-danger">⛔ Подписка бизнеса неактивна — сообщите владельцу.</div>' : '';
    return;
  }
  if (S.biz.is_blocked) b.innerHTML = `<div class="alert alert-danger">Аккаунт заблокирован.${support}</div>`;
  else if (d <= 0) b.innerHTML = `<div class="alert alert-danger">⛔ Подписка закончилась — онлайн-запись для клиентов отключена. <a href="#billing"><b>Продлить</b></a></div>`;
  else if (S.biz.plan === 'trial') b.innerHTML = `<div class="alert alert-info">🎁 Пробный период: осталось ${d} ${plural(d, 'день', 'дня', 'дней')}. <a href="#billing">Тарифы</a></div>`;
  else if (d <= 5) b.innerHTML = `<div class="alert alert-warn">⚠️ Подписка закончится через ${d} ${plural(d, 'день', 'дня', 'дней')}. <a href="#billing"><b>Продлить</b></a></div>`;
  else b.innerHTML = '';
}

// ---------- Ссылка для записи: скопировать, QR, отправить ----------
const shortUrl = (u) => u.replace(/^https?:\/\//, '');
const tgShareUrl = () => `https://t.me/share/url?url=${encodeURIComponent(bookUrl())}&text=${encodeURIComponent(`Записаться онлайн в «${S.biz.name}»`)}`;
function selectOnTap(input) {
  if (!input) return;
  const sel = () => { input.focus(); input.setSelectionRange(0, input.value.length); };
  input.addEventListener('click', sel); input.addEventListener('focus', sel);
}
async function nativeShare() {
  try {
    await navigator.share({ title: S.biz.name, text: `Записаться онлайн в «${S.biz.name}»`, url: bookUrl() });
    onbFlag('shared');
  } catch { /* пользователь закрыл окно */ }
}
function shareBarHtml() {
  const url = bookUrl();
  return `<div class="card share-bar"><div class="grow" style="min-width:0">
      <div class="muted small">Ссылка для записи клиентов</div>
      <a class="share-url" href="${esc(url)}" target="_blank" rel="noopener">${esc(shortUrl(url))}</a></div>
    <button class="btn btn-sm btn-pri" id="sbCopy">Скопировать</button>
    <button class="btn btn-sm" id="sbQr">QR и отправить</button></div>`;
}
function bindShareBar() {
  $('#sbCopy') && ($('#sbCopy').onclick = () => { copyText(bookUrl()); onbFlag('shared'); });
  $('#sbQr') && ($('#sbQr').onclick = () => shareModal());
  $$('a[href="#share"]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); shareModal(); }; });
}
function shareModal() {
  const url = bookUrl(), qr = qrDataUrl(url);
  const text = `Записаться онлайн в «${S.biz.name}»: ${url}`;
  const m = modal({ title: 'Ссылка для записи', body: `<div class="share">
      <img class="share-qr" src="${qr}" alt="QR-код для записи">
      <div class="link-box"><input class="input grow" readonly value="${esc(url)}" id="shUrl"><button class="btn btn-pri" id="shCopy">Скопировать</button></div>
      <div class="share-btns">
        ${navigator.share ? '<button class="btn" id="shNative">Поделиться…</button>' : ''}
        <a class="btn btn-wa" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(text)}">WhatsApp</a>
        <a class="btn" target="_blank" rel="noopener" href="${esc(tgShareUrl())}">Telegram</a>
        <button class="btn" id="shText">Скопировать с текстом</button>
        <a class="btn" href="${qr}" download="qr-${esc(S.biz.slug)}.png" id="shDl">Скачать QR</a>
        <a class="btn" href="${esc(url)}" target="_blank" rel="noopener">Открыть страницу ↗</a>
      </div>
      <p class="muted small" style="margin:0">Ссылку поставьте в шапку Instagram, в WhatsApp Business и 2GIS. QR распечатайте на стойку или зеркало. На телефоне QR можно сохранить долгим нажатием на картинку.</p>
    </div>` });
  const el = m.el;
  selectOnTap($('#shUrl', el));
  $('#shCopy', el).onclick = () => { copyText(url); onbFlag('shared'); };
  $('#shText', el).onclick = () => { copyText(text); onbFlag('shared'); };
  $('#shDl', el).addEventListener('click', () => onbFlag('shared'));
  $$('.btn-wa, [href^="https://t.me/share"]', el).forEach((a) => a.addEventListener('click', () => onbFlag('shared')));
  $('#shNative', el) && ($('#shNative', el).onclick = () => nativeShare());
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
    [!!st.shared, '#share', 'Разместите ссылку для записи в Instagram, WhatsApp и 2GIS'],
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

const JF = { staff: store.get('jz_jf_staff', ''), status: 'all' };
function renderJournal() {
  if (!S.day) S.day = todayInTz(tz());
  const mgr = S.role === 'manager';
  const stOpts = activeStaff().map((x) => `<option value="${x.id}" ${JF.staff === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  $('#page').innerHTML = `${mgr ? mgrBadge() : checklistHtml()}
    <div class="card" style="margin-bottom:12px">
      <div class="row between" style="margin-bottom:10px"><b>Быстрый ввод</b>${mgr ? '<span class="muted small">запись, оплата, сверка смены</span>' : '<a href="#acc" class="small"><b>Бухгалтерия ›</b></a>'}</div>
      <div class="quick-btns">
        <button class="btn btn-pri" data-q="walk">+ Без записи</button>
        <button class="btn" data-q="book">По записи</button>
        <button class="btn" data-q="batch">Списком</button>
        <button class="btn" data-q="exp">– Расход</button>
        <button class="btn" data-q="shift">🔒 Закрыть смену</button>
      </div></div>
    <div class="grid grid-4 keep-2" id="cashKpi" style="margin-bottom:10px"></div>
    <div class="card cash-extra small" id="cashExtra" style="margin-bottom:14px"><div class="spinner"></div></div>
    ${mgr ? '' : shareBarHtml()}
    <div class="page-h">
      <div class="day-nav">
        <button class="btn btn-sm" id="prev" aria-label="Предыдущий день">‹</button>
        <div class="day-title" id="dt"></div>
        <button class="btn btn-sm" id="next" aria-label="Следующий день">›</button>
        <button class="btn btn-sm btn-ghost" id="today">Сегодня</button>
        <input type="date" class="input input-sm" id="dpick" style="width:auto">
      </div>
      <div class="seg" style="margin:0"><button data-v="list">Список</button><button data-v="grid">Сетка</button></div>
    </div>
    <div class="row filters">
      <select class="select" id="mf"><option value="">Все мастера</option>${stOpts}</select>
      <div class="chips">${[['all', 'Все'], ['booked', 'По записи'], ['paid', 'Оплачено'], ['noshow', 'Не пришёл']].map(([k, t]) => `<button class="chip ${JF.status === k ? 'on' : ''}" data-sf="${k}">${t}</button>`).join('')}</div>
    </div>
    <div class="grid grid-4 keep-2" id="kpi" style="margin-bottom:14px"></div>
    <div id="jr"><div class="spinner"></div></div>`;
  $('#hideOnb') && ($('#hideOnb').onclick = () => { onbFlag('hidden'); renderJournal(); });
  bindShareBar();
  const Q = { walk: () => walkInModal(), book: () => bookingModal(null, { date: S.day, staff_id: JF.staff || undefined }), batch: () => batchModal(), exp: () => expenseModal('expense'), shift: () => shiftModal() };
  $$('[data-q]').forEach((b) => { b.onclick = Q[b.dataset.q]; });
  $('#prev').onclick = () => { S.day = addDays(S.day, -1); drawDay(); };
  $('#next').onclick = () => { S.day = addDays(S.day, 1); drawDay(); };
  $('#today').onclick = () => { S.day = todayInTz(tz()); drawDay(); };
  $('#dpick').onchange = (e) => { if (e.target.value) { S.day = e.target.value; drawDay(); } };
  $$('[data-v]').forEach((b) => { b.onclick = () => { S.view = b.dataset.v; store.set('kezek_view', S.view); drawDay(); }; });
  $('#mf').onchange = (e) => { JF.staff = e.target.value; store.set('jz_jf_staff', JF.staff); drawDay(); };
  $$('[data-sf]').forEach((b) => { b.onclick = () => { JF.status = b.dataset.sf; $$('[data-sf]').forEach((x) => x.classList.toggle('on', x === b)); drawDay(); }; });
  drawCashKpi();
  drawDay();
}

async function drawDay() {
  const day = S.day;
  $('#dt').textContent = `${capital(WD_FULL[isoWeekday(day)])}, ${humanDate(day, false)}`;
  $('#dpick').value = day;
  $$('[data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v === S.view));
  const from = zonedToUtc(day, '00:00', tz()).toISOString(), to = zonedToUtc(addDays(day, 1), '00:00', tz()).toISOString();
  const [bq, eq] = await Promise.all([
    sb.from('bookings').select('*').eq('business_id', S.biz.id).gte('starts_at', from).lt('starts_at', to).order('starts_at'),
    sb.from('earnings').select('*').eq('business_id', S.biz.id).gte('occurred_at', from).lt('occurred_at', to).order('occurred_at'),
  ]);
  if (S.day !== day || !$('#jr')) return;
  if (bq.error) { $('#jr').innerHTML = `<div class="alert alert-danger">${esc(errMsg(bq.error))}</div>`; return; }
  const data = bq.data;
  S.dayBookings = data;
  S.dayEarn = eq.data || [];
  const ids = data.map((b) => b.id);
  S.paid = new Map(S.dayEarn.filter((e) => e.booking_id).map((e) => [e.booking_id, e]));
  // оплата по записи могла быть записана в другой день
  const missing = ids.filter((id) => !S.paid.has(id));
  if (missing.length && S.role !== 'manager') {
    const { data: more } = await sb.from('earnings').select('*').in('booking_id', missing);
    (more || []).forEach((e) => S.paid.set(e.booking_id, e));
  }
  if (S.day !== day || !$('#jr')) return;
  const act = data.filter((b) => b.status !== 'cancelled');
  const walk = S.dayEarn.filter((e) => !e.booking_id);
  $('#kpi').innerHTML = [
    [act.length, plural(act.length, 'запись', 'записи', 'записей')],
    [walk.length, 'без записи'],
    [money(act.reduce((a, b) => a + (b.status !== 'no_show' ? b.price || 0 : 0), 0)) || '0 ₸', 'ожидалось по записям'],
    [data.filter((b) => b.status === 'cancelled').length + ' / ' + act.filter((b) => b.status === 'no_show').length, 'отмен / неявок'],
  ].map(([v, l]) => `<div class="card stat flat"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');
  const isPaid = (b) => S.paid.has(b.id) || b.status === 'done';
  const okStaff = (id) => !JF.staff || id === JF.staff;
  const okStatus = (b) => JF.status === 'all' || (JF.status === 'paid' && isPaid(b))
    || (JF.status === 'booked' && ['booked', 'confirmed'].includes(b.status) && !isPaid(b)) || (JF.status === 'noshow' && b.status === 'no_show');
  const items = data.filter((b) => okStaff(b.staff_id) && okStatus(b));
  const walks = walk.filter((e) => okStaff(e.staff_id) && ['all', 'paid'].includes(JF.status));
  if (S.view === 'grid') drawGrid(items.filter((b) => b.status !== 'cancelled'), day); else drawList(items, walks);
}

function drawGrid(items, day) {
  const box = $('#jr');
  const staff = activeStaff().filter((x) => !JF.staff || x.id === JF.staff);
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

function drawList(items, walks = []) {
  const box = $('#jr');
  const rows = [...items.map((b) => ({ t: b.starts_at, b })), ...walks.map((e) => ({ t: e.occurred_at, e }))]
    .sort((a, b) => new Date(a.t) - new Date(b.t));
  if (!rows.length) {
    box.innerHTML = `<div class="card empty"><div class="ico">🗓</div>${JF.status !== 'all' || JF.staff ? 'По выбранному фильтру записей нет' : 'На этот день записей нет'}
      <div style="margin-top:10px"><button class="btn btn-pri btn-sm" id="emptyAdd">+ Записать клиента</button></div></div>`;
    $('#emptyAdd').onclick = () => bookingModal(null, { date: S.day, staff_id: JF.staff || undefined });
    return;
  }
  const owner = S.role !== 'manager';
  box.innerHTML = `<div class="bk-list">${rows.map((r) => {
    if (r.e) {
      const e = r.e;
      return `<div class="bk-card walk" data-e="${e.id}"><div class="bk-main">
        <div class="grow" data-open><b>${timeStrInTz(e.occurred_at, tz())} · ${esc(e.client_name || 'Гость')} <span class="muted small">(без записи)</span></b>
          <div class="muted small">${[e.staff_name, e.service_name, money(e.amount)].filter(Boolean).map(esc).join(' · ')}</div></div>
        <span class="badge b-done">Оплачено · ${PAY[e.method] || e.method}</span>${owner ? '<button class="x" data-x="delE" title="Удалить оплату">✕</button>' : ''}</div></div>`;
    }
    const b = r.b, e = S.paid.get(b.id), paid = !!e || b.status === 'done', cancelled = b.status === 'cancelled';
    const badge = paid ? `<span class="badge b-done">Оплачено${e ? ' · ' + (PAY[e.method] || '') : ''}</span>` : statusBadge(b.status);
    const open = ['booked', 'confirmed'].includes(b.status) && !paid;
    return `<div class="bk-card ${cancelled ? 'cancelled' : ''}" data-id="${b.id}"><div class="bk-main">
        <div class="grow" data-open><b>${timeStrInTz(b.starts_at, tz())} · ${esc(b.client_name)}</b>
          <div class="muted small">${[b.staff_name, b.service_name, b.price != null ? money(b.price) : '', b.source === 'online' ? 'онлайн' : ''].filter(Boolean).map(esc).join(' · ')}</div>
          ${b.comment ? `<div class="small">💬 ${esc(b.comment)}</div>` : ''}</div>
        ${badge}${cancelled || paid ? '' : '<button class="x" data-x="cancel" title="Отменить запись">✕</button>'}</div>
      ${cancelled ? '' : `<div class="bk-act">
        <a class="btn btn-sm" href="${telLink(b.client_phone)}">Позвонить</a>
        <a class="btn btn-sm btn-wa" target="_blank" rel="noopener" href="${esc(waLink(b.client_phone, reminderText(b)))}">WhatsApp</a>
        ${paid ? '' : '<button class="btn btn-sm" data-x="move">Перенести</button>'}
        ${open ? '<button class="btn btn-sm" data-x="noshow">Не пришёл</button>' : ''}
        ${paid ? '' : '<button class="btn btn-sm btn-pri" data-x="pay">Оплатил</button>'}</div>`}</div>`;
  }).join('')}</div>`;
  const setStatus = async (b, status, msg) => {
    const { error } = await sb.from('bookings').update({ status }).eq('id', b.id);
    if (error) return toastErr(error);
    toast(msg); drawDay(); drawCashKpi();
  };
  $$('.bk-card[data-id]', box).forEach((el) => {
    const b = S.dayBookings.find((x) => x.id === el.dataset.id);
    $('[data-open]', el).onclick = () => bookingModal(b);
    $$('[data-x]', el).forEach((btn) => {
      btn.onclick = async () => {
        const a = btn.dataset.x;
        if (a === 'move') return bookingModal(b);
        if (a === 'pay') return payModal(b);
        if (a === 'noshow') return setStatus(b, 'no_show', 'Отмечено: не пришёл');
        if (a === 'cancel') {
          if (!(await confirmDlg(`Отменить запись ${b.client_name} на ${timeStrInTz(b.starts_at, tz())}? Если клиент подключил Telegram, он получит уведомление.`, 'Отменить запись', true))) return;
          return setStatus(b, 'cancelled', 'Запись отменена');
        }
      };
    });
  });
  $$('.bk-card[data-e]', box).forEach((el) => {
    const e = S.dayEarn.find((x) => x.id === el.dataset.e);
    if (owner) $('[data-open]', el).onclick = () => earningModal(e);
    const del = $('[data-x=delE]', el);
    if (del) del.onclick = async () => {
      if (!(await confirmDlg(`Удалить оплату ${money(e.amount)}${e.client_name ? ' — ' + e.client_name : ''}?`, 'Удалить', true))) return;
      const { error } = await sb.from('earnings').delete().eq('id', e.id);
      if (error) return toastErr(error);
      toast('Оплата удалена'); drawDay(); drawCashKpi();
    };
  });
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
    ${!isNew && b.status !== 'cancelled' ? '<button class="btn" data-a="pay">💰 Оплатил</button>' : ''}
    <button class="btn" data-a="close">Закрыть</button><button class="btn btn-pri" data-a="save">${isNew ? 'Записать' : 'Сохранить'}</button>`;
  const m = modal({ title: isNew ? 'Новая запись' : 'Запись', body, footer });
  const payBtn = $('[data-a=pay]', m.el);
  if (payBtn) payBtn.onclick = () => { m.close(); payModal(b); };
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
  if ($('#jr')) { drawDay(); drawCashKpi(); }
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
  if (S.role !== 'manager') sb.rpc('owner_stats', { p_from: from.toISOString(), p_to: to.toISOString() }).then(({ data }) => {
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
  const mgr = S.role === 'manager';
  const body = document.createElement('div');
  body.innerHTML = `${!isNew ? `<div class="grid grid-2 keep-2" style="margin-bottom:12px">
      <div class="card stat flat"><div class="v">${c.visits || 0}</div><div class="l">${plural(c.visits || 0, 'визит', 'визита', 'визитов')}${c.no_shows ? ` · неявок ${c.no_shows}` : ''}</div></div>
      <div class="card stat flat"><div class="v">${money(c.spent || 0) || '0 ₸'}</div><div class="l">Оставил в кассе</div></div></div>
      <div id="lastV" class="card flat" style="margin-bottom:12px;padding:12px"><div class="muted small">Последний визит</div><div class="spinner"></div></div>
      <div class="row" style="margin-bottom:14px;flex-wrap:wrap;gap:8px"><button class="btn btn-pri" id="book">Записать по времени</button>
        <button class="btn" id="again" disabled>Как в прошлый раз (в кассу)</button>
        <a class="btn btn-sm" href="${telLink(c.phone)}">📞 Позвонить</a><a class="btn btn-sm btn-wa" target="_blank" rel="noopener" href="${esc(waLink(c.phone))}">WhatsApp</a></div>` : ''}
    <form id="cf" class="form-grid" novalidate>
      <label class="field"><span>Имя</span><input class="input" name="name" required maxlength="80" value="${esc(c?.name || '')}"></label>
      <label class="field"><span>Телефон</span><input class="input" name="phone" type="tel" required></label>
      <label class="field full"><span>Заметка мастера</span><textarea class="textarea" name="notes" maxlength="2000" placeholder="Например: виски покороче, переход плавный">${esc(c?.notes || '')}</textarea></label>
    </form>
    ${!isNew ? '<h3 style="margin-top:14px">История</h3><div id="hist"><div class="spinner"></div></div>' : ''}`;
  const m = modal({
    title: isNew ? 'Новый клиент' : c.name, body, wide: !isNew,
    footer: `${!isNew && !mgr ? '<button class="btn btn-danger" data-a="del">Удалить</button>' : ''}<button class="btn" data-a="close">Закрыть</button><button class="btn btn-pri" data-a="save">${isNew ? 'Добавить' : 'Сохранить'}</button>`,
  });
  const f = $('#cf', m.el);
  f.phone.value = c ? fmtPhone(c.phone) : '';
  phoneMask(f.phone);
  $('[data-a=close]', m.el).onclick = m.close;
  if (!isNew) {
    $('#book', m.el).onclick = () => { m.close(); bookingModal(null, { phone: c.phone, name: c.name, date: S.day || todayInTz(tz()) }); };
    const { data } = await sb.from('bookings').select('*').eq('client_id', c.id).order('starts_at', { ascending: false }).limit(50);
    const last = (data || []).find((b) => b.status === 'done') || (data || []).find((b) => b.status !== 'cancelled');
    const lv = $('#lastV', m.el);
    if (lv) lv.innerHTML = `<div class="muted small">Последний визит</div>${last
      ? `<b>${esc([last.service_name || 'Без услуги', last.price != null ? money(last.price) : ''].filter(Boolean).join(' · '))}</b>
         <div class="muted small">${fmtDateShort(last.starts_at, tz())}${last.staff_name ? ' · Мастер: ' + esc(last.staff_name) : ''}</div>` : '<span class="muted">ещё не было</span>'}`;
    const again = $('#again', m.el);
    if (again && last) {
      again.disabled = false;
      again.onclick = () => { m.close(); walkInModal({ staff_id: last.staff_id, service: last.service_name, amount: last.price, client: c.name, noLast: true }); };
    }
    const h = $('#hist', m.el);
    if (h) h.innerHTML = !data?.length ? '<p class="muted">Записей нет</p>' : `<div class="day-list">${data.map((b) => `
      <div class="item"><div class="t" style="min-width:110px">${fmtDateShort(b.starts_at, tz())} ${timeStrInTz(b.starts_at, tz())}</div>
      <div class="grow small">${esc([b.service_name, b.staff_name, b.price != null ? money(b.price) : ''].filter(Boolean).join(' · '))}</div>${statusBadge(b.status)}</div>`).join('')}</div>`;
    const del = $('[data-a=del]', m.el);
    if (del) del.onclick = async () => {
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
  $('#page').innerHTML = `<div class="page-h"><div><h2 style="margin:0">Услуги и фото</h2><p class="muted small" style="margin:2px 0 0">Фотографии услуг отображаются на странице онлайн-записи</p></div><button class="btn btn-pri" id="add">+ Услуга</button></div>
    <div id="list" class="stack" style="gap:8px"></div>`;
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
      ${svcThumb(s)}
      <div class="grow"><b>${esc(s.name)}</b> ${s.is_active ? '' : '<span class="badge b-cancelled">скрыта</span>'}
        <div class="muted small">${durText(s.duration_min)} · ${s.photo_path ? 'с фото' : 'Без фото'}${serviceStaffNames(s) ? ' · ' + esc(serviceStaffNames(s)) : ''}</div></div>
      <b class="nowrap">${s.price != null ? money(s.price) : ''}</b><span class="muted">›</span></div>`).join('');
  $$('.list-item', list).forEach((el) => { el.onclick = () => serviceModal(S.services.find((s) => s.id === el.dataset.id)); });
}

function serviceModal(s) {
  const isNew = !s;
  const staff = activeStaff();
  const linked = s ? S.links.filter((l) => l.service_id === s.id).map((l) => l.staff_id) : [];
  const checked = (id) => isNew || !linked.length || linked.includes(id);
  const body = `<form id="sf" class="form-grid" novalidate>
      <div class="field full"><span>Фотография услуги (для витрины записи)</span>
        <div class="svc-photo-box"><span id="svcPh">${svcThumb(s || {})}</span><div class="stack" style="gap:6px">
          <input type="file" id="svcFile" accept="image/*" hidden>
          <button type="button" class="btn btn-sm" id="svcUp">+ Загрузить фото услуги</button>
          <button type="button" class="btn btn-sm btn-ghost ${s?.photo_path ? '' : 'hide'}" id="svcClr">Удалить фото</button>
          <small class="muted">JPG или PNG с телефона или компьютера</small></div></div></div>
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
  let photoBlob = null, photoClear = false;
  $('#svcUp', m.el).onclick = () => $('#svcFile', m.el).click();
  $('#svcFile', m.el).onchange = async (ev) => {
    const file = ev.target.files[0]; ev.target.value = '';
    if (!file) return;
    const sv = $('[data-a=save]', m.el); sv.disabled = true;
    try { photoBlob = await resizeImage(file, 900); } catch (e) { return toastErr(e); } finally { sv.disabled = false; }
    photoClear = false;
    $('#svcPh', m.el).innerHTML = `<img class="svc-ph" src="${URL.createObjectURL(photoBlob)}" alt="">`;
    $('#svcClr', m.el).classList.remove('hide');
  };
  $('#svcClr', m.el).onclick = () => { photoBlob = null; photoClear = true; $('#svcPh', m.el).innerHTML = svcThumb({}); $('#svcClr', m.el).classList.add('hide'); };
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
      const oldPath = s?.photo_path || null;
      if (photoBlob) {
        const path = `${S.biz.id}/svc-${crypto.randomUUID()}.jpg`;
        const up = await sb.storage.from('photos').upload(path, photoBlob, { contentType: 'image/jpeg', cacheControl: '31536000' });
        if (up.error) return toastErr(up.error);
        const { error } = await sb.from('services').update({ photo_path: path }).eq('id', r.data.id);
        if (error) { await sb.storage.from('photos').remove([path]); return toastErr(error); }
        if (oldPath) sb.storage.from('photos').remove([oldPath]);
      } else if (photoClear && oldPath) {
        const { error } = await sb.from('services').update({ photo_path: null }).eq('id', r.data.id);
        if (error) return toastErr(error);
        sb.storage.from('photos').remove([oldPath]);
      }
      if (staff.length > 1) {
        const ids = sel.length === staff.length ? [] : sel;
        const { error } = await sb.rpc('owner_set_service_staff', { p_service: r.data.id, p_staff: ids });
        if (error) return toastErr(error);
      }
      await loadRefs(); toast('Сохранено'); m.close(); renderServices();
    });
  };
}

function svcThumb(s) {
  return s && s.photo_path ? `<img class="svc-ph" src="${esc(photoUrl(s.photo_path))}" alt="" loading="lazy">` : '<span class="svc-ph">Фото</span>';
}

// Прайс для менеджера — только просмотр
function renderPriceList() {
  const list = S.services.filter((s) => s.is_active);
  $('#page').innerHTML = `${mgrBadge()}<div class="page-h"><h2>Прайс услуг</h2></div>
    <div class="stack" style="gap:8px">${list.map((s) => `<div class="list-item" style="cursor:default">${svcThumb(s)}
      <div class="grow"><b>${esc(s.name)}</b><div class="muted small">${durText(s.duration_min)}${s.description ? ' · ' + esc(s.description) : ''}</div></div>
      <b class="nowrap">${s.price != null ? money(s.price) : ''}</b></div>`).join('') || '<div class="card empty">Услуг пока нет</div>'}</div>
    <p class="muted small" style="margin-top:12px">Цены и фото меняет владелец.</p>`;
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
      <div class="grow"><b>${esc(s.name)}</b>${s.title ? ` <span class="muted">· ${esc(s.title)}</span>` : ''}${s.share_pct ? ` <span class="muted">(${s.share_pct}%)</span>` : ''} ${s.is_active ? '' : '<span class="badge b-cancelled">не работает</span>'}
        <div class="muted small">${esc(scheduleText(s.id))}</div>
        <div class="small" style="margin-top:2px">${s.user_id ? `🔑 вход: <b>${esc(s.login)}</b>${s.tg_chat_id ? ' · ✈️ Telegram подключён' : ' · Telegram не подключён'}` : '<span class="muted">🔒 нет входа — откройте, чтобы выдать логин и пароль</span>'}</div></div><span class="muted">›</span></div>`).join('') || '<div class="card empty">Сотрудников пока нет</div>'}</div>
    <div class="page-h" style="margin-top:22px"><h3 style="margin:0">Менеджеры</h3><button class="btn btn-sm btn-pri" id="addMgr">+ Менеджер</button></div>
    <p class="muted small" style="margin:0 0 8px">Менеджер (администратор) ведёт журнал и клиентов, принимает оплату и расходы за сегодня и закрывает смену. Он не видит ваши финансы за прошлые дни, налог, зарплату, настройки и подписку.</p>
    <div id="mgrs"><div class="spinner"></div></div>
    <p class="muted small" style="margin-top:12px">Каждый сотрудник со своим входом видит только свои записи на странице <a href="${esc(pageUrl('staff.html'))}" target="_blank">кабинета сотрудника</a> и получает в Telegram только своих клиентов.</p>`;
  $('#add').onclick = () => {
    if (activeStaff().length >= limit) return toastErr(`На вашем тарифе можно сотрудников: ${limit}. Выберите тариф побольше в разделе «Подписка»`);
    staffModal(null);
  };
  $$('.list-item', $('#list')).forEach((el) => { el.onclick = () => staffModal(S.staff.find((s) => s.id === el.dataset.id)); });
  $('#addMgr').onclick = () => managerModal(null);
  drawManagers();
}

async function drawManagers() {
  const { data, error } = await sb.from('managers').select('*').eq('business_id', S.biz.id).order('created_at');
  const box = $('#mgrs');
  if (!box) return;
  if (error) { box.innerHTML = `<div class="alert alert-danger">${esc(errMsg(error))}</div>`; return; }
  S.managers = data || [];
  box.innerHTML = S.managers.map((m) => `<div class="list-item ${m.is_active ? '' : 'inactive'}" data-id="${m.id}" style="margin-bottom:8px">
      <span class="avatar">${esc(m.name[0]?.toUpperCase() || '?')}</span>
      <div class="grow"><b>${esc(m.name)}</b> ${m.is_active ? '' : '<span class="badge b-cancelled">отключён</span>'}
        <div class="small muted">🔑 логин: <b>${esc(m.login || '—')}</b></div></div><span class="muted">›</span></div>`).join('')
    || '<div class="card empty small">Менеджеров нет</div>';
  $$('.list-item', box).forEach((el) => { el.onclick = () => managerModal(S.managers.find((m) => m.id === el.dataset.id)); });
}

async function mgrCall(btn, body, after) {
  await busy(btn, async () => {
    const r = await sb.functions.invoke('account', { body });
    if (r.error) return toastErr(await fnErr(r.error));
    await after(r.data);
  });
}

function managerModal(mg) {
  const isNew = !mg;
  const m = modal({
    title: isNew ? 'Новый менеджер' : mg.name,
    body: `<form class="stack" novalidate>
      <label class="field"><span>Имя</span><input class="input" name="name" maxlength="80" value="${esc(mg?.name || '')}" placeholder="Например: Асель"></label>
      <label class="field"><span>Логин для входа</span><input class="input" name="login" maxlength="40" autocapitalize="off" autocomplete="off" value="${esc(mg?.login || `${S.biz.slug}-admin`.slice(0, 40))}">
        <small class="muted">Латинские буквы, цифры, точка, дефис. Пароль создастся сам. Вход — на этой же странице, в поле «Email или логин».</small></label>
      ${isNew ? '' : `<label class="check"><input type="checkbox" name="active" ${mg.is_active ? 'checked' : ''}><span>Доступ включён</span></label>`}
    </form>`,
    footer: `${isNew ? '' : '<button class="btn btn-danger" data-a="del">Удалить</button><button class="btn" data-a="pwd">🔄 Новый пароль</button>'}<button class="btn" data-a="close">Закрыть</button><button class="btn btn-pri" data-a="save">${isNew ? 'Создать вход' : 'Сохранить'}</button>`,
  });
  const f = $('form', m.el);
  f.login.oninput = () => { f.login.value = f.login.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''); };
  $('[data-a=close]', m.el).onclick = m.close;
  const done = async (d, name) => {
    m.close(); await drawManagers();
    credentialsModal(name, d.login, d.password, { page: 'app.html', who: 'менеджера' });
  };
  $('[data-a=save]', m.el).onclick = (e) => {
    const name = f.name.value.trim(), login = f.login.value.trim();
    if (!name) return toastErr('Укажите имя');
    if (login.length < 3) return toastErr('Логин — минимум 3 символа');
    if (isNew) return mgrCall(e.target, { action: 'manager_create', name, login }, (d) => done(d, name));
    return busy(e.target, async () => {
      const { error } = await sb.from('managers').update({ name, is_active: f.active.checked }).eq('id', mg.id);
      if (error) return toastErr(error);
      if (login !== mg.login) {
        const r = await sb.functions.invoke('account', { body: { action: 'manager_password_reset', manager_id: mg.id, login } });
        if (r.error) return toastErr(await fnErr(r.error));
        await done(r.data, name);
        return;
      }
      toast('Сохранено'); m.close(); drawManagers();
    });
  };
  if (!isNew) {
    $('[data-a=pwd]', m.el).onclick = (e) => mgrCall(e.target, { action: 'manager_password_reset', manager_id: mg.id }, (d) => done(d, mg.name));
    $('[data-a=del]', m.el).onclick = async (e) => {
      if (!(await confirmDlg(`Удалить менеджера «${mg.name}»? Он больше не сможет войти.`, 'Удалить', true))) return;
      mgrCall(e.target, { action: 'manager_remove', manager_id: mg.id }, async () => { toast('Удалён'); m.close(); drawManagers(); });
    };
  }
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
      <label class="field"><span>Ставка мастера (% от выручки) <span class="muted">— для раздела «Зарплата»</span></span><input class="input" name="share" type="number" min="0" max="100" step="1" inputmode="numeric" value="${s?.share_pct ?? 0}" style="max-width:140px"></label>
      <label class="check"><input type="checkbox" name="active" ${!s || s.is_active ? 'checked' : ''}><span>Работает и принимает записи</span></label>
      <div><h3 style="margin:8px 0 4px">График работы</h3>${rows.join('')}
        <button type="button" class="btn btn-sm btn-ghost" id="copyMon">Скопировать понедельник на все рабочие дни</button></div>
      ${!isNew ? '<div><h3 style="margin:8px 0 4px">Отпуск и выходные дни</h3><div id="off"></div></div>' : ''}
      ${!isNew ? '<div><h3 style="margin:8px 0 4px">🔑 Личный кабинет сотрудника</h3><div id="acc"></div></div>' : ''}
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
    staffAccessEditor($('#acc', m.el), s);
    $('[data-a=del]', m.el).onclick = async () => {
      if (!(await confirmDlg(`Удалить «${s.name}»? Прошлые записи останутся в журнале без мастера.`, 'Удалить', true))) return;
      if (s.user_id) {
        const r = await sb.functions.invoke('account', { body: { action: 'staff_login_remove', staff_id: s.id } });
        if (r.error) return toastErr(await fnErr(r.error));
      }
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
    const share = Math.min(100, Math.max(0, parseInt(f.share.value, 10) || 0));
    const payload = { name, title: f.title.value.trim() || null, is_active: f.active.checked, share_pct: share };
    await busy(e.target, async () => {
      const r = isNew
        ? await sb.from('staff').insert({ ...payload, business_id: S.biz.id, sort: S.staff.length }).select().single()
        : await sb.from('staff').update(payload).eq('id', s.id).select().single();
      if (r.error) return toastErr(r.error);
      const { error } = await sb.rpc('owner_set_hours', { p_staff: r.data.id, p_hours: hours });
      if (error) return toastErr(error);
      onbFlag('hours');
      await loadRefs(); toast('Сохранено'); m.close(); route();
    });
  };
}

// ---------- Касса: заработок сотрудников и выгрузка в Excel ----------
const PAY = { cash: 'Наличные', kaspi: 'Kaspi', card: 'Карта' };
const cashState = { preset: 'month', from: null, to: null, staff: '' };

function cashRange() {
  const today = todayInTz(tz());
  const mon = addDays(today, -(isoWeekday(today) - 1));
  const ms = today.slice(0, 8) + '01';
  const prev = (() => { const [y, m] = ms.split('-').map(Number); const d = new Date(Date.UTC(y, m - 2, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`; })();
  switch (cashState.preset) {
    case 'today': return [today, today, 'Сегодня'];
    case 'yesterday': return [addDays(today, -1), addDays(today, -1), 'Вчера'];
    case 'week': return [mon, today, 'Эта неделя'];
    case 'lastweek': return [addDays(mon, -7), addDays(mon, -1), 'Прошлая неделя'];
    case 'month': return [ms, today, 'Этот месяц'];
    case 'lastmonth': return [prev, addDays(ms, -1), 'Прошлый месяц'];
    default: return [cashState.from || ms, cashState.to || today, 'Свой период'];
  }
}

async function fetchEarnings(fromDay, toDay) {
  const a = zonedToUtc(fromDay, '00:00', tz()).toISOString();
  const b = zonedToUtc(addDays(toDay, 1), '00:00', tz()).toISOString();
  const out = [];
  for (let off = 0; off < 50000; off += 1000) {
    const { data, error } = await sb.from('earnings').select('*').eq('business_id', S.biz.id)
      .gte('occurred_at', a).lt('occurred_at', b).order('occurred_at', { ascending: false }).range(off, off + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

// Добавить оплату за сотрудника или исправить/удалить любую
function earningModal(e) {
  const isNew = !e;
  const staff = S.staff.filter((x) => x.is_active || (e && x.id === e.staff_id));
  const day = e ? dateStrInTz(e.occurred_at, tz()) : todayInTz(tz());
  const time = e ? timeStrInTz(e.occurred_at, tz()) : timeStrInTz(Date.now(), tz());
  const m = modal({
    title: isNew ? 'Добавить оплату' : 'Оплата', wide: true,
    body: `<form id="ef" class="stack" novalidate><div class="form-grid">
      <label class="field"><span>Сотрудник</span><select class="select" name="staff">${staff.map((x) => `<option value="${x.id}" ${e && e.staff_id === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      <label class="field"><span>Сумма, ₸</span><input class="input" name="amount" type="number" inputmode="numeric" min="1" value="${e ? e.amount : ''}" required></label>
      <label class="field"><span>Дата</span><input class="input" name="day" type="date" value="${day}"></label>
      <label class="field"><span>Время</span><input class="input" name="time" type="time" value="${time}"></label>
      <label class="field"><span>Способ оплаты</span><select class="select" name="method">${Object.entries(PAY).map(([k, t]) => `<option value="${k}" ${e && e.method === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="field"><span>Клиент</span><input class="input" name="client" maxlength="80" value="${esc(e?.client_name || '')}"></label>
      <label class="field"><span>Услуга</span><input class="input" name="service" maxlength="120" value="${esc(e?.service_name || '')}"></label>
      <label class="field"><span>Комментарий</span><input class="input" name="note" maxlength="300" value="${esc(e?.note || '')}"></label></div></form>`,
    footer: `${!isNew ? '<button class="btn btn-danger" data-a="del">Удалить</button>' : ''}<button class="btn" data-a="close">Отмена</button><button class="btn btn-pri" data-a="save">Сохранить</button>`,
  });
  $('[data-a=close]', m.el).onclick = m.close;
  if (!isNew) $('[data-a=del]', m.el).onclick = async () => {
    if (!(await confirmDlg(`Удалить оплату ${money(e.amount)}?`, 'Удалить', true))) return;
    const { error } = await sb.from('earnings').delete().eq('id', e.id);
    if (error) return toastErr(error);
    toast('Удалено'); m.close(); route();
  };
  $('[data-a=save]', m.el).onclick = (ev) => busy(ev.target, async () => {
    const f = $('#ef', m.el);
    const amount = Math.round(Number(f.amount.value));
    if (!amount || amount < 1) return toastErr('Введите сумму');
    if (!f.staff.value) return toastErr('Выберите сотрудника');
    if (!f.day.value) return toastErr('Укажите дату');
    const payload = {
      staff_id: f.staff.value, amount, method: f.method.value,
      occurred_at: zonedToUtc(f.day.value, f.time.value || '12:00', tz()).toISOString(),
      client_name: f.client.value.trim() || null, service_name: f.service.value.trim() || null, note: f.note.value.trim() || null,
    };
    const { error } = isNew
      ? await sb.from('earnings').insert({ ...payload, business_id: S.biz.id, created_by: 'owner' })
      : await sb.from('earnings').update(payload).eq('id', e.id);
    if (error) return toastErr(error);
    toast('Сохранено'); m.close(); route();
  });
}

// Логин и пароль сотрудника: выдать, сменить пароль, закрыть доступ
function staffAccessEditor(box, s) {
  const draw = () => {
    if (s.user_id) {
      box.innerHTML = `<div class="card" style="padding:12px">
        <div>Логин: <b>${esc(s.login)}</b></div>
        <div class="muted small" style="margin:4px 0 10px">Telegram сотрудника: ${s.tg_chat_id ? '✈️ подключён — ему приходят его записи' : 'не подключён (сотрудник подключает сам в своём кабинете)'}</div>
        <div class="row" style="flex-wrap:wrap;gap:8px">
          <button type="button" class="btn btn-sm" data-x="pwd">🔄 Новый пароль</button>
          <button type="button" class="btn btn-sm btn-ghost" data-x="login">Сменить логин</button>
          <button type="button" class="btn btn-sm btn-danger" data-x="off">Закрыть доступ</button>
        </div></div>`;
      $('[data-x=pwd]', box).onclick = (e) => call(e.target, 'staff_password_reset', {});
      $('[data-x=login]', box).onclick = () => form(s.login);
      $('[data-x=off]', box).onclick = async (e) => {
        if (!(await confirmDlg(`Закрыть доступ для «${s.name}»? Сотрудник больше не сможет войти, уведомления в Telegram прекратятся. Записи останутся.`, 'Закрыть доступ', true))) return;
        await busy(e.target, async () => {
          const r = await sb.functions.invoke('account', { body: { action: 'staff_login_remove', staff_id: s.id } });
          if (r.error) return toastErr(await fnErr(r.error));
          Object.assign(s, { user_id: null, login: null, tg_chat_id: null });
          await loadRefs(); renderStaff(); draw(); toast('Доступ закрыт');
        });
      };
    } else form(`${S.biz.slug}-${slugify(s.name) || 'master'}`.slice(0, 40));
  };
  const form = (val) => {
    box.innerHTML = `<p class="muted small" style="margin:0 0 8px">Выдайте сотруднику логин и пароль: он будет видеть только своих клиентов и получать в Telegram только свои записи.</p>
      <div class="row" style="gap:8px;flex-wrap:wrap"><input class="input grow" name="login" maxlength="40" autocapitalize="off" autocomplete="off" value="${esc(val)}" placeholder="логин латиницей">
      <button type="button" class="btn btn-pri" data-x="make">${s.user_id ? 'Сохранить логин' : 'Выдать вход'}</button></div>
      <small class="muted">Латинские буквы, цифры, точка, дефис. Пароль создастся сам.</small>`;
    const inp = $('[name=login]', box);
    inp.oninput = () => { inp.value = inp.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''); };
    $('[data-x=make]', box).onclick = (e) => {
      const login = inp.value.trim();
      if (login.length < 3) return toastErr('Логин — минимум 3 символа');
      call(e.target, 'staff_login_set', { login });
    };
  };
  const call = (btn, action, extra) => busy(btn, async () => {
    const r = await sb.functions.invoke('account', { body: { action, staff_id: s.id, ...extra } });
    if (r.error) return toastErr(await fnErr(r.error));
    await loadRefs();
    Object.assign(s, S.staff.find((x) => x.id === s.id) || {});
    draw(); renderStaff();
    credentialsModal(s.name, r.data.login, r.data.password);
  });
  draw();
}

// Логин и пароль — отдельными сообщениями WhatsApp: в WhatsApp нельзя скопировать часть сообщения,
// а так мастер копирует логин и пароль одним нажатием. Ссылка сама подставляет логин на странице входа.
function credentialsModal(name, login, password, opts = {}) {
  const url = `${pageUrl(opts.page || 'staff.html')}?login=${encodeURIComponent(login)}`;
  const msgs = [
    ['Приветствие и ссылка', opts.who === 'менеджера'
      ? `Здравствуйте, ${name}! Ваш вход в ${BRAND} (кабинет менеджера): журнал записей, клиенты, касса и закрытие смены.\n\nВход: ${url}\n\nЛогин и пароль пришлю следующими сообщениями — нажмите на сообщение и скопируйте.`
      : `Здравствуйте, ${name}! Ваш личный кабинет в ${BRAND} — там ваши записи и клиенты.\n\nВход: ${url}\n\nЛогин и пароль пришлю следующими сообщениями — нажмите на сообщение и скопируйте.\nПосле входа нажмите «Подключить Telegram», чтобы получать уведомления о своих записях.`],
    ['Логин', login],
    ['Пароль', password],
  ];
  const key = `jz_staff_wa_${login}`;
  const m = modal({
    title: `Вход для ${name}`,
    body: `<div class="alert alert-warn" style="margin-bottom:12px">Пароль больше не покажется — отправьте сейчас. Забудет — нажмите «Новый пароль».</div>
      <div class="card" style="padding:12px;margin-bottom:12px">
        ${[['Логин', login], ['Пароль', password]].map(([t, v], i) => `<div style="display:grid;grid-template-columns:1fr auto;gap:2px 8px;align-items:center;${i ? 'margin-top:10px' : ''}">
          <span class="muted small">${t}</span><button class="btn btn-sm" data-copy="${i}" style="grid-row:span 2">Копировать</button>
          <b style="font-family:monospace;font-size:17px;letter-spacing:.5px;word-break:break-all">${esc(v)}</b></div>`).join('')}
      </div>
      <label class="field" style="margin-bottom:10px"><span>WhatsApp ${opts.who === 'менеджера' ? 'менеджера' : 'сотрудника'} <span class="muted">(чтобы все 3 сообщения ушли в один чат)</span></span>
        <input class="input" name="wa" type="tel" inputmode="tel" placeholder="+7 (___) ___-__-__" value="${esc(store.get(key, ''))}"></label>
      <p class="muted small" style="margin:0 0 8px">Нажмите по очереди — WhatsApp откроется 3 раза, каждый раз нажмите «Отправить»:</p>
      <div class="stack" style="gap:8px">${msgs.map(([t], i) => `<button class="btn btn-block" data-send="${i}" style="justify-content:flex-start">
        <span class="badge b-booked">${i + 1}</span><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t)}</span><span class="grow"></span><b data-ok="${i}" style="color:var(--ok)"></b></button>`).join('')}</div>`,
    footer: '<button class="btn" data-a="all">Скопировать всё одним текстом</button><button class="btn btn-pri" data-a="close">Готово</button>',
  });
  const wa = $('[name=wa]', m.el);
  phoneMask(wa);
  $$('[data-copy]', m.el).forEach((b) => { b.onclick = () => copyText(b.dataset.copy === '0' ? login : password); });
  $$('[data-send]', m.el).forEach((b) => {
    b.onclick = () => {
      const i = +b.dataset.send, phone = normPhone(wa.value);
      if (wa.value.trim() && !phone) return toastErr('Проверьте номер WhatsApp');
      if (phone) store.set(key, wa.value);
      window.open(waLink(phone || '', msgs[i][1]), '_blank', 'noopener');
      $(`[data-ok="${i}"]`, m.el).textContent = '✓';
      b.classList.remove('btn-pri');
      const next = $(`[data-send="${i + 1}"]`, m.el);
      if (next) next.classList.add('btn-pri');
    };
  });
  $('[data-send="0"]', m.el).classList.add('btn-pri');
  $('[data-a=all]', m.el).onclick = () => copyText(`${msgs[0][1]}\n\nЛогин: ${login}\nПароль: ${password}`);
  $('[data-a=close]', m.el).onclick = m.close;
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
    <div class="card"><h3>Оформление интерфейса</h3><div class="theme-pick">${THEMES.map(([k, t, c]) => `<button class="chip ${document.documentElement.dataset.theme === k ? 'on' : ''}" data-th="${k}"><i style="background:${c}"></i>${t}</button>`).join('')}</div>
      <p class="muted small" style="margin:8px 0 0">Сохраняется на этом устройстве. Кнопка ◐ вверху тоже переключает тему.</p></div>
    <div class="card"><h3>Ссылка для онлайн-записи</h3>
      <div class="qr-box"><img id="qr" alt="QR-код"><div class="grow stack">
        <div class="link-box"><input class="input grow" readonly value="${esc(url)}" id="url"><button class="btn btn-pri" id="copy">Скопировать</button></div>
        <div class="row"><a class="btn btn-sm" href="${esc(url)}" target="_blank" rel="noopener">Открыть ↗</a>
          <a class="btn btn-sm" id="qrdl" download="qr-zapis.png">Скачать QR</a>
          <a class="btn btn-sm btn-wa" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(shareText)}">Отправить в WhatsApp</a>
          <a class="btn btn-sm" target="_blank" rel="noopener" href="${esc(tgShareUrl())}">В Telegram</a>
          ${navigator.share ? '<button class="btn btn-sm" id="nshare">Поделиться…</button>' : ''}</div>
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
        <label class="field"><span>Ставка налога, %</span><input class="input" name="tax_rate" type="number" min="0" max="30" step="0.5" value="${Number(b.tax_rate ?? 4)}"><small>Для расчёта налога в «Бухгалтерии». Упрощёнка — обычно 4%; уточните у бухгалтера.</small></label>
        <div class="field"><span>Напоминания клиентам в Telegram</span>
          <label class="check"><input type="checkbox" name="remind_24h" ${b.remind_24h ? 'checked' : ''}><span>за сутки</span></label>
          <label class="check"><input type="checkbox" name="remind_2h" ${b.remind_2h ? 'checked' : ''}><span>за 2 часа</span></label></div>
        <div class="full"><button class="btn btn-pri" type="submit">Сохранить</button></div>
      </form></div>

    <div class="card"><h3>🚶 Сегодня — только живая очередь</h3><div id="nosameday"></div></div>

    <div class="card"><h3>💳 Запись по предоплате</h3><div id="prepay"></div></div>

    <div class="card"><h3>📸 Фото работ и товаров</h3><div id="photos"></div></div>

    <div class="card"><h3>Праздники и выходные для всех</h3><p class="muted small">В эти дни онлайн-запись закрыта для всех сотрудников.</p><div id="off"></div></div>

    <div class="card"><h3>Аккаунт</h3><p class="muted">Вход: ${esc(S.user.email)}</p>
      <div class="row"><button class="btn" id="pw">Сменить пароль</button><button class="btn btn-ghost" id="lo2">Выйти</button></div></div>`;

  $$('[data-th]').forEach((x) => { x.onclick = () => { applyTheme(x.dataset.th); $$('[data-th]').forEach((y) => y.classList.toggle('on', y === x)); }; });
  const qr = qrDataUrl(url);
  $('#qr').src = qr; $('#qrdl').href = qr;
  $('#copy').onclick = () => { copyText(url); onbFlag('shared'); };
  selectOnTap($('#url'));
  $('#nshare') && ($('#nshare').onclick = () => nativeShare());
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
  renderNoSameDay();
  renderPrepay();
  renderPhotos();

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
      tax_rate: Math.round(Number(f.tax_rate.value) * 10) / 10,
    };
    if (!(patch.tax_rate >= 0 && patch.tax_rate <= 30)) return toastErr('Ставка налога — от 0 до 30%');
    if (patch.name.length < 2) return toastErr('Укажите название');
    if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(slug)) return toastErr('Адрес страницы: латиница, цифры, дефис, 3–40 символов');
    await busy($('button[type=submit]', f), async () => {
      const { error } = await sb.from('businesses').update(patch).eq('id', b.id);
      if (error) return toastErr(/duplicate|unique/i.test(error.message) ? 'Этот адрес страницы уже занят' : error);
      await reloadBiz(); $('#bizName').textContent = S.biz.name; toast('Сохранено'); renderSettings();
    });
  };

  function renderNoSameDay() {
    const box = $('#nosameday'), on = !!S.biz.no_same_day;
    box.innerHTML = `
      <label class="switch-row">
        <span class="grow"><b>Не принимать онлайн-запись на сегодня</b><br>
          <span class="muted small">Сегодня клиенты приходят по живой очереди, а онлайн записываются с завтрашнего дня и дальше. Вы сами по-прежнему можете добавить запись на сегодня в кабинете. Включается и выключается в любой момент.</span></span>
        <span class="sw-state ${on ? 'on' : 'off'}">${on ? 'ВКЛ' : 'ВЫКЛ'}</span>
        <span class="switch"><input type="checkbox" id="nsdOn" aria-label="Сегодня только живая очередь" ${on ? 'checked' : ''}><i></i></span>
      </label>
      <div class="alert ${on ? 'alert-ok' : 'alert-info'}" style="margin:12px 0 0">${on
        ? '✅ <b>Включено.</b> На сегодня онлайн-записи нет — клиенты увидят «Сегодня — живая очередь» и смогут записаться на завтра и позже.'
        : '⏸ <b>Выключено.</b> Клиенты могут записаться и на сегодня. Нажмите на переключатель, чтобы включить.'}</div>`;
    const sw = $('#nsdOn');
    sw.onchange = async () => {
      const val = sw.checked;
      sw.disabled = true;
      const { error } = await sb.from('businesses').update({ no_same_day: val }).eq('id', S.biz.id);
      sw.disabled = false;
      if (error) { sw.checked = !val; return toastErr(error); }
      await reloadBiz();
      toast(val ? 'Сегодня — только живая очередь' : 'Запись на сегодня снова открыта');
      renderNoSameDay();
    };
  }

  function renderPrepay() {
    const box = $('#prepay'), on = !!S.biz.prepay_enabled;
    const pct = S.biz.prepay_percent || 30, details = S.biz.prepay_details || '';
    const example = (p) => `Пример: услуга за ${money(10000)} → клиент платит заранее <b>${money(Math.round(100 * p))}</b>, остальное на месте.`;
    box.innerHTML = `
      <label class="switch-row">
        <span class="grow"><b>Предоплата при онлайн-записи</b><br>
          <span class="muted small">Клиент при записи увидит, сколько нужно оплатить заранее и куда перевести. Функцию можно включить и выключить в любой момент этим переключателем.</span></span>
        <span class="sw-state ${on ? 'on' : 'off'}">${on ? 'ВКЛ' : 'ВЫКЛ'}</span>
        <span class="switch"><input type="checkbox" id="ppOn" aria-label="Предоплата" ${on ? 'checked' : ''}><i></i></span>
      </label>
      <div class="alert ${on ? 'alert-ok' : 'alert-info'}" style="margin:12px 0 0">${on
        ? `✅ <b>Включено.</b> Клиенты видят предоплату ${pct}% от стоимости услуги.`
        : '⏸ <b>Выключено.</b> Клиенты записываются без предоплаты. Нажмите на переключатель, чтобы включить.'}</div>
      <form id="ppf" class="form-grid" novalidate style="margin-top:14px;${on ? '' : 'display:none'}">
        <label class="field"><span>Размер предоплаты, %</span>
          <input class="input" name="pct" type="number" inputmode="numeric" min="1" max="100" step="1" value="${pct}">
          <small id="ppEx">${example(pct)}</small></label>
        <div class="field"><span>Быстрый выбор</span><div class="row">${[10, 20, 30, 50, 100].map((v) => `<button type="button" class="btn btn-sm" data-pct="${v}">${v}%</button>`).join('')}</div></div>
        <label class="field full"><span>Куда переводить предоплату</span>
          <textarea class="textarea" name="details" maxlength="300" rows="2" placeholder="Например: Kaspi Gold +7 707 000 00 00 (Айгерим А.). В комментарии укажите имя и время записи">${esc(details)}</textarea>
          <small>Этот текст клиент увидит после записи.</small></label>
        ${!details ? '<div class="full alert alert-warn">Укажите, куда переводить. Пока поле пустое, клиенту будет показан только ваш телефон.</div>' : ''}
        <div class="full"><button class="btn btn-pri" type="submit">Сохранить предоплату</button></div>
      </form>`;

    const sw = $('#ppOn');
    sw.onchange = async () => {
      const val = sw.checked;
      sw.disabled = true;
      const { error } = await sb.from('businesses').update({ prepay_enabled: val }).eq('id', S.biz.id);
      sw.disabled = false;
      if (error) { sw.checked = !val; return toastErr(error); }
      await reloadBiz();
      toast(val ? 'Предоплата включена' : 'Предоплата выключена');
      renderPrepay();
    };

    const f = $('#ppf');
    const syncEx = () => { const p = Math.min(100, Math.max(1, Math.round(+f.pct.value || 0))); $('#ppEx').innerHTML = example(p); };
    f.pct.oninput = syncEx;
    $$('[data-pct]', f).forEach((btn) => { btn.onclick = () => { f.pct.value = btn.dataset.pct; syncEx(); }; });
    f.onsubmit = async (e) => {
      e.preventDefault();
      const p = Math.round(+f.pct.value);
      if (!(p >= 1 && p <= 100)) { f.pct.focus(); return toastErr('Процент предоплаты — от 1 до 100'); }
      await busy($('button[type=submit]', f), async () => {
        const { error } = await sb.from('businesses')
          .update({ prepay_percent: p, prepay_details: f.details.value.trim() || null }).eq('id', S.biz.id);
        if (error) return toastErr(error);
        await reloadBiz(); toast('Сохранено'); renderPrepay();
      });
    };
  }

  async function renderPhotos() {
    const box = $('#photos');
    if (!box) return;
    const MAX = 24;
    const { data, error } = await sb.from('business_photos').select('*').eq('business_id', S.biz.id).order('sort').order('created_at');
    if (error) {
      box.innerHTML = '<p class="muted">Фото пока недоступны. Попробуйте обновить страницу позже.</p>';
      return;
    }
    const list = data || [];
    box.innerHTML = `
      <p class="muted small" style="margin-top:0">Покажите клиентам свои работы: причёски, маникюр, товары. Фото появятся на странице онлайн-записи. Можно добавить подпись и цену.</p>
      <div class="ph-grid" id="phGrid">${list.map((p) => `
        <div class="ph-item" data-id="${p.id}">
          <img src="${esc(photoUrl(p.path))}" alt="${esc(p.caption || 'Фото')}" loading="lazy">
          <div class="ph-cap">${p.caption ? `<b>${esc(p.caption)}</b>` : '<span class="muted small">без подписи</span>'}${p.price != null ? `<span>${money(p.price)}</span>` : ''}</div>
          <div class="ph-act"><button class="btn btn-sm" data-edit="${p.id}">Подпись</button><button class="btn btn-sm btn-ghost" data-del="${p.id}">Удалить</button></div>
        </div>`).join('')}</div>
      ${list.length ? '' : '<div class="empty" style="padding:16px 0"><div class="ico">🖼</div><p class="muted">Пока нет фото</p></div>'}
      <input type="file" id="phFile" accept="image/*" multiple hidden>
      <div class="row" style="margin-top:12px"><button class="btn btn-pri" id="phAdd" ${list.length >= MAX ? 'disabled' : ''}>+ Добавить фото</button>
        <span class="muted small">${list.length} из ${MAX}</span></div>`;

    const fileInput = $('#phFile');
    $('#phAdd').onclick = () => fileInput.click();
    fileInput.onchange = async () => {
      const files = [...fileInput.files].slice(0, MAX - list.length);
      fileInput.value = '';
      if (!files.length) return;
      const btn = $('#phAdd');
      await busy(btn, async () => {
        let ok = 0;
        for (const file of files) {
          try {
            const blob = await resizeImage(file);
            const path = `${S.biz.id}/${crypto.randomUUID()}.jpg`;
            const up = await sb.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
            if (up.error) throw up.error;
            const ins = await sb.from('business_photos').insert({ business_id: S.biz.id, path, sort: list.length + ok });
            if (ins.error) { await sb.storage.from('photos').remove([path]); throw ins.error; }
            ok++;
          } catch (e) { toastErr(e); }
        }
        if (ok) toast(ok === 1 ? 'Фото добавлено' : `Добавлено фото: ${ok}`);
        renderPhotos();
      });
    };

    $$('[data-del]', box).forEach((b) => {
      b.onclick = async () => {
        const p = list.find((x) => x.id === b.dataset.del);
        if (!p || !(await confirmDlg('Удалить это фото?', 'Удалить', true))) return;
        const { error: e1 } = await sb.from('business_photos').delete().eq('id', p.id);
        if (e1) return toastErr(e1);
        await sb.storage.from('photos').remove([p.path]);
        toast('Фото удалено'); renderPhotos();
      };
    });
    $$('[data-edit]', box).forEach((b) => {
      b.onclick = () => {
        const p = list.find((x) => x.id === b.dataset.edit);
        if (!p) return;
        const m = modal({
          title: 'Подпись к фото',
          body: `<img src="${esc(photoUrl(p.path))}" alt="" style="width:100%;max-height:220px;object-fit:cover;border-radius:10px;margin-bottom:12px">
            <label class="field"><span>Подпись</span><input class="input" id="phC" maxlength="100" value="${esc(p.caption || '')}" placeholder="Например: Фейд + борода"></label>
            <label class="field"><span>Цена, ₸ (необязательно)</span><input class="input" id="phP" type="number" inputmode="numeric" min="0" value="${p.price ?? ''}"></label>`,
          footer: '<button class="btn btn-pri" id="phS">Сохранить</button>',
        });
        $('#phS', m.el).onclick = async () => {
          const pv = $('#phP', m.el).value.trim();
          const price = pv === '' ? null : Math.round(+pv);
          if (price != null && !(price >= 0)) return toastErr('Цена указана неверно');
          const { error: e2 } = await sb.from('business_photos').update({ caption: $('#phC', m.el).value.trim() || null, price }).eq('id', p.id);
          if (e2) return toastErr(e2);
          m.close(); toast('Сохранено'); renderPhotos();
        };
      };
    });
  }

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
  const { data: offers } = await sb.rpc('my_trial_offers');
  const trialOf = (p) => (offers || []).includes(p.code) && p.trial_price != null && p.trial_days ? p : null;
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
          ${trialOf(p) ? `<div class="muted small" style="text-decoration:line-through">${money(p.price)} / мес</div><div class="price">${money(p.trial_price)}<span class="muted small"> за ${p.trial_days} дн.</span></div><div class="small" style="color:#16a34a;font-weight:600">Пробный период, потом ${money(p.price)} / мес</div>` : `<div class="price">${money(p.price)}<span class="muted small"> / мес</span></div>`}
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
  const isTrial = () => state.months === 1 && !!trialOf(planObj());
  const calc = () => isTrial() ? planObj().trial_price : planObj().price * (state.months === 12 ? 10 : state.months);
  const draw = () => {
    if (!state.plan) return;
    $$('.plan').forEach((p) => p.classList.toggle('sel', p.dataset.p === state.plan));
    $$('#months [data-m]').forEach((x) => x.classList.toggle('btn-pri', +x.dataset.m === state.months));
    const amount = calc();
    $('#pay').innerHTML = s.kaspi_details
      ? `<div><b>К оплате: ${money(amount)}</b> — тариф «${esc(planObj().title)}» ${isTrial() ? `на пробный период ${planObj().trial_days} дн. (потом ${money(planObj().price)} / мес)` : `на ${state.months} мес.`}</div>
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

// =====================================================================
//  Касса, быстрый ввод и финансы (по макету v11)
// =====================================================================
const sum = (rows, f = (r) => r.amount) => rows.reduce((a, r) => a + (f(r) || 0), 0);
const hhmm = (iso) => timeStrInTz(iso, tz());
const m0 = (v) => money(v) || '0 ₸';
function mgrBadge() {
  return `<div class="muted small" style="margin:0 0 10px">👤 Вы вошли как менеджер: <b>${esc(S.mgr?.name || '')}</b></div>`;
}
async function fetchExpenses(fromDay, toDay) {
  const a = zonedToUtc(fromDay, '00:00', tz()).toISOString();
  const b = zonedToUtc(addDays(toDay, 1), '00:00', tz()).toISOString();
  const { data, error } = await sb.from('expenses').select('*').eq('business_id', S.biz.id)
    .gte('occurred_at', a).lt('occurred_at', b).order('occurred_at', { ascending: false }).limit(2000);
  if (error) throw error;
  return data;
}
async function fetchClosings(fromDay, toDay) {
  const a = zonedToUtc(fromDay, '00:00', tz()).toISOString();
  const b = zonedToUtc(addDays(toDay, 1), '00:00', tz()).toISOString();
  const { data, error } = await sb.from('shift_closings').select('*').eq('business_id', S.biz.id)
    .gte('created_at', a).lt('created_at', b).order('created_at', { ascending: false }).limit(200);
  if (error) throw error;
  return data;
}
const shareOf = (e) => {
  const st = S.staff.find((x) => x.id === e.staff_id);
  return Math.round(e.amount * ((st && st.share_pct) || 0) / 100);
};
const taxRate = () => Number(S.biz.tax_rate ?? 4);

// Чипы выбора: <div data-chips="name">…<button data-v="…">
function chipsHtml(name, items, cur) {
  return `<div class="chips" data-chips="${name}">${items.map(([v, t]) => `<button type="button" class="chip ${String(v) === String(cur) ? 'on' : ''}" data-v="${esc(String(v))}">${t}</button>`).join('')}</div>`;
}
function bindChips(root, name, onPick) {
  const box = $(`[data-chips="${name}"]`, root);
  if (!box) return;
  $$('[data-v]', box).forEach((b) => {
    b.onclick = () => { $$('[data-v]', box).forEach((x) => x.classList.toggle('on', x === b)); onPick(b.dataset.v, b); };
  });
}
const setChip = (root, name, v) => $$(`[data-chips="${name}"] [data-v]`, root).forEach((x) => x.classList.toggle('on', x.dataset.v === String(v)));
const PAY_ITEMS = () => [['kaspi', 'Kaspi'], ['cash', 'Наличные'], ['card', 'Карта']];

// Записать оплату: владелец — напрямую, менеджер — через защищённую функцию
async function savePayment(p) {
  if (S.role === 'manager') {
    const { error } = await sb.rpc('manager_add_earning', {
      p_amount: p.amount, p_method: p.method, p_staff: p.booking ? null : (p.staff_id || null), p_booking: p.booking?.id || null,
      p_client: p.booking ? null : (p.client || null), p_service: p.booking ? null : (p.service || null), p_note: p.note || null,
    });
    return error;
  }
  if (p.booking) {
    const b = p.booking;
    const { data: ex } = await sb.from('earnings').select('id').eq('booking_id', b.id).maybeSingle();
    const row = { amount: p.amount, method: p.method, note: p.note || null };
    const r = ex ? await sb.from('earnings').update(row).eq('id', ex.id)
      : await sb.from('earnings').insert({ ...row, business_id: S.biz.id, staff_id: b.staff_id, booking_id: b.id, price_expected: b.price,
        client_name: b.client_name, service_name: b.service_name, occurred_at: new Date().toISOString(), created_by: 'owner' });
    if (r.error) return r.error;
    if (['booked', 'confirmed', 'no_show'].includes(b.status)) {
      const u = await sb.from('bookings').update({ status: 'done' }).eq('id', b.id);
      if (u.error) return u.error;
    }
    return null;
  }
  const { error } = await sb.from('earnings').insert({ business_id: S.biz.id, staff_id: p.staff_id || null, amount: p.amount, method: p.method,
    client_name: p.client || null, service_name: p.service || null, note: p.note || null, occurred_at: new Date().toISOString(), created_by: 'owner' });
  return error;
}
function afterMoney() { if ($('#jr')) { drawDay(); drawCashKpi(); } else route(); }

// «Оплатил» по записи
function payModal(b) {
  let method = 'kaspi';
  const m = modal({
    title: 'Принять оплату',
    body: `<form id="pf2" class="stack" novalidate>
      <div><b>${esc(b.client_name)}</b> <span class="muted small">${timeStrInTz(b.starts_at, tz())}</span>
        <div class="muted small">${[b.staff_name, b.service_name].filter(Boolean).map(esc).join(' · ')}</div></div>
      <label class="field"><span>Сумма, ₸</span><input class="input input-lg" name="amount" type="number" inputmode="numeric" min="1" value="${b.price ?? ''}" placeholder="Сумма"></label>
      <div class="field"><span>Способ оплаты</span>${chipsHtml('pay', PAY_ITEMS(), method)}</div></form>`,
    footer: '<button class="btn" data-a="close">Отмена</button><button class="btn btn-pri" data-a="save">Оплачено</button>',
  });
  bindChips(m.el, 'pay', (v) => { method = v; });
  $('[data-a=close]', m.el).onclick = m.close;
  setTimeout(() => $('#pf2 [name=amount]', m.el)?.focus(), 50);
  $('[data-a=save]', m.el).onclick = (e) => busy(e.target, async () => {
    const amount = Math.round(Number($('#pf2', m.el).amount.value));
    if (!amount || amount < 1) return toastErr('Введите сумму');
    const err = await savePayment({ booking: b, amount, method });
    if (err) return toastErr(err);
    toast(`Оплачено: ${money(amount)}`); m.close(); afterMoney();
  });
}

// «+ Без записи»: клиент пришёл с улицы — сразу в кассу
async function walkInModal(pre = {}) {
  const staff = activeStaff();
  const svcs = S.services.filter((x) => x.is_active);
  let st = pre.staff_id && staff.some((x) => x.id === pre.staff_id) ? pre.staff_id : (staff.length === 1 ? staff[0].id : '');
  let svc = pre.service || '', method = pre.method || 'kaspi';
  const m = modal({
    title: 'Клиент без записи',
    body: `<form id="wf" class="stack" novalidate>
      <div id="wiLast"></div>
      ${staff.length ? `<div class="field"><span>Мастер</span>${chipsHtml('st', staff.map((x) => [x.id, esc(x.name)]), st)}</div>` : ''}
      ${svcs.length ? `<div class="field"><span>Услуга</span>${chipsHtml('svc', svcs.map((x) => [x.name, `${esc(x.name)}${x.price != null ? ' · ' + money(x.price) : ''}`]), svc)}</div>` : ''}
      <div class="form-grid">
        <label class="field"><span>Сумма, ₸</span><input class="input input-lg" name="amount" type="number" inputmode="numeric" min="1" value="${pre.amount ?? ''}"></label>
        <label class="field"><span>Имя <span class="muted">(необязательно)</span></span><input class="input" name="client" maxlength="80" value="${esc(pre.client || '')}" placeholder="Гость"></label>
      </div>
      <div class="field"><span>Способ оплаты</span>${chipsHtml('pay', PAY_ITEMS(), method)}</div></form>`,
    footer: '<button class="btn" data-a="close">Отмена</button><button class="btn btn-pri" data-a="save">Записать оплату</button>',
  });
  const f = $('#wf', m.el);
  bindChips(m.el, 'st', (v) => { st = v; });
  bindChips(m.el, 'svc', (v) => { svc = v; const x = svcs.find((y) => y.name === v); if (x && x.price != null) f.amount.value = x.price; });
  bindChips(m.el, 'pay', (v) => { method = v; });
  $('[data-a=close]', m.el).onclick = m.close;
  $('[data-a=save]', m.el).onclick = (e) => busy(e.target, async () => {
    const amount = Math.round(Number(f.amount.value));
    if (!amount || amount < 1) return toastErr('Введите сумму');
    if (staff.length > 1 && !st) return toastErr('Выберите мастера');
    const err = await savePayment({ amount, method, staff_id: st || null, client: f.client.value.trim() || null, service: svc || null });
    if (err) return toastErr(err);
    toast(`Оплата записана: ${money(amount)}`); m.close(); afterMoney();
  });
  if (pre.noLast) return;
  const { data } = await sb.from('earnings').select('*').eq('business_id', S.biz.id).order('occurred_at', { ascending: false }).limit(1);
  const last = data && data[0];
  const box = $('#wiLast', m.el);
  if (!last || !box) return;
  box.innerHTML = `<div class="card flat pay-row" style="padding:10px 12px"><div><div class="muted small">Как в прошлый раз</div>
      <b>${esc([last.staff_name, last.service_name, money(last.amount)].filter(Boolean).join(' · '))}</b> <span class="muted small">(${PAY[last.method] || ''})</span></div>
      <button type="button" class="btn btn-sm" id="wiRep">Повторить</button></div>`;
  $('#wiRep', m.el).onclick = () => {
    if (last.staff_id && staff.some((x) => x.id === last.staff_id)) { st = last.staff_id; setChip(m.el, 'st', st); }
    if (last.service_name) { svc = last.service_name; setChip(m.el, 'svc', svc); }
    method = last.method; setChip(m.el, 'pay', method);
    f.amount.value = last.amount;
  };
}

// «Списком»: перенести записи из тетради
function batchModal() {
  const svcs = S.services.filter((x) => x.is_active);
  const m = modal({
    title: 'Добавить записи списком', wide: true,
    body: `<div class="stack">
      <p class="muted small" style="margin:0">Одна строка — одна запись на <b>${esc(humanDate(S.day, false))}</b>: <b>время, имя, мастер, телефон</b>. Телефон можно не писать, если клиент уже есть в базе.</p>
      <textarea class="textarea" id="bt" rows="7" placeholder="16:00 Арман ${esc(activeStaff()[0]?.name || 'Ерлан')} 87011234567&#10;17:30 Бекзат ${esc(activeStaff()[1]?.name || activeStaff()[0]?.name || 'Азамат')}"></textarea>
      ${svcs.length ? `<label class="field"><span>Услуга для всех записей</span><select class="select" id="bs"><option value="">— без услуги —</option>${svcs.map((x, i) => `<option value="${x.id}" ${i === 0 ? 'selected' : ''}>${esc(x.name)}${x.price != null ? ' · ' + money(x.price) : ''}</option>`).join('')}</select></label>` : ''}
      <div id="bres"></div></div>`,
    footer: '<button class="btn" data-a="close">Отмена</button><button class="btn btn-pri" data-a="save">Добавить все</button>',
  });
  $('[data-a=close]', m.el).onclick = m.close;
  $('[data-a=save]', m.el).onclick = (e) => busy(e.target, async () => {
    const lines = $('#bt', m.el).value.split('\n').map((x) => x.trim()).filter(Boolean);
    if (!lines.length) return toastErr('Впишите хотя бы одну строку');
    const svc = svcs.find((x) => x.id === ($('#bs', m.el)?.value || '')) || null;
    const staff = activeStaff();
    let ok = 0; const errs = [];
    for (const line of lines) {
      try {
        const tm = line.match(/^(\d{1,2})[:.](\d{2})\s+(.+)$/);
        if (!tm) throw new Error('нет времени в начале (например 16:00)');
        const time = `${tm[1].padStart(2, '0')}:${tm[2]}`;
        let rest = tm[3];
        const ph = rest.match(/(\+?\d[\d\s()-]{8,}\d)/);
        let phone = ph ? normPhone(ph[1]) : null;
        if (ph) rest = rest.replace(ph[1], ' ');
        const words = rest.split(/\s+/).filter(Boolean);
        let master = null;
        for (let i = words.length - 1; i >= 0 && !master; i--) {
          const w = words[i].toLowerCase();
          const hit = staff.find((x) => x.name.toLowerCase() === w || x.name.toLowerCase().split(/\s+/)[0] === w);
          if (hit) { master = hit; words.splice(i, 1); }
        }
        if (!master && staff.length === 1) master = staff[0];
        if (!master) throw new Error('не нашёл мастера');
        const name = words.join(' ').trim();
        if (!name) throw new Error('нет имени клиента');
        if (!phone) {
          const { data } = await sb.from('clients').select('phone').eq('business_id', S.biz.id).ilike('name', name).limit(2);
          if (data && data.length === 1) phone = data[0].phone;
          else throw new Error(data && data.length > 1 ? 'несколько клиентов с таким именем — укажите телефон' : 'нет телефона, и клиента нет в базе');
        }
        const starts = zonedToUtc(S.day, time, tz());
        const dur = svc?.duration_min || 60;
        const { error } = await sb.from('bookings').insert({ business_id: S.biz.id, staff_id: master.id, service_id: svc?.id || null,
          client_name: name, client_phone: phone, starts_at: starts.toISOString(), ends_at: new Date(starts.getTime() + dur * 60000).toISOString(), price: svc?.price ?? null });
        if (error) throw error;
        ok++;
      } catch (err) { errs.push(`<li><b>${esc(line)}</b> — ${esc(errMsg(err))}</li>`); }
    }
    if (ok) { toast(`Добавлено записей: ${ok} из ${lines.length}`); drawDayIfJournal(); }
    if (!errs.length) return m.close();
    $('#bres', m.el).innerHTML = `<div class="alert alert-warn">Не добавлены (исправьте и нажмите ещё раз):<ul style="margin:6px 0 0;padding-left:18px">${errs.join('')}</ul></div>`;
    $('#bt', m.el).value = lines.filter((l) => errs.some((x) => x.includes(esc(l)))).join('\n');
  });
}

// Расход или налог
function expenseModal(kind = 'expense') {
  const mgr = S.role === 'manager';
  if (mgr) kind = 'expense';
  const m = modal({
    title: mgr ? 'Расход из кассы' : 'Добавить расход или налог',
    body: `<form id="xf" class="stack" novalidate>
      ${mgr ? '' : `<div class="field"><span>Категория</span>${chipsHtml('kind', [['expense', 'Расходы'], ['tax', 'Налог']], kind)}</div>`}
      <label class="field"><span>Комментарий</span><input class="input" name="title" maxlength="120" value="${kind === 'tax' ? `Налог (ИП ${taxRate()}%)` : ''}" placeholder="Расходники, аренда, реклама…"></label>
      <div class="form-grid">
        <label class="field"><span>Сумма, ₸</span><input class="input input-lg" name="amount" type="number" inputmode="numeric" min="1"></label>
        ${mgr ? '' : `<label class="field"><span>Дата</span><input class="input" name="day" type="date" value="${todayInTz(tz())}"></label>`}
      </div></form>`,
    footer: '<button class="btn" data-a="close">Отмена</button><button class="btn btn-pri" data-a="save">Сохранить</button>',
  });
  const f = $('#xf', m.el);
  bindChips(m.el, 'kind', (v) => {
    kind = v;
    if (v === 'tax' && !f.title.value.trim()) f.title.value = `Налог (ИП ${taxRate()}%)`;
    if (v === 'expense' && /^Налог/.test(f.title.value)) f.title.value = '';
  });
  $('[data-a=close]', m.el).onclick = m.close;
  setTimeout(() => (f.title.value ? f.amount : f.title).focus(), 50);
  $('[data-a=save]', m.el).onclick = (e) => busy(e.target, async () => {
    const title = f.title.value.trim(), amount = Math.round(Number(f.amount.value));
    if (!title) return toastErr('Напишите, на что расход');
    if (!amount || amount < 1) return toastErr('Введите сумму');
    let error;
    if (mgr) ({ error } = await sb.rpc('manager_add_expense', { p_title: title, p_amount: amount }));
    else {
      const day = f.day.value || todayInTz(tz());
      const at = day === todayInTz(tz()) ? new Date() : zonedToUtc(day, '12:00', tz());
      ({ error } = await sb.from('expenses').insert({ business_id: S.biz.id, kind, title, amount, occurred_at: at.toISOString(), created_by: 'owner' }));
    }
    if (error) return toastErr(error);
    toast(kind === 'tax' ? 'Налог записан' : 'Расход записан'); m.close(); afterMoney();
  });
}

// Закрытие (сверка) смены
async function shiftModal() {
  const day = todayInTz(tz());
  let earn, exp;
  try { [earn, exp] = await Promise.all([fetchEarnings(day, day), fetchExpenses(day, day)]); } catch (e) { return toastErr(e); }
  const owner = S.role !== 'manager';
  const costs = sum(exp.filter((x) => x.kind === 'expense'));
  const total = sum(earn), cash = sum(earn.filter((r) => r.method === 'cash'));
  const share = owner ? sum(earn, shareOf) : 0;
  const m = modal({
    title: 'Закрытие смены',
    body: `<div class="stack" style="gap:0">
      <div class="kv"><span>Выручка за смену (сегодня)</span><b>${m0(total)}</b></div>
      <div class="kv"><span>Наличные / Kaspi и карта</span><b>${m0(cash)} / ${m0(total - cash)}</b></div>
      <div class="kv"><span>Расходы из кассы</span><b>– ${m0(costs)}</b></div>
      ${owner ? `<div class="kv"><span>Доля мастеров за смену</span><b>– ${m0(share)}</b></div>` : ''}
      <div class="kv"><span><b>Наличных должно быть в кассе</b></span><b style="font-size:18px">${m0(cash - costs)}</b></div>
      <label class="field" style="margin-top:12px"><span>Комментарий <span class="muted">(необязательно)</span></span><input class="input" id="shN" maxlength="300" placeholder="Например: размен 5 000 ₸ оставил в кассе"></label>
      <p class="muted small" style="margin:8px 0 0">${earn.length} ${plural(earn.length, 'оплата', 'оплаты', 'оплат')} за сегодня. ${owner ? '' : 'Владелец получит итог в Telegram.'}</p></div>`,
    footer: '<button class="btn" data-a="close">Отмена</button><button class="btn btn-pri" data-a="save">Зафиксировать смену</button>',
  });
  $('[data-a=close]', m.el).onclick = m.close;
  $('[data-a=save]', m.el).onclick = (e) => busy(e.target, async () => {
    const { data, error } = await sb.rpc('close_shift', { p_note: $('#shN', m.el).value.trim() || null });
    if (error) return toastErr(error);
    toast(`Смена закрыта: ${m0(data.gross)}`); m.close(); afterMoney();
  });
}

// Касса на главной
async function drawCashKpi() {
  const kpi = $('#cashKpi'), ex = $('#cashExtra');
  if (!kpi) return;
  const today = todayInTz(tz());
  const card = (v, l, sub) => `<div class="card stat"><div class="l">${l}</div><div class="v">${v}</div><div class="l">${sub}</div></div>`;
  const visits = (n) => `${n} ${plural(n, 'визит', 'визита', 'визитов')}`;
  try {
    if (S.role === 'manager') {
      const [earn, exp, cl] = await Promise.all([fetchEarnings(today, today), fetchExpenses(today, today), fetchClosings(today, today)]);
      if (!$('#cashKpi')) return;
      const t = sum(earn), cash = sum(earn.filter((r) => r.method === 'cash')), costs = sum(exp);
      kpi.innerHTML = card(m0(t), 'Касса сегодня', visits(earn.length)) + card(m0(cash), '💵 Наличные', 'за смену')
        + card(m0(t - cash), '📱 Kaspi и карта', 'за смену') + card(m0(cash - costs), 'В кассе', `расходы ${m0(costs)}`);
      ex.innerHTML = `<div>Режим менеджера: запись клиентов, приём оплат и сверка смены.</div>
        ${cl.length ? `<div>🔒 Смена закрыта в ${hhmm(cl[0].created_at)} на ${m0(cl[0].gross)}. Новые оплаты можно добавлять и закрыть смену ещё раз.</div>` : ''}`;
      return;
    }
    const mon = addDays(today, -(isoWeekday(today) - 1)), ms = today.slice(0, 8) + '01', yd = addDays(today, -1);
    const from = [mon, ms, yd].sort()[0];
    const [earn, exp] = await Promise.all([fetchEarnings(from, today), fetchExpenses(today, today)]);
    if (!$('#cashKpi')) return;
    const d = (r) => dateStrInTz(r.occurred_at, tz());
    const pick = (a, b) => earn.filter((r) => d(r) >= a && d(r) <= b);
    const T = pick(today, today), Y = pick(yd, yd), W = pick(mon, today), M = pick(ms, today);
    kpi.innerHTML = card(m0(sum(T)), 'Касса сегодня', visits(T.length)) + card(m0(sum(Y)), 'Вчера', visits(Y.length))
      + card(m0(sum(W)), 'За неделю', visits(W.length)) + card(m0(sum(M)), 'За месяц', visits(M.length));
    const costs = sum(exp.filter((x) => x.kind === 'expense'));
    const net = sum(T) - costs - sum(T, shareOf) - Math.round(sum(T) * taxRate() / 100);
    const cashT = sum(T.filter((r) => r.method === 'cash'));
    ex.innerHTML = `<div class="row"><span>Чистыми владельцу за сегодня:</span><b>${m0(net)}</b></div>
      <div class="row"><span>Без записи / По записи (мес.):</span><b>${m0(sum(M.filter((r) => !r.booking_id)))} / ${m0(sum(M.filter((r) => r.booking_id)))}</b></div>
      <div class="row"><span>Наличные / Kaspi и карта за смену:</span><b>${m0(cashT)} / ${m0(sum(T) - cashT)}</b></div>`;
  } catch (e) { ex.innerHTML = `<span class="muted">Касса не загрузилась: ${esc(errMsg(e))}</span>`; }
}

// ---------- Финансы владельца: общий выбор периода ----------
function periodBar(rerender) {
  const [from, to, label] = cashRange();
  const presets = [['month', 'Этот месяц'], ['today', 'Сегодня'], ['yesterday', 'Вчера'], ['week', 'Неделя'], ['lastmonth', 'Прошлый месяц'], ['custom', 'Свой период']];
  const html = `<div class="chips" style="margin-bottom:10px">${presets.map(([k, t]) => `<button class="chip ${cashState.preset === k ? 'on' : ''}" data-p="${k}">${t}</button>`).join('')}</div>
    <div class="row ${cashState.preset === 'custom' ? '' : 'hide'}" style="gap:8px;flex-wrap:wrap;margin-bottom:10px;align-items:center">
      <input class="input input-sm" type="date" id="cf" value="${from}"> — <input class="input input-sm" type="date" id="ct" value="${to}"></div>
    <div class="muted small" style="margin-bottom:12px">Период: <b>${esc(label)}</b> · ${esc(humanDate(from, false))} — ${esc(humanDate(to, false))}</div>`;
  const bind = () => {
    $$('[data-p]').forEach((b) => { b.onclick = () => { cashState.preset = b.dataset.p; rerender(); }; });
    if (cashState.preset === 'custom') {
      $('#cf').onchange = $('#ct').onchange = () => { cashState.from = $('#cf').value; cashState.to = $('#ct').value; if (cashState.from && cashState.to && cashState.from <= cashState.to) rerender(); else toastErr('Проверьте даты'); };
    }
  };
  return { html, bind, from, to, label };
}
function payrollRows(earn) {
  const map = new Map();
  for (const e of earn) {
    const k = e.staff_id || 'none';
    const o = map.get(k) || { st: S.staff.find((x) => x.id === e.staff_id) || null, name: e.staff_name || 'Без мастера', rev: 0, n: 0, pay: 0 };
    o.rev += e.amount; o.n++; o.pay += shareOf(e); map.set(k, o);
  }
  for (const st of S.staff) if (st.is_active && !map.has(st.id)) map.set(st.id, { st, name: st.name, rev: 0, n: 0, pay: 0 });
  return [...map.values()].sort((a, b) => b.rev - a.rev);
}

// ---------- Бухгалтерия ----------
async function renderAcc() {
  const pb = periodBar(renderAcc);
  $('#page').innerHTML = `<div class="page-h"><div><h2 style="margin:0">Бухгалтерский учёт</h2></div>
      <span class="row" style="gap:8px;flex-wrap:wrap"><button class="btn btn-sm" id="addX">– Расход / Налог</button><button class="btn btn-sm" id="shiftB">Сверка смены</button><button class="btn btn-sm btn-pri" id="xl">⬇️ Скачать Excel</button></span></div>
    ${pb.html}<div id="accBody"><div class="spinner"></div></div>`;
  pb.bind();
  $('#addX').onclick = () => expenseModal('expense');
  $('#shiftB').onclick = () => shiftModal();
  let earn, exp, closings;
  try { [earn, exp, closings] = await Promise.all([fetchEarnings(pb.from, pb.to), fetchExpenses(pb.from, pb.to), fetchClosings(pb.from, pb.to)]); }
  catch (e) { $('#accBody').innerHTML = `<div class="empty">Не удалось загрузить: ${esc(errMsg(e))}</div>`; return; }
  if (!$('#accBody')) return;
  $('#xl').onclick = () => exportAcc(earn, exp, pb);
  const rate = taxRate(), rev = sum(earn);
  const costs = sum(exp.filter((x) => x.kind === 'expense')), taxPaid = sum(exp.filter((x) => x.kind === 'tax'));
  const tax = Math.round(rev * rate / 100), preFot = rev - costs - tax, payroll = sum(earn, shareOf), net = preFot - payroll;
  const cash = sum(earn.filter((r) => r.method === 'cash'));
  const walkIn = sum(earn.filter((r) => !r.booking_id));
  const pct = (v) => (rev > 0 ? Math.max(0, v) / rev * 100 : 0);
  $('#accBody').innerHTML = `<div class="grid grid-4 keep-2" style="margin-bottom:14px">
      <div class="stat card"><div class="v">${m0(rev)}</div><div class="l">Валовая выручка · ${earn.length} ${plural(earn.length, 'оплата', 'оплаты', 'оплат')}</div></div>
      <div class="stat card"><div class="v">${m0(costs)}</div><div class="l">Расходы</div></div>
      <div class="stat card"><div class="v">${m0(tax)}</div><div class="l">Налог (${rate}%)</div></div>
      <div class="stat card"><div class="v" style="color:${preFot < 0 ? 'var(--danger)' : 'inherit'}">${m0(preFot)}</div><div class="l">Чистая прибыль (до ФОТ)</div></div></div>
    <div class="grid grid-2" style="margin-bottom:14px">
      <div class="card"><div class="row between"><h3 style="margin:0">Структура оборота</h3><span class="muted small">Ставка налога: ${rate}% · <a href="#settings">изменить</a></span></div>
        <div class="struct-bar"><i style="width:${pct(preFot)}%;background:var(--ok)"></i><i style="width:${pct(costs)}%;background:var(--accent)"></i><i style="width:${pct(tax)}%;background:var(--danger)"></i></div>
        <div class="legend"><span style="--c:var(--ok)">Прибыль до ФОТ — <b>${m0(preFot)}</b></span><span style="--c:var(--accent)">Расходы — <b>${m0(costs)}</b></span>
          <span style="--c:var(--danger)">Налог ИП — <b>${m0(tax)}</b>${taxPaid ? ` <span class="muted small">(уплачено ${m0(taxPaid)})</span>` : ''}</span></div></div>
      <div class="card"><h3>Сверка счетов и остаток</h3>
        <div class="kv"><span>Безналичный расчёт (Kaspi / Карта)</span><b>${m0(rev - cash)}</b></div>
        <div class="kv"><span>Наличные в кассе</span><b>${m0(cash)}</b></div>
        <div class="kv"><span>Выручка без записи / по записи</span><b>${m0(walkIn)} / ${m0(rev - walkIn)}</b></div>
        <div class="kv"><span>Зарплата мастеров (ФОТ)</span><b>– ${m0(payroll)}</b></div>
        <div class="kv"><span><b>Чистый остаток владельцу</b><br><span class="muted small">после ФОТ и налога</span></span><b style="font-size:18px;color:${net < 0 ? 'var(--danger)' : 'inherit'}">${m0(net)}</b></div></div></div>
    <p class="muted small">Налог считается от выручки по ставке из настроек — это ориентир, а не расчёт для налоговой. Уточните у бухгалтера.</p>
    <h3 style="margin:14px 0 6px">Закрытые смены</h3>
    <div class="card day-list">${closings.length ? closings.map((c) => `<div class="item">
      <div class="t" style="min-width:78px">${esc(humanDate(dateStrInTz(c.created_at, tz()), false))}<div class="muted small" style="font-weight:400">${hhmm(c.created_at)}</div></div>
      <div class="grow"><b>${esc(c.closed_by_name || (c.closed_by === 'owner' ? 'Владелец' : 'Менеджер'))}</b>
        <div class="muted small">нал ${m0(c.cash)} · безнал ${m0(c.noncash)}${c.expenses ? ` · расходы ${m0(c.expenses)}` : ''}${c.note ? ` · ${esc(c.note)}` : ''}</div></div>
      <b>${m0(c.gross)}</b></div>`).join('') : '<div class="empty small">За период смены не закрывались</div>'}</div>`;
}

// ---------- Зарплата мастеров ----------
async function renderPayroll() {
  const pb = periodBar(renderPayroll);
  $('#page').innerHTML = `<div class="page-h"><h2>Зарплата мастеров</h2><span id="payTot" class="muted"></span></div>${pb.html}<div id="payBody"><div class="spinner"></div></div>`;
  pb.bind();
  let earn;
  try { earn = await fetchEarnings(pb.from, pb.to); } catch (e) { $('#payBody').innerHTML = `<div class="empty">${esc(errMsg(e))}</div>`; return; }
  if (!$('#payBody')) return;
  const rows = payrollRows(earn), total = sum(rows, (r) => r.pay);
  $('#payTot').innerHTML = `Итого к выплате: <b style="color:var(--text)">${m0(total)}</b>`;
  $('#payBody').innerHTML = `<h3 style="margin:0 0 8px">Ведомость по зарплате мастеров</h3>
    <div class="stack" style="gap:8px">${rows.map((r) => `<div class="list-item" ${r.st ? `data-id="${r.st.id}"` : 'style="cursor:default"'}>
      <span class="avatar">${esc((r.name[0] || '?').toUpperCase())}</span>
      <div class="grow"><b>${esc(r.name)}</b> <span class="muted">· ставка ${r.st ? (r.st.share_pct || 0) + '%' : '—'}</span>
        <div class="muted small">Выручка: ${m0(r.rev)} · Визитов: ${r.n}${r.st && !r.st.share_pct ? ' · <span style="color:var(--warn)">ставка не задана — нажмите, чтобы указать</span>' : ''}</div></div>
      <div style="text-align:right"><div class="muted small">Начислено</div><b>${m0(r.pay)}</b></div></div>`).join('') || '<div class="card empty">Нет сотрудников</div>'}</div>
    <p class="muted small" style="margin-top:12px">Начислено = выручка мастера × его ставка. Ставку меняйте в карточке сотрудника.</p>`;
  $$('#payBody .list-item[data-id]').forEach((el) => { el.onclick = () => staffModal(S.staff.find((x) => x.id === el.dataset.id)); });
}

// ---------- Книга проводок ----------
const LG = { cat: '', staff: '' };
async function renderLedger() {
  const pb = periodBar(renderLedger);
  $('#page').innerHTML = `<div class="page-h"><h2>Журнал проводок</h2>
      <span class="row" style="gap:8px;flex-wrap:wrap"><button class="btn btn-sm btn-pri" id="addL">+ Проводка</button><button class="btn btn-sm" id="xl">⬇️ Excel</button></span></div>
    ${pb.html}
    <div class="row filters"><select class="select" id="lc"><option value="">Все статьи</option><option value="income">Приход (выручка)</option><option value="expense">Расходы</option><option value="tax">Налоги</option></select>
      <select class="select" id="ls"><option value="">Все мастера</option>${S.staff.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></div>
    <div id="lgTot" class="grid grid-4 keep-2" style="margin-bottom:12px"></div>
    <div id="lgBody"><div class="spinner"></div></div>`;
  pb.bind();
  $('#lc').value = LG.cat; $('#ls').value = LG.staff;
  $('#addL').onclick = () => {
    const m = modal({ title: 'Новая проводка', body: `<div class="stack"><button class="btn btn-block" data-k="income">+ Приход (оплата клиента)</button>
      <button class="btn btn-block" data-k="expense">– Расход</button><button class="btn btn-block" data-k="tax">– Налог</button></div>`, footer: '<button class="btn" data-a="close">Отмена</button>' });
    $('[data-a=close]', m.el).onclick = m.close;
    $$('[data-k]', m.el).forEach((b) => { b.onclick = () => { m.close(); if (b.dataset.k === 'income') earningModal(null); else expenseModal(b.dataset.k); }; });
  };
  let earn, exp;
  try { [earn, exp] = await Promise.all([fetchEarnings(pb.from, pb.to), fetchExpenses(pb.from, pb.to)]); } catch (e) { $('#lgBody').innerHTML = `<div class="empty">${esc(errMsg(e))}</div>`; return; }
  if (!$('#lgBody')) return;
  $('#xl').onclick = () => exportAcc(earn, exp, pb);
  const draw = () => {
    let rows = [
      ...earn.map((e) => ({ t: e.occurred_at, kind: 'income', e })),
      ...exp.map((x) => ({ t: x.occurred_at, kind: x.kind, x })),
    ];
    if (LG.cat) rows = rows.filter((r) => r.kind === LG.cat);
    if (LG.staff) rows = rows.filter((r) => r.kind === 'income' && r.e.staff_id === LG.staff);
    rows.sort((a, b) => new Date(b.t) - new Date(a.t));
    const inc = sum(rows.filter((r) => r.kind === 'income'), (r) => r.e.amount);
    const ex = sum(rows.filter((r) => r.kind === 'expense'), (r) => r.x.amount);
    const tx = sum(rows.filter((r) => r.kind === 'tax'), (r) => r.x.amount);
    $('#lgTot').innerHTML = [[m0(inc), 'Приход'], [m0(ex), 'Расходы'], [m0(tx), 'Налоги'], [m0(inc - ex - tx), 'Сальдо']]
      .map(([v, l]) => `<div class="card stat flat"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');
    $('#lgBody').innerHTML = rows.length ? `<div class="card day-list">${rows.map((r, i) => {
      const date = `<div class="t" style="min-width:74px">${esc(humanDate(dateStrInTz(r.t, tz()), false))}<div class="muted small" style="font-weight:400">${hhmm(r.t)}</div></div>`;
      if (r.kind === 'income') {
        const e = r.e;
        return `<div class="item" data-i="${i}" style="cursor:pointer">${date}<div class="grow"><b>${esc(e.client_name || (e.booking_id ? 'Клиент' : 'Гость (без записи)'))}</b>${e.staff_name ? ` <span class="muted small">· ${esc(e.staff_name)}</span>` : ''}
          <div class="muted small">${[e.service_name, PAY[e.method], e.created_by === 'manager' ? 'принял менеджер' : e.created_by === 'staff' ? 'отметил мастер' : ''].filter(Boolean).map(esc).join(' · ')}</div></div>
          <span class="money-plus">+ ${m0(e.amount)}</span><button class="x" data-del="${i}" title="Удалить">✕</button></div>`;
      }
      const x = r.x;
      return `<div class="item">${date}<div class="grow"><b>${esc(x.title)}</b><div class="muted small">Статья: ${r.kind === 'tax' ? 'Налоги' : 'Расходы'}${x.created_by === 'manager' ? ' · внёс менеджер' : ''}</div></div>
        <span class="money-minus">– ${m0(x.amount)}</span><button class="x" data-del="${i}" title="Удалить">✕</button></div>`;
    }).join('')}</div>` : '<div class="card empty">За период проводок нет</div>';
    $$('#lgBody [data-i]').forEach((el) => { el.onclick = (ev) => { if (ev.target.closest('[data-del]')) return; earningModal(rows[+el.dataset.i].e); }; });
    $$('#lgBody [data-del]').forEach((b) => {
      b.onclick = async (ev) => {
        ev.stopPropagation();
        const r = rows[+b.dataset.del], amt = (r.e || r.x).amount;
        if (!(await confirmDlg(`Удалить проводку на ${m0(amt)}?`, 'Удалить', true))) return;
        const { error } = await sb.from(r.e ? 'earnings' : 'expenses').delete().eq('id', (r.e || r.x).id);
        if (error) return toastErr(error);
        toast('Удалено'); renderLedger();
      };
    });
  };
  $('#lc').onchange = (e) => { LG.cat = e.target.value; draw(); };
  $('#ls').onchange = (e) => { LG.staff = e.target.value; draw(); };
  draw();
}

// ---------- Excel: оплаты, расходы, зарплата, итоги ----------
function exportAcc(earn, exp, pb) {
  const H = (v) => ({ v, head: true });
  const sorted = [...earn].sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at));
  const rev = sum(earn), costs = sum(exp.filter((x) => x.kind === 'expense')), taxPaid = sum(exp.filter((x) => x.kind === 'tax'));
  const tax = Math.round(rev * taxRate() / 100), payroll = sum(earn, shareOf);
  const pays = [['Дата', 'Время', 'Мастер', 'Клиент', 'Услуга', 'Способ', 'Сумма', 'Тип', 'Кто принял'].map(H),
    ...sorted.map((r) => [{ v: dateStrInTz(r.occurred_at, tz()), t: 'date' }, hhmm(r.occurred_at), r.staff_name || '', r.client_name || '', r.service_name || '',
      PAY[r.method] || r.method, { v: r.amount, t: 'money' }, r.booking_id ? 'по записи' : 'без записи',
      { owner: 'владелец', manager: 'менеджер', staff: 'мастер' }[r.created_by] || '']),
    [{ v: 'ИТОГО', bold: true }, '', '', '', '', '', { v: rev, t: 'money', bold: true }]];
  const exps = [['Дата', 'Статья', 'Комментарий', 'Сумма', 'Кто внёс'].map(H),
    ...[...exp].sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at)).map((x) => [{ v: dateStrInTz(x.occurred_at, tz()), t: 'date' },
      x.kind === 'tax' ? 'Налоги' : 'Расходы', x.title, { v: x.amount, t: 'money' }, x.created_by === 'manager' ? 'менеджер' : 'владелец'])];
  const pr = payrollRows(earn);
  const pay = [['Мастер', 'Визитов', 'Выручка', 'Ставка, %', 'Начислено'].map(H),
    ...pr.map((r) => [r.name, { v: r.n, t: 'num' }, { v: r.rev, t: 'money' }, { v: r.st ? r.st.share_pct || 0 : 0, t: 'num' }, { v: r.pay, t: 'money', bold: true }]),
    [{ v: 'ИТОГО', bold: true }, '', { v: rev, t: 'money', bold: true }, '', { v: payroll, t: 'money', bold: true }]];
  const tot = [['Показатель', 'Сумма'].map(H), ['Валовая выручка', { v: rev, t: 'money' }], ['Наличные', { v: sum(earn.filter((r) => r.method === 'cash')), t: 'money' }],
    ['Kaspi и карта', { v: sum(earn.filter((r) => r.method !== 'cash')), t: 'money' }], ['Расходы', { v: costs, t: 'money' }],
    [`Налог (${taxRate()}%), расчёт`, { v: tax, t: 'money' }], ['Налог уплачен', { v: taxPaid, t: 'money' }], ['Прибыль до ФОТ', { v: rev - costs - tax, t: 'money', bold: true }],
    ['Зарплата мастеров', { v: payroll, t: 'money' }], ['Чистый остаток владельцу', { v: rev - costs - tax - payroll, t: 'money', bold: true }]];
  const biz = S.biz.name.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'buh';
  downloadXlsx(`${biz}_бухгалтерия_${pb.from}_${pb.to}.xlsx`, [
    { name: 'Итоги', widths: [30, 16], rows: tot },
    { name: 'Оплаты', widths: [12, 8, 18, 22, 22, 12, 14, 12, 12], rows: pays, filterTo: pays.length - 1 },
    { name: 'Расходы и налоги', widths: [12, 12, 36, 14, 12], rows: exps },
    { name: 'Зарплата', widths: [24, 10, 15, 10, 15], rows: pay },
  ]);
  toast('Excel-файл скачан');
}
