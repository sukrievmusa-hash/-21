// Кабинет мастера: свои записи, приём оплат, заработок, смена/выходной, Telegram
import {
  sb, $, $$, esc, money, toast, toastErr, modal, busy, fmtPhone, telLink, waLink, zonedToUtc, dateStrInTz,
  timeStrInTz, todayInTz, addDays, confirmDlg, isoWeekday, WD_SHORT, MONTHS_SHORT, humanDate, plural, pageUrl, BRAND, copyText, STAFF_AUTH_KEY, MIGRATED_FROM,
} from './lib.js?v=20261124b';
import { ico } from './icons.js?v=20261124b';
import { downloadXlsx } from './xlsx.js?v=20261124b';

const STAFF_DOMAIN = 'staff.jazylam.kz';
const DAYS_BACK = 1, DAYS_AHEAD = 21;
const root = $('#root');
const S = { me: null, items: [], day: null, timer: null, earn: [], tab: 'sched', period: 'today', flt: 'all' };
const tz = () => S.me.business.timezone;

sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') { S.me = null; showLogin(); } });
boot();

async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return showLogin();
  let { data: me, error } = await sb.rpc('staff_me');
  if (error && isAuthErr(error)) {
    // токен устарел (телефон долго спал) — обновляем и пробуем ещё раз, без выхода
    const r = await sb.auth.refreshSession();
    if (r.error) { await sb.auth.signOut({ scope: 'local' }); return showLogin('Сессия истекла — войдите ещё раз'); }
    ({ data: me, error } = await sb.rpc('staff_me'));
  }
  if (error) {
    root.innerHTML = `<div class="auth-wrap"><div class="auth-card"><div class="card center stack">
      <div class="ok-ico">📶</div><h3>Нет связи с сервером</h3>
      <p class="muted">Проверьте интернет. Вход сохранён — выходить не нужно.</p>
      <button class="btn btn-pri btn-block" id="retry">Повторить</button></div></div></div>`;
    $('#retry').onclick = () => boot();
    return;
  }
  if (MIGRATED_FROM) {
    // перенесли вход из общего ключа: мастеру — убираем старую копию; владельцу — убираем нашу
    try {
      if (me) localStorage.removeItem(MIGRATED_FROM);
      else { // владелец: возвращаем (возможно обновлённый) токен в общий ключ, чтобы его не выбило
        localStorage.setItem(MIGRATED_FROM, localStorage.getItem(STAFF_AUTH_KEY));
        localStorage.removeItem(STAFF_AUTH_KEY);
      }
    } catch { /* ignore */ }
    if (!me) { location.replace(pageUrl('app.html')); return; }
  }
  if (!me) {
    // Вошёл владелец — ему в обычный кабинет
    const { data: biz } = await sb.from('businesses').select('id').eq('owner_id', session.user.id).maybeSingle();
    if (biz) { location.replace(pageUrl('app.html')); return; }
    root.innerHTML = `<div class="auth-wrap"><div class="auth-card"><div class="card center stack">
      <div class="ok-ico">🔒</div><h3>Доступ закрыт</h3>
      <p class="muted">Этот вход больше не привязан к сотруднику. Попросите администратора выдать новый логин и пароль.</p>
      <button class="btn btn-block" id="lo">Выйти</button></div></div></div>`;
    $('#lo').onclick = () => sb.auth.signOut();
    return;
  }
  S.me = me;
  S.day = S.day || todayInTz(tz());
  renderShell();
  await load();
  clearInterval(S.timer);
  S.timer = setInterval(load, 60000);
}

const isAuthErr = (e) => /jwt|token|expired|401|not authenticated/i.test(`${e?.message} ${e?.code} ${e?.status}`);

// Вернулись в приложение: тихо обновляем данные; при сбое сети вход не трогаем
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.me) { refreshMe(); load(); } });
window.addEventListener('online', () => { if (S.me) { refreshMe(); load(); } else boot(); });

