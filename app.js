import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/* Настройки лежат в config.json и грузятся мимо кеша: иначе браузер
   надолго запоминает файл, скачанный до того, как его заполнили. */
let SUPABASE_URL = '', SUPABASE_ANON = '', BOT = '';
let CHAT = 'https://t.me/Members_6x6', SUPPORT = '';

async function loadConfig() {
  let c;
  try {
    const r = await fetch('config.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error(String(r.status));
    c = await r.json();
  } catch (e) {
    throw new Error('Не удалось прочитать config.json рядом с приложением (' + e.message + ')');
  }
  const clean = (v) => String(v ?? '').trim();
  SUPABASE_URL  = clean(c.SUPABASE_URL).replace(/\/+$/, '');
  SUPABASE_ANON = clean(c.SUPABASE_ANON);
  BOT           = clean(c.BOT).replace(/^@/, '');
  CHAT          = clean(c.CHAT) || CHAT;
  SUPPORT       = clean(c.SUPPORT).replace(/^@/, '');

  /* Значение заголовка обязано быть латиницей: незаполненная настройка
     кириллицей роняет fetch невнятной ошибкой про ISO-8859-1. */
  const latin = (v) => /^[\x20-\x7E]*$/.test(v);
  const bad = [];
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(SUPABASE_URL)) bad.push('SUPABASE_URL');
  if (!SUPABASE_ANON || !latin(SUPABASE_ANON)) bad.push('SUPABASE_ANON');
  if (!/^[A-Za-z0-9_]{3,64}$/.test(BOT)) bad.push('BOT');
  if (bad.length) {
    throw new Error('В файле config.json не заполнено: ' + bad.join(', ') +
      '. Впишите значения из Supabase → Settings → API и от BotFather.');
  }
}

const tg = window.Telegram?.WebApp;
/* expand() и запрет свайпов придуманы для телефонов: на компьютере expand()
   раздувает окно Telegram Desktop так, что его нельзя ни свернуть, ни сдвинуть. */
const MOBILE = ['android', 'android_x', 'ios'].includes(tg?.platform ?? '');
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const ICONS = ['🌴', '❤️', '🏠', '⚖️', '💰', '🧭'];
const SPHERES = ['Климат', 'Отношения', 'Быт', 'Общество', 'Деньги', 'Мировоззрение'];
const QUESTIONS = [
  'Где вы хотите жить?',
  'Какая модель отношений вам ближе?',
  'Какой уклад жизни вам подходит?',
  'Какие общественные порядки вам по душе?',
  'Как вы хотите зарабатывать?',
  'Во что вы верите?',
];
const GAINS = [
  'Хотите жить в одном климате',
  'Одинаково понимаете, что такое «вместе»',
  'Совпал уклад — быт не станет полем боя',
  'Общие взгляды — легко дружить и спорить',
  'Можете делать общее дело',
  'Общая картина мира',
];

let sb = null;
const S = { me: null, opts: null, summary: null, answers: [], admin: false, invite: null };
let qi = 0, draft = [], editing = false;

/* ── мелочи ── */
const toast = (t, ms = 2600) => {
  const el = $('#toast'); el.textContent = t; el.classList.add('on');
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('on'), ms);
};
const haptic = (k) => { try { k === 'ok'
  ? tg.HapticFeedback.notificationOccurred('success')
  : tg.HapticFeedback.impactOccurred('light'); } catch { /* не критично */ } };

/* Оверлеи закрываются системной кнопкой Telegram и аппаратной «назад». */
const overlays = [];
function pushOverlay(close) {
  overlays.push(close);
  try { tg.BackButton.show(); } catch { /* старый клиент — остаётся кнопка в углу */ }
}
function popOverlay() {
  const close = overlays.pop();
  if (close) close();
  if (!overlays.length) { try { tg.BackButton.hide(); } catch { /* см. выше */ } }
}
try { tg.BackButton.onClick(popOverlay); } catch { /* старый клиент */ }

function pane(id) {
  $$('.pane').forEach((p) => p.classList.remove('on'));
  $(id).classList.add('on');
  window.scrollTo(0, 0);
}

