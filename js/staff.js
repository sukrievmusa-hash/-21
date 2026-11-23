// Кабинет сотрудника: только его записи, подключение своего Telegram, смена пароля
import {
  sb, $, $$, esc, money, toast, toastErr, modal, busy, fmtPhone, telLink, waLink, zonedToUtc, dateStrInTz,
  timeStrInTz, todayInTz, addDays, confirmDlg, isoWeekday, WD_SHORT, MONTHS_SHORT, humanDate, plural, statusBadge, pageUrl, BRAND,
} from './lib.js';

const STAFF_DOMAIN = 'staff.jazylam.kz';
const DAYS_BACK = 1, DAYS_AHEAD = 21;
const root = $('#root');
const S = { me: null, items: [], day: null, timer: null, earn: [], tab: 'sched' };
const METHODS = [['cash', '💵 Наличные'], ['kaspi', '📱 Kaspi'], ['card', '💳 Карта']];
const methodName = (m) => (METHODS.find((x) => x[0] === m) || ['', m])[1];
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
  document.body.classList.add('sx-body');
  root.innerHTML = `<div class="sx">
    <header class="topbar"><div class="container">
      <div class="sx-who"><b>${esc(me.name)}</b><span>${esc([me.title, b.name].filter(Boolean).join(' · '))}</span></div>
      <button class="sx-ico" id="tgBtn" aria-label="Telegram">✈️<i class="dot"></i></button>
      <button class="sx-ico" id="menuBtn" aria-label="Меню">⋯</button>
    </div></header>
    <div class="container"><main>
      <div class="sx-tabs"><div class="seg" role="tablist">
        <button data-tab="sched" role="tab">🗓 Расписание</button><button data-tab="earn" role="tab">💰 Заработок</button></div></div>
      ${b.active ? '' : '<div class="alert alert-warn" style="margin-bottom:12px">Онлайн-запись приостановлена — новые клиенты не записываются. Сообщите администратору.</div>'}
      <section id="tabSched">
        <button class="sx-strip" id="strip"><span class="l">Сегодня заработано</span><span class="v" id="stripV">…</span><span class="go">›</span></button>
        <div class="days" id="days"></div>
        <div class="sx-dayh"><h3 id="dayTitle"></h3><span id="sum"></span></div>
        <div class="sx-back hide" id="backToday"><button class="btn btn-sm">← К сегодняшнему дню</button></div>
        <div id="list"><div class="spinner"></div></div>
      </section>
      <section id="tabEarn" class="hide"><div id="earn"><div class="spinner"></div></div></section>
    </main></div>
    <button class="btn btn-pri sx-fab" id="walkin">＋ Без записи</button></div>`;
  $$('[data-tab]').forEach((t) => { t.onclick = () => setTab(t.dataset.tab); });
  $('#strip').onclick = () => setTab('earn');
  $('#walkin').onclick = () => payModal(null);
  $('#menuBtn').onclick = menuModal;
  $('#tgBtn').onclick = tgModal;
  $('#backToday button').onclick = () => { S.day = todayInTz(tz()); drawDays(); drawList(); };
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

// Статус Telegram — точка на значке в шапке
function renderTg() {
  const dot = $('#tgBtn .dot');
  if (!dot) return;
  const has = S.me.tg;
  $('#tgBtn').classList.toggle('hide', !has && !S.me.bot_username);
  dot.className = 'dot ' + (has ? 'on' : 'off');
  $('#tgBtn').title = has ? 'Telegram подключён' : 'Telegram не подключён';
}

