-- Statistiques d'écoute PAR GENRE pour l'admin : quels styles sont les plus écoutés.
--
-- À appliquer APRÈS la migration de l'API 20261014000002_genres.sql (qui crée la table `genres` et la
-- colonne `tracks.genre_code`). Mêmes définitions que les autres statistiques de l'admin
-- (20261011200000_admin_analytics.sql) : une écoute = une ligne de `plays` comptée ET qualifiée (30 s
-- validées), secondes = `validated_seconds`, auditeurs = comptes distincts, fenêtre [p_from, p_to[ en UTC,
-- mêmes filtres (pays, appareil, formule, artiste).
--
-- Un morceau SANS genre (tous les morceaux d'avant la migration) est regroupé sous « none » (« No genre »),
-- pour que le total reste exact et que la part des morceaux non classés se voie.
--
-- Agrégats seulement, jamais une liste de personnes. Sécurité : exécution réservée à la clé secret
-- (service_role), comme les autres fonctions de statistiques.
--
-- Idempotente (create or replace).

create or replace function admin_stats_genres(
  p_from timestamptz,
  p_to timestamptz,
  p_countries text[] default null,
  p_device text default null,
  p_entitlement text default null,
  p_artist_id uuid default null
)
returns table (
  genre_code text,
  label text,
  plays bigint,
  seconds numeric,
  listeners bigint,
  tracks bigint
)
language sql
stable
set search_path = public
as $$
  select
    coalesce(t.genre_code, 'none'),
    coalesce(g.label, 'No genre'),
    count(*),
    coalesce(sum(p.validated_seconds), 0),
    count(distinct p.user_id),
    count(distinct p.track_id)
  from plays p
  join tracks t on t.id = p.track_id
  left join genres g on g.code = t.genre_code
  where p.counted and p.qualified
    and p.started_at >= p_from and p.started_at < p_to
    and (p_countries is null or p.country_code = any(p_countries))
    and (p_device is null or p.device_type = p_device)
    and (p_entitlement is null or p.entitlement::text = p_entitlement)
    and (p_artist_id is null or p.artist_id = p_artist_id)
  group by coalesce(t.genre_code, 'none'), coalesce(g.label, 'No genre')
  order by count(*) desc, coalesce(sum(p.validated_seconds), 0) desc, 1;
$$;

revoke all on function admin_stats_genres(timestamptz, timestamptz, text[], text, text, uuid) from public, anon, authenticated;
grant execute on function admin_stats_genres(timestamptz, timestamptz, text[], text, text, uuid) to service_role;

-- Demande à l'API de Supabase (PostgREST) de relire le schéma.
notify pgrst, 'reload schema';

-- Vérification après application (à lancer à la main) :
--   select * from admin_stats_genres(now() - interval '30 days', now() + interval '1 day');
--   -- une ligne par genre écouté, plus « none » pour les morceaux sans genre