/** Розетка: шестиугольник из шести сегментов, по одному на сферу. */
function rosette(hits, size = 64, opts = {}) {
  const c = size / 2, r = size / 2 - 1, gap = 0.06;
  let out = `<svg viewBox="0 0 ${size} ${size}" width="100%" height="100%" class="ros${
    opts.jack ? ' jack' : ''}${opts.seq ? ' seq' : ''}">`;
  for (let k = 0; k < 6; k++) {
    const p = [[c, c]];
    for (const t of [k, k + 1]) {
      const a = (-90 + 60 * t) * Math.PI / 180;
      p.push([c + r * Math.cos(a), c + r * Math.sin(a)]);
    }
    const gx = (p[0][0] + p[1][0] + p[2][0]) / 3, gy = (p[0][1] + p[1][1] + p[2][1]) / 3;
    const pts = p.map(([x, y]) => `${gx + (x - gx) * (1 - gap)},${gy + (y - gy) * (1 - gap)}`);
    out += `<polygon points="${pts.join(' ')}" class="${hits[k] ? 'on' : ''}" style="--i:${k}"/>`;
  }
  return out + '</svg>';
}

const label = (axis, val) =>
  S.opts.find((o) => o.axis === axis && o.val === val)?.label ?? '—';

/* ── обращения к базе ── */
async function rpc(fn, args) {
  const { data, error } = await sb.rpc(fn, args ?? {});
  if (error) throw new Error(error.message);
  return data;
}

/* ── опрос ── */
function renderQuestion() {
  const ax = qi + 1;
  const opts = S.opts.filter((o) => o.axis === ax).sort((a, b) => a.val - b.val);
  $('#q-step').textContent = `Вопрос ${ax} из 6`;
  $('#q-fill').style.width = `${ax / 6 * 100}%`;
  $('#q-title').textContent = QUESTIONS[qi];
  $('#q-opts').innerHTML = opts.map((o) => `
    <button class="opt${draft[qi] === o.val ? ' pick' : ''}" data-v="${o.val}">
      <div class="t">${o.label}</div>${o.hint ? `<div class="d">${o.hint}</div>` : ''}
    </button>`).join('');
  $$('#q-opts .opt').forEach((el) => el.onclick = () => {
    draft[qi] = +el.dataset.v; haptic(); renderQuestion();
  });
  $('#q-next').disabled = !draft[qi];
  $('#q-next').textContent = qi === 5 ? (editing ? 'Сохранить' : 'Готово') : 'Дальше';
  $('#q-back').hidden = qi === 0;
  window.scrollTo(0, 0);
}

$('#q-next').onclick = async () => {
  if (qi < 5) { qi++; renderQuestion(); return; }
  const btn = $('#q-next');
  btn.disabled = true; btn.textContent = 'Сохраняем…';
  try {
    await rpc('save_answers', {
      a: draft, p_username: S.me.username, p_first_name: S.me.first_name,
      p_photo: S.me.photo_url, p_invite: S.invite,
    });
  } catch (e) {
    toast('Ответы не сохранились: ' + e.message);
    btn.disabled = false; renderQuestion();
    return;
  }
  haptic('ok'); editing = false;
  try {
    await loadAll();
    $('#nav').hidden = false; $('#top').hidden = false;
    fitNav();
    go('p-match');
    toast('Готово. Смотрите, с кем совпали');
  } catch (e) {
    // ответы уже в базе — виновата загрузка, а не сохранение
    toast('Ответы сохранены, но экран не загрузился: ' + e.message, 4200);
  }
};
$('#q-back').onclick = () => { qi--; renderQuestion(); };
$('#i-next').onclick = () => pane('#p-brief');
$('#b-start').onclick = () => { qi = 0; renderQuestion(); pane('#p-quiz'); };

