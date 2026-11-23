// Кабинет сотрудника: только его записи, подключение своего Telegram, смена пароля
import {
  sb, $, esc, money, toast, toastErr, modal, busy, fmtPhone, telLink, waLink, zonedToUtc, dateStrInTz,
  timeStrInTz, todayInTz, addDays, isoWeekday, WD_SHORT, MONTHS_SHORT, humanDate, plural, statusBadge, pageUrl, BRAND,
} from './lib.js';

const STAFF_DOMAIN = 'staff.jazylam.kz';
const DAYS_BACK = 1, DAYS_AHEAD = 21;
const root = $('#root');
const S = { me: null, items: [], day: null, timer: null };
const tz = () => S.me.business.timezone;

sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') { S.me = null; showLogin(); } });
boot();

async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return showLogin();
  const { data: me, error } = await sb.rpc('staff_me');
  if (error) { root.innerHTML = `<div class="empty">Ошибка загрузки: ${esc(error.message)}<br><button class="btn" onclick="location.reload()">Обновить</button></div>`; return; }
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

document.addEventListener('visibilitychange', () => { if (!document.hidden && S.me) { refreshMe(); load(); } });

function showLogin() {
  root.innerHTML = `<div class="auth-wrap"><div class="auth-card">
    <div class="center" style="margin-bottom:18px"><a class="logo" href="index.html"><i>J</i><span>${esc(BRAND)}</span></a></div>
    <div class="card"><form id="lf" class="stack" novalidate>
      <div><h2 style="margin-bottom:4px">Кабинет сотрудника</h2>
        <p class="muted small" style="margin:0">Логин и пароль выдаёт администратор</p></div>
      <label class="field"><span>Логин</span><input class="input" name="login" autocomplete="username" autocapitalize="off" required></label>
      <label class="field"><span>Пароль</span><input class="input" name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn btn-pri btn-block btn-lg">Войти</button>
      <a class="btn btn-ghost btn-block" href="app.html">Я владелец бизнеса</a>
    </form></div></div></div>`;
  const f = $('#lf');
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

function renderShell() {
  const me = S.me, b = me.business;
  root.innerHTML = `
    <header class="topbar"><div class="container">
      <span class="logo"><i>J</i><span>${esc(BRAND)}</span></span>
      <span class="biz grow">${esc(b.name)}</span>
      <button class="btn btn-sm btn-ghost" id="pwd">Пароль</button>
      <button class="btn btn-sm btn-ghost" id="logout">Выйти</button>
    </div></header>
    <div class="container"><main class="page">
      <div class="page-h"><h2>👋 ${esc(me.name)}</h2><span class="muted small">${esc(me.title || '')}</span></div>
      ${b.active ? '' : '<div class="alert alert-warn" style="margin-bottom:12px">Онлайн-запись сейчас приостановлена — новые клиенты не записываются. Сообщите администратору.</div>'}
      <div id="tg" style="margin-bottom:14px"></div>
      <div id="sum" class="muted small" style="margin-bottom:6px"></div>
      <div class="days" id="days"></div>
      <h3 id="dayTitle" style="margin:12px 0 8px"></h3>
      <div id="list"><div class="spinner"></div></div>
    </main></div>`;
  $('#logout').onclick = () => sb.auth.signOut();
  $('#pwd').onclick = passwordModal;
  renderTg();
}

function renderTg() {
  const me = S.me, box = $('#tg');
  if (!box) return;
  if (me.tg) {
    box.innerHTML = `<div class="alert alert-ok row" style="gap:8px;flex-wrap:wrap;align-items:center">
      <span class="grow">✈️ Telegram подключён — сюда приходят только ваши записи, а в 8:00 — список клиентов на день.</span>
      <button class="btn btn-sm btn-ghost" id="tgOff">Отключить</button></div>`;
    $('#tgOff').onclick = async (e) => busy(e.target, async () => {
      const { error } = await sb.rpc('staff_unlink_tg');
      if (error) return toastErr(error);
      await refreshMe(); toast('Telegram отключён');
    });
  } else if (me.bot_username) {
    box.innerHTML = `<div class="card" style="padding:14px">
      <b>Получайте свои записи в Telegram</b>
      <p class="muted small" style="margin:4px 0 10px">Кто к вам записался, отмены, переносы и каждое утро — список клиентов на день. Только ваши, без чужих.</p>
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <a class="btn btn-tg" target="_blank" rel="noopener" href="https://t.me/${esc(me.bot_username)}?start=m_${esc(me.tg_link_code)}">Подключить Telegram</a>
        <button class="btn btn-ghost" id="tgCheck">Я нажал «Запустить» — проверить</button></div></div>`;
    $('#tgCheck').onclick = async (e) => busy(e.target, async () => {
      await refreshMe();
      toast(S.me.tg ? 'Готово, Telegram подключён' : 'Пока не подключено: откройте бота и нажмите «Запустить» (Start)', S.me.tg ? 'ok' : 'err');
    });
  } else box.innerHTML = '';
}

async function refreshMe() {
  const { data } = await sb.rpc('staff_me');
  if (!data) return boot();
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
  if (error) { toastErr(error); return; }
  S.items = data || [];
  drawDays(from);
  drawList();
}

const active = (b) => b.status !== 'cancelled';
const itemsOn = (d) => S.items.filter((b) => dateStrInTz(b.starts_at, tz()) === d);

function drawDays(from) {
  const box = $('#days');
  if (!box) return;
  const today = todayInTz(tz());
  const upcoming = S.items.filter((b) => active(b) && b.status !== 'done' && b.status !== 'no_show' && new Date(b.starts_at) > new Date());
  $('#sum').textContent = upcoming.length
    ? `Впереди ${upcoming.length} ${plural(upcoming.length, 'запись', 'записи', 'записей')}`
    : 'Впереди записей пока нет';
  box.innerHTML = '';
  for (let i = 0; i <= DAYS_BACK + DAYS_AHEAD; i++) {
    const d = addDays(from, i);
    const [, m, dd] = d.split('-').map(Number);
    const n = itemsOn(d).filter(active).length;
    const btn = document.createElement('button');
    btn.className = 'day' + (d === S.day ? ' sel' : '');
    btn.innerHTML = `<div class="dw">${d === today ? 'сег' : d === addDays(today, 1) ? 'завт' : d === addDays(today, -1) ? 'вчера' : WD_SHORT[isoWeekday(d)]}</div>
      <div class="dn">${dd}</div><div class="dm">${n ? `<b>${n}</b> кл.` : MONTHS_SHORT[m - 1]}</div>`;
    btn.onclick = () => { S.day = d; drawDays(from); drawList(); };
    box.append(btn);
    if (d === S.day) requestAnimationFrame(() => btn.scrollIntoView({ inline: 'center', block: 'nearest' }));
  }
}

function drawList() {
  const box = $('#list');
  if (!box) return;
  const d = S.day, today = todayInTz(tz());
  const items = itemsOn(d);
  const act = items.filter(active);
  const sum = act.reduce((s, b) => s + (b.price || 0), 0);
  $('#dayTitle').textContent = `${d === today ? 'Сегодня, ' : d === addDays(today, 1) ? 'Завтра, ' : ''}${humanDate(d)}`
    + (act.length ? ` · ${act.length} ${plural(act.length, 'клиент', 'клиента', 'клиентов')}${sum ? ' · ' + money(sum) : ''}` : '');
  if (!items.length) { box.innerHTML = '<div class="card empty"><div class="ico">🗓</div>На этот день у вас записей нет</div>'; return; }
  box.innerHTML = `<div class="card day-list">${items.map((b) => `
    <div class="item ${b.status === 'cancelled' ? 'cancelled' : ''}">
      <div class="t">${timeStrInTz(b.starts_at, tz())}<div class="muted small" style="font-weight:400">до ${timeStrInTz(b.ends_at, tz())}</div></div>
      <div class="grow"><div class="who" style="justify-content:flex-start"><b>${esc(b.client_name)}</b> <span class="muted small">${fmtPhone(b.client_phone)}</span></div>
        <div class="muted small">${[b.service_name, b.price != null ? money(b.price) : '', b.source === 'online' ? 'онлайн' : ''].filter(Boolean).map(esc).join(' · ')}</div>
        ${b.comment ? `<div class="small">💬 ${esc(b.comment)}</div>` : ''}</div>
      ${statusBadge(b.status)}
      ${active(b) ? `<a class="btn btn-sm btn-ghost" href="${telLink(b.client_phone)}" title="Позвонить">📞</a>
      <a class="btn btn-sm btn-ghost" target="_blank" rel="noopener" href="${esc(waLink(b.client_phone))}" title="Написать в WhatsApp">💬</a>` : ''}
    </div>`).join('')}</div>`;
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

