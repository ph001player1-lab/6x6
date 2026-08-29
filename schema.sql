-- ═══════════════════════════════════════════════════════════════
--  ШЕСТЬ ИЗ ШЕСТИ · 6×6
--  Схема Supabase. Выполнить целиком в SQL Editor.
-- ═══════════════════════════════════════════════════════════════

create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists cube;
create extension if not exists earthdistance;

-- ───────────────────────────── справочник осей ─────────────────
-- Радиксы: климат 5, отношения 4, быт 6, общество 6, деньги 6, мировоззрение 7
-- Веса позиционной системы: 6048, 1512, 252, 42, 7, 1  → всего 30 240 конфигураций

create table if not exists axis_options (
  axis  smallint not null check (axis between 1 and 6),
  val   smallint not null,
  code  text not null,          -- TRP, MON, PAR …
  label text not null,
  hint  text,
  primary key (axis, val)
);

insert into axis_options (axis, val, code, label, hint) values
 (1,1,'TRP','Тропический','Круглый год тепло, +24…+35'),
 (1,2,'SUB','Субтропический','Жаркое лето, мягкая зима'),
 (1,3,'TMP','Умеренный','Четыре выраженных времени года'),
 (1,4,'CLD','Холодный','Долгая зима, короткое лето'),
 (1,5,'PLR','Полярный','Большую часть года ниже нуля'),

 (2,1,'MNG','Моногамия','Один партнёр, взаимная исключительность'),
 (2,2,'PLY','Полиамория','Несколько близких связей по согласию всех'),
 (2,3,'FRE','Свободные отношения','Без обязательств об исключительности'),
 (2,4,'ASX','Асексуальный образ жизни','Близость без сексуальной составляющей'),

 (3,1,'SOL','Одиночное проживание','Своё пространство, никого рядом постоянно'),
 (3,2,'PAT','Патриархальная семья','Решения и ответственность за мужчиной'),
 (3,3,'MAT','Матриархальная семья','Решения и ответственность за женщиной'),
 (3,4,'PRT','Партнёрская семья','Равный вклад и общие решения'),
 (3,5,'COM','Коммуна','Несколько человек, общий быт и ресурсы'),
 (3,6,'GST','Гостевой брак','Вместе, но живём раздельно'),

 (4,1,'LIB','Либерализм','Максимум личной свободы, минимум государства'),
 (4,2,'SOC','Социализм','Государство выравнивает возможности'),
 (4,3,'CNS','Консерватизм','Опора на традицию и устоявшийся порядок'),
 (4,4,'CMM','Коммунизм','Общая собственность, распределение по нуждам'),
 (4,5,'ANA','Анархизм','Самоорганизация без принуждающей власти'),
 (4,6,'AUT','Авторитаризм','Сильная вертикаль и жёсткий порядок'),

 (5,1,'ENT','Предприниматель','Своё дело, доход от него'),
 (5,2,'EMP','Наёмный работник','Зарплата, работа по найму'),
 (5,3,'INV','Инвестор','Доход с вложенного капитала'),
 (5,4,'FRL','Фрилансер','Проекты, заказчики, свободный график'),
 (5,5,'COO','Кооперативная экономика','Общее дело с равными долями'),
 (5,6,'UBI','Безусловный базовый доход','Гарантированный доход, дальше сам решаю'),

 (6,1,'CHR','Христианство',null),
 (6,2,'ISL','Ислам',null),
 (6,3,'BUD','Буддизм',null),
 (6,4,'JUD','Иудаизм',null),
 (6,5,'SCI','Научный материализм','Мир объясним через науку'),
 (6,6,'AGN','Агностицизм','Достоверно знать нельзя'),
 (6,7,'ESO','Эзотерика','Скрытые связи и практики')
on conflict (axis, val) do update
  set code = excluded.code, label = excluded.label, hint = excluded.hint;

-- ───────────────────────────── игроки ──────────────────────────