/* ── вкладка «Совпадения» ── */
function renderMatches() {
  const d = S.summary, b = d.buckets ?? {}, best = d.best ?? 0;
  const hits = Array(6).fill(0).map((_, i) => (i < best ? 1 : 0));

  $('#m-hero').className = 'hero' + (best === 6 ? ' jack' : '');
  $('#m-hero').innerHTML =
    `<div style="width:76px;flex:none">${rosette(hits, 76, { jack: best === 6 })}</div>
     <div><div class="num">${best}</div><div class="of">ЛУЧШЕЕ СОВПАДЕНИЕ</div></div>`;

  $('#m-scores').innerHTML = [6, 5, 4, 3].map((n) => {
    const c = b[n] ?? 0;
    return `<button class="row${c ? '' : ' mute'}${n === 6 ? ' gold' : ''}" data-score="${n}">
      <div style="width:26px;flex:none">${rosette(
        Array(6).fill(0).map((_, i) => (i < n ? 1 : 0)), 26, { jack: n === 6 })}</div>
      <div class="grow">${n} из 6</div>
      <span class="cnt">${c}</span><span class="chev">›</span></button>`;
  }).join('');

  $('#m-axes').innerHTML = (d.axes ?? []).map((a) => `
    <button class="row${a.cnt ? '' : ' mute'}" data-axis="${a.axis}">
      <span style="font-size:17px;width:24px;flex:none">${ICONS[a.axis - 1]}</span>
      <div class="grow">${label(a.axis, a.val)}<div class="sub">${SPHERES[a.axis - 1]}</div></div>
      <span class="cnt">${a.cnt}</span><span class="chev">›</span></button>`).join('');

  $$('#m-scores .row').forEach((el) =>
    el.onclick = () => openList('score', +el.dataset.score, `${el.dataset.score} из 6`));
  $$('#m-axes .row').forEach((el) => {
    const ax = +el.dataset.axis;
    el.onclick = () => openList('axis', ax, label(ax, S.answers[ax - 1]));
  });

  const nb = $('#m-notify');
  const botOk = d.me?.bot_ok;
  nb.hidden = !!botOk;
  if (!botOk) {
    nb.innerHTML = `<button class="row call quiet">
      <span style="font-size:17px;width:24px;flex:none">🔔</span>
      <div class="grow">Включите уведомления<div class="sub">иначе не узнаете о новых совпадениях</div></div>
      <span class="chev">›</span></button>`;
    nb.querySelector('.row').onclick = () => {
      haptic();
      const url = `https://t.me/${BOT}?start=notify`;
      try { tg?.openTelegramLink?.(url); } catch { window.open(url, '_blank'); }
    };
  }

  const inb = d.pending_in ?? 0;
  const box = $('#m-inbox');
  box.hidden = !inb;
  if (inb) {
    box.innerHTML = `<button class="row call">
      <span style="font-size:17px;width:24px;flex:none">✉️</span>
      <div class="grow">Запросы на контакт<div class="sub">хотят с вами общаться</div></div>
      <span class="cnt">${inb}</span><span class="chev">›</span></button>`;
    box.querySelector('.row').onclick = () => openList('inbox', null, 'Входящие запросы');
  }

  loadNearby();
}

async function loadNearby() {
  const wrap = $('#m-near-wrap');
  try {
    const pres = await rpc('my_presence');
    S.presence = pres;
    renderPresence(pres);

    if (!pres.active) { wrap.hidden = true; return; }

    // Геопоиск и совпадение по месту — разные вещи: место работает и без координат.
    const rows = [];
    if (pres.has_geo && pres.near) {
      rows.push(`<button class="row" data-kind="near">
        <span style="font-size:17px;width:24px;flex:none">📍</span>
        <div class="grow">В пределах 5 км<div class="sub">по вашей геолокации</div></div>
        <span class="cnt">${pres.near}</span><span class="chev">›</span></button>`);
    }
    if (pres.place && pres.same_place) {
      rows.push(`<button class="row" data-kind="place">
        <span style="font-size:17px;width:24px;flex:none">🏷</span>
        <div class="grow">${pres.place}<div class="sub">отметились там же</div></div>
        <span class="cnt">${pres.same_place}</span><span class="chev">›</span></button>`);
    }
    wrap.hidden = !rows.length;
    if (!rows.length) return;
    $('#m-near').innerHTML = rows.join('');
    $$('#m-near .row').forEach((el) => el.onclick = () =>
      el.dataset.kind === 'near'
        ? openList('near', null, 'Рядом, до 5 км')
        : openList('place', null, pres.place));
  } catch { wrap.hidden = true; }
}

