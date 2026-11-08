import {
  sb, $, $$, esc, money, durText, toastErr, phoneMask, normPhone, fmtPhone, todayInTz, addDays,
  isoWeekday, WD_SHORT, MONTHS_SHORT, humanDate, timeStrInTz, minutesInTz, pageUrl, store, telLink, brandify, prepayAmount,
} from './lib.js';

const slug = new URLSearchParams(location.search).get('b') || '';
const app = $('#app');
const S = { biz: null, service: null, staffId: null, staffChosen: false, day: null, slot: null, freeDays: null };

brandify();
init();

async function init() {
  if (!slug) return fatal('Ссылка на запись неполная', 'Попросите у бизнеса актуальную ссылку.');
  const { data, error } = await sb.rpc('get_public_business', { p_slug: slug });
  if (error) return fatal('Не удалось загрузить страницу', 'Проверьте интернет и обновите страницу.');
  if (!data) return fatal('Страница не найдена', 'Возможно, ссылка изменилась. Уточните её у бизнеса.');
  S.biz = data;
  document.title = `Запись — ${data.name}`;
  renderHead();
  if (!data.active) {
    app.innerHTML = `<div class="empty"><div class="ico">⏸</div><h3>Онлайн-запись временно недоступна</h3>
      ${data.phone ? `<p>Запишитесь по телефону: <a href="${telLink(data.phone)}">${esc(data.phone)}</a></p>` : ''}</div>`;
    return;
  }
  if (!data.services.length) {
    app.innerHTML = `<div class="empty"><div class="ico">🗓</div><h3>Скоро здесь появится запись</h3><p>Бизнес ещё добавляет услуги.</p></div>`;
    return;
  }
  stepService();
}

function fatal(title, text) {
  $('#head').innerHTML = `<h1>Онлайн-запись</h1>`;
  app.innerHTML = `<div class="empty"><div class="ico">🔍</div><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`;
}

function renderHead() {
  const b = S.biz;
  $('#head').innerHTML = `
    ${b.is_demo ? '<div class="chip" style="background:rgba(255,255,255,.15);border-color:rgba(255,255,255,.3);color:#fff;margin-bottom:10px">Демо-режим</div>' : ''}
    <h1>${esc(b.name)}</h1>
    <div class="meta">${[b.category, b.address].filter(Boolean).map(esc).join(' · ')}
      ${b.phone ? ` · <a class="nowrap" href="${telLink(b.phone)}">${esc(b.phone)}</a>` : ''}</div>
    ${b.description ? `<p class="meta" style="margin:8px 0 0">${esc(b.description)}</p>` : ''}
    ${b.chat && b.bot_username ? `<a class="btn btn-sm" style="margin-top:12px;background:rgba(255,255,255,.95);color:#0f172a" target="_blank" rel="noopener" href="https://t.me/${esc(b.bot_username)}?start=s_${esc(b.slug)}">💬 ${b.ai ? 'Задать вопрос ассистенту' : 'Задать вопрос'} в Telegram</a>` : ''}`;
}

function bar(n) {
  return `<div class="steps-bar">${[1, 2, 3, 4].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</div>`;
}

function summary() {
  const parts = [];
  if (S.service) parts.push(`<span class="chip">📋 ${esc(S.service.name)}</span>`);
  if (S.staffChosen) {
    const st = S.biz.staff.find((x) => x.id === S.staffId);
    parts.push(`<span class="chip">👤 ${st ? esc(st.name) : 'Любой мастер'}</span>`);
  }
  if (S.slot) parts.push(`<span class="chip">📅 ${humanDate(S.day)}, ${timeStrInTz(S.slot.t, S.biz.timezone)}</span>`);
  return parts.length ? `<div class="summary">${parts.join('')}</div>` : '';
}

function eligibleStaff() {
  const ids = S.service.staff_ids || [];
  return ids.length ? S.biz.staff.filter((s) => ids.includes(s.id)) : S.biz.staff;
}

// Шаг 1 — услуга
function stepService() {
  S.service = null; S.staffChosen = false; S.slot = null;
  const pp = S.biz.prepay_enabled
    ? `<div class="alert alert-info" style="margin-bottom:12px">💳 Запись по предоплате ${S.biz.prepay_percent}% от стоимости услуги</div>` : '';
  app.innerHTML = `${bar(1)}<h2>Выберите услугу</h2>${pp}<div id="list"></div>`;
  const list = $('#list');
  for (const s of S.biz.services) {
    const btn = document.createElement('button');
    btn.className = 'opt';
    btn.innerHTML = `<div class="grow"><b>${esc(s.name)}</b>
      <span class="muted small">${durText(s.duration_min)}${s.description ? ' · ' + esc(s.description) : ''}</span></div>
      ${s.price != null ? `<div class="price">${money(s.price)}</div>` : ''}<span class="muted">›</span>`;
    btn.onclick = () => { S.service = s; stepStaff(); };
    list.append(btn);
  }
}