function tgModal() {
  const me = S.me;
  const m = modal({
    title: 'Уведомления в Telegram',
    body: me.tg
      ? `<p style="margin-top:0">✅ <b>Подключено.</b> Сюда приходят только ваши записи: новые, отмены, переносы, а в 8:00 — список клиентов на день.</p>`
      : `<p style="margin-top:0">Получайте в Telegram только своих клиентов: кто записался, отмены, переносы и список на день в 8:00.</p>
         <a class="btn btn-tg btn-block btn-lg" target="_blank" rel="noopener" href="https://t.me/${esc(me.bot_username)}?start=m_${esc(me.tg_link_code)}">Подключить Telegram</a>
         <p class="muted small">В боте нажмите «Запустить» (Start), затем вернитесь сюда.</p>`,
    footer: me.tg
      ? '<button class="btn" data-a="close">Закрыть</button><button class="btn btn-danger" data-a="off">Отключить</button>'
      : '<button class="btn" data-a="close">Закрыть</button><button class="btn btn-pri" data-a="check">Я нажал «Запустить»</button>',
  });
  $('[data-a=close]', m.el).onclick = m.close;
  const off = $('[data-a=off]', m.el), chk = $('[data-a=check]', m.el);
  if (off) off.onclick = (e) => busy(e.target, async () => {
    const { error } = await sb.rpc('staff_unlink_tg');
    if (error) return toastErr(error);
    await refreshMe(); m.close(); toast('Telegram отключён');
  });
  if (chk) chk.onclick = (e) => busy(e.target, async () => {
    await refreshMe();
    if (S.me.tg) { m.close(); toast('Готово, Telegram подключён'); }
    else toastErr('Пока не подключено: откройте бота и нажмите «Запустить» (Start)');
  });
}

function menuModal() {
  const m = modal({
    title: S.me.name,
    body: `<div class="sx-menu">
      <button class="btn" data-m="tg">✈️ Telegram — ${S.me.tg ? 'подключён' : 'не подключён'}</button>
      <button class="btn" data-m="pwd">🔑 Сменить пароль</button>
      <button class="btn btn-danger" data-m="out">↩️ Выйти</button></div>`,
  });
  $('[data-m=tg]', m.el).onclick = () => { m.close(); tgModal(); };
  $('[data-m=pwd]', m.el).onclick = () => { m.close(); passwordModal(); };
  $('[data-m=out]', m.el).onclick = () => { m.close(); sb.auth.signOut(); };
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
}