function renderPresence(p) {
  const box = $('#me-pres-now'), off = $('#me-pres-off');
  $('#me-geo').classList.toggle('on', !!p.has_geo);
  box.hidden = !p.active;
  off.hidden = !p.active;
  if (!p.active) { $('#me-place').value = ''; return; }
  $('#me-place').value = p.place ?? '';
  const h = Math.floor((p.minutes_left ?? 0) / 60), mm = (p.minutes_left ?? 0) % 60;
  const left = h ? `${h} ч ${mm} мин` : `${mm} мин`;
  const who = [];
  if (p.place) who.push(`${p.same_place} там же`);
  if (p.has_geo) who.push(`${p.near} в 5 км`);
  box.innerHTML = `Вы отмечены${p.place ? ' в <b>' + p.place + '</b>' : ''}` +
    `${p.has_geo ? ', геолокация включена' : ''}.<br>` +
    `${who.length ? who.join(', ') + '. ' : ''}Отметка погаснет через ${left}.`;
}

/* ── список людей ── */
async function openList(kind, value, title) {
  $('#l-kind').textContent = kind === 'axis' ? 'Совпали по сфере'
    : kind === 'score' ? 'Совпадение'
    : kind === 'inbox' ? 'Ждут вашего ответа' : 'Рядом сейчас';
  $('#l-title').textContent = title;
  $('#l-body').innerHTML = '<div class="empty">Ищем…</div>';
  $('#c-list').classList.add('on');
  pushOverlay(() => $('#c-list').classList.remove('on'));
  try {
    const rows = await rpc('match_list',
      { filter_kind: kind, filter_value: value, lim: 60, radius_km: 5 });
    $('#l-body').innerHTML = rows.length ? rows.map((p, i) => `
      <button class="row" data-i="${i}">
        <div class="ava">${p.photo_url
          ? `<img src="${p.photo_url}" alt="">` : (p.first_name[0] ?? '?').toUpperCase()}</div>
        <div class="grow"><div>${p.first_name}</div>
          <div class="sub">${p.score} из 6${p.proximity ? ' · ' + p.proximity : ''}${
            p.contact_status === 'accepted' ? ' · контакт открыт'
            : p.contact_status === 'pending' && p.contact_dir === 'in' ? ' · ждёт вашего ответа'
            : p.contact_status === 'pending' ? ' · запрос отправлен' : ''}</div></div>
        <div style="width:26px;flex:none">${rosette(p.hits, 26, { jack: p.score === 6 })}</div>
        <span class="chev">›</span></button>`).join('')
      : (kind === 'inbox'
          ? '<div class="empty">Входящих запросов нет.</div>'
          : '<div class="empty">Здесь пока никого.<br>Позовите друзей — улей растёт от каждого.</div>');
    $$('#l-body .row').forEach((el) => el.onclick = () => openPerson(rows[+el.dataset.i]));
  } catch (e) { $('#l-body').innerHTML = `<div class="empty">${e.message}</div>`; }
}
$('#l-back').onclick = popOverlay;

/* На iOS openTelegramLink иногда молча ничего не делает. Пробуем по очереди:
   штатный вызов, затем схему tg://, затем просто копируем ник. */
function openTelegram(nick) {
  const web = `https://t.me/${nick}`;
  let left = false;
  const mark = () => { left = true; };
  document.addEventListener('visibilitychange', mark, { once: true });
  addEventListener('pagehide', mark, { once: true });
  const gone = () => left || document.hidden;

  try { tg?.openTelegramLink?.(web); } catch { /* запасные пути ниже */ }

  setTimeout(() => {
    if (gone()) return;
    try { location.href = `tg://resolve?domain=${nick}`; } catch { /* см. ниже */ }
    setTimeout(async () => {
      if (gone()) return;
      const ok = await copyText('@' + nick);
      toast(ok ? `Чат не открылся. Ник @${nick} скопирован — вставьте в поиск Telegram`
               : `Чат не открылся. Ник: @${nick}`, 5200);
    }, 800);
  }, 700);
}