create table if not exists players (
  tg_id       bigint primary key,
  username    text,
  first_name  text not null default '',
  photo_url   text,
  c1 smallint not null check (c1 between 1 and 5),
  c2 smallint not null check (c2 between 1 and 4),
  c3 smallint not null check (c3 between 1 and 6),
  c4 smallint not null check (c4 between 1 and 6),
  c5 smallint not null check (c5 between 1 and 6),
  c6 smallint not null check (c6 between 1 and 7),
  config_id   int generated always as (
                (c1-1)*6048 + (c2-1)*1512 + (c3-1)*252 + (c4-1)*42 + (c5-1)*7 + (c6-1)
              ) stored,
  answered_at timestamptz not null default now(),   -- параметр T
  created_at  timestamptz not null default now(),
  invited_by  bigint,
  notify_6    boolean not null default true,
  notify_5    boolean not null default true,
  bot_ok      boolean not null default false,
  banned      boolean not null default false
);

create index if not exists players_config_idx on players(config_id);
create index if not exists players_c1_idx on players(c1);
create index if not exists players_c2_idx on players(c2);
create index if not exists players_c3_idx on players(c3);
create index if not exists players_c4_idx on players(c4);
create index if not exists players_c5_idx on players(c5);
create index if not exists players_c6_idx on players(c6);
create index if not exists players_created_idx on players(created_at desc);

create table if not exists config_log (
  id bigserial primary key,
  tg_id bigint not null,
  c1 smallint, c2 smallint, c3 smallint, c4 smallint, c5 smallint, c6 smallint,
  changed_at timestamptz not null default now()
);

-- ───────────────────────────── присутствие ─────────────────────

