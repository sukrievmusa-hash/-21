import { sb, $, $$, esc, money, toast, toastErr, errMsg, modal, confirmDlg, busy, fmtDateShort, pageUrl, BRAND, INITIAL_HASH } from './lib.js';
import { renderAuth, renderNewPassword } from './auth.js';

const root = $('#root');
const TZ = 'Asia/Almaty';
const PLAN = { trial: 'Пробный', start: 'Старт', business: 'Бизнес' };
let user = null;
let recovery = INITIAL_HASH.includes('type=recovery');

sb.auth.onAuthStateChange((e) => {
  if (e === 'PASSWORD_RECOVERY') { recovery = true; renderNewPassword(root, () => { recovery = false; boot(); }); }
  if (e === 'SIGNED_OUT') boot();
});
window.addEventListener('hashchange', () => { if (user) route(); });
boot();

async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return renderAuth(root, { onDone: boot, allowSignup: true, title: 'Вход для администратора' });
  if (recovery) return renderNewPassword(root, () => { recovery = false; boot(); });
  user = session.user;
  const { data: isAdmin } = await sb.rpc('is_admin');
  if (!isAdmin) return renderClaim();
  renderShell();
  route();
}

function renderClaim() {
  root.innerHTML = `<div class="auth-wrap"><div class="auth-card"><div class="card stack">
    <h2>Доступ администратора</h2>
    <p class="muted">Вы вошли как <b>${esc(user.email)}</b>. Введите код администратора, чтобы получить доступ к управлению платформой.</p>
    <input class="input" id="code" placeholder="KZ-XXXXXXXXXXXX" autocomplete="off">
    <button class="btn btn-pri btn-block" id="go">Получить доступ</button>
    <button class="btn btn-ghost btn-block" id="lo">Выйти</button></div></div></div>`;
  $('#lo').onclick = () => sb.auth.signOut();
  $('#go').onclick = async (e) => {
    await busy(e.target, async () => {
      const { error } = await sb.rpc('claim_admin', { p_code: $('#code').value.trim() });
      if (error) return toastErr(error);
      toast('Готово, вы администратор'); boot();
    });
  };
}

const TABS = [['overview', 'Обзор'], ['payments', 'Оплаты'], ['businesses', 'Бизнесы'], ['settings', 'Настройки']];
function renderShell() {
  root.innerHTML = `<header class="topbar"><div class="container">
      <a class="logo" href="index.html"><i style="background:#0f172a">A</i><span>${esc(BRAND)} · админка</span></a><span class="grow"></span>
      <a class="btn btn-sm" href="app.html">Кабинет бизнеса</a><button class="btn btn-sm btn-ghost" id="lo">Выйти</button></div>
    <div class="container"><nav class="tabs">${TABS.map(([k, t]) => `<a class="tab" href="#${k}" data-t="${k}">${t}</a>`).join('')}</nav></div></header>
    <div class="container"><main class="page" id="page"></main></div>`;
  $('#lo').onclick = () => sb.auth.signOut();
}

function route() {
  const t = location.hash.slice(1);
  const tab = TABS.some(([k]) => k === t) ? t : 'overview';
  $$('.tab').forEach((a) => a.classList.toggle('active', a.dataset.t === tab));
  ({ overview, payments, businesses, settings })[tab]();
}