/* ── карточка человека ── */
function openPerson(p) {
  const jack = p.score === 6;
  $('#pr-ros').innerHTML = rosette(p.hits, 132, { jack, seq: true });
  $('#pr-score').textContent = `${p.score} из 6`;
  $('#pr-score').className = 'score' + (jack ? ' jack' : '');
  $('#pr-name').textContent = p.first_name;
  const nickEl = $('#pr-nick');
  nickEl.textContent = p.username ? '@' + p.username : '';
  nickEl.onclick = p.username
    ? async () => {
        const ok = await copyText('@' + p.username);
        if (ok) { haptic(); toast('Ник скопирован'); }
      }
    : null;
  $('#pr-axes').innerHTML = p.hits.map((h, i) => `
    <div class="ax${h ? ' hit' : ''}"><span class="ic">${ICONS[i]}</span>
      <span class="tx">${h ? GAINS[i] : SPHERES[i] + ' — разошлись'}</span>
      <span class="mk">${h ? '✓' : '—'}</span></div>`).join('');

  const act = $('#pr-act'), act2 = $('#pr-act2');
  act.disabled = false; act2.hidden = true; act2.onclick = null;

  const answer = async (yes) => {
    act.disabled = true;
    try {
      await rpc('respond_contact', { req_id: p.contact_id, accept: yes });
      haptic('ok');
      p.contact_status = yes ? 'accepted' : 'declined';
      toast(yes ? 'Контакт открыт' : 'Отклонено');
      await loadAll(); openPerson(p);
    } catch (e) { toast(e.message); act.disabled = false; }
  };

  if (p.contact_status === 'pending' && p.contact_dir === 'in') {
    act.textContent = 'Принять запрос';
    act.className = 'btn lit';
    act.onclick = () => answer(true);
    act2.hidden = false;
    act2.textContent = 'Отклонить';
    act2.onclick = () => answer(false);
  } else if (p.contact_status === 'accepted') {
    act.textContent = p.username ? 'Написать в Telegram' : 'Контакт открыт';
    act.className = 'btn lit';
    act.onclick = () => p.username
      ? openTelegram(p.username)
      : toast('У человека нет ника в Telegram — он напишет вам сам', 4000);
  } else if (p.contact_status === 'pending') {
    act.textContent = 'Запрос отправлен — ждём ответа';
    act.className = 'btn ghost'; act.onclick = null;
  } else if (p.contact_status === 'declined') {
    act.textContent = 'Запрос отклонён';
    act.className = 'btn ghost'; act.onclick = null;
  } else {
    act.textContent = 'Запросить контакт';
    act.className = 'btn';
    act.onclick = async () => {
      act.disabled = true;
      try {
        const r = await rpc('request_contact', { target: p.tg_id });
        haptic('ok');
        p.contact_status = r.status;
        toast(r.status === 'accepted'
          ? 'Контакт открыт — вы запросили друг друга'
          : 'Запрос ушёл. Придёт ответ — сообщим');
        openPerson(p);
      } catch (e) { toast(e.message); act.disabled = false; }
    };
  }
  if (!$('#c-person').classList.contains('on')) {
    pushOverlay(() => $('#c-person').classList.remove('on'));
  }
  $('#c-person').classList.add('on');
  haptic();
}
$('#pr-close').onclick = popOverlay;

/* ── вкладка «Я» ── */
function renderMe() {
  const a = S.answers;
  $('#me-qr').innerHTML = QR.svg(`6x6|${S.me.tg_id}|${a.join('')}`,
    { dark: '#070B0A', light: '#E7EFE9', quiet: 2 });
  $('#me-code').textContent = S.summary.me.code;
  $('#me-answers').innerHTML = a.map((v, i) => `
    <div class="row" style="cursor:default"><span style="font-size:17px;width:24px;flex:none">${ICONS[i]}</span>
      <div class="grow">${label(i + 1, v)}<div class="sub">${SPHERES[i]}</div></div></div>`).join('');
  $('#me-n6').classList.toggle('on', S.summary.me.notify_6);
  $('#me-n5').classList.toggle('on', S.summary.me.notify_5);
}

$('#me-edit').onclick = () => {
  editing = true; qi = 0; draft = S.answers.slice();
  renderQuestion(); pane('#p-quiz');
  toast('Отвечайте как хотите, а не как сложилось', 3600);
};