function showLogin(msg) {
  clearInterval(S.timer);
  root.innerHTML = `<div class="auth-wrap"><div class="auth-card">
    <div class="center" style="margin-bottom:18px"><a class="logo" href="index.html"><i>J</i><span>${esc(BRAND)}</span></a></div>
    ${msg ? `<div class="alert alert-warn" style="margin-bottom:12px">${esc(msg)}</div>` : ''}
    <div class="card"><form id="lf" class="stack" novalidate>
      <div><h2 style="margin-bottom:4px">Кабинет сотрудника</h2>
        <p class="muted small" style="margin:0">Логин и пароль выдаёт администратор</p></div>
      <label class="field"><span>Логин</span><input class="input" name="login" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" required></label>
      <label class="field"><span>Пароль</span><input class="input" name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn btn-pri btn-block btn-lg">Войти</button>
      <p class="muted small center" style="margin:0">Забыли пароль? Попросите администратора нажать «Новый пароль».</p>
      <a class="btn btn-ghost btn-block" href="app.html">Я владелец бизнеса</a>
    </form></div></div></div>`;
  const f = $('#lf');
  // ссылка из WhatsApp вида staff.html?login=... — логин уже подставлен, остаётся вставить пароль
  const pre = new URLSearchParams(location.search).get('login');
  if (pre) { f.login.value = pre.trim().toLowerCase(); setTimeout(() => f.password.focus(), 50); }
  f.onsubmit = async (e) => {
    e.preventDefault();
    const login = f.login.value.trim().toLowerCase();
    const password = f.password.value;
    if (!login || !password) return toastErr('Введите логин и пароль');
    const email = login.includes('@') ? login : `${login}@${STAFF_DOMAIN}`;
    await busy($('button', f), async () => {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) return toastErr(/Invalid login/i.test(error.message) ? 'Неверный логин или пароль' : error);
      boot();
    });
  };
}

// ======================= Интерфейс мастера =======================
const initials = (name) => String(name || '').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '✂';
const PERIOD = { today: 'Сегодня', week: 'Неделя', month: 'Месяц' };
const PERIOD_UP = { today: 'Сегодня', week: 'За неделю', month: 'За месяц' };
const FILTERS = [['all', 'Все оплаты'], ['kaspi', 'Kaspi'], ['cash', 'Наличные'], ['card', 'Карта']];
const MSHORT = { cash: 'Наличные', kaspi: 'Kaspi', card: 'Карта' };

function shiftState() {
  const me = S.me;
  if (me.off_today) return { key: 'off', label: 'Выходной', cls: 'amber' };
  if (me.hours_today && !me.hours_today.length) return { key: 'none', label: 'Не по графику', cls: 'gray' };
  return { key: 'on', label: 'На смене', cls: 'green' };
}

function renderShell() {
  const me = S.me, b = me.business;
  document.body.classList.add('sx-body');
  root.innerHTML = `<div class="sx">
    <header class="sx-head">
      <div class="sx-top">
        <div class="sx-prof">
          <div class="sx-ava">${esc(initials(me.name))}<span class="sx-dot" id="shiftDot"></span></div>
          <div class="sx-pn"><div class="sx-nm"><h1>${esc(me.name)}</h1><span class="sx-badge" id="shiftBadge"></span></div>
            <p>${ico('scissors')}<span>${esc([me.title, b.name].filter(Boolean).join(' · '))}</span></p></div>
        </div>
        <div class="sx-acts">
          <button class="sx-btn" id="shiftBtn" aria-label="Смена и выходной">${ico('calOff')}<span class="sx-pip hide" id="shiftPip"></span></button>
          <button class="sx-btn" id="menuBtn" aria-label="Меню">${ico('more')}<span class="sx-pip red hide" id="tgPip"></span></button>
        </div>
      </div>
      <div class="sx-seg" role="tablist">
        <button data-tab="sched" role="tab">${ico('cal')}<span>Расписание</span></button>
        <button data-tab="earn" role="tab">${ico('wallet')}<span>Заработок</span></button>
      </div>
    </header>
    <main class="sx-main">
      ${b.active ? '' : '<div class="sx-warn">Онлайн-запись приостановлена — новые клиенты не записываются. Сообщите администратору.</div>'}
      <section id="tabSched">
        <div class="days" id="days"></div>
        <div class="sx-dayc"><div><p id="dayHint"></p><h2 id="dayTitle"></h2></div><span class="sx-pill" id="dayCnt">${ico('users')}<span></span></span></div>
        <div id="list" class="sx-list"><div class="spinner"></div></div>
      </section>
      <section id="tabEarn" class="hide"><div id="earn"><div class="spinner"></div></div></section>
    </main>
    <div class="sx-fabw"><button class="sx-fab" id="walkin">${ico('plus')}<span>Без записи</span></button></div></div>`;
  $$('[data-tab]').forEach((t) => { t.onclick = () => setTab(t.dataset.tab); });
  $('#walkin').onclick = () => payModal(null);
  $('#menuBtn').onclick = menuModal;
  $('#shiftBtn').onclick = shiftModal;
  if (me.hours_today === undefined) $('#shiftBtn').classList.add('hide');
  setTab(S.tab || 'sched');
  renderTg();
}