function drawEarn() {
  const today = todayInTz(tz()), w = weekStart(today), m = monthStart(today);
  const pick = (fromDay) => S.earn.filter((e) => dateStrInTz(e.occurred_at, tz()) >= fromDay);
  const sum = (a) => a.reduce((s, e) => s + e.amount, 0);
  const t = pick(today), wk = pick(w), mo = pick(m);
  const sv = $('#stripV');
  if (sv) sv.textContent = `${money(sum(t)) || '0 ₸'} · ${t.length} кл.`;
  const box = $('#earn');
  if (!box) return;
  const cell = (label, a, main) => `<div class="${main ? 'main' : ''}"><div class="l">${label}</div><div class="v">${money(sum(a)) || '0 ₸'}</div>
    <div class="n">${a.length} ${plural(a.length, 'клиент', 'клиента', 'клиентов')}</div></div>`;
  // История: эта неделя и месяц (что уже загружено), сгруппировано по дням
  const rows = [...S.earn].sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at));
  let last = '', hist = '';
  for (const e of rows) {
    const d = dateStrInTz(e.occurred_at, tz());
    if (d !== last) {
      const dayRows = rows.filter((x) => dateStrInTz(x.occurred_at, tz()) === d);
      hist += `<div class="sx-dsep">${d === today ? 'Сегодня' : d === addDays(today, -1) ? 'Вчера' : esc(humanDate(d, false))} · ${money(sum(dayRows))}</div>`;
      last = d;
    }
    hist += `<div class="sx-pay" data-id="${e.id}" style="margin-bottom:6px">
      <div class="d"><b>${timeStrInTz(e.occurred_at, tz())}</b>${esc(methodName(e.method).split(' ')[1] || '')}</div>
      <div class="m"><b>${esc(e.client_name || 'Клиент без имени')}</b><div>${esc([e.service_name, e.note].filter(Boolean).join(' · ') || ' ')}</div></div>
      <div class="a">${money(e.amount)}</div>
      ${e.editable ? '<button class="sx-ico" data-e aria-label="Исправить">✏️</button>' : ''}</div>`;
  }
  box.innerHTML = `<div class="sx-kpi">${cell('Сегодня', t, true)}${cell('Неделя', wk)}${cell('Месяц', mo)}</div>
    <div class="sx-dayh"><h3>Мои оплаты</h3><span>с ${esc(humanDate([w, m].sort()[0], false))}</span></div>
    ${rows.length ? hist + '<p class="muted small" style="margin:12px 2px">Исправить или удалить оплату можно 24 часа, потом — только администратор.</p>'
      : '<div class="card empty"><div class="ico">💰</div>Пока оплат нет.<br><span class="muted small">После клиента нажмите «Оплатил» в расписании.</span></div>'}`;
  $$('[data-e]', box).forEach((btn) => { btn.onclick = () => editEarning(S.earn.find((x) => x.id === btn.closest('[data-id]').dataset.id)); });
}
function payModal(b) {
  const edit = b && b.earning_id;
  const e0 = edit ? S.earn.find((x) => x.id === b.earning_id) : null;
  const amount0 = edit ? b.paid : (b && b.price != null ? b.price : '');
  const method0 = edit ? b.paid_method : 'cash';
  const m = modal({
    title: b ? `${b.client_name}${edit ? ' — оплата' : ''}` : 'Клиент без записи',
    body: `<form id="pf" class="stack" novalidate>
      ${b ? `<div class="muted small">${[timeStrInTz(b.starts_at, tz()), b.service_name, b.price != null ? 'по записи ' + money(b.price) : ''].filter(Boolean).map(esc).join(' · ')}</div>`
        : `<div class="form-grid"><label class="field"><span>Имя клиента <span class="muted">(необязательно)</span></span><input class="input" name="client" maxlength="80"></label>
           <label class="field"><span>Услуга <span class="muted">(необязательно)</span></span><input class="input" name="service" maxlength="120" placeholder="Стрижка"></label></div>`}
      <label class="field"><span>Сколько заплатил клиент, ₸</span>
        <input class="input" name="amount" type="number" inputmode="numeric" min="1" max="10000000" step="1" value="${esc(amount0)}" required style="font-size:24px;font-weight:800" autofocus></label>
      <div><span class="small" style="font-weight:600">Как заплатил</span>
        <div class="seg seg3" id="meth" style="margin-top:6px">${METHODS.map(([k, t]) => `<button type="button" data-k="${k}" class="${k === method0 ? 'on' : ''}">${t}</button>`).join('')}</div></div>
      <label class="field"><span>Комментарий <span class="muted">(необязательно)</span></span><input class="input" name="note" maxlength="300" value="${esc(e0?.note || '')}"></label>
    </form>`,
    footer: `<button class="btn" data-a="close">Отмена</button><button class="btn btn-pri btn-lg" data-a="save">${edit ? 'Сохранить' : '✅ Записать оплату'}</button>`,
  });
  let method = method0;
  $$('#meth button', m.el).forEach((btn) => { btn.onclick = () => { method = btn.dataset.k; $$('#meth button', m.el).forEach((x) => x.classList.toggle('on', x === btn)); }; });
  $('[data-a=close]', m.el).onclick = m.close;
  const f = $('#pf', m.el);
  const save = (ev) => busy(ev.target, async () => {
    const amount = Math.round(Number(f.amount.value));
    if (!amount || amount < 1) return toastErr('Введите сумму');
    const { error } = await sb.rpc('staff_add_earning', {
      p_amount: amount, p_method: method, p_booking: b ? b.id : null,
      p_client: b ? null : f.client.value.trim() || null, p_service: b ? null : f.service.value.trim() || null,
      p_note: f.note.value.trim() || null,
    });
    if (error) return toastErr(error);
    toast(`Записано: ${money(amount)}`);
    m.close();
    await load();
  });
  $('[data-a=save]', m.el).onclick = save;
  f.onsubmit = (ev) => { ev.preventDefault(); save({ target: $('[data-a=save]', m.el) }); };
  setTimeout(() => f.amount.focus(), 50);
}

// История оплат за 30 дней: можно исправить или удалить свою запись в течение суток