$('#me-geo').onclick = async () => {
  const t = $('#me-geo');
  if (t.classList.contains('on')) {
    await rpc('set_presence', { p_lat: null, p_lon: null, hours: 6 });
    toast('Геолокация останется до конца отметки. Чтобы убрать всё — «Снять отметку»', 4200);
    return;
  }
  const put = async (lat, lon) => {
    renderPresence(await rpc('set_presence', { p_lat: lat, p_lon: lon, hours: 6 }));
    toast('Геолокация добавлена'); loadNearby();
  };
  const lm = tg?.LocationManager;
  if (lm?.init) {
    lm.init(() => {
      if (lm.isLocationAvailable === false) {
        return toast('Телефон не даёт Telegram координаты. Впишите место текстом — это работает всегда', 4600);
      }
      lm.getLocation((loc) => {
        if (loc) return put(loc.latitude, loc.longitude);
        if (lm.isAccessRequested && !lm.isAccessGranted && lm.openSettings) {
          toast('Доступ закрыт. Откройте настройки и разрешите геолокацию', 4200);
          lm.openSettings();
        } else {
          toast('Координаты не пришли. Впишите место текстом — это работает всегда', 4600);
        }
      });
    });
    return;
  }
  if (!navigator.geolocation) {
    return toast('Ваш Telegram не умеет геолокацию. Впишите место текстом', 4600);
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => put(pos.coords.latitude, pos.coords.longitude),
    () => toast('Доступ к геолокации закрыт. Впишите место текстом — это работает всегда', 4600),
    { timeout: 10000 });
};

$('#me-pres-off').onclick = async () => {
  await rpc('clear_presence');
  renderPresence({ active: false });
  toast('Отметка снята'); loadNearby();
};

$('#me-place-go').onclick = async () => {
  const place = $('#me-place').value.trim();
  if (!place) return toast('Впишите название места');
  const b = $('#me-place-go'); b.disabled = true;
  try {
    renderPresence(await rpc('set_presence', { p_place: place, hours: 6 }));
    haptic('ok');
    toast('Отметились на 6 часов. Вас увидят те, кто вписал так же', 4000);
    loadNearby();
  } catch (e) { toast(e.message); }
  b.disabled = false;
};

const notifyToggle = async () => {
  await rpc('set_notify', {
    n6: $('#me-n6').classList.contains('on'),
    n5: $('#me-n5').classList.contains('on'),
  });
};
$('#me-n6').onclick = (e) => { e.target.classList.toggle('on'); notifyToggle(); };
$('#me-n5').onclick = (e) => { e.target.classList.toggle('on'); notifyToggle(); };

