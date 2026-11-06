import { sb, $, $$, esc, money, toast, toastErr, errMsg, modal, confirmDlg, busy, fmtDateShort, pageUrl, copyText, waLink, normPhone, BRAND, INITIAL_HASH } from './lib.js';
import { renderAuth, renderNewPassword } from './auth.js';

const root = $('#root');
const TZ = 'Asia/Almaty';
let PLANS = [];
const planTitle = (c) => PLANS.find((p) => p.code === c)?.title || c;
async function loadPlans() { const { data } = await sb.from('plans').select('*').order('sort'); PLANS = data || []; }
async function fnErr(error) { try { const j = await error.context.json(); return j.error || errMsg(error); } catch { return errMsg(error); } }
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
  await loadPlans();
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

const TABS = [['overview', 'Обзор'], ['payments', 'Оплаты'], ['businesses', 'Бизнесы'], ['plans', 'Тарифы'], ['settings', 'Настройки']];
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
  ({ overview, payments, businesses, plans, settings })[tab]();
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
  if (!tg?.ai_key_set) todo.push('<li><a href="#settings">Подключите ИИ</a> — ключ Anthropic API, чтобы работал тариф с ИИ-ассистентом</li>');
  page.innerHTML = `<div class="page-h"><h2>Обзор</h2></div>
    ${todo.length ? `<div class="alert alert-warn" style="margin-bottom:14px"><b>Осталось настроить:</b><ul style="margin:6px 0 0;padding-left:20px">${todo.join('')}</ul></div>` : ''}
    <div class="grid grid-4 keep-2">
      ${[[money(o.mrr) || '0 ₸', 'MRR — ежемесячная выручка'], [o.paid, 'платящих бизнесов'], [o.trial, 'на пробном периоде'], [o.pending_payments, 'заявок на оплату ждут'],
        [o.businesses, 'всего бизнесов'], [o.new_30d, 'новых за 30 дней'], [money(o.paid_30d) || '0 ₸', 'оплат за 30 дней'], [o.bookings_30d, 'записей у клиентов за 30 дней'],
        [o.expired, 'подписка закончилась'], [o.blocked, 'заблокировано'], [o.ai_30d, 'ответов ИИ за 30 дней'], [Math.round((o.ai_tokens_30d || 0) / 1000) + ' тыс.', 'токенов ИИ за 30 дней']]
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
      <td>${esc(planTitle(p.plan))}, ${p.months} мес</td><td class="nowrap"><b>${money(p.amount)}</b></td><td>${esc(p.payer_note || '')}</td>
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
          <td class="small">${esc(b.email || '—')}<div class="muted">${esc(b.phone || '')}</div></td><td>${esc(planTitle(b.plan))}</td>
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
        <label class="field"><span>Тариф</span><select class="select" id="pl">${PLANS.map((p) => `<option value="${esc(p.code)}" ${p.code === b.plan ? 'selected' : ''}>${esc(p.title)} — до ${p.staff_limit} сотр.${p.ai ? ', ИИ' : ''}${p.is_public ? '' : ' (скрытый)'}${p.is_active ? '' : ' (архив)'}</option>`).join('')}</select></label>
        <label class="field"><span>Оплачено до</span><input class="input" type="date" id="pu" value="${d}"></label></div>
      <div class="row">${[[7, '+7 дней'], [30, '+1 мес'], [90, '+3 мес'], [365, '+1 год']].map(([n, t]) => `<button type="button" class="btn btn-sm" data-add="${n}">${t}</button>`).join('')}</div>
      <label class="check"><input type="checkbox" id="bl" ${b.is_blocked ? 'checked' : ''}><span>Заблокировать (запись и напоминания остановятся)</span></label></div>`,
    footer: `${b.email ? '<button class="btn" data-a="pw">Новый пароль владельцу</button>' : ''}<button class="btn" data-a="c">Отмена</button><button class="btn btn-pri" data-a="s">Сохранить</button>`,
  });
  const pwBtn = $('[data-a=pw]', m.el);
  if (pwBtn) pwBtn.onclick = async () => {
    if (!(await confirmDlg(`Сбросить пароль владельцу «${b.name}» (${b.email})? Старый пароль перестанет работать.`, 'Сбросить', true))) return;
    const { data, error } = await sb.functions.invoke('account', { body: { action: 'reset_password', business_id: b.id } });
    if (error) {
      let msg = errMsg(error);
      try { msg = (await error.context.json()).error || msg; } catch { /* без тела */ }
      return toastErr(msg);
    }
    const text = `Здравствуйте! Новый пароль для входа в ${BRAND}: ${data.password}\nEmail: ${b.email}\nВход: ${pageUrl('app.html')}\nПосле входа смените пароль в «Настройки → Аккаунт».`;
    const pm = modal({
      title: 'Новый пароль',
      body: `<p>Email: <b>${esc(b.email)}</b><br>Пароль: <b style="font-size:20px;letter-spacing:.05em">${esc(data.password)}</b></p><p class="muted small">Отправьте его владельцу. Он сможет сменить пароль в кабинете.</p>`,
      footer: `<button class="btn" id="pwCopy">Скопировать сообщение</button>${normPhone(b.phone) ? `<a class="btn btn-wa" target="_blank" rel="noopener" href="${esc(waLink(b.phone, text))}">Отправить в WhatsApp</a>` : ''}`,
    });
    $('#pwCopy', pm.el).onclick = () => copyText(text);
  };
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