async function overview() {
  const page = $('#page');
  page.innerHTML = '<div class="spinner"></div>';
  const [{ data: o, error }, { data: tg }] = await Promise.all([sb.rpc('admin_overview'), sb.rpc('admin_tg_info')]);
  if (error) { page.innerHTML = `<div class="alert alert-danger">${esc(errMsg(error))}</div>`; return; }
  const todo = [];
  if (!tg?.token_set) todo.push('<li><a href="#settings">Подключите Telegram-бота</a> — без него не будет напоминаний и уведомлений</li>');
  if (tg?.token_set && !tg?.admin_chat_connected) todo.push('<li><a href="#settings">Подключите уведомления администратора</a> — о регистрациях и оплатах</li>');
  const { data: ps } = await sb.from('platform_settings').select('kaspi_details').eq('id', 1).single();
  if (!ps?.kaspi_details) todo.push('<li><a href="#settings">Укажите реквизиты Kaspi</a> для оплаты подписки</li>');
  page.innerHTML = `<div class="page-h"><h2>Обзор</h2></div>
    ${todo.length ? `<div class="alert alert-warn" style="margin-bottom:14px"><b>Осталось настроить:</b><ul style="margin:6px 0 0;padding-left:20px">${todo.join('')}</ul></div>` : ''}
    <div class="grid grid-4 keep-2">
      ${[[money(o.mrr) || '0 ₸', 'MRR — ежемесячная выручка'], [o.paid, 'платящих бизнесов'], [o.trial, 'на пробном периоде'], [o.pending_payments, 'заявок на оплату ждут'],
        [o.businesses, 'всего бизнесов'], [o.new_30d, 'новых за 30 дней'], [money(o.paid_30d) || '0 ₸', 'оплат за 30 дней'], [o.bookings_30d, 'записей у клиентов за 30 дней'],
        [o.expired, 'подписка закончилась'], [o.blocked, 'заблокировано']]
        .map(([v, l]) => `<div class="card stat flat"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('')}
    </div>`;
}

async function payments() {
  const page = $('#page');
  page.innerHTML = '<div class="page-h"><h2>Заявки на оплату</h2></div><div class="card" style="padding:0"><div class="table-wrap" id="t"><div class="spinner"></div></div></div>';
  const { data, error } = await sb.rpc('admin_payments');
  const box = $('#t');
  if (error) { box.innerHTML = `<div class="empty">${esc(errMsg(error))}</div>`; return; }
  if (!data.length) { box.innerHTML = '<div class="empty">Заявок пока нет</div>'; return; }
  const st = { pending: 'ждёт проверки', approved: 'подтверждена', rejected: 'отклонена' };
  box.innerHTML = `<table class="table"><thead><tr><th>Дата</th><th>Бизнес</th><th>Тариф</th><th>Сумма</th><th>Отправитель</th><th>Статус</th><th></th></tr></thead><tbody>
    ${data.map((p) => `<tr><td class="nowrap">${fmtDateShort(p.created_at, TZ)}</td>
      <td><b>${esc(p.business_name)}</b><div class="muted small">${esc(p.slug)} · ${esc(p.email || '')}</div></td>
      <td>${PLAN[p.plan]}, ${p.months} мес</td><td class="nowrap"><b>${money(p.amount)}</b></td><td>${esc(p.payer_note || '')}</td>
      <td><span class="badge b-${p.status}">${st[p.status]}</span></td>
      <td class="nowrap">${p.status === 'pending' ? `<button class="btn btn-sm btn-pri" data-ok="${p.id}">Подтвердить</button> <button class="btn btn-sm btn-danger" data-no="${p.id}">Не найдено</button>` : ''}</td></tr>`).join('')}
    </tbody></table>`;
  $$('[data-ok]', box).forEach((b) => { b.onclick = () => process(b.dataset.ok, true, b); });
  $$('[data-no]', box).forEach((b) => { b.onclick = () => process(b.dataset.no, false, b); });
  async function process(id, ok, btn) {
    const p = data.find((x) => x.id === id);
    if (!(await confirmDlg(ok ? `Перевод ${money(p.amount)} от «${p.payer_note}» поступил? Подписка «${p.business_name}» продлится на ${p.months} мес.` : 'Отметить, что перевод не найден? Клиент получит уведомление.', ok ? 'Подтвердить' : 'Не найдено', !ok))) return;
    await busy(btn, async () => {
      const { error: e } = await sb.rpc('admin_process_payment', { p_id: id, p_approve: ok });
      if (e) return toastErr(e);
      toast(ok ? 'Подписка продлена' : 'Заявка отклонена');
      payments();
    });
  }
}

async function businesses() {
  const page = $('#page');
  page.innerHTML = `<div class="page-h"><h2>Бизнесы</h2><input class="input" id="q" placeholder="Поиск" style="max-width:260px"></div>
    <div class="card" style="padding:0"><div class="table-wrap" id="t"><div class="spinner"></div></div></div>`;
  const { data, error } = await sb.rpc('admin_businesses');
  if (error) { $('#t').innerHTML = `<div class="empty">${esc(errMsg(error))}</div>`; return; }
  const draw = (q = '') => {
    q = q.toLowerCase();
    const rows = data.filter((b) => !q || [b.name, b.slug, b.email, b.phone, b.category].some((x) => String(x || '').toLowerCase().includes(q)));
    $('#t').innerHTML = !rows.length ? '<div class="empty">Ничего не найдено</div>' : `<table class="table"><thead><tr><th>Бизнес</th><th>Владелец</th><th>Тариф</th><th>Оплачено до</th><th>Сотр.</th><th>Записей 30 дн.</th><th>TG</th></tr></thead><tbody>
      ${rows.map((b) => {
        const exp = new Date(b.paid_until) < new Date();
        return `<tr class="clickable" data-id="${b.id}"><td><b>${esc(b.name)}</b>${b.is_demo ? ' <span class="badge b-booked">демо</span>' : ''}${b.is_blocked ? ' <span class="badge b-rejected">блок</span>' : ''}
          <div class="muted small">${esc(b.category || '')} · <a href="${esc(pageUrl('book.html', { b: b.slug }))}" target="_blank" data-stop>${esc(b.slug)}</a></div></td>
          <td class="small">${esc(b.email || '—')}<div class="muted">${esc(b.phone || '')}</div></td><td>${PLAN[b.plan]}</td>
          <td class="nowrap" style="${exp ? 'color:var(--danger);font-weight:700' : ''}">${b.is_demo ? '∞' : fmtDateShort(b.paid_until, TZ)}</td>
          <td>${b.staff}</td><td>${b.bookings_30d} <span class="muted small">(${b.online_30d} онлайн)</span></td><td>${b.tg ? '✅' : '—'}</td></tr>`;
      }).join('')}</tbody></table>`;
    $$('[data-stop]').forEach((a) => a.addEventListener('click', (e) => e.stopPropagation()));
    $$('tr[data-id]').forEach((tr) => { tr.onclick = () => editBiz(data.find((b) => b.id === tr.dataset.id)); });
  };
  $('#q').oninput = (e) => draw(e.target.value);
  draw();
}

function editBiz(b) {
  const d = new Date(b.paid_until).toISOString().slice(0, 10);
  const m = modal({
    title: b.name,
    body: `<div class="stack"><div class="muted small">${esc(b.email || '')} · создан ${fmtDateShort(b.created_at, TZ)} · услуг: ${b.services}</div>
      <div class="form-grid">
        <label class="field"><span>Тариф</span><select class="select" id="pl">${Object.entries(PLAN).map(([k, t]) => `<option value="${k}" ${k === b.plan ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="field"><span>Оплачено до</span><input class="input" type="date" id="pu" value="${d}"></label></div>
      <div class="row">${[[7, '+7 дней'], [30, '+1 мес'], [90, '+3 мес'], [365, '+1 год']].map(([n, t]) => `<button type="button" class="btn btn-sm" data-add="${n}">${t}</button>`).join('')}</div>
      <label class="check"><input type="checkbox" id="bl" ${b.is_blocked ? 'checked' : ''}><span>Заблокировать (запись и напоминания остановятся)</span></label></div>`,
    footer: '<button class="btn" data-a="c">Отмена</button><button class="btn btn-pri" data-a="s">Сохранить</button>',
  });
  $$('[data-add]', m.el).forEach((x) => {
    x.onclick = () => {
      const base = new Date(Math.max(Date.now(), new Date($('#pu', m.el).value).getTime() || 0));
      base.setDate(base.getDate() + +x.dataset.add);
      $('#pu', m.el).value = base.toISOString().slice(0, 10);
    };
  });
  $('[data-a=c]', m.el).onclick = m.close;
  $('[data-a=s]', m.el).onclick = async (e) => {
    await busy(e.target, async () => {
      const { error } = await sb.rpc('admin_update_business', {
        p_id: b.id, p_plan: $('#pl', m.el).value, p_paid_until: new Date($('#pu', m.el).value + 'T23:59:00+05:00').toISOString(), p_blocked: $('#bl', m.el).checked,
      });
      if (error) return toastErr(error);
      toast('Сохранено'); m.close(); businesses();
    });
  };
}