const inviteLink = () => `https://t.me/${BOT}/app?startapp=${S.inviteCode}`;

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* см. ниже */ }
  try {                       // в вебвью Telegram буфер обмена часто закрыт
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(ta);
    ta.select(); ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

$('#me-invite').onclick = async () => {
  if (!S.inviteCode) return toast('Ссылка ещё не загрузилась');
  const ok = await copyText(inviteLink());
  toast(ok ? 'Ссылка скопирована' : 'Скопируйте вручную — ссылка выше на экране', 3600);
};

$('#me-share').onclick = () => {
  if (!S.inviteCode) return toast('Ссылка ещё не загрузилась');
  const text = 'Шесть вопросов — и видно, с кем ты совпадаешь и по каким сферам жизни.';
  tg?.openTelegramLink?.(
    `https://t.me/share/url?url=${encodeURIComponent(inviteLink())}&text=${encodeURIComponent(text)}`);
};

$('#me-chat').onclick = () => {
  haptic();
  openTelegram(CHAT.replace(/^https:\/\/t\.me\//, ''));
};

$('#me-help').onclick = () => {
  haptic();
  if (/ВСТАВЬ/.test(SUPPORT)) return toast('Поддержка пока не настроена');
  openTelegram(SUPPORT);
};

/* ── вкладка «Улей» ── */
async function renderHive() {
  const h = await rpc('hive_stats');
  $('#h-top').innerHTML = `
    <div><div class="num">${h.total}</div><div class="lbl" style="margin-top:5px">в улье</div></div>
    <div><div class="num" style="color:var(--lit)">+${h.week}</div><div class="lbl" style="margin-top:5px">за неделю</div></div>
    <div><div class="num" style="color:var(--honey)">${h.configs_used}</div>
         <div class="lbl" style="margin-top:5px">из ${h.configs_all.toLocaleString('ru')} конфигураций</div></div>`;

  const byAxis = {};
  h.axes.forEach((a) => (byAxis[a.axis] ??= []).push(a));
  $('#h-axes').innerHTML = Object.entries(byAxis).map(([ax, list]) => {
    const max = Math.max(...list.map((x) => x.cnt), 1);
    return `<div class="sect"><span class="lbl">${ICONS[ax - 1]} ${SPHERES[ax - 1]}</span>` +
      list.sort((a, b) => b.cnt - a.cnt).map((o) => `
        <div class="meter${o.mine ? ' mine' : ''}">
          <div class="top"><span>${o.label}${o.mine ? ' — вы здесь' : ''}</span>
            <b>${h.total ? Math.round(o.cnt / h.total * 100) : 0}%</b></div>
          <div class="tr"><i class="fl" style="width:${o.cnt / max * 100}%"></i></div>
        </div>`).join('') + '</div>';
  }).join('');
}

/* ── админ ── */
async function renderAdmin() {
  try {
    const a = await rpc('admin_stats');
    const rows = [
      ['Игроков', a.total],
      ['За сутки', a.day],
      ['За неделю', a.week],
      ['Заселено конфигураций', `${a.configs_used} из 30 240`],
      ['Пар 6 из 6 в базе', a.jackpots],
      ['Из них уже списались', a.jackpots_met],
      ['Запросов на контакт', a.requests],
      ['Принято', a.accepted],
      ['Отклонено', a.declined],
      ['Сканов при встрече', a.scans],
      ['Отмечены «рядом» сейчас', a.presence_now],
      ['Бот доходит', `${a.bot_ok} из ${a.total}`],
      ['Застряло в очереди', a.outbox_stuck],
    ];
    const unreachable = a.total - a.bot_ok;
    $('#a-stats').innerHTML = rows.map(([k, v]) =>
      `<div class="row" style="cursor:default"><div class="grow">${k}</div>
       <span class="cnt">${v}</span></div>`).join('')
      + (unreachable > a.total / 2
        ? `<div class="presnow" style="margin-top:16px">До <b>${unreachable}</b> человек
           не доходят сообщения — они не запускали бота. О новых совпадениях и запросах
           на контакт они узнают, только если зайдут в приложение сами.</div>`
        : '');
  } catch (e) { $('#a-stats').innerHTML = `<div class="empty">${e.message}</div>`; }
}

$('#a-export').onclick = async () => {
  const b = $('#a-export'); b.disabled = true; b.textContent = 'Собираем…';
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/export`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${SUPABASE_ANON}`,
      },
      body: JSON.stringify({ tg_id: S.me.tg_id }),
    }).then((x) => x.json());
    toast(r.ok ? `Файл на ${r.rows} строк ушёл вам в чат с ботом` : 'Не получилось: ' + r.error);
  } catch (e) { toast('Не получилось: ' + e.message); }
  b.disabled = false; b.textContent = 'Выгрузить базу в Excel';
};

$('#scan-main').onclick = () => scan();
$('#scan-me').onclick = () => scan();

/* ── скан ── */
function scan() {
  if (!tg?.showScanQrPopup) return toast('Сканер работает только внутри Telegram');
  tg.showScanQrPopup({ text: 'Наведите на код другого игрока' }, (txt) => {
    const m = String(txt ?? '').match(/^6x6\|(\d+)\|([1-7]{6})$/);
    if (!m) { toast('Это не код игрока 6×6'); return false; }
    if (m[1] === String(S.me.tg_id)) { toast('Это ваш собственный код'); return false; }
    tg.closeScanQrPopup();
    rpc('scan_contact', { target: Number(m[1]) })
      .then((r) => { haptic('ok'); openPerson({ ...r, tg_id: Number(m[1]), contact_status: 'accepted' }); loadAll(); })
      .catch((e) => toast(e.message));
    return true;
  });
}