async function plans() {
  await loadPlans();
  const page = $('#page');
  page.innerHTML = `<div class="page-h"><h2>Тарифы</h2><button class="btn btn-pri" id="add">+ Тариф</button></div>
    <p class="muted small">Цены, лимиты и пункты меняются сразу на сайте и в кабинетах. <b>Скрытый</b> тариф не виден на сайте — назначьте его конкретному бизнесу в «Бизнесы» для индивидуальных условий (например, 50 мастеров по особой цене). Уже оплаченные заявки не меняются.</p>
    <div class="card" style="padding:0"><div class="table-wrap"><table class="table"><thead><tr><th>Тариф</th><th>Цена / мес</th><th>Сотрудников</th><th>ИИ</th><th>Виден</th><th></th></tr></thead><tbody>
    ${PLANS.map((p) => `<tr class="clickable" data-c="${esc(p.code)}"><td><b>${esc(p.title)}</b> <span class="muted small">${esc(p.code)}</span>${p.is_active ? '' : ' <span class="badge b-cancelled">архив</span>'}</td>
      <td class="nowrap">${p.code === 'trial' ? 'бесплатно' : money(p.price)}</td><td>до ${p.staff_limit}</td><td>${p.ai ? `✅ до ${p.ai_limit} отв.` : '—'}</td>
      <td>${p.code === 'trial' ? 'пробный' : p.is_public ? 'всем' : 'скрытый'}</td><td class="muted">›</td></tr>`).join('')}</tbody></table></div></div>`;
  $('#add').onclick = () => planModal(null);
  $$('tr[data-c]').forEach((tr) => { tr.onclick = () => planModal(PLANS.find((p) => p.code === tr.dataset.c)); });
}

