// Демо в первом экране: два телефона (клиент и мастер), сначала проблема, потом решение.
// Все данные выдуманные (демо), в разметке есть пометка «Пример · демо-данные».
(function () {
  var root = document.getElementById('dm');
  if (!root) return;
  var $ = function (id) { return document.getElementById(id); };

  var bar = function (ico, name, sub, bg) {
    return '<span class="dm-av"' + (bg ? ' style="background:' + bg + '"' : '') + '>' + ico + '</span><div><b>' + name + '</b><small>' + sub + '</small></div>';
  };
  var day = function (t) { return '<div class="dm-day">' + t + '</div>'; };
  var msg = function (html, time, me) { return '<div class="dm-msg' + (me ? ' me' : '') + '">' + html + (time ? '<time>' + time + '</time>' : '') + '</div>'; };
  var wait = function (t) { return '<div class="dm-wait">' + t + '</div>'; };
  var paint = function (cb, cs, ob, os) {
    $('dm-cbar').innerHTML = cb; $('dm-cscene').innerHTML = cs;
    $('dm-obar').innerHTML = ob; $('dm-oscene').innerHTML = os;
  };

  // ----- A: как сейчас (WhatsApp) -----
  var WA_C = bar('💈', 'Барбершоп «Сарбаз»', 'WhatsApp', '#059669');
  var WA_O = bar('Е', 'Ерлан', 'WhatsApp', '#64748b');
  var CHAT = [['c', 'Здравствуйте! Завтра свободно?'], ['c', 'Во сколько можно?'], ['c', 'А сколько стоит?'],
              ['c', 'На 15:00 можно?'], ['o', 'Да, 15:00 свободно, 6 000 ₸'], ['c', 'Ок, запишите меня']];
  var chat = function (who, n) {
    return CHAT.slice(0, n).map(function (m) { return msg(m[1], '', m[0] === who); }).join('');
  };
  var night = function (who, n) { return day('23:40') + chat(who, n); };
  var missed = '<div class="dm-bad"><div style="font-size:24px">😴</div><b>Клиент забыл про запись</b><small>Ни звонка, ни сообщения</small></div>';
  var loss = '<div class="dm-bad"><small>15:20 · клиента нет</small><strong>−6 000 ₸</strong><small>Окно пустует. Мастер без работы</small></div>';

  // ----- B: с Jazylam -----
  var CB_WEB = bar('🌐', 'jazylam.kz', 'страница записи', '#334155');
  var CB_BOT = bar('J', 'Jazylam', 'бот');
  var OB_BOT = bar('J', 'Jazylam', 'бот · для мастера');
  // state: 0 пусто, 1 тап по времени, 2 тап по кнопке, 3 записан
  var booking = function (s) {
    return '<div class="dm-card"><small>Услуга</small><b>Мужская стрижка</b><small style="margin-top:2px">60 мин · 6 000 ₸</small></div>' +
      '<div class="dm-card"><small>Завтра</small><div class="dm-slots"><span>13:30</span>' +
      '<span class="' + (s >= 1 ? 'sel ' : '') + (s === 1 ? 'dm-tap' : '') + '">15:00</span><span>16:30</span></div></div>' +
      '<div class="dm-card"><small>Имя</small>Ерлан</div>' +
      '<div class="dm-go' + (s >= 3 ? ' ok' : '') + (s === 2 ? ' dm-tap' : '') + '">' + (s >= 3 ? '✓ Вы записаны' : 'Записаться') + '</div>';
  };
  var remind = msg('<b>⏰ Напоминаем о записи</b><br>Барбершоп «Сарбаз»<br>Мужская стрижка<br>завтра, 15:00 · Айдос', '15:00');
  var newBooking = msg('<b>🆕 Новая онлайн-запись</b><br>Ерлан · Мужская стрижка<br>Завтра, 15:00', '13:52');
  var confirmed = msg('<b>✅ Клиент подтвердил запись</b><br>Ерлан · Мужская стрижка<br>Завтра, 15:00', '15:01');
  var btns = function (pressed) {
    return '<div class="dm-btns"><span class="' + (pressed ? 'sel dm-tap' : '') + '">✅ Приду</span><span>✖ Отменить</span></div>';
  };
  var answered = day('Завтра') + remind + msg('✅ Приду', '', true) + msg('Спасибо! Ждём вас 🙌');
  var done = '<div class="dm-good"><div style="font-size:24px">🎉</div><b>Клиент придёт</b><small>Ни одной переписки. Окно занято</small></div>';
  var quiet = wait('Тишина. Вы отдыхаете');

  // active: 'c' клиент, 'o' мастер
  var STEPS = [
    { ph: 'A', act: 'o', ms: 5200, cap: 'Ночью вы переписываетесь, вместо того чтобы отдыхать', fr: [
      [0, function () { paint(WA_C, night('c', 1), WA_O, night('o', 1)); }],
      [900, function () { paint(WA_C, night('c', 2), WA_O, night('o', 2)); }],
      [1800, function () { paint(WA_C, night('c', 3), WA_O, night('o', 3)); }],
      [2700, function () { paint(WA_C, night('c', 4), WA_O, night('o', 4)); }]] },
    { ph: 'A', act: 'o', ms: 4200, cap: '6 сообщений ради одной записи. И так с каждым клиентом', fr: [
      [0, function () { paint(WA_C, night('c', 5), WA_O, night('o', 5)); }],
      [1300, function () { paint(WA_C, night('c', 6), WA_O, night('o', 6)); }]] },
    { ph: 'A', act: 'c', ms: 5200, cap: 'Наступил день записи. Клиент забыл, никто не напомнил', fr: [
      [0, function () { paint(WA_C, day('Завтра, 15:00') + missed, WA_O, day('Завтра, 15:20') + loss); }]] },
    { ph: 'B', act: 'c', ms: 5200, cap: 'Клиент сам записывается по ссылке. Вы не переписываетесь', fr: [
      [0, function () { paint(CB_WEB, booking(0), OB_BOT, quiet); }],
      [1000, function () { paint(CB_WEB, booking(1), OB_BOT, quiet); }],
      [2300, function () { paint(CB_WEB, booking(2), OB_BOT, quiet); }],
      [3500, function () { paint(CB_WEB, booking(3), OB_BOT, quiet); }]] },
    { ph: 'B', act: 'o', ms: 3800, cap: 'Мастеру сразу приходит уведомление в Telegram', fr: [
      [0, function () { paint(CB_WEB, booking(3), OB_BOT, day('Сегодня') + newBooking); }]] },
    { ph: 'B', act: 'c', ms: 6200, cap: 'За сутки клиенту приходит напоминание. Он нажимает «Приду»', fr: [
      [0, function () { paint(CB_BOT, day('Завтра') + remind + btns(false), OB_BOT, day('Сегодня') + newBooking); }],
      [2200, function () { paint(CB_BOT, day('Завтра') + remind + btns(true), OB_BOT, day('Сегодня') + newBooking); }],
      [2900, function () { paint(CB_BOT, answered, OB_BOT, day('Сегодня') + newBooking); }]] },
    { ph: 'B', act: 'o', ms: 5200, cap: 'Мастер видит: клиент придёт. Без неявок и без переписок', fr: [
      [0, function () { paint(CB_BOT, answered, OB_BOT, day('Сегодня') + newBooking + confirmed); }],
      [1200, function () { paint(CB_BOT, answered, OB_BOT, day('Сегодня') + newBooking + confirmed + done); }]] },
  ];

  var timers = [];
  function show(i) {
    timers.forEach(clearTimeout); timers = [];
    var st = STEPS[i], cap = $('dm-cap');
    cap.textContent = st.cap;
    cap.className = 'dm-cap' + (st.ph === 'A' ? ' a' : '');
    $('dm-tab-a').className = st.ph === 'A' ? 'on-a' : '';
    $('dm-tab-b').className = st.ph === 'B' ? 'on-b' : '';
    $('dm-pc').className = 'dm-ph ' + (st.act === 'c' ? 'act' : 'dim');
    $('dm-po').className = 'dm-ph ' + (st.act === 'o' ? 'act' : 'dim');
    st.fr.forEach(function (f) { timers.push(setTimeout(f[1], f[0])); });
    timers.push(setTimeout(function () { show((i + 1) % STEPS.length); }, st.ms));
  }
  $('dm-tab-a').onclick = function () { show(0); };
  $('dm-tab-b').onclick = function () { show(3); };

  // Не крутим анимацию, пока блок не на экране (экономим батарею на телефоне)
  var started = false;
  function start() { if (!started) { started = true; show(0); } }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (e) { if (e[0].isIntersecting) start(); }).observe(root);
  } else start();
})();