function setTab(t) {
  S.tab = t;
  $$('[data-tab]').forEach((b) => { b.classList.toggle('on', b.dataset.tab === t); b.setAttribute('aria-selected', b.dataset.tab === t); });
  $('#tabSched').classList.toggle('hide', t !== 'sched');
  $('#tabEarn').classList.toggle('hide', t !== 'earn');
  window.scrollTo({ top: 0 });
}

// Шапка: статус смены и точка Telegram
function renderTg() {
  if (!$('#shiftBadge')) return;
  const st = shiftState();
  $('#shiftBadge').className = 'sx-badge ' + st.cls;
  $('#shiftBadge').textContent = st.label;
  $('#shiftDot').className = 'sx-dot ' + st.cls;
  $('#shiftPip').classList.toggle('hide', st.key !== 'off');
  $('#tgPip').classList.toggle('hide', !!S.me.tg || !S.me.bot_username);
}

// ---------- Смена / выходной ----------
function shiftModal() {
  const me = S.me, st = shiftState();
  const hours = (me.hours_today || []).map((h) => `${h.start}–${h.end}`).join(', ');
  const m = modal({
    title: 'Статус смены',
    body: `<p class="sx-sub" style="margin-top:0">${hours ? `По графику сегодня: <b>${esc(hours)}</b>.` : 'По графику сегодня у вас не рабочий день.'} Выходной закрывает онлайн-запись к вам на сегодня, администратор получит сообщение.</p>
      <div class="sx-opts">
        <button class="sx-opt ${st.key !== 'off' ? 'on green' : ''}" data-s="on"><span class="d green"></span><div><b>На смене</b><small>Клиенты могут записываться онлайн</small></div>${st.key !== 'off' ? ico('check', 'ok') : ''}</button>
        <button class="sx-opt ${st.key === 'off' ? 'on amber' : ''}" data-s="off"><span class="d amber"></span><div><b>Выходной сегодня</b><small>Онлайн-запись к вам на сегодня закрыта</small></div>${st.key === 'off' ? ico('check', 'ok') : ico('plane', 'mut')}</button>
      </div>
      ${me.off_today && !me.off_by_me ? '<p class="sx-note">Выходной поставил администратор — снять его может только он.</p>' : ''}`,
  });
  $$('[data-s]', m.el).forEach((btn) => {
    btn.onclick = () => busy(btn, async () => {
      const off = btn.dataset.s === 'off';
      if (off === !!me.off_today) { m.close(); return; }
      const { data, error } = await sb.rpc('staff_set_day_off', { p_off: off });
      if (error) return toastErr(error);
      await refreshMe(); m.close();
      toast(off ? 'Отмечен выходной на сегодня' : 'Вы на смене — запись открыта');
      if (off && data?.bookings_left) toastErr(`На сегодня у вас ещё ${data.bookings_left} ${plural(data.bookings_left, 'запись', 'записи', 'записей')} — администратор их перенесёт`);
    });
  });
}

// ---------- Меню ----------
function bookUrl() { return new URL(`book.html?b=${encodeURIComponent(S.me.business.slug || '')}`, location.href).href; }

function menuModal() {
  const me = S.me;
  const m = modal({
    title: `${me.name} · ${me.business.name}`,
    body: `<div class="sx-menu">
      ${me.business.slug ? `<button data-m="link">${ico('link')}<span>Скопировать ссылку для записи клиентов</span></button>` : ''}
      <button data-m="xls">${ico('xls')}<span>Выгрузить мои оплаты за месяц в Excel</span></button>
      ${me.bot_username ? `<button data-m="tg">${ico('send')}<span>Telegram — ${me.tg ? '<b class="g">подключён</b>' : '<b class="r">не подключён</b>'}</span></button>` : ''}
      <button data-m="pwd">${ico('key')}<span>Сменить пароль</span></button>
      <button data-m="out" class="danger">${ico('out')}<span>Выйти</span></button></div>`,
  });
  const on = (k, f) => { const el = $(`[data-m=${k}]`, m.el); if (el) el.onclick = () => { m.close(); f(); }; };
  on('link', () => { copyText(bookUrl()); });
  on('xls', exportMine);
  on('tg', tgModal);
  on('pwd', passwordModal);
  on('out', () => sb.auth.signOut());
}

