import { sb, $, esc, money, toast, toastErr, confirmDlg, humanDate, dateStrInTz, timeStrInTz, telLink, pageUrl, brandify } from './lib.js';

const params = new URLSearchParams(location.search);
const token = params.get('t') || '';
const isNew = params.get('new') === '1';
const app = $('#app');
let B = null;

brandify();
load();

async function load() {
  if (!token) return notFound();
  const { data, error } = await sb.rpc('get_booking', { p_token: token });
  if (error) { app.innerHTML = '<div class="empty">Не удалось загрузить запись. Обновите страницу.</div>'; return; }
  if (!data) return notFound();
  B = data;
  render();
}

function notFound() {
  app.innerHTML = '<div class="empty"><div class="ico">🔍</div><h3>Запись не найдена</h3><p>Проверьте ссылку или свяжитесь с бизнесом.</p></div>';
}

const icsDate = (ts) => new Date(ts).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

function render() {
  const z = B.business, tz = z.timezone;
  const day = dateStrInTz(B.starts_at, tz);
  const time = timeStrInTz(B.starts_at, tz);
  document.title = `Запись — ${z.name}`;
  $('#head').innerHTML = `<h1>${esc(z.name)}</h1><div class="meta">${[z.address].filter(Boolean).map(esc).join(' · ')}
    ${z.phone ? ` · <a class="nowrap" href="${telLink(z.phone)}">${esc(z.phone)}</a>` : ''}</div>`;

  const cancelled = B.status === 'cancelled';
  const past = new Date(B.starts_at) < new Date();
  const head = cancelled
    ? `<div class="ok-ico" style="background:#f1f5f9;color:#64748b">✕</div><h2 class="center">Запись отменена</h2>`
    : isNew
      ? `<div class="ok-ico">✓</div><h2 class="center">Вы записаны!</h2><p class="center muted">Сохраните эту страницу — по ней можно посмотреть или отменить запись.</p>`
      : `<h2 class="center">${past ? 'Прошедшая запись' : 'Ваша запись'}</h2>`;

  const tgBlock = !cancelled && !past && B.bot_username
    ? (B.tg
      ? `<div class="alert alert-ok">🔔 Напоминание в Telegram включено</div>`
      : `<div class="alert alert-info stack"><div><b>Не забудьте о визите</b><br>Пришлём напоминание за день и за 2 часа — в Telegram, бесплатно.</div>
         <a class="btn btn-tg btn-block" target="_blank" rel="noopener" href="https://t.me/${esc(B.bot_username)}?start=b_${esc(B.token)}">🔔 Напомнить в Telegram</a></div>`)
    : '';

  app.innerHTML = `${head}
    <dl class="kv" style="margin:18px 0">
      <dt>Когда</dt><dd>${humanDate(day)}, ${time}</dd>
      ${B.service_name ? `<dt>Услуга</dt><dd>${esc(B.service_name)}</dd>` : ''}
      ${B.staff_name ? `<dt>Мастер</dt><dd>${esc(B.staff_name)}</dd>` : ''}
      ${B.price != null ? `<dt>Стоимость</dt><dd>${money(B.price)}</dd>` : ''}
      ${z.address ? `<dt>Адрес</dt><dd>${esc(z.address)}</dd>` : ''}
      <dt>На имя</dt><dd>${esc(B.client_name)}</dd>
    </dl>
    <div class="stack">
      ${tgBlock}
      ${!cancelled && !past ? `<div class="grid grid-2">
        <button class="btn" id="ics">📅 В календарь</button>
        <a class="btn" target="_blank" rel="noopener" id="gcal">Google Календарь</a></div>` : ''}
      ${z.address ? `<a class="btn btn-block" target="_blank" rel="noopener" href="https://2gis.kz/search/${encodeURIComponent(z.address)}">📍 Как добраться (2GIS)</a>` : ''}
      ${B.can_cancel ? `<button class="btn btn-danger btn-block" id="cancel">Отменить запись</button>` : ''}
      <a class="btn btn-ghost btn-block" href="${pageUrl('book.html', { b: z.slug })}">Записаться ещё</a>
    </div>`;

  const ics = $('#ics');
  if (ics) {
    const title = `${B.service_name || 'Запись'} — ${z.name}`;
    const g = new URL('https://calendar.google.com/calendar/render');
    g.searchParams.set('action', 'TEMPLATE');
    g.searchParams.set('text', title);
    g.searchParams.set('dates', `${icsDate(B.starts_at)}/${icsDate(B.ends_at)}`);
    if (z.address) g.searchParams.set('location', z.address);
    g.searchParams.set('details', location.href.replace(/[?&]new=1/, ''));
    $('#gcal').href = g.toString();
    ics.onclick = () => {
      const esc2 = (s) => String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
      const body = [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kezek//Booking//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
        'BEGIN:VEVENT', `UID:${B.token}@kezek`, `DTSTAMP:${icsDate(Date.now())}`,
        `DTSTART:${icsDate(B.starts_at)}`, `DTEND:${icsDate(B.ends_at)}`,
        `SUMMARY:${esc2(title)}`, z.address ? `LOCATION:${esc2(z.address)}` : '',
        `DESCRIPTION:${esc2(location.href.replace(/[?&]new=1/, ''))}`,
        'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', `DESCRIPTION:${esc2(title)}`, 'END:VALARM',
        'END:VEVENT', 'END:VCALENDAR',
      ].filter(Boolean).join('\r\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([body], { type: 'text/calendar;charset=utf-8' }));
      a.download = 'zapis.ics';
      document.body.append(a); a.click(); a.remove();
    };
  }
  const c = $('#cancel');
  if (c) c.onclick = async () => {
    if (!(await confirmDlg('Отменить запись? Время освободится для других клиентов.', 'Отменить запись', true))) return;
    const { error } = await sb.rpc('cancel_booking', { p_token: token });
    if (error) return toastErr(error);
    toast('Запись отменена');
    load();
  };
}
