-- Statistiques d'écoute pour l'admin : toute la plateforme, par pays, appareil, source.
--
-- Mêmes définitions que les statistiques du Studio (20261010000000_creator_stats.sql),
-- pour que les chiffres s'accordent partout :
--   * une écoute = une ligne de `plays` comptée (`counted`) ET qualifiée (`qualified`,
--     30 s validées, spec D1) ; `starts` = lectures démarrées et comptées ;
--   * auditeurs = comptes distincts (`user_id`) parmi les écoutes ; un compte supprimé
--     est anonymisé (user_id null) : plus compté comme auditeur, ses écoutes restent ;
--   * secondes = `validated_seconds` des écoutes qualifiées (mesurées par le serveur) ;
--   * jours en UTC ; fenêtre [p_from, p_to[ (borne haute exclue) ;
--   * aucune distinction de `entitlement` sauf si on filtre dessus (pendant la bêta tout
--     est « beta »).
--
-- Filtres communs : p_countries (liste de codes pays ISO ; null = tous, la région du
-- monde est résolue côté application), p_device, p_entitlement, p_artist_id.
-- Une écoute sans pays connu n'apparaît pas dès qu'un filtre de pays est actif.
--
-- Pourquoi des fonctions SQL : PostgREST plafonne une requête à 1 000 lignes et ne sait
-- pas faire de GROUP BY ; un décompte fait côté application serait silencieusement faux.
--
-- Sécurité : les tables ont la RLS sans policy ; ces fonctions ne sont appelables que
-- par la clé secret (service_role). On retire explicitement l'exécution à public / anon /
-- authenticated, sans quoi PostgREST les exposerait à tout porteur de la clé publique.
-- Elles donnent des agrégats, jamais une liste de personnes (sauf
-- admin_stats_user_top_artists, qui ne porte que sur UN compte et dont l'accès est
-- journalisé par l'admin).
--
-- Idempotente (create or replace). Seule modification de schéma : un index.

-- Historique d'un auditeur et « nouveaux auditeurs » : lectures par compte, par date.
create index if not exists idx_plays_user_started on plays (user_id, started_at desc);

-- =============================================================================
-- 1. Totaux de la fenêtre
-- =============================================================================

create or replace function admin_stats_totals(
  p_from timestamptz,
  p_to timestamptz,
  p_countries text[] default null,
  p_device text default null,
  p_entitlement text default null,
  p_artist_id uuid default null
)
returns table (
  starts bigint,
  plays bigint,
  listeners bigint,
  seconds numeric,
  artists bigint,
  tracks bigint,
  countries bigint,
  excluded bigint
)
language sql
stable
set search_path = public
as $$
  with p as (
    select p.user_id, p.artist_id, p.track_id, p.country_code, p.qualified, p.validated_seconds
    from plays p
    where p.counted
      and p.started_at >= p_from and p.started_at < p_to
      and (p_countries is null or p.country_code = any(p_countries))
      and (p_device is null or p.device_type = p_device)
      and (p_entitlement is null or p.entitlement::text = p_entitlement)
      and (p_artist_id is null or p.artist_id = p_artist_id)
  )
  select
    (select count(*) from p),
    (select count(*) from p where qualified),
    (select count(distinct user_id) from p where qualified),
    coalesce((select sum(validated_seconds) from p where qualified), 0),
    (select count(distinct artist_id) from p where qualified),
    (select count(distinct track_id) from p where qualified),
    (select count(distinct country_code) from p where qualified and country_code is not null),
    -- Écoutes exclues (counted = false) de la même fenêtre et des mêmes filtres.
    (
      select count(*)
      from plays x
      where not x.counted
        and x.started_at >= p_from and x.started_at < p_to
        and (p_countries is null or x.country_code = any(p_countries))
        and (p_device is null or x.device_type = p_device)
        and (p_entitlement is null or x.entitlement::text = p_entitlement)
        and (p_artist_id is null or x.artist_id = p_artist_id)
    );
$$;

-- =============================================================================
-- 2. Série journalière (les jours sans écoute sont présents, à zéro)
-- =============================================================================

create or replace function admin_stats_daily(
  p_from timestamptz,
  p_to timestamptz,
  p_countries text[] default null,
  p_device text default null,
  p_entitlement text default null,
  p_artist_id uuid default null
)
returns table (
  day date,
  starts bigint,
  plays bigint,
  listeners bigint,
  seconds numeric
)
language sql
stable
set search_path = public
as $$
  with days as (
    -- timestamp sans fuseau : le ::date reste celui du jour UTC quel que soit le
    -- fuseau de la session.
    select d::date as day
    from generate_series(
      (p_from at time zone 'UTC')::date::timestamp,
      ((p_to at time zone 'UTC') - interval '1 microsecond')::date::timestamp,
      interval '1 day'
    ) d
  ),
  agg as (
    select
      (p.started_at at time zone 'UTC')::date as day,
      count(*) as n_starts,
      count(*) filter (where p.qualified) as n_plays,
      count(distinct p.user_id) filter (where p.qualified) as n_listeners,
      sum(p.validated_seconds) filter (where p.qualified) as n_seconds
    from plays p
    where p.counted
      and p.started_at >= p_from and p.started_at < p_to
      and (p_countries is null or p.country_code = any(p_countries))
      and (p_device is null or p.device_type = p_device)
      and (p_entitlement is null or p.entitlement::text = p_entitlement)
      and (p_artist_id is null or p.artist_id = p_artist_id)
    group by 1
  )
  select d.day, coalesce(a.n_starts, 0), coalesce(a.n_plays, 0), coalesce(a.n_listeners, 0), coalesce(a.n_seconds, 0)
  from days d
  left join agg a using (day)
  order by d.day;
$$;

-- =============================================================================
-- 3. Artistes les plus écoutés
-- =============================================================================

create or replace function admin_stats_top_artists(
  p_from timestamptz,
  p_to timestamptz,
  p_countries text[] default null,
  p_device text default null,
  p_entitlement text default null,
  p_limit integer default 20
)
returns table (
  artist_id uuid,
  name text,
  plays bigint,
  seconds numeric,
  listeners bigint,
  countries bigint
)
language sql
stable
set search_path = public
as $$
  select
    p.artist_id,
    a.name,
    count(*),
    coalesce(sum(p.validated_seconds), 0),
    count(distinct p.user_id),
    count(distinct p.country_code)
  from plays p
  join artists a on a.id = p.artist_id
  where p.counted and p.qualified
    and p.started_at >= p_from and p.started_at < p_to
    and (p_countries is null or p.country_code = any(p_countries))
    and (p_device is null or p.device_type = p_device)
    and (p_entitlement is null or p.entitlement::text = p_entitlement)
  group by p.artist_id, a.name
  -- artist_id en dernier critère : un classement identique d'un appel à l'autre.
  order by count(*) desc, coalesce(sum(p.validated_seconds), 0) desc, p.artist_id
  limit least(greatest(coalesce(p_limit, 20), 1), 200);
$$;

-- =============================================================================
-- 4. Morceaux les plus écoutés (de toute la plateforme ou d'un artiste)
-- =============================================================================

create or replace function admin_stats_top_tracks(
  p_from timestamptz,
  p_to timestamptz,
  p_countries text[] default null,
  p_device text default null,
  p_entitlement text default null,
  p_artist_id uuid default null,
  p_limit integer default 20
)
returns table (
  track_id uuid,
  title text,
  artist_id uuid,
  artist_name text,
  plays bigint,
  seconds numeric,
  listeners bigint
)
language sql
stable
set search_path = public
as $$
  select
    p.track_id,
    t.title,
    p.artist_id,
    a.name,
    count(*),
    coalesce(sum(p.validated_seconds), 0),
    count(distinct p.user_id)
  from plays p
  join tracks t on t.id = p.track_id
  join artists a on a.id = p.artist_id
  where p.counted and p.qualified
    and p.started_at >= p_from and p.started_at < p_to
    and (p_countries is null or p.country_code = any(p_countries))
    and (p_device is null or p.device_type = p_device)
    and (p_entitlement is null or p.entitlement::text = p_entitlement)
    and (p_artist_id is null or p.artist_id = p_artist_id)
  group by p.track_id, t.title, p.artist_id, a.name
  order by count(*) desc, coalesce(sum(p.validated_seconds), 0) desc, p.track_id
  limit least(greatest(coalesce(p_limit, 20), 1), 200);
$$;

-- =============================================================================
-- 5. D'où on écoute : par pays (« unknown » = pays non déterminé)
-- =============================================================================

create or replace function admin_stats_by_country(
  p_from timestamptz,
  p_to timestamptz,
  p_countries text[] default null,
  p_device text default null,
  p_entitlement text default null,
  p_artist_id uuid default null
)
returns table (
  country text,
  starts bigint,
  plays bigint,
  seconds numeric,
  listeners bigint
)
language sql
stable
set search_path = public
as $$
  select
    coalesce(p.country_code, 'unknown'),
    count(*),
    count(*) filter (where p.qualified),
    coalesce(sum(p.validated_seconds) filter (where p.qualified), 0),
    count(distinct p.user_id) filter (where p.qualified)
  from plays p
  where p.counted
    and p.started_at >= p_from and p.started_at < p_to
    and (p_countries is null or p.country_code = any(p_countries))
    and (p_device is null or p.device_type = p_device)
    and (p_entitlement is null or p.entitlement::text = p_entitlement)
    and (p_artist_id is null or p.artist_id = p_artist_id)
  group by 1
  order by 3 desc, 4 desc, 1;
$$;

-- =============================================================================
-- 6. Répartition : appareil, origine de la lecture, droit d'écoute, version, heure
-- =============================================================================

create or replace function admin_stats_breakdown(
  p_from timestamptz,
  p_to timestamptz,
  p_countries text[] default null,
  p_device text default null,
  p_entitlement text default null,
  p_artist_id uuid default null
)
returns table (
  dimension text,
  key text,
  plays bigint,
  seconds numeric,
  listeners bigint
)
language sql
stable
set search_path = public
as $$
  with p as (
    select
      coalesce(p.device_type, 'unknown') as device,
      coalesce(p.source_context, 'unknown') as src,
      p.entitlement::text as entitlement,
      coalesce(p.app_version, 'unknown') as app_version,
      to_char(p.started_at at time zone 'UTC', 'HH24') as hour_utc,
      p.user_id,
      p.validated_seconds
    from plays p
    where p.counted and p.qualified
      and p.started_at >= p_from and p.started_at < p_to
      and (p_countries is null or p.country_code = any(p_countries))
      and (p_device is null or p.device_type = p_device)
      and (p_entitlement is null or p.entitlement::text = p_entitlement)
      and (p_artist_id is null or p.artist_id = p_artist_id)
  )
  select 'device'::text, device, count(*), coalesce(sum(validated_seconds), 0), count(distinct user_id) from p group by device
  union all
  select 'source'::text, src, count(*), coalesce(sum(validated_seconds), 0), count(distinct user_id) from p group by src
  union all
  select 'entitlement'::text, entitlement, count(*), coalesce(sum(validated_seconds), 0), count(distinct user_id) from p group by entitlement
  union all
  select 'app_version'::text, app_version, count(*), coalesce(sum(validated_seconds), 0), count(distinct user_id) from p group by app_version
  union all
  select 'hour_utc'::text, hour_utc, count(*), coalesce(sum(validated_seconds), 0), count(distinct user_id) from p group by hour_utc
  order by 1, 3 desc, 2;
$$;

-- =============================================================================
-- 7. Auditeurs : nouveaux ou de retour, et intensité d'écoute
-- =============================================================================

-- « Nouveau » = sa toute première écoute qualifiée tombe dans la fenêtre. Les tranches
-- comptent les auditeurs selon leur nombre d'écoutes qualifiées dans la fenêtre.
create or replace function admin_stats_listeners(
  p_from timestamptz,
  p_to timestamptz,
  p_countries text[] default null,
  p_device text default null,
  p_entitlement text default null,
  p_artist_id uuid default null
)
returns table (
  listeners bigint,
  new_listeners bigint,
  returning_listeners bigint,
  plays_1_4 bigint,
  plays_5_19 bigint,
  plays_20_99 bigint,
  plays_100_plus bigint
)
language sql
stable
set search_path = public
as $$
  with w as (
    select p.user_id, count(*) as n
    from plays p
    where p.counted and p.qualified and p.user_id is not null
      and p.started_at >= p_from and p.started_at < p_to
      and (p_countries is null or p.country_code = any(p_countries))
      and (p_device is null or p.device_type = p_device)
      and (p_entitlement is null or p.entitlement::text = p_entitlement)
      and (p_artist_id is null or p.artist_id = p_artist_id)
    group by p.user_id
  ),
  first_play as (
    select x.user_id, min(x.started_at) as first_at
    from plays x
    where x.counted and x.qualified and x.user_id in (select user_id from w)
    group by x.user_id
  )
  select
    count(*),
    count(*) filter (where f.first_at >= p_from and f.first_at < p_to),
    count(*) filter (where not (f.first_at >= p_from and f.first_at < p_to)),
    count(*) filter (where w.n between 1 and 4),
    count(*) filter (where w.n between 5 and 19),
    count(*) filter (where w.n between 20 and 99),
    count(*) filter (where w.n >= 100)
  from w
  join first_play f using (user_id);
$$;

-- =============================================================================
-- 8. Auditeurs actifs : jour, semaine, mois glissants
-- =============================================================================

create or replace function admin_stats_active_users(p_at timestamptz default now())
returns table (
  dau bigint,
  wau bigint,
  mau bigint
)
language sql
stable
set search_path = public
as $$
  select
    count(distinct p.user_id) filter (where p.started_at >= p_at - interval '1 day'),
    count(distinct p.user_id) filter (where p.started_at >= p_at - interval '7 days'),
    count(distinct p.user_id)
  from plays p
  where p.counted and p.qualified and p.user_id is not null
    and p.started_at >= p_at - interval '30 days' and p.started_at < p_at;
$$;

-- =============================================================================
-- 9. Qualité de la collecte : quelle part des écoutes porte pays, appareil, empreinte
-- =============================================================================

create or replace function admin_stats_data_quality(p_from timestamptz, p_to timestamptz)
returns table (
  total bigint,
  with_country bigint,
  with_device bigint,
  with_ip_hash bigint,
  with_source bigint
)
language sql
stable
set search_path = public
as $$
  select
    count(*),
    count(p.country_code),
    count(p.device_type),
    count(p.ip_hash),
    count(p.source_context)
  from plays p
  where p.counted
    and p.started_at >= p_from and p.started_at < p_to;
$$;

-- =============================================================================
-- 10. Artistes écoutés par UN compte (accès individuel : journalisé par l'admin)
-- =============================================================================

create or replace function admin_stats_user_top_artists(p_user_id uuid, p_limit integer default 10)
returns table (
  artist_id uuid,
  name text,
  plays bigint,
  seconds numeric
)
language sql
stable
set search_path = public
as $$
  select
    p.artist_id,
    a.name,
    count(*),
    coalesce(sum(p.validated_seconds), 0)
  from plays p
  join artists a on a.id = p.artist_id
  where p.user_id = p_user_id
    and p.counted and p.qualified
  group by p.artist_id, a.name
  order by count(*) desc, coalesce(sum(p.validated_seconds), 0) desc, p.artist_id
  limit least(greatest(coalesce(p_limit, 10), 1), 50);
$$;

-- =============================================================================
-- 11. Droits d'exécution : service_role uniquement
-- =============================================================================

revoke all on function admin_stats_totals(timestamptz, timestamptz, text[], text, text, uuid) from public, anon, authenticated;
revoke all on function admin_stats_daily(timestamptz, timestamptz, text[], text, text, uuid) from public, anon, authenticated;
revoke all on function admin_stats_top_artists(timestamptz, timestamptz, text[], text, text, integer) from public, anon, authenticated;
revoke all on function admin_stats_top_tracks(timestamptz, timestamptz, text[], text, text, uuid, integer) from public, anon, authenticated;
revoke all on function admin_stats_by_country(timestamptz, timestamptz, text[], text, text, uuid) from public, anon, authenticated;
revoke all on function admin_stats_breakdown(timestamptz, timestamptz, text[], text, text, uuid) from public, anon, authenticated;
revoke all on function admin_stats_listeners(timestamptz, timestamptz, text[], text, text, uuid) from public, anon, authenticated;
revoke all on function admin_stats_active_users(timestamptz) from public, anon, authenticated;
revoke all on function admin_stats_data_quality(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function admin_stats_user_top_artists(uuid, integer) from public, anon, authenticated;

grant execute on function admin_stats_totals(timestamptz, timestamptz, text[], text, text, uuid) to service_role;
grant execute on function admin_stats_daily(timestamptz, timestamptz, text[], text, text, uuid) to service_role;
grant execute on function admin_stats_top_artists(timestamptz, timestamptz, text[], text, text, integer) to service_role;
grant execute on function admin_stats_top_tracks(timestamptz, timestamptz, text[], text, text, uuid, integer) to service_role;
grant execute on function admin_stats_by_country(timestamptz, timestamptz, text[], text, text, uuid) to service_role;
grant execute on function admin_stats_breakdown(timestamptz, timestamptz, text[], text, text, uuid) to service_role;
grant execute on function admin_stats_listeners(timestamptz, timestamptz, text[], text, text, uuid) to service_role;
grant execute on function admin_stats_active_users(timestamptz) to service_role;
grant execute on function admin_stats_data_quality(timestamptz, timestamptz) to service_role;
grant execute on function admin_stats_user_top_artists(uuid, integer) to service_role;

-- Demande à l'API de Supabase (PostgREST) de relire le schéma.
notify pgrst, 'reload schema';

-- =============================================================================
-- Vérification après application (à lancer à la main) :
--
--   select proname from pg_proc where proname like 'admin_stats_%' order by 1;
--   -- doit renvoyer 10 lignes
-- =============================================================================