// Шаг 2 — мастер
function stepStaff() {
  const staff = eligibleStaff();
  if (staff.length === 0) {
    app.innerHTML = `${bar(2)}<div class="empty"><h3>Сейчас нет свободных мастеров для этой услуги</h3>
      <button class="btn" id="back">← Другая услуга</button></div>`;
    $('#back').onclick = stepService;
    return;
  }
  if (staff.length === 1) { S.staffId = staff[0].id; S.staffChosen = false; return stepTime(); }
  app.innerHTML = `${bar(2)}${summary()}<h2>Выберите мастера</h2><div id="list"></div>
    <div class="row" style="margin-top:14px"><button class="btn btn-ghost" id="back">← Назад</button></div>`;
  const list = $('#list');
  const add = (id, name, title) => {
    const btn = document.createElement('button');
    btn.className = 'opt';
    btn.innerHTML = `<span class="avatar">${id ? esc(name[0].toUpperCase()) : '✦'}</span>
      <div class="grow"><b>${esc(name)}</b>${title ? `<span class="muted small">${esc(title)}</span>` : ''}</div><span class="muted">›</span>`;
    btn.onclick = () => { S.staffId = id; S.staffChosen = true; stepTime(); };
    list.append(btn);
  };
  add(null, 'Любой мастер', 'Покажем всё свободное время');
  for (const s of staff) add(s.id, s.name, s.title);
  $('#back').onclick = stepService;
}

// Шаг 3 — дата и время
async function stepTime() {
  S.slot = null;
  const tz = S.biz.timezone;
  const today = todayInTz(tz);
  const days = Math.min(S.biz.max_days_ahead + 1, 45);
  app.innerHTML = `${bar(3)}${summary()}<h2>Дата и время</h2>
    <div class="days" id="days"></div><div id="slots"><div class="spinner"></div></div>
    <div class="row" style="margin-top:14px"><button class="btn btn-ghost" id="back">← Назад</button></div>`;
  $('#back').onclick = () => (eligibleStaff().length > 1 ? stepStaff() : stepService());

  const { data: free, error } = await sb.rpc('get_free_days', {
    p_slug: slug, p_service: S.service.id, p_staff: S.staffId, p_from: today, p_days: days,
  });
  if (error) { toastErr(error); return; }
  const freeSet = new Set(free || []);
  const daysEl = $('#days');
  if (!daysEl) return;
  for (let i = 0; i < days; i++) {
    const d = addDays(today, i);
    const [, m, dd] = d.split('-').map(Number);
    const btn = document.createElement('button');
    btn.className = 'day';
    btn.dataset.d = d;
    btn.disabled = !freeSet.has(d);
    btn.innerHTML = `<div class="dw">${i === 0 ? 'сег' : i === 1 ? 'завт' : WD_SHORT[isoWeekday(d)]}</div><div class="dn">${dd}</div><div class="dm">${MONTHS_SHORT[m - 1]}</div>`;
    btn.onclick = () => pickDay(d);
    daysEl.append(btn);
  }
  const first = (free || [])[0];
  if (!first) {
    $('#slots').innerHTML = `<div class="empty"><h3>Свободного времени нет</h3><p>Попробуйте другого мастера или позвоните нам${S.biz.phone ? `: <a href="${telLink(S.biz.phone)}">${esc(S.biz.phone)}</a>` : ''}.</p></div>`;
    return;
  }
  pickDay(S.day && freeSet.has(S.day) ? S.day : first);
}