async function exportMine() {
  const today = todayInTz(tz()), from = monthStart(today);
  const { data, error } = await sb.rpc('staff_earnings', {
    p_from: zonedToUtc(from, '00:00', tz()).toISOString(), p_to: zonedToUtc(addDays(today, 1), '00:00', tz()).toISOString(),
  });
  if (error) return toastErr(error);
  const rows = [...(data || [])].sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at));
  if (!rows.length) return toastErr('За этот месяц оплат пока нет');
  const H = (v) => ({ v, head: true });
  const total = rows.reduce((s, e) => s + e.amount, 0);
  const sheet = [['Дата', 'Время', 'Клиент', 'Услуга', 'Способ оплаты', 'Сумма', 'Комментарий'].map(H),
    ...rows.map((e) => [{ v: dateStrInTz(e.occurred_at, tz()), t: 'date' }, timeStrInTz(e.occurred_at, tz()), e.client_name || '', e.service_name || '', MSHORT[e.method] || e.method, { v: e.amount, t: 'money' }, e.note || '']),
    [{ v: 'ИТОГО', bold: true }, '', '', '', '', { v: total, t: 'money', bold: true }]];
  const nm = S.me.name.replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 30) || 'master';
  downloadXlsx(`${nm}_оплаты_${from}_${today}.xlsx`, [{ name: 'Мои оплаты', widths: [12, 8, 22, 24, 15, 14, 30], rows: sheet, filterTo: rows.length + 1 }]);
  toast('Excel-файл скачан');
}

function tgModal() {
  const me = S.me;
  const m = modal({
    title: 'Уведомления в Telegram',
    body: me.tg
      ? '<p style="margin-top:0">✅ <b>Подключено.</b> Сюда приходят только ваши записи: новые, отмены, переносы, а в 8:00 — список клиентов на день.</p>'
      : `<p style="margin-top:0">Получайте в Telegram только своих клиентов: кто записался, отмены, переносы и список на день в 8:00.</p>
         <a class="btn btn-tg btn-block btn-lg" target="_blank" rel="noopener" href="https://t.me/${esc(me.bot_username)}?start=m_${esc(me.tg_link_code)}">Подключить Telegram</a>
         <p class="muted small">В боте нажмите «Запустить» (Start), затем вернитесь сюда.</p>`,
    footer: me.tg ? '<button class="btn btn-danger" data-a="off">Отключить</button>' : '<button class="btn btn-pri" data-a="check">Я нажал «Запустить»</button>',
  });
  const off = $('[data-a=off]', m.el), chk = $('[data-a=check]', m.el);
  if (off) off.onclick = (e) => busy(e.target, async () => {
    const { error } = await sb.rpc('staff_unlink_tg');
    if (error) return toastErr(error);
    await refreshMe(); m.close(); toast('Telegram отключён');
  });
  if (chk) chk.onclick = (e) => busy(e.target, async () => {
    await refreshMe();
    if (S.me.tg) { m.close(); toast('Готово, Telegram подключён'); } else toastErr('Пока не подключено: откройте бота и нажмите «Запустить» (Start)');
  });
}

async function refreshMe() {
  const { data, error } = await sb.rpc('staff_me');
  if (error) return;            // сеть или устаревший токен — оставляем экран как есть
  if (!data) return boot();     // доступ действительно закрыли
  S.me = data;
  renderTg();
}

async function load() {
  const today = todayInTz(tz());
  const from = addDays(today, -DAYS_BACK), to = addDays(today, DAYS_AHEAD + 1);
  const { data, error } = await sb.rpc('staff_bookings', {
    p_from: zonedToUtc(from, '00:00', tz()).toISOString(),
    p_to: zonedToUtc(to, '00:00', tz()).toISOString(),
  });
  if (error) {
    if (isAuthErr(error)) await sb.auth.refreshSession();
    else if (navigator.onLine) toastErr(error);   // без интернета не сыпем ошибками каждую минуту
    return;
  }
  S.items = data || [];
  drawDays();
  drawList();
  loadEarn();
}

// ---------- Заработок ----------
const weekStart = (today) => addDays(today, -(isoWeekday(today) - 1));
const monthStart = (today) => today.slice(0, 8) + '01';

async function loadEarn() {
  const today = todayInTz(tz());
  const from = [weekStart(today), monthStart(today)].sort()[0];
  const { data, error } = await sb.rpc('staff_earnings', {
    p_from: zonedToUtc(from, '00:00', tz()).toISOString(),
    p_to: zonedToUtc(addDays(today, 1), '00:00', tz()).toISOString(),
  });
  if (error) return;
  S.earn = data || [];
  drawEarn();
  drawList();   // кнопки «Изменить оплату» зависят от загруженных оплат
}


