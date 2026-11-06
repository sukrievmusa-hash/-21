// Экран входа/регистрации — общий для кабинета и админки
import { sb, $, $$, esc, toast, toastErr, BRAND } from './lib.js';

export function renderAuth(root, { mode = 'login', onDone, allowSignup = true, title } = {}) {
  root.innerHTML = `<div class="auth-wrap"><div class="auth-card">
    <div class="center" style="margin-bottom:18px"><a class="logo" href="index.html"><i>K</i><span>${esc(BRAND)}</span></a></div>
    <div class="card">
      ${allowSignup ? '<div class="seg"><button type="button" data-m="login">Вход</button><button type="button" data-m="signup">Регистрация</button></div>' : ''}
      <form id="af" class="stack" novalidate>
        <div><h2 id="at" style="margin-bottom:4px"></h2><p class="muted small" id="as" style="margin:0"></p></div>
        <label class="field"><span>Email</span><input class="input" name="email" type="email" autocomplete="email" required></label>
        <label class="field" id="pwf"><span>Пароль</span><input class="input" name="password" type="password" minlength="6" required></label>
        <label class="check small" id="agf"><input type="checkbox" name="agree" checked><span>Принимаю <a href="terms.html" target="_blank">условия оферты</a> и <a href="terms.html#privacy" target="_blank">политику конфиденциальности</a></span></label>
        <button class="btn btn-pri btn-block btn-lg" type="submit" id="ab"></button>
        <button class="btn btn-ghost btn-block" type="button" id="alt"></button>
      </form>
      <div id="sent" class="hide center stack">
        <div class="ok-ico">🔑</div><h3 id="sentTitle">Проверьте почту</h3>
        <p class="muted" id="sentText"></p>
        <a class="btn btn-pri btn-block hide" id="supportLink" target="_blank" rel="noopener">Написать в поддержку</a>
        <button class="btn btn-block" type="button" id="backLogin">Вернуться ко входу</button>
      </div>
    </div></div></div>`;

  const f = $('#af', root);
  const setMode = (m) => {
    mode = m;
    $$('[data-m]', root).forEach((b) => b.classList.toggle('on', b.dataset.m === m));
    $('#agf', root).classList.toggle('hide', m !== 'signup');
    f.password.autocomplete = m === 'signup' ? 'new-password' : 'current-password';
    const T = {
      login: [title || 'Вход в кабинет', 'Введите email и пароль', 'Войти', 'Забыли пароль?'],
      signup: ['Регистрация', 'Бесплатный пробный период, без карты', 'Создать аккаунт', 'Уже есть аккаунт? Войти'],
    }[m];
    $('#at', root).textContent = T[0];
    $('#as', root).textContent = T[1];
    $('#ab', root).textContent = T[2];
    $('#alt', root).textContent = T[3];
  };
  $$('[data-m]', root).forEach((b) => (b.onclick = () => setMode(b.dataset.m)));
  $('#alt', root).onclick = async () => {
    if (mode !== 'login') return setMode('login');
    const { data } = await sb.from('platform_settings').select('support_contact').eq('id', 1).maybeSingle();
    const c = (data && data.support_contact) || '';
    const tg = c.match(/@([A-Za-z0-9_]{4,})/);
    const ph = c.replace(/\D/g, '');
    const link = tg ? `https://t.me/${tg[1]}` : ph.length >= 10 ? `https://wa.me/${ph}?text=${encodeURIComponent('Здравствуйте! Забыл(а) пароль от кабинета, мой email: ' + (f.email.value || ''))}` : '';
    sent(c ? `Напишите в поддержку: ${c}. Укажите email аккаунта — пришлём новый пароль.` : 'Напишите в поддержку — пришлём новый пароль.');
    $('#sentTitle', root).textContent = 'Восстановление пароля';
    if (link) { const a = $('#supportLink', root); a.href = link; a.classList.remove('hide'); }
  };
  $('#backLogin', root).onclick = () => { $('#sent', root).classList.add('hide'); $('.seg', root)?.classList.remove('hide'); f.classList.remove('hide'); setMode('login'); };
  setMode(mode === 'signup' && allowSignup ? 'signup' : 'login');

  const sent = (text) => {
    f.classList.add('hide');
    $('.seg', root)?.classList.add('hide');
    $('#sent', root).classList.remove('hide');
    $('#sentText', root).textContent = text;
  };

  f.onsubmit = async (e) => {
    e.preventDefault();
    const email = f.email.value.trim().toLowerCase();
    const password = f.password.value;
    if (!/^\S+@\S+\.\S+$/.test(email)) return toastErr('Проверьте email');
    if (password.length < 6) return toastErr('Пароль — минимум 6 символов');
    if (mode === 'signup' && !f.agree.checked) return toastErr('Нужно принять условия');
    const btn = $('#ab', root);
    btn.disabled = true;
    try {
            if (mode === 'login') {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onDone && onDone();
      } else if (mode === 'signup') {
        // Регистрация через edge-функцию: аккаунт создаётся сразу подтверждённым, без письма
        const { error } = await sb.functions.invoke('account', { body: { action: 'signup', email, password } });
        if (error) {
          let msg = error.message;
          try { msg = (await error.context.json()).error || msg; } catch { /* без тела */ }
          throw new Error(msg);
        }
        const { error: e2 } = await sb.auth.signInWithPassword({ email, password });
        if (e2) throw e2;
        onDone && onDone();
      }
    } catch (err) {
      toastErr(err);
    } finally {
      btn.disabled = false;
    }
  };
}

export function renderNewPassword(root, onDone) {
  root.innerHTML = `<div class="auth-wrap"><div class="auth-card"><div class="card">
    <form id="pf" class="stack"><h2>Новый пароль</h2>
      <label class="field"><span>Пароль (минимум 6 символов)</span><input class="input" name="p" type="password" autocomplete="new-password" minlength="6" required></label>
      <button class="btn btn-pri btn-block btn-lg">Сохранить пароль</button></form></div></div></div>`;
  $('#pf', root).onsubmit = async (e) => {
    e.preventDefault();
    const p = e.target.p.value;
    if (p.length < 6) return toastErr('Минимум 6 символов');
    const { error } = await sb.auth.updateUser({ password: p });
    if (error) return toastErr(error);
    toast('Пароль изменён');
    history.replaceState(null, '', location.pathname);
    onDone && onDone();
  };
}