async function settings() {
  const page = $('#page');
  page.innerHTML = '<div class="spinner"></div>';
  const [{ data: s }, { data: tg }] = await Promise.all([sb.from('platform_settings').select('*').eq('id', 1).single(), sb.rpc('admin_tg_info')]);
  page.innerHTML = `<div class="page-h"><h2>Настройки платформы</h2></div>
    <div class="card"><h3>Telegram-бот</h3><div id="tg"></div></div>
    <div class="card"><h3>Оплата и цены</h3><form id="sf" class="form-grid" novalidate>
      <label class="field full"><span>Реквизиты Kaspi для оплаты подписки</span><textarea class="textarea" name="kaspi_details" rows="3" placeholder="Kaspi Gold: +7 707 123 45 67 (Муса Ш.)&#10;или Kaspi Pay — номер для перевода">${esc(s.kaspi_details || '')}</textarea>
        <small>Видно владельцам бизнесов на странице «Подписка»</small></label>
      <label class="field"><span>Контакт поддержки</span><input class="input" name="support_contact" value="${esc(s.support_contact || '')}" placeholder="WhatsApp +7 707 … или @username"></label>
      <label class="field"><span>Адрес сайта</span><input class="input" name="site_url" value="${esc(s.site_url || '')}"></label>
      <label class="field"><span>Цена «Старт», ₸/мес</span><input class="input" type="number" name="price_start" min="0" step="10" value="${s.price_start}"></label>
      <label class="field"><span>Цена «Бизнес», ₸/мес</span><input class="input" type="number" name="price_business" min="0" step="10" value="${s.price_business}"></label>
      <label class="field"><span>Пробный период, дней</span><input class="input" type="number" name="trial_days" min="0" max="90" value="${s.trial_days}"></label>
      <div class="full"><button class="btn btn-pri">Сохранить</button></div></form></div>`;
  const f = $('#sf');
  f.onsubmit = async (e) => {
    e.preventDefault();
    await busy($('button', f), async () => {
      const { error } = await sb.from('platform_settings').update({
        kaspi_details: f.kaspi_details.value.trim() || null, support_contact: f.support_contact.value.trim() || null,
        site_url: f.site_url.value.trim() || null, price_start: +f.price_start.value || 0,
        price_business: +f.price_business.value || 0, trial_days: Math.min(90, Math.max(0, +f.trial_days.value || 0)),
      }).eq('id', 1);
      if (error) return toastErr(error);
      toast('Сохранено');
    });
  };
  drawTg(tg);

  function drawTg(info) {
    const box = $('#tg');
    const connected = info?.token_set;
    box.innerHTML = `${connected ? `<div class="alert alert-ok" style="margin-bottom:12px">✅ Бот подключён: <a href="https://t.me/${esc(info.bot_username)}" target="_blank"><b>@${esc(info.bot_username)}</b></a> <span id="hook" class="small"></span></div>` : ''}
      <ol class="small" style="padding-left:18px;margin:0 0 12px">
        <li>Откройте <a href="https://t.me/BotFather" target="_blank">@BotFather</a> в Telegram → <b>/newbot</b> → придумайте имя (например «${esc(BRAND)} Напоминания») и username, оканчивающийся на <b>bot</b>.</li>
        <li>BotFather пришлёт токен вида <code>123456789:AA…</code> — вставьте его ниже.</li></ol>
      <div class="link-box"><input class="input grow" id="tok" placeholder="${connected ? 'Новый токен (если нужно заменить бота)' : 'Токен от @BotFather'}" autocomplete="off">
        <button class="btn btn-pri" id="tokGo">${connected ? 'Заменить' : 'Подключить'}</button></div>
      ${connected ? `<div style="margin-top:16px"><b>Уведомления администратора</b> — о новых регистрациях и заявках на оплату:
        <div class="row" style="margin-top:8px">${info.admin_chat_connected ? '<span class="badge b-done">подключено</span>' : `<a class="btn btn-tg btn-sm" target="_blank" href="https://t.me/${esc(info.bot_username)}?start=adm_${esc(info.admin_link_code)}">Подключить мой Telegram</a>`}
        <button class="btn btn-sm" id="tgRefresh">Обновить</button>${info.admin_chat_connected ? '<button class="btn btn-sm" id="tgTest">Отправить тест</button>' : ''}</div></div>` : ''}`;
    $('#tokGo').onclick = async (e) => {
      const token = $('#tok').value.trim();
      if (!token) return toastErr('Вставьте токен');
      await busy(e.target, async () => {
        const { data, error } = await sb.functions.invoke('tg', { body: { action: 'setup', token } });
        if (error) {
          let msg = errMsg(error);
          try { const j = await error.context.json(); msg = j.error || msg; } catch { /* нет тела */ }
          return toastErr(msg);
        }
        toast('Бот @' + data.username + ' подключён');
        const { data: t2 } = await sb.rpc('admin_tg_info');
        drawTg(t2);
      });
    };
    $('#tgRefresh') && ($('#tgRefresh').onclick = async () => { const { data: t2 } = await sb.rpc('admin_tg_info'); drawTg(t2); });
    $('#tgTest') && ($('#tgTest').onclick = async () => { const { error } = await sb.rpc('admin_test_message'); error ? toastErr(error) : toast('Отправлено — проверьте Telegram'); });
    if (connected) sb.functions.invoke('tg', { body: { action: 'status' } }).then(({ data }) => {
      const h = $('#hook');
      if (!h || !data) return;
      h.innerHTML = data.url_ok ? ' · webhook работает' + (data.last_error ? ` · последняя ошибка: ${esc(data.last_error)}` : '') : ' · <b style="color:var(--danger)">webhook не настроен — нажмите «Заменить» с тем же токеном</b>';
    });
  }
}