// ---------- Заработок ----------
function earnIn(period) {
  const today = todayInTz(tz());
  const from = period === 'today' ? today : period === 'week' ? weekStart(today) : monthStart(today);
  return S.earn.filter((e) => dateStrInTz(e.occurred_at, tz()) >= from);
}

function drawEarn() {
  const box = $('#earn');
  if (!box) return;
  const per = S.period || 'today', flt = S.flt || 'all', today = todayInTz(tz());
  const sum = (a) => a.reduce((s, e) => s + e.amount, 0);
  const card = (p) => { const a = earnIn(p); return `<button class="sx-per ${p === per ? 'on' : ''}" data-per="${p}"><span class="l">${PERIOD[p]}</span>
    <span class="v">${money(sum(a)) || '0 ₸'}</span><span class="n">${a.length} ${plural(a.length, 'клиент', 'клиента', 'клиентов')}</span></button>`; };
  const inPer = earnIn(per);
  const rows = inPer.filter((e) => flt === 'all' || e.method === flt).sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at));
  const from = per === 'today' ? today : per === 'week' ? weekStart(today) : monthStart(today);
  let list = '', last = '';
  for (const e of rows) {
    const d = dateStrInTz(e.occurred_at, tz());
    if (per !== 'today' && d !== last) {
      const dr = rows.filter((x) => dateStrInTz(x.occurred_at, tz()) === d);
      list += `<div class="sx-dsep">${d === today ? 'Сегодня' : d === addDays(today, -1) ? 'Вчера' : esc(humanDate(d, false))} · ${money(sum(dr))}</div>`;
      last = d;
    }
    list += `<div class="sx-payc">
      <div class="t"><b>${timeStrInTz(e.occurred_at, tz())}</b><span class="mb m-${e.method}">${MSHORT[e.method] || e.method}</span></div>
      <div class="c"><b>${esc(e.client_name || 'Клиент')}</b><span>${esc([e.service_name, e.note].filter(Boolean).join(' · ') || 'Услуга не указана')}</span></div>
      <div class="a">${money(e.amount)}</div>
      ${e.editable ? `<button class="sx-pen" data-e="${e.id}" aria-label="Изменить оплату">${ico('pencil')}</button>` : '<span class="sx-pen ghost"></span>'}</div>`;
  }
  box.innerHTML = `<div class="sx-pers">${card('today')}${card('week')}${card('month')}</div>
    <div class="sx-lh"><h2>Мои оплаты</h2><button class="sx-fbtn" id="fCycle">${ico('sliders')}<span>с ${esc(humanDate(from, false))} • ${esc(FILTERS.find((f) => f[0] === flt)[1].replace(' оплаты', ''))}</span></button></div>
    <div class="sx-chips">${FILTERS.map(([k, t]) => `<button class="sx-chip ${k === flt ? 'on' : ''}" data-f="${k}">${k !== 'all' ? `<i class="pd m-${k}"></i>` : ''}${t}</button>`).join('')}</div>
    <div class="sx-gh"><span>${PERIOD_UP[per]} · ${money(sum(rows)) || '0 ₸'}</span><span>${rows.length} ${plural(rows.length, 'запись', 'записи', 'записей')}</span></div>
    <div class="sx-plist">${rows.length ? list : `<div class="sx-empty">${ico('receipt')}<b>Оплат не найдено</b><span>${flt !== 'all' ? 'Попробуйте сбросить фильтр' : 'После клиента нажмите «Принять оплату» в расписании'}</span></div>`}</div>
    <div class="sx-info">${ico('info')}<p>Исправить или удалить оплату можно в течение <b>24 часов</b>, потом — только через администратора.</p></div>`;
  $$('[data-per]', box).forEach((b) => { b.onclick = () => { S.period = b.dataset.per; drawEarn(); }; });
  $$('[data-f]', box).forEach((b) => { b.onclick = () => { S.flt = b.dataset.f; drawEarn(); }; });
  $('#fCycle').onclick = () => { const i = FILTERS.findIndex((f) => f[0] === flt); S.flt = FILTERS[(i + 1) % FILTERS.length][0]; drawEarn(); };
  $$('[data-e]', box).forEach((b) => { b.onclick = () => editEarning(S.earn.find((x) => x.id === b.dataset.e)); });
}

// ---------- Окно оплаты ----------
const methodBtns = (cur) => `<div class="sx-meth">${['kaspi', 'cash', 'card'].map((k) => `<button type="button" data-k="${k}" class="m-${k} ${k === cur ? 'on' : ''}"><i class="pd m-${k}"></i>${MSHORT[k]}</button>`).join('')}</div>`;
function bindMethods(el, onPick) {
  $$('.sx-meth button', el).forEach((btn) => { btn.onclick = () => { onPick(btn.dataset.k); $$('.sx-meth button', el).forEach((x) => x.classList.toggle('on', x === btn)); }; });
}