/* ── навигация ── */
function fitNav() {
  const top = Math.max(
    tg?.contentSafeAreaInset?.top ?? 0,
    tg?.safeAreaInset?.top ?? 0,
    0,
  );
  document.documentElement.style.setProperty('--tgtop', top + 'px');

  const safe = Math.max(
    tg?.safeAreaInset?.bottom ?? 0,
    tg?.contentSafeAreaInset?.bottom ?? 0,
    MOBILE ? 22 : 0,          // плашка-ручка есть только в мобильных клиентах
  );
  document.documentElement.style.setProperty('--tgsafe', safe + 'px');
  const n = $('#nav');
  if (!n || n.hidden) return;
  document.documentElement.style.setProperty('--navh',
    Math.min(n.offsetHeight || 86, 160) + 'px');
}
addEventListener('resize', fitNav);
tg?.onEvent?.('safeAreaChanged', fitNav);
tg?.onEvent?.('viewportChanged', fitNav);

function go(id) {
  pane('#' + id);
  $$('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.go === id));
  if (id === 'p-hive') renderHive();
  if (id === 'p-admin') renderAdmin();
  if (id === 'p-me') renderMe();
}
$$('#nav button').forEach((b) => b.onclick = () => { haptic(); go(b.dataset.go); });

/* ── загрузка ── */
async function loadAll() {
  S.summary = await rpc('my_summary');
  if (!S.summary.registered) return false;
  S.answers = S.summary.me.answers;
  S.admin = !!S.summary.me.admin;
  $('#nav [data-go="p-admin"]').hidden = !S.admin;
  $('#nav').className = S.admin ? 'n4' : 'n3';
  renderMatches();

  // Приглашение — не повод не пустить человека внутрь, если оно не загрузилось.
  try {
    const inv = await rpc('my_invite');
    S.inviteCode = inv.code;
    $('#me-inv-link').textContent = inviteLink();
    $('#me-inv-txt').textContent = inv.invited
      ? `По вашей ссылке пришло ${inv.invited}. Чем больше в улье, тем выше шанс на шесть из шести.`
      : 'Чем больше людей в улье, тем выше у каждого шанс встретить своё шесть из шести.';
  } catch {
    $('#me-inv-txt').textContent = 'Ссылка сейчас недоступна, попробуйте позже.';
    $('#me-inv-link').textContent = '—';
  }
  return true;
}

(async function boot() {
  try {
    await loadConfig();

    if (tg) {
      tg.ready();
      if (MOBILE) {
        tg.expand();
        tg.disableVerticalSwipes?.();
      }
      tg.setHeaderColor?.('#070B0A');
      tg.setBackgroundColor?.('#070B0A');
    }
    $('#intro-ros').innerHTML = rosette([1, 1, 1, 1, 1, 1], 56, { jack: true });

    // Ключ anon сам по себе валидный JWT, поэтому функция работает
    // и со включённой проверкой токена — переключатель в панели не нужен.
    const auth = await fetch(`${SUPABASE_URL}/functions/v1/auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${SUPABASE_ANON}`,
      },
      body: JSON.stringify({ initData: tg?.initData ?? '' }),
    }).then((r) => r.json());
    if (auth.error) throw new Error(auth.error);

    S.me = auth.user;
    S.invite = auth.start_param ?? null;
    sb = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${auth.token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    S.opts = await sb.from('axis_options').select('*').then((r) => r.data ?? []);
    if (!S.opts.length) throw new Error('Справочник вопросов пуст — выполните schema.sql');

    const ready = await loadAll();
    if (ready) {
      $('#nav').hidden = false; $('#top').hidden = false;
      fitNav();
      [80, 300, 800].forEach((ms) => setTimeout(fitNav, ms));   // окно устаканивается не сразу
      go('p-match');
    } else {
      pane('#p-intro');            // шапку и вкладки покажем после шести ответов
    }

  } catch (e) {
    $('#p-load').innerHTML =
      `<div class="empty" style="padding-top:26vh">Не получилось открыть.<br><br>${e.message}</div>
       <div class="sticky"><button class="btn ghost" id="retry">Попробовать снова</button></div>`;
    $('#retry').onclick = () => location.reload();
  }
})();