function planModal(p) {
  const isNew = !p, trial = p?.code === 'trial';
  p = p || { code: '', title: '', price: 0, staff_limit: 10, ai: false, ai_limit: 0, features: '', is_public: true, is_active: true, sort: (PLANS.at(-1)?.sort || 0) + 10 };
  const m = modal({
    title: isNew ? 'Новый тариф' : p.title, wide: true,
    body: `<form id="pf" class="form-grid" novalidate>
      <label class="field"><span>Название</span><input class="input" name="title" maxlength="40" value="${esc(p.title)}" placeholder="Например: Сеть 50"></label>
      <label class="field"><span>Код (латиница)</span><input class="input" name="code" maxlength="30" value="${esc(p.code)}" ${isNew ? '' : 'disabled'} placeholder="network50"><small>${isNew ? 'Нельзя будет изменить' : 'Не меняется'}</small></label>
      ${trial ? '' : `<label class="field"><span>Цена, ₸ в месяц</span><input class="input" type="number" name="price" min="0" step="10" value="${p.price}"></label>`}
      <label class="field"><span>Сотрудников максимум</span><input class="input" type="number" name="staff_limit" min="1" max="1000" value="${p.staff_limit}"></label>
      <div class="field"><span>ИИ-ассистент</span><label class="check"><input type="checkbox" name="ai" ${p.ai ? 'checked' : ''}><span>Включён в тариф</span></label></div>
      <label class="field"><span>Ответов ИИ в месяц</span><input class="input" type="number" name="ai_limit" min="0" step="100" value="${p.ai_limit}"><small>Защита от перерасхода. ~1 ответ ≈ 2–6 ₸ ваших затрат на ИИ</small></label>
      ${trial ? '' : `<label class="field full"><span>Что входит — по пункту на строку</span><textarea class="textarea" name="features" rows="5" maxlength="1000">${esc(p.features || '')}</textarea></label>
      <div class="field"><span>Видимость</span><label class="check"><input type="checkbox" name="is_public" ${p.is_public ? 'checked' : ''}><span>Показывать на сайте и в кабинете</span></label>
        <label class="check"><input type="checkbox" name="is_active" ${p.is_active ? 'checked' : ''}><span>Можно оплатить (иначе — архив)</span></label></div>`}
      <label class="field"><span>Порядок</span><input class="input" type="number" name="sort" value="${p.sort}"></label>
    </form>`,
    footer: '<button class="btn" data-a="c">Отмена</button><button class="btn btn-pri" data-a="s">Сохранить</button>',
  });
  const f = $('#pf', m.el);
  if (isNew) f.title.oninput = () => { if (!f.code.dataset.t) f.code.value = (f.title.value.toLowerCase().match(/[a-z0-9]+/g) || []).join('_').slice(0, 30); };
  if (isNew) f.code.oninput = () => { f.code.dataset.t = '1'; };
  $('[data-a=c]', m.el).onclick = m.close;
  $('[data-a=s]', m.el).onclick = async (e) => {
    const row = {
      title: f.title.value.trim(), staff_limit: Math.max(1, +f.staff_limit.value || 1), ai: f.ai.checked,
      ai_limit: Math.max(0, +f.ai_limit.value || 0), sort: +f.sort.value || 0,
    };
    if (!trial) Object.assign(row, { price: Math.max(0, +f.price.value || 0), features: f.features.value.trim() || null, is_public: f.is_public.checked, is_active: f.is_active.checked });
    if (row.title.length < 2) return toastErr('Укажите название');
    if (row.ai && !row.ai_limit) return toastErr('Укажите, сколько ответов ИИ в месяц входит в тариф');
    if (!trial && row.is_active && !row.price) return toastErr('Укажите цену');
    await busy(e.target, async () => {
      let r;
      if (isNew) {
        const code = f.code.value.trim().toLowerCase();
        if (!/^[a-z][a-z0-9_]{1,29}$/.test(code)) return toastErr('Код: латинские буквы, цифры и _, начинается с буквы');
        r = await sb.from('plans').insert({ ...row, code });
      } else r = await sb.from('plans').update(row).eq('code', p.code);
      if (r.error) return toastErr(/duplicate/i.test(r.error.message) ? 'Такой код уже есть' : r.error);
      toast('Сохранено'); m.close(); plans();
    });
  };
}