// b — запись из расписания; null — клиент без записи
function payModal(b) {
  const edit = b && b.earning_id;
  const e0 = edit ? S.earn.find((x) => x.id === b.earning_id) : null;
  const svc = (S.me.services || []).slice(0, 6);
  let method = edit ? b.paid_method : 'kaspi';
  const m = modal({
    title: b ? (edit ? 'Изменить оплату' : 'Принять оплату') : 'Оплата без записи',
    body: `<form id="pf" class="sx-form" novalidate>
      ${b ? `<div class="sx-who"><b>${esc(b.client_name)}</b><span>${[timeStrInTz(b.starts_at, tz()), b.service_name, b.price != null ? 'по записи ' + money(b.price) : ''].filter(Boolean).map(esc).join(' · ')}</span></div>`
        : `<div><label class="sx-lbl">Услуга</label>
          ${svc.length ? `<div class="sx-svc">${svc.map((v, i) => `<button type="button" data-svc="${i}"><b>${esc(v.name)}</b><span>${v.price != null ? money(v.price) : '—'}</span></button>`).join('')}</div>` : ''}
          <input class="sx-in" name="service" maxlength="120" placeholder="Название услуги"></div>`}
      <div><label class="sx-lbl" for="amt">Сумма (₸)</label>
        <div class="sx-amt"><input id="amt" name="amount" type="number" inputmode="numeric" min="1" max="10000000" step="1" placeholder="0" value="${esc(edit ? b.paid : b && b.price != null ? b.price : '')}"><span>₸</span></div></div>
      <div><label class="sx-lbl">Способ оплаты</label>${methodBtns(method)}</div>
      ${b ? '' : '<div><label class="sx-lbl">Имя клиента <em>(необязательно)</em></label><input class="sx-in" name="client" maxlength="80" placeholder="Например: Алихан"></div>'}
      <div><label class="sx-lbl">Комментарий <em>(необязательно)</em></label><input class="sx-in" name="note" maxlength="300" value="${esc(e0?.note || '')}"></div>
    </form>`,
    footer: `${b && !edit && new Date(b.starts_at) <= new Date() && b.status !== 'no_show' ? '<button class="btn sx-noshow" data-a="noshow">Не пришёл</button>' : ''}<button class="btn btn-pri sx-save" data-a="save">${edit ? 'Сохранить' : 'Сохранить оплату'}</button>`,
  });
  const f = $('#pf', m.el);
  const ns = $('[data-a=noshow]', m.el);
  if (ns) ns.onclick = async () => {
    if (!(await confirmDlg(`Отметить, что ${b.client_name} не пришёл?`, 'Не пришёл'))) return;
    const { error } = await sb.rpc('staff_mark_no_show', { p_booking: b.id });
    if (error) return toastErr(error);
    toast('Отмечено: клиент не пришёл'); m.close(); await load();
  };
  bindMethods(m.el, (k) => { method = k; });
  $$('[data-svc]', m.el).forEach((btn) => {
    btn.onclick = () => {
      const v = svc[+btn.dataset.svc];
      f.service.value = v.name;
      if (v.price != null) f.amount.value = v.price;
      $$('[data-svc]', m.el).forEach((x) => x.classList.toggle('on', x === btn));
    };
  });
  const save = (ev) => busy(ev.target, async () => {
    const amount = Math.round(Number(f.amount.value));
    if (!amount || amount < 1) return toastErr('Введите сумму');
    const { error } = await sb.rpc('staff_add_earning', {
      p_amount: amount, p_method: method, p_booking: b ? b.id : null,
      p_client: b ? null : f.client.value.trim() || null, p_service: b ? null : f.service.value.trim() || null,
      p_note: f.note.value.trim() || null,
    });
    if (error) return toastErr(error);
    toast(edit ? 'Изменения сохранены' : `Добавлено: ${money(amount)}`);
    m.close();
    await load();
  });
  $('[data-a=save]', m.el).onclick = save;
  f.onsubmit = (ev) => { ev.preventDefault(); save({ target: $('[data-a=save]', m.el) }); };
  if (b) setTimeout(() => f.amount.focus(), 60);
}