create table if not exists presence (
  tg_id      bigint primary key references players(tg_id) on delete cascade,
  lat        double precision,          -- округлено до 3 знаков, ≈110 м
  lon        double precision,
  place      text,
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists presence_expires_idx on presence(expires_at);
create index if not exists presence_geo_idx on presence using gist (ll_to_earth(lat, lon));
create index if not exists presence_place_idx on presence (lower(place));

-- ───────────────────────────── контакты ────────────────────────

create table if not exists contacts (
  id           bigserial primary key,
  from_id      bigint not null references players(tg_id) on delete cascade,
  to_id        bigint not null references players(tg_id) on delete cascade,
  status       text not null default 'pending'
               check (status in ('pending','accepted','declined')),
  score        smallint,
  via          text not null default 'app' check (via in ('app','scan')),
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  unique (from_id, to_id),
  check (from_id <> to_id)
);
create index if not exists contacts_to_idx on contacts(to_id, status);
create index if not exists contacts_from_idx on contacts(from_id, status);

-- ───────────────────────────── очередь бота ────────────────────

create table if not exists outbox (
  id         bigserial primary key,
  tg_id      bigint not null,
  kind       text not null,
  payload    jsonb not null default '{}',
  send_after timestamptz not null default now(),
  sent_at    timestamptz,
  attempts   smallint not null default 0,
  last_error text
);
create index if not exists outbox_pending_idx on outbox(send_after) where sent_at is null;

-- ───────────────────────────── прочее ──────────────────────────

create table if not exists axis_stats (
  axis smallint not null, val smallint not null, cnt int not null default 0,
  primary key (axis, val)
);

create table if not exists admins (tg_id bigint primary key);

create table if not exists invites (
  code       text primary key,
  owner_id   bigint not null references players(tg_id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists invites_owner_idx on invites(owner_id);

-- ═══════════════════════════════════════════════════════════════
--  ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
-- ═══════════════════════════════════════════════════════════════

-- tg_id текущего пользователя из JWT
create or replace function me_id() returns bigint
language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::json ->> 'tg_id', '')::bigint
$$;

create or replace function is_admin(uid bigint default me_id()) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where tg_id = uid)
$$;

-- Идентификаторы конфигураций, отличающихся не более чем в max_diff осях.
-- При max_diff = 2 их ровно 353: 1 + 28 + 324.
create or replace function neighbor_ids(a smallint[], max_diff int default 2)
returns int[] language plpgsql immutable as $$
declare
  r   int[] := array[5,4,6,6,6,7];
  w   int[] := array[6048,1512,252,42,7,1];
  base int := 0;
  out  int[];
  i int; j int; vi int; vj int;
begin
  for i in 1..6 loop base := base + (a[i]-1)*w[i]; end loop;
  out := array[base];

  if max_diff >= 1 then
    for i in 1..6 loop
      for vi in 1..r[i] loop
        if vi <> a[i] then out := out || (base + (vi - a[i])*w[i]); end if;
      end loop;
    end loop;
  end if;

  if max_diff >= 2 then
    for i in 1..5 loop
      for j in (i+1)..6 loop
        for vi in 1..r[i] loop
          continue when vi = a[i];
          for vj in 1..r[j] loop
            continue when vj = a[j];
            out := out || (base + (vi-a[i])*w[i] + (vj-a[j])*w[j]);
          end loop;
        end loop;
      end loop;
    end loop;
  end if;

  return out;
end $$;

-- буквенный код конфигурации: TRP-MON-PAR-LIB-ENT-AGN
create or replace function config_code(a smallint[]) returns text
language sql stable as $$
  select string_agg(o.code, '-' order by o.axis)
  from (select generate_series(1,6) ax) g
  join axis_options o on o.axis = g.ax and o.val = a[g.ax]
$$;

-- ═══════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════

alter table players       enable row level security;
alter table presence      enable row level security;
alter table contacts      enable row level security;
alter table config_log    enable row level security;
alter table outbox        enable row level security;
alter table invites       enable row level security;
alter table admins        enable row level security;
alter table axis_stats    enable row level security;
alter table axis_options  enable row level security;

-- своя строка — целиком; чужие только через функции ниже
drop policy if exists players_self on players;
create policy players_self on players
  for select using (tg_id = me_id());

drop policy if exists players_self_upd on players;
create policy players_self_upd on players
  for update using (tg_id = me_id()) with check (tg_id = me_id());

drop policy if exists presence_self on presence;
create policy presence_self on presence
  using (tg_id = me_id()) with check (tg_id = me_id());

drop policy if exists contacts_mine on contacts;
create policy contacts_mine on contacts
  for select using (from_id = me_id() or to_id = me_id());

drop policy if exists invites_mine on invites;
create policy invites_mine on invites
  for select using (owner_id = me_id());

-- справочники читают все авторизованные
drop policy if exists axis_options_read on axis_options;
create policy axis_options_read on axis_options for select using (true);
drop policy if exists axis_stats_read on axis_stats;
create policy axis_stats_read on axis_stats for select using (true);

-- ═══════════════════════════════════════════════════════════════
--  API ДЛЯ ПРИЛОЖЕНИЯ
-- ═══════════════════════════════════════════════════════════════

-- Регистрация и смена ответов. Без шести ответов в базу не попасть:
-- строка players создаётся только здесь и только целиком.
create or replace function save_answers(
  a smallint[], p_username text, p_first_name text,
  p_photo text default null, p_invite text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare uid bigint := me_id(); inviter bigint;
begin
  if uid is null then raise exception 'no_auth'; end if;
  if array_length(a,1) <> 6 then raise exception 'need_six_answers'; end if;

  select owner_id into inviter from invites where code = p_invite;

  insert into players (tg_id, username, first_name, photo_url,
                       c1,c2,c3,c4,c5,c6, invited_by)
  values (uid, p_username, coalesce(p_first_name,''), p_photo,
          a[1],a[2],a[3],a[4],a[5],a[6],
          case when inviter <> uid then inviter end)
  on conflict (tg_id) do update set
    username   = excluded.username,
    first_name = excluded.first_name,
    photo_url  = coalesce(excluded.photo_url, players.photo_url),
    c1 = excluded.c1, c2 = excluded.c2, c3 = excluded.c3,
    c4 = excluded.c4, c5 = excluded.c5, c6 = excluded.c6,
    answered_at = now();

  insert into config_log (tg_id,c1,c2,c3,c4,c5,c6)
  values (uid,a[1],a[2],a[3],a[4],a[5],a[6]);

  return json_build_object('ok', true, 'code', config_code(a));
end $$;

-- Сводка для главного экрана
create or replace function my_summary() returns json
language plpgsql security definer set search_path = public as $$
declare uid bigint := me_id(); m players; ids int[]; res json;
begin
  select * into m from players where tg_id = uid;
  if not found then return json_build_object('registered', false); end if;

  ids := neighbor_ids(array[m.c1,m.c2,m.c3,m.c4,m.c5,m.c6]::smallint[], 2);

  select json_build_object(
    'registered', true,
    'me', json_build_object(
      'tg_id', m.tg_id, 'first_name', m.first_name, 'username', m.username,
      'answers', array[m.c1,m.c2,m.c3,m.c4,m.c5,m.c6],
      'code', config_code(array[m.c1,m.c2,m.c3,m.c4,m.c5,m.c6]::smallint[]),
      'answered_at', m.answered_at, 'admin', is_admin(uid),
      'notify_6', m.notify_6, 'notify_5', m.notify_5),
    'best', coalesce((select max(sc) from (
        select (p.c1=m.c1)::int+(p.c2=m.c2)::int+(p.c3=m.c3)::int
             + (p.c4=m.c4)::int+(p.c5=m.c5)::int+(p.c6=m.c6)::int sc
        from players p where p.tg_id <> uid and not p.banned
          and p.config_id = any(ids)) t), 0),
    'buckets', coalesce((select json_object_agg(sc, n) from (
        select (p.c1=m.c1)::int+(p.c2=m.c2)::int+(p.c3=m.c3)::int
             + (p.c4=m.c4)::int+(p.c5=m.c5)::int+(p.c6=m.c6)::int sc, count(*) n
        from players p where p.tg_id <> uid and not p.banned
          and p.config_id = any(ids)
        group by 1) t), '{}'::json),
    'axes', (select json_agg(json_build_object(
        'axis', ax, 'val', v, 'cnt', greatest(coalesce((select cnt from axis_stats s where s.axis = ax and s.val = v),1) - 1, 0))
        order by ax)
      from (select 1 ax, m.c1 v union all select 2, m.c2 union all select 3, m.c3
            union all select 4, m.c4 union all select 5, m.c5 union all select 6, m.c6) q),
    'pending_in', (select count(*) from contacts where to_id = uid and status = 'pending'),
    'total', (select count(*) from players where not banned)
  ) into res;
  return res;
end $$;

-- Список людей. filter_kind: 'score' | 'axis' | 'near' | 'place'
create or replace function match_list(
  filter_kind text, filter_value int default null,
  lim int default 30, off int default 0, radius_km int default 5
) returns json
language plpgsql security definer set search_path = public as $$
declare uid bigint := me_id(); m players; ids int[]; res json; mylat float8; mylon float8; myplace text;
begin
  select * into m from players where tg_id = uid;
  if not found then raise exception 'not_registered'; end if;
  select lat, lon, place into mylat, mylon, myplace from presence
   where tg_id = uid and expires_at > now();

  ids := neighbor_ids(array[m.c1,m.c2,m.c3,m.c4,m.c5,m.c6]::smallint[], 2);

  select coalesce(json_agg(row_to_json(t) order by t.score desc, t.created_at desc), '[]'::json)
  into res from (
    select p.tg_id, p.first_name, p.photo_url,
           (p.c1=m.c1)::int+(p.c2=m.c2)::int+(p.c3=m.c3)::int
         + (p.c4=m.c4)::int+(p.c5=m.c5)::int+(p.c6=m.c6)::int as score,
           array[(p.c1=m.c1)::int,(p.c2=m.c2)::int,(p.c3=m.c3)::int,
                 (p.c4=m.c4)::int,(p.c5=m.c5)::int,(p.c6=m.c6)::int] as hits,
           p.created_at,
           c.status as contact_status,
           case when c.status = 'accepted' then p.username end as username,
           case when pr.lat is null or mylat is null then null
                when earth_distance(ll_to_earth(mylat,mylon), ll_to_earth(pr.lat,pr.lon)) < 1000 then 'рядом'
                when earth_distance(ll_to_earth(mylat,mylon), ll_to_earth(pr.lat,pr.lon)) < 5000 then 'в районе'
                when earth_distance(ll_to_earth(mylat,mylon), ll_to_earth(pr.lat,pr.lon)) < 25000 then 'в городе'
           end as proximity,
           pr.place
    from players p
    left join presence pr on pr.tg_id = p.tg_id and pr.expires_at > now()
    left join contacts c on (c.from_id = uid and c.to_id = p.tg_id)
                         or (c.to_id = uid and c.from_id = p.tg_id)
    where p.tg_id <> uid and not p.banned
      and case filter_kind
            when 'score' then p.config_id = any(ids) and
              ((p.c1=m.c1)::int+(p.c2=m.c2)::int+(p.c3=m.c3)::int
              +(p.c4=m.c4)::int+(p.c5=m.c5)::int+(p.c6=m.c6)::int) = filter_value
            when 'axis'  then case filter_value
                  when 1 then p.c1 = m.c1 when 2 then p.c2 = m.c2 when 3 then p.c3 = m.c3
                  when 4 then p.c4 = m.c4 when 5 then p.c5 = m.c5 else p.c6 = m.c6 end
            when 'near'  then mylat is not null and pr.lat is not null
                  and earth_distance(ll_to_earth(mylat,mylon), ll_to_earth(pr.lat,pr.lon)) < radius_km*1000
            when 'place' then myplace is not null and lower(pr.place) = lower(myplace)
            else true
          end
    limit lim offset off
  ) t;
  return res;
end $$;

-- Улей: распределение всей базы
create or replace function hive_stats() returns json
language plpgsql security definer set search_path = public as $$
declare uid bigint := me_id(); m players;
begin
  select * into m from players where tg_id = uid;
  return json_build_object(
    'total',        (select count(*) from players where not banned),
    'week',         (select count(*) from players where created_at > now() - interval '7 days'),
    'configs_used', (select count(distinct config_id) from players where not banned),
    'configs_all',  30240,
    'axes', (select json_agg(a order by a->>'axis', (a->>'val')::int) from (
        select json_build_object(
          'axis', o.axis, 'val', o.val, 'label', o.label, 'code', o.code,
          'cnt', coalesce(s.cnt,0),
          'mine', case when m.tg_id is null then false else
             (o.axis=1 and o.val=m.c1) or (o.axis=2 and o.val=m.c2) or (o.axis=3 and o.val=m.c3) or
             (o.axis=4 and o.val=m.c4) or (o.axis=5 and o.val=m.c5) or (o.axis=6 and o.val=m.c6) end
        ) a
        from axis_options o left join axis_stats s on s.axis=o.axis and s.val=o.val) q)
  );
end $$;

-- ─── контакты ───

create or replace function request_contact(target bigint) returns json
language plpgsql security definer set search_path = public as $$
declare uid bigint := me_id(); m players; p players; sc int; cid bigint; st text;
begin
  if uid is null or uid = target then raise exception 'bad_target'; end if;
  select * into m from players where tg_id = uid;
  select * into p from players where tg_id = target and not banned;
  if not found then raise exception 'no_such_player'; end if;

  sc := (p.c1=m.c1)::int+(p.c2=m.c2)::int+(p.c3=m.c3)::int
      + (p.c4=m.c4)::int+(p.c5=m.c5)::int+(p.c6=m.c6)::int;

  -- встречный запрос — сразу принимаем
  update contacts set status='accepted', responded_at=now()
   where from_id = target and to_id = uid and status = 'pending'
   returning id into cid;
  if found then return json_build_object('status','accepted'); end if;

  insert into contacts (from_id, to_id, score) values (uid, target, sc)
  on conflict (from_id, to_id) do update
     set created_at = case when contacts.status='declined'
                             and contacts.responded_at < now() - interval '30 days'
                           then now() else contacts.created_at end,
         status = case when contacts.status='declined'
                         and contacts.responded_at < now() - interval '30 days'
                       then 'pending' else contacts.status end
  returning id, status into cid, st;

  return json_build_object('status', st, 'id', cid);
end $$;

create or replace function respond_contact(req_id bigint, accept boolean) returns json
language plpgsql security definer set search_path = public as $$
declare uid bigint := me_id();
begin
  update contacts set status = case when accept then 'accepted' else 'declined' end,
                      responded_at = now()
   where id = req_id and to_id = uid and status = 'pending';
  if not found then raise exception 'no_request'; end if;
  return json_build_object('status', case when accept then 'accepted' else 'declined' end);
end $$;

-- Скан при личной встрече: согласие обоюдно по факту присутствия
create or replace function scan_contact(target bigint) returns json
language plpgsql security definer set search_path = public as $$
declare uid bigint := me_id(); m players; p players; sc int;
begin
  if uid is null or uid = target then raise exception 'bad_target'; end if;
  select * into m from players where tg_id = uid;
  select * into p from players where tg_id = target and not banned;
  if not found then raise exception 'no_such_player'; end if;

  sc := (p.c1=m.c1)::int+(p.c2=m.c2)::int+(p.c3=m.c3)::int
      + (p.c4=m.c4)::int+(p.c5=m.c5)::int+(p.c6=m.c6)::int;

  insert into contacts (from_id,to_id,status,score,via,responded_at)
  values (uid,target,'accepted',sc,'scan',now())
  on conflict (from_id,to_id) do update set status='accepted', responded_at=now(), via='scan';

  insert into contacts (from_id,to_id,status,score,via,responded_at)
  values (target,uid,'accepted',sc,'scan',now())
  on conflict (from_id,to_id) do update set status='accepted', responded_at=now(), via='scan';

  return json_build_object('score', sc, 'first_name', p.first_name, 'username', p.username,
    'hits', array[(p.c1=m.c1)::int,(p.c2=m.c2)::int,(p.c3=m.c3)::int,
                  (p.c4=m.c4)::int,(p.c5=m.c5)::int,(p.c6=m.c6)::int]);
end $$;

create or replace function my_requests() returns json
language plpgsql security definer set search_path = public as $$
declare uid bigint := me_id();
begin
  return coalesce((select json_agg(row_to_json(t)) from (
    select c.id, c.score, c.status, c.created_at,
           p.tg_id, p.first_name, p.photo_url,
           case when c.status='accepted' then p.username end as username,
           array[(p.c1=m.c1)::int,(p.c2=m.c2)::int,(p.c3=m.c3)::int,
                 (p.c4=m.c4)::int,(p.c5=m.c5)::int,(p.c6=m.c6)::int] as hits
    from contacts c
    join players p on p.tg_id = c.from_id
    join players m on m.tg_id = uid
    where c.to_id = uid and c.status = 'pending'
    order by c.created_at desc) t), '[]'::json);
end $$;

-- ─── присутствие ───

create or replace function set_presence(
  p_lat float8 default null, p_lon float8 default null,
  p_place text default null, hours int default 6
) returns json
language plpgsql security definer set search_path = public as $$
declare uid bigint := me_id();
begin
  insert into presence (tg_id, lat, lon, place, updated_at, expires_at)
  values (uid, round(p_lat::numeric,3), round(p_lon::numeric,3),
          nullif(trim(p_place),''), now(), now() + make_interval(hours => hours))
  on conflict (tg_id) do update set
    lat = excluded.lat, lon = excluded.lon, place = excluded.place,
    updated_at = now(), expires_at = excluded.expires_at;
  return json_build_object('ok', true, 'expires_at', now() + make_interval(hours => hours));
end $$;

create or replace function clear_presence() returns json
language plpgsql security definer set search_path = public as $$
begin delete from presence where tg_id = me_id(); return json_build_object('ok',true); end $$;

create or replace function set_notify(n6 boolean, n5 boolean) returns json
language plpgsql security definer set search_path = public as $$
begin
  update players set notify_6 = n6, notify_5 = n5 where tg_id = me_id();
  return json_build_object('ok', true);
end $$;

create or replace function my_invite() returns json
language plpgsql security definer set search_path = public as $$
declare uid bigint := me_id(); c text;
begin
  select code into c from invites where owner_id = uid limit 1;
  if c is null then
    c := lower(substr(encode(gen_random_bytes(6),'hex'),1,8));
    insert into invites (code, owner_id) values (c, uid);
  end if;
  return json_build_object('code', c,
    'invited', (select count(*) from players where invited_by = uid));
end $$;

-- ─── админ ───

create or replace function admin_stats() returns json
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  return json_build_object(
    'total',        (select count(*) from players where not banned),
    'day',          (select count(*) from players where created_at > now() - interval '1 day'),
    'week',         (select count(*) from players where created_at > now() - interval '7 days'),
    'configs_used', (select count(distinct config_id) from players where not banned),
    'requests',     (select count(*) from contacts),
    'accepted',     (select count(*) from contacts where status='accepted'),
    'declined',     (select count(*) from contacts where status='declined'),
    'jackpots',     (select count(*) from contacts c
                       join players a on a.tg_id=c.from_id
                       join players b on b.tg_id=c.to_id
                      where a.config_id = b.config_id),
    'presence_now', (select count(*) from presence where expires_at > now()),
    'outbox_stuck', (select count(*) from outbox where sent_at is null and attempts >= 3),
    'bot_ok',       (select count(*) from players where bot_ok)
  );
end $$;

create or replace function admin_dump() returns json
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  return coalesce((select json_agg(row_to_json(t)) from (
    select p.tg_id, p.username, p.first_name,
           p.c1,p.c2,p.c3,p.c4,p.c5,p.c6, p.config_id,
           config_code(array[p.c1,p.c2,p.c3,p.c4,p.c5,p.c6]::smallint[]) as code,
           p.created_at, p.answered_at, p.invited_by, p.bot_ok,
           (select count(*) from contacts c
             where (c.from_id=p.tg_id or c.to_id=p.tg_id) and c.status='accepted') as contacts
    from players p order by p.created_at) t), '[]'::json);
end $$;

-- ═══════════════════════════════════════════════════════════════
--  ТРИГГЕРЫ И ФОНОВЫЕ ЗАДАЧИ
-- ═══════════════════════════════════════════════════════════════

-- Пуш тем, у кого совпало 6 из 6 или 5 из 6 с новичком / сменившим ответы
create or replace function notify_new_match() returns trigger
language plpgsql security definer set search_path = public as $$
declare ids int[];
begin
  if tg_op = 'UPDATE' and old.config_id = new.config_id then return new; end if;

  insert into outbox (tg_id, kind, payload)
  select p.tg_id, 'new_match',
         json_build_object('who', new.first_name, 'score',
           (p.c1=new.c1)::int+(p.c2=new.c2)::int+(p.c3=new.c3)::int
          +(p.c4=new.c4)::int+(p.c5=new.c5)::int+(p.c6=new.c6)::int)
  from players p
  where p.tg_id <> new.tg_id and not p.banned
    and p.config_id = any(neighbor_ids(array[new.c1,new.c2,new.c3,new.c4,new.c5,new.c6]::smallint[], 1))
    and (
      (p.config_id = new.config_id and p.notify_6)
      or (p.config_id <> new.config_id and p.notify_5)
    );
  return new;
end $$;

drop trigger if exists players_notify on players;
create trigger players_notify after insert or update of c1,c2,c3,c4,c5,c6 on players
for each row execute function notify_new_match();

-- Запрос на контакт и ответ на него
create or replace function notify_contact() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    insert into outbox (tg_id, kind, payload)
    values (new.to_id, 'contact_request',
      json_build_object('req', new.id, 'score', new.score,
        'who', (select first_name from players where tg_id = new.from_id)));

  elsif new.status = 'accepted' and (tg_op = 'INSERT' or old.status <> 'accepted') then
    insert into outbox (tg_id, kind, payload)
    select new.to_id, 'contact_open',
      json_build_object('peer', new.from_id, 'score', new.score,
        'who', (select first_name from players where tg_id = new.from_id),
        'nick',(select username   from players where tg_id = new.from_id))
    where new.via = 'app';
    insert into outbox (tg_id, kind, payload)
    values (new.from_id, 'contact_open',
      json_build_object('peer', new.to_id, 'score', new.score,
        'who', (select first_name from players where tg_id = new.to_id),
        'nick',(select username   from players where tg_id = new.to_id)));

  elsif new.status = 'declined' and tg_op = 'UPDATE' then
    insert into outbox (tg_id, kind, payload)
    values (new.from_id, 'contact_declined', '{}');
  end if;
  return new;
end $$;

drop trigger if exists contacts_notify on contacts;
create trigger contacts_notify after insert or update of status on contacts
for each row execute function notify_contact();

-- Срез базы для гистограмм
create or replace function refresh_axis_stats() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from axis_stats;
  insert into axis_stats (axis, val, cnt)
  select 1, c1, count(*) from players where not banned group by c1 union all
  select 2, c2, count(*) from players where not banned group by c2 union all
  select 3, c3, count(*) from players where not banned group by c3 union all
  select 4, c4, count(*) from players where not banned group by c4 union all
  select 5, c5, count(*) from players where not banned group by c5 union all
  select 6, c6, count(*) from players where not banned group by c6;
end $$;

create or replace function purge_presence() returns void
language plpgsql security definer set search_path = public as $$
begin delete from presence where expires_at < now(); end $$;

select cron.schedule('axis-stats', '*/5 * * * *', $$select refresh_axis_stats()$$);
select cron.schedule('purge-presence', '*/30 * * * *', $$select purge_presence()$$);

-- Разгребание очереди: раз в минуту дёргаем Edge Function pusher.
-- Подставьте свой project-ref и service_role key перед выполнением.
-- select cron.schedule('pusher', '* * * * *', $$
--   select net.http_post(
--     url := 'https://ВАШ_REF.supabase.co/functions/v1/pusher',
--     headers := '{"Authorization":"Bearer СЕРВИСНЫЙ_КЛЮЧ","Content-Type":"application/json"}'::jsonb,
--     body := '{}'::jsonb);
-- $$);

select refresh_axis_stats();