function editEarning(e) {
  const m = modal({
    title: 'Исправить оплату',
    body: `<form id="ef" class="stack" novalidate>
      <label class="field"><span>Сумма, ₸</span><input class="input" name="amount" type="number" inputmode="numeric" min="1" value="${e.amount}" style="font-size:24px;font-weight:800"></label>
      <div class="seg seg3" id="meth">${METHODS.map(([k, t]) => `<button type="button" data-k="${k}" class="${k === e.method ? 'on' : ''}">${t}</button>`).join('')}</div>
      <label class="field"><span>Комментарий</span><input class="input" name="note" maxlength="300" value="${esc(e.note || '')}"></label></form>`,
    footer: '<button class="btn" data-a="close">Отмена</button><button class="btn btn-ghost" data-a="del" aria-label="Удалить">🗑</button><button class="btn btn-pri" data-a="save">Сохранить</button>',
  });
  $('[data-a=del]', m.el).onclick = async () => {
    if (!(await confirmDlg(`Удалить оплату ${money(e.amount)}?`, 'Удалить', true))) return;
    const { error } = await sb.rpc('staff_delete_earning', { p_id: e.id });
    if (error) return toastErr(error);
    toast('Удалено'); m.close(); await load();
  };
  let method = e.method;
  $$('#meth button', m.el).forEach((btn) => { btn.onclick = () => { method = btn.dataset.k; $$('#meth button', m.el).forEach((x) => x.classList.toggle('on', x === btn)); }; });
  $('[data-a=close]', m.el).onclick = m.close;
  $('[data-a=save]', m.el).onclick = (ev) => busy(ev.target, async () => {
    const f = $('#ef', m.el);
    const { error } = await sb.rpc('staff_update_earning', { p_id: e.id, p_amount: Math.round(Number(f.amount.value)), p_method: method, p_note: f.note.value.trim() || null });
    if (error) return toastErr(error);
    toast('Сохранено'); m.close(); await load();
  });
}

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
  $('#dayTitle').textContent = `${d === today ? 'Сегодня' : d === addDays(today, 1) ? 'Завтра' : d === addDays(today, -1) ? 'Вчера' : humanDate(d)}`;
  $('#sum').textContent = act.length ? `${act.length} ${plural(act.length, 'клиент', 'клиента', 'клиентов')}${sum ? ' · ' + money(sum) : ''}` : '';
  $('#backToday').classList.toggle('hide', d === today);
  if (!items.length) { box.innerHTML = '<div class="card empty"><div class="ico">🗓</div>На этот день записей нет</div>'; return; }
  box.innerHTML = `<div class="sx-list">${items.map((b) => {
    const paid = b.paid != null;
    const badge = paid ? `<span class="badge b-done">✅ Оплачено</span>` : statusBadge(b.status);
    return `<div class="sx-card ${b.status === 'cancelled' ? 'cancelled' : ''} ${paid ? 'paid' : ''}">
      <div class="sx-l1"><div class="sx-time">${timeStrInTz(b.starts_at, tz())}<small>– ${timeStrInTz(b.ends_at, tz())}</small></div>${badge}</div>
      <div class="sx-l2"><div class="sx-name">${esc(b.client_name)}</div>
        <div class="sx-sub"><span>${esc(b.service_name || 'Услуга не указана')}${b.source === 'online' ? ' · онлайн' : ''}</span>
          <b>${paid ? money(b.paid) + ' · ' + esc(methodName(b.paid_method).split(' ')[1] || '') : b.price != null ? money(b.price) : ''}</b></div>
        ${b.comment ? `<div class="sx-note">💬 ${esc(b.comment)}</div>` : ''}</div>
      ${active(b) ? `<div class="sx-l3">
        <a class="sx-ico" href="${telLink(b.client_phone)}" aria-label="Позвонить ${esc(fmtPhone(b.client_phone))}">📞</a>
        <a class="sx-ico" target="_blank" rel="noopener" href="${esc(waLink(b.client_phone))}" aria-label="WhatsApp">💬</a>
        <button class="btn ${paid ? '' : 'btn-pri'} main" data-pay="${b.id}">${paid ? '✏️ Изменить оплату' : '💰 Оплатил'}</button></div>` : ''}
    </div>`;
  }).join('')}</div>`;
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