function editEarning(e) {
  let method = e.method;
  const m = modal({
    title: `Изменить (${timeStrInTz(e.occurred_at, tz())})`,
    body: `<form id="ef" class="sx-form" novalidate>
      <div class="sx-who"><b>${esc(e.client_name || 'Клиент')}</b><span>${esc(e.service_name || 'Услуга не указана')}</span></div>
      <div><label class="sx-lbl">Сумма (₸)</label><div class="sx-amt"><input name="amount" type="number" inputmode="numeric" min="1" value="${e.amount}"><span>₸</span></div></div>
      <div><label class="sx-lbl">Способ оплаты</label>${methodBtns(method)}</div>
      <div><label class="sx-lbl">Комментарий</label><input class="sx-in" name="note" maxlength="300" value="${esc(e.note || '')}"></div></form>`,
    footer: `<button class="sx-del" data-a="del" aria-label="Удалить оплату">${ico('trash')}</button><button class="btn btn-pri sx-save" data-a="save">Сохранить</button>`,
  });
  bindMethods(m.el, (k) => { method = k; });
  $('[data-a=del]', m.el).onclick = async () => {
    if (!(await confirmDlg(`Удалить оплату ${money(e.amount)}?`, 'Удалить', true))) return;
    const { error } = await sb.rpc('staff_delete_earning', { p_id: e.id });
    if (error) return toastErr(error);
    toast('Запись об оплате удалена'); m.close(); await load();
  };
  $('[data-a=save]', m.el).onclick = (ev) => busy(ev.target, async () => {
    const f = $('#ef', m.el);
    const amount = Math.round(Number(f.amount.value));
    if (!amount || amount < 1) return toastErr('Введите сумму');
    const { error } = await sb.rpc('staff_update_earning', { p_id: e.id, p_amount: amount, p_method: method, p_note: f.note.value.trim() || null });
    if (error) return toastErr(error);
    toast('Изменения сохранены'); m.close(); await load();
  });
}

// ---------- Расписание ----------
const active = (b) => b.status !== 'cancelled';
const itemsOn = (d) => S.items.filter((b) => dateStrInTz(b.starts_at, tz()) === d);

function drawDays() {
  const box = $('#days');
  if (!box) return;
  const today = todayInTz(tz()), from = addDays(today, -DAYS_BACK);
  box.innerHTML = '';
  for (let i = 0; i <= DAYS_BACK + DAYS_AHEAD; i++) {
    const d = addDays(from, i);
    const [, m, dd] = d.split('-').map(Number);
    const n = itemsOn(d).filter(active).length;
    const btn = document.createElement('button');
    btn.className = 'day' + (d === S.day ? ' sel' : '') + (d === today ? ' today' : '');
    btn.innerHTML = `<div class="dw">${d === today ? 'сег' : d === addDays(today, 1) ? 'завт' : d === addDays(today, -1) ? 'вчера' : WD_SHORT[isoWeekday(d)]}</div>
      <div class="dn">${dd}</div><div class="dm">${n ? `<span class="cnt">${n}</span>` : MONTHS_SHORT[m - 1]}</div>`;
    btn.setAttribute('aria-label', `${humanDate(d)}${n ? `, ${n} ${plural(n, 'запись', 'записи', 'записей')}` : ''}`);
    btn.onclick = () => { S.day = d; drawDays(); drawList(); };
    box.append(btn);
  }
  // центрируем выбранный день внутри ленты (страницу не трогаем) — только если день сменился
  if (S.daysCentered !== S.day) {
    S.daysCentered = S.day;
    requestAnimationFrame(() => {
      const sel = $('.day.sel', box);
      if (sel) box.scrollLeft = sel.offsetLeft - box.offsetLeft - (box.clientWidth - sel.offsetWidth) / 2;
    });
  }
}

function bookingState(b, now) {
  if (b.status === 'cancelled') return ['cancel', 'Отменена'];
  if (b.paid != null) return ['paid', 'Оплачено'];
  if (b.status === 'no_show') return ['gray', 'Не пришёл'];
  const s = new Date(b.starts_at), e = new Date(b.ends_at);
  if (now >= s && now < e) return ['now', 'Идёт сейчас'];
  if (now >= e) return ['due', 'Ждёт оплаты'];
  return b.status === 'confirmed' ? ['conf', 'Подтвердил'] : ['wait', 'Ожидается'];
}