async function pickDay(d) {
  S.day = d;
  $$('.day').forEach((b) => b.classList.toggle('sel', b.dataset.d === d));
  const sel = $(`.day[data-d="${d}"]`);
  if (sel) sel.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  const box = $('#slots');
  box.innerHTML = '<div class="spinner"></div>';
  const { data, error } = await sb.rpc('get_slots', { p_slug: slug, p_service: S.service.id, p_staff: S.staffId, p_date: d });
  if (S.day !== d) return;
  if (error) { box.innerHTML = ''; toastErr(error); return; }
  if (!data.length) { box.innerHTML = '<div class="empty">На этот день всё занято</div>'; return; }
  const tz = S.biz.timezone;
  const groups = [['Утро', 0, 720], ['День', 720, 1020], ['Вечер', 1020, 1440]];
  box.innerHTML = '';
  for (const [name, a, z] of groups) {
    const items = data.filter((s) => { const m = minutesInTz(s.t, tz); return m >= a && m < z; });
    if (!items.length) continue;
    const g = document.createElement('div');
    g.innerHTML = `<div class="slot-group">${name}</div><div class="slots"></div>`;
    for (const s of items) {
      const b = document.createElement('button');
      b.className = 'slot';
      b.textContent = timeStrInTz(s.t, tz);
      b.onclick = () => { S.slot = s; stepForm(); };
      $('.slots', g).append(b);
    }
    box.append(g);
  }
}

// Стоимость: без предоплаты — как раньше; с предоплатой — сумма заранее и остаток
function priceRows() {
  const price = S.service.price;
  if (!S.biz.prepay_enabled) {
    return price != null ? `<div class="row between"><span class="muted">К оплате на месте</span><b>${money(price)}</b></div>` : '';
  }
  const pct = S.biz.prepay_percent;
  if (price == null) {
    return `<div class="alert alert-warn">💳 Нужна предоплата ${pct}% от стоимости услуги. Куда перевести — покажем после записи.</div>`;
  }
  const pre = prepayAmount(price, pct);
  return `<div class="alert alert-warn stack" style="gap:6px">
      <div class="row between"><span>💳 Предоплата ${pct}%</span><b>${money(pre)}</b></div>
      ${pre < price ? `<div class="row between"><span class="muted">Остаток на месте</span><b>${money(price - pre)}</b></div>` : ''}
      <span class="small">Куда перевести — покажем сразу после записи.</span></div>`;
}

// Шаг 4 — контакты
function stepForm() {
  const saved = store.get('kezek_client', {});
  app.innerHTML = `${bar(4)}${summary()}<h2>Ваши контакты</h2>
    <form id="f" class="stack" novalidate>
      <label class="field"><span>Имя</span><input class="input" name="name" autocomplete="name" required maxlength="80" value="${esc(saved.name || '')}"></label>
      <label class="field"><span>Телефон</span><input class="input" name="phone" type="tel" inputmode="tel" autocomplete="tel" required placeholder="+7 (___) ___-__-__"></label>
      <label class="field"><span>Комментарий <span class="muted">(необязательно)</span></span><textarea class="textarea" name="comment" maxlength="500" rows="2"></textarea></label>
      <label class="check small"><input type="checkbox" name="agree" checked> <span>Согласен(на) на обработку персональных данных согласно <a href="terms.html#privacy" target="_blank">политике конфиденциальности</a></span></label>
      ${priceRows()}
      <button class="btn btn-pri btn-lg btn-block" type="submit">Записаться</button>
      <button class="btn btn-ghost btn-block" type="button" id="back">← Изменить время</button>
    </form>`;
  const f = $('#f');
  if (saved.phone) f.phone.value = fmtPhone(saved.phone);
  phoneMask(f.phone);
  $('#back').onclick = stepTime;
  f.onsubmit = async (e) => {
    e.preventDefault();
    const name = f.name.value.trim();
    const phone = normPhone(f.phone.value);
    if (name.length < 2) { f.name.focus(); return toastErr('Укажите имя'); }
    if (!phone) { f.phone.focus(); return toastErr('Укажите номер телефона полностью'); }
    if (!f.agree.checked) return toastErr('Нужно согласие на обработку данных');
    const btn = $('button[type=submit]', f);
    btn.disabled = true; btn.textContent = 'Записываем…';
    const { data, error } = await sb.rpc('create_booking', {
      p_slug: slug, p_service: S.service.id, p_staff: S.slot.staff_id, p_starts: S.slot.t,
      p_name: name, p_phone: phone, p_comment: f.comment.value.trim() || null,
    });
    if (error) {
      btn.disabled = false; btn.textContent = 'Записаться';
      toastErr(error);
      if (/занят/i.test(error.message)) setTimeout(stepTime, 1200);
      return;
    }
    store.set('kezek_client', { name, phone });
    const mine = store.get('kezek_bookings', []);
    mine.unshift({ t: data.token, at: S.slot.t, biz: S.biz.name });
    store.set('kezek_bookings', mine.slice(0, 20));
    location.href = pageUrl('my.html', { t: data.token, new: 1 });
  };
}