async function settings() {
  const page = $('#page');
  page.innerHTML = '<div class="spinner"></div>';
  const [{ data: s }, { data: tg }] = await Promise.all([sb.from('platform_settings').select('*').eq('id', 1).single(), sb.rpc('admin_tg_info')]);
  page.innerHTML = `<div class="page-h"><h2>Настройки платформы</h2></div>
    <div class="card"><h3>Telegram-бот</h3><div id="tg"></div></div>
    <div class="card"><h3>ИИ-ассистент</h3><div id="ai"></div></div>
    <div class="card"><h3>Оплата и цены</h3><form id="sf" class="form-grid" novalidate>
      <label class="field full"><span>Реквизиты Kaspi для оплаты подписки</span><textarea class="textarea" name="kaspi_details" rows="3" placeholder="Kaspi Gold: +7 707 123 45 67 (Муса Ш.)&#10;или Kaspi Pay — номер для перевода">${esc(s.kaspi_details || '')}</textarea>
        <small>Видно владельцам бизнесов на странице «Подписка»</small></label>
      <label class="field"><span>Контакт поддержки</span><input class="input" name="support_contact" value="${esc(s.support_contact || '')}" placeholder="WhatsApp +7 707 … или @username"></label>
      <label class="field"><span>Адрес сайта</span><input class="input" name="site_url" value="${esc(s.site_url || '')}"></label>
      <div class="field"><span>Цены и лимиты</span><a class="btn btn-sm" href="#plans">Открыть «Тарифы»</a></div>
      <label class="field"><span>Пробный период, дней</span><input class="input" type="number" name="trial_days" min="0" max="90" value="${s.trial_days}"></label>
      <div class="full"><button class="btn btn-pri">Сохранить</button></div></form></div>`;
  const f = $('#sf');
  f.onsubmit = async (e) => {
    e.preventDefault();
    await busy($('button', f), async () => {
      const { error } = await sb.from('platform_settings').update({
        kaspi_details: f.kaspi_details.value.trim() || null, support_contact: f.support_contact.value.trim() || null,
        site_url: f.site_url.value.trim() || null, trial_days: Math.min(90, Math.max(0, +f.trial_days.value || 0)),
      }).eq('id', 1);
      if (error) return toastErr(error);
      toast('Сохранено');
    });
  };
  drawTg(tg);
  drawAi(tg);

  function drawAi(info) {
    const box = $('#ai');
    box.innerHTML = `${info?.ai_key_set ? `<div class="alert alert-ok" style="margin-bottom:12px">✅ Ключ сохранён (${esc(info.ai_key_hint || '')}) · модель <b>${esc(info.ai_model)}</b> <span id="aiPing" class="small"></span></div>` : ''}
      <ol class="small" style="padding-left:18px;margin:0 0 12px">
        <li>Зарегистрируйтесь на <a href="https://console.anthropic.com" target="_blank" rel="noopener">console.anthropic.com</a>, пополните баланс (от $5) в разделе Billing.</li>
        <li>API Keys → Create Key → скопируйте ключ <code>sk-ant-…</code> и вставьте ниже.</li>
        <li>Поставьте лимит расходов в Limits, чтобы не было сюрпризов. Расход по бизнесам видно в «Обзоре».</li></ol>
      <div class="form-grid">
        <label class="field"><span>Ключ Anthropic API</span><input class="input" id="aiKey" type="password" autocomplete="off" placeholder="${info?.ai_key_set ? 'Оставьте пустым, чтобы не менять' : 'sk-ant-…'}"></label>
        <label class="field"><span>Модель</span><input class="input" id="aiModel" value="${esc(info?.ai_model || 'claude-haiku-5-5')}"><small>Haiku — быстрая и недорогая, подходит для ответов клиентам</small></label></div>
      <div class="row"><button class="btn btn-pri" id="aiSave">Сохранить</button>${info?.ai_key_set ? '<button class="btn" id="aiCheck">Проверить связь</button><button class="btn btn-ghost" id="aiDel">Удалить ключ</button>' : ''}</div>`;
    $('#aiSave').onclick = async (e) => {
      await busy(e.target, async () => {
        const { error } = await sb.rpc('admin_set_ai', { p_key: $('#aiKey').value.trim() || null, p_model: $('#aiModel').value.trim() });
        if (error) return toastErr(error);
        toast('Сохранено');
        const { data: t2 } = await sb.rpc('admin_tg_info'); drawAi(t2);
        if (t2?.ai_key_set) $('#aiCheck').click();
      });
    };
    const del = $('#aiDel');
    if (del) del.onclick = async () => {
      if (!(await confirmDlg('Удалить ключ? ИИ-ассистенты всех бизнесов перестанут отвечать, вопросы пойдут владельцам.', 'Удалить', true))) return;
      const { error } = await sb.rpc('admin_set_ai', { p_key: '', p_model: null });
      if (error) return toastErr(error);
      const { data: t2 } = await sb.rpc('admin_tg_info'); drawAi(t2);
    };
    const chk = $('#aiCheck');
    if (chk) chk.onclick = async (e) => {
      await busy(e.target, async () => {
        const { data, error } = await sb.functions.invoke('tg', { body: { action: 'ai_ping' } });
        const el = $('#aiPing');
        if (error) { const msg = await fnErr(error); el.innerHTML = ` · <b style="color:var(--danger)">${esc(msg)}</b>`; return toastErr(msg); }
        el.textContent = ` · связь есть (${data.model})`; toast('ИИ отвечает');
      });
    };
  }

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