function drawList() {
  const box = $('#list');
  if (!box) return;
  const d = S.day, today = todayInTz(tz()), now = new Date();
  const items = itemsOn(d), act = items.filter(active);
  const hours = (S.me.hours_today || []).map((h) => `${h.start} – ${h.end}`).join(', ');
  const lbl = d === today ? 'Сегодня' : d === addDays(today, 1) ? 'Завтра' : d === addDays(today, -1) ? 'Вчера' : humanDate(d);
  $('#dayHint').textContent = d === today
    ? (S.me.off_today ? 'Сегодня, выходной' : hours ? `Сегодня, смена ${hours}` : 'Сегодня')
    : (lbl === humanDate(d) ? humanDate(d) : `${lbl}, ${humanDate(d)}`);
  $('#dayTitle').textContent = 'Записи на день';
  $('#dayCnt span').textContent = `${act.length} ${plural(act.length, 'запись', 'записи', 'записей')}`;
  // ближайшая неоплаченная — выделяем
  const focus = d === today ? act.find((b) => b.paid == null && b.status !== 'no_show' && new Date(b.ends_at) > now) : null;
  if (!items.length) {
    box.innerHTML = `<div class="sx-empty">${ico('cal')}<b>На этот день записей нет</b>${d !== today ? '<button class="btn btn-sm" id="toToday" style="margin-top:10px">← К сегодняшнему дню</button>' : ''}</div>`;
    const tt = $('#toToday'); if (tt) tt.onclick = () => { S.day = today; drawDays(); drawList(); };
    return;
  }
  box.innerHTML = items.map((b) => {
    const [st, stl] = bookingState(b, now);
    const dur = Math.round((new Date(b.ends_at) - new Date(b.starts_at)) / 60000);
    const isF = focus && focus.id === b.id;
    const canPay = active(b) && d <= today;
    const e0 = b.earning_id ? S.earn.find((x) => x.id === b.earning_id) : null;
    const canEdit = b.paid != null && e0 && e0.editable;
    const price = b.paid != null ? `${money(b.paid)} · ${MSHORT[b.paid_method] || ''}` : b.price != null ? money(b.price) : '';
    return `<div class="sx-bk ${isF ? 'focus' : ''} ${st === 'cancel' ? 'cancelled' : ''}">
      <div class="sx-bkr">
        <div class="sx-tb"><b>${timeStrInTz(b.starts_at, tz())}</b><span>${dur} мин</span></div>
        <div class="sx-bi"><div class="nm"><b>${esc(b.client_name)}</b><span class="st ${st}">${stl}</span></div>
          <p>${esc(b.service_name || 'Услуга не указана')}${price ? ' • ' + esc(price) : ''}${b.source === 'online' ? ' • онлайн' : ''}</p>
          ${b.comment ? `<p class="cm">💬 ${esc(b.comment)}</p>` : ''}</div>
      </div>
      ${active(b) ? `<div class="sx-row">
        ${b.paid != null
          ? (canEdit ? `<button class="sx-act ghost" data-pay="${b.id}">${ico('pencil')}<span>Изменить оплату</span></button>` : '<span class="sx-act done">✅ Оплата записана</span>')
          : canPay ? `<button class="sx-act ${isF || st === 'due' ? '' : 'soft'}" data-pay="${b.id}">${ico('checkc')}<span>${b.price != null ? 'Принять ' + money(b.price) : 'Принять оплату'}</span></button>`
          : '<span class="grow"></span>'}
        <a class="sx-cbtn" href="${telLink(b.client_phone)}" aria-label="Позвонить ${esc(fmtPhone(b.client_phone))}">${ico('phone')}</a>
        <a class="sx-cbtn" target="_blank" rel="noopener" href="${esc(waLink(b.client_phone))}" aria-label="Написать в WhatsApp">${ico('msg')}</a></div>` : ''}
    </div>`;
  }).join('');
  $$('[data-pay]', box).forEach((btn) => { btn.onclick = () => payModal(S.items.find((x) => x.id === btn.dataset.pay)); });
}

function passwordModal() {
  const m = modal({
    title: 'Сменить пароль',
    body: `<form id="pf" class="stack"><label class="field"><span>Новый пароль (минимум 6 символов)</span>
      <input class="input" name="p" type="password" autocomplete="new-password" minlength="6" required></label></form>`,
    footer: '<button class="btn" data-a="close">Отмена</button><button class="btn btn-pri" data-a="save">Сохранить</button>',
  });
  $('[data-a=close]', m.el).onclick = m.close;
  const save = (e) => busy(e.target, async () => {
    const p = $('[name=p]', m.el).value;
    if (p.length < 6) return toastErr('Минимум 6 символов');
    const { error } = await sb.auth.updateUser({ password: p });
    if (error) return toastErr(error);
    toast('Пароль изменён'); m.close();
  });
  $('[data-a=save]', m.el).onclick = save;
  $('#pf', m.el).onsubmit = (e) => { e.preventDefault(); save({ target: $('[data-a=save]', m.el) }); };
}

