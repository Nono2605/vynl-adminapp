-- Nettoyage ponctuel : supprime les « re-saves » de déclarations IA.
--
-- Avant la correction de l'API (commit « Do not add an AI declaration when nothing
-- changed »), chaque clic sur « Save declaration » du Studio ajoutait une ligne, même
-- sans rien changer. Ce script supprime ces lignes en trop. Ce n'est PAS une
-- migration (aucun schéma ne change) : à lancer une fois, à la main, dans le SQL
-- Editor de Supabase.
--
-- Règle : pour chaque morceau, les déclarations sont lues de la plus ancienne à la
-- plus récente. Une déclaration est un « re-save » si elle est IDENTIQUE à celle qui la
-- précède (même provenance, même description, mêmes outils, et toutes deux refusées ou
-- toutes deux non refusées). On garde la première de chaque série : c'est la vraie
-- date de déclaration. Sont donc CONSERVÉES :
--   * tout vrai changement (A, puis B, puis de nouveau A : les trois restent) ;
--   * tout refus, et la déclaration identique renvoyée après un refus (preuve) ;
--   * toute déclaration citée dans le journal d'audit (admin_audit_log).
--
-- IRRÉVERSIBLE. Lancez d'abord l'APERÇU (1), vérifiez la liste, puis la SUPPRESSION (2).
-- Idempotente : relancée, elle ne supprime plus rien.

-- (1) APERÇU — ne supprime rien : liste les lignes qui seraient supprimées.
with ordered as (
  select
    d.id,
    d.track_id,
    d.declared_at,
    d.provenance,
    d.description,
    d.ai_tool_names,
    (d.status = 'rejected') as rejected,
    lag(d.provenance)         over w as prev_provenance,
    lag(d.description)        over w as prev_description,
    lag(d.ai_tool_names)      over w as prev_tools,
    lag(d.status = 'rejected') over w as prev_rejected,
    lag(d.id)                 over w as prev_id
  from public.ai_declarations d
  window w as (partition by d.track_id order by d.declared_at asc, d.id asc)
),
doomed as (
  select o.*
  from ordered o
  where o.prev_id is not null
    and o.provenance = o.prev_provenance
    and o.description is not distinct from o.prev_description
    and o.ai_tool_names is not distinct from o.prev_tools
    and o.rejected = o.prev_rejected
    and not exists (
      select 1 from public.admin_audit_log a
      where a.target_type = 'ai_declaration' and a.target_id = o.id
    )
)
select t.title as track, doomed.provenance, doomed.declared_at as will_be_deleted, doomed.id
from doomed
join public.tracks t on t.id = doomed.track_id
order by t.title, doomed.declared_at;

-- (2) SUPPRESSION — même règle, une seule instruction (atomique). Renvoie les lignes supprimées.
with ordered as (
  select
    d.id,
    d.track_id,
    d.provenance,
    d.description,
    d.ai_tool_names,
    (d.status = 'rejected') as rejected,
    lag(d.provenance)         over w as prev_provenance,
    lag(d.description)        over w as prev_description,
    lag(d.ai_tool_names)      over w as prev_tools,
    lag(d.status = 'rejected') over w as prev_rejected,
    lag(d.id)                 over w as prev_id
  from public.ai_declarations d
  window w as (partition by d.track_id order by d.declared_at asc, d.id asc)
),
doomed as (
  select o.id
  from ordered o
  where o.prev_id is not null
    and o.provenance = o.prev_provenance
    and o.description is not distinct from o.prev_description
    and o.ai_tool_names is not distinct from o.prev_tools
    and o.rejected = o.prev_rejected
    and not exists (
      select 1 from public.admin_audit_log a
      where a.target_type = 'ai_declaration' and a.target_id = o.id
    )
)
delete from public.ai_declarations
where id in (select id from doomed)
returning id, track_id, provenance, declared_at;
