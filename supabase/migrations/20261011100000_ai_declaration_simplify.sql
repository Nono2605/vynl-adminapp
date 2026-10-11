-- Simplification des déclarations IA (décision de produit du 11 oct. 2026).
--
-- Une déclaration n'est plus « relue » avant publication : le créateur déclare, c'est
-- tout. Un admin ne l'écarte que dans un cas exceptionnel (refus, qui bloque la
-- publication du morceau, avec un motif que le créateur peut lire). Il ne reste donc
-- que deux états, et plus rien à « approuver ».
--
--   avant : status ∈ pending_review | approved | rejected, reviewed_by, reviewed_at
--   après : status ∈ declared | rejected, review_note (le motif d'un refus)
--
--   * pending_review et approved deviennent « declared » ;
--   * rejected reste rejected, avec son motif (review_note) ;
--   * reviewed_by et reviewed_at disparaissent : qui a refusé, quand et pourquoi est
--     dans admin_audit_log (écrit avant chaque action, jamais modifiable).
--
-- Aucune application n'est à redéployer : le Studio n'utilise pas le statut, l'API ne
-- fait que le renvoyer, et le code de l'admin accepte l'ancien comme le nouveau
-- schéma. À appliquer UNE FOIS dans le SQL Editor de Supabase. Idempotente : rejouée,
-- elle ne fait rien. IRRÉVERSIBLE pour reviewed_by / reviewed_at (colonnes supprimées).
--
-- Avant de l'appliquer, pour voir ce qui va changer :
--   select status, count(*) from public.ai_declarations group by 1;

do $$
begin
  if exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'declaration_status' and e.enumlabel = 'declared'
  ) then
    raise notice 'ai_declarations: already simplified, nothing to do';
    return;
  end if;

  -- Postgres ne sait pas retirer une valeur d'un type énuméré : on le remplace.
  create type public.declaration_status_new as enum ('declared', 'rejected');

  alter table public.ai_declarations alter column status drop default;
  alter table public.ai_declarations
    alter column status type public.declaration_status_new
    using (case status::text when 'rejected' then 'rejected' else 'declared' end)::public.declaration_status_new;

  drop type public.declaration_status;
  alter type public.declaration_status_new rename to declaration_status;
  alter table public.ai_declarations alter column status set default 'declared';

  alter table public.ai_declarations drop column if exists reviewed_by;
  alter table public.ai_declarations drop column if exists reviewed_at;
end $$;

-- Le motif d'un refus (ajoutée par la migration des actions d'admin ; ne fait rien si
-- elle existe déjà).
alter table public.ai_declarations add column if not exists review_note text;

-- Demande à l'API de Supabase (PostgREST) de relire le schéma.
notify pgrst, 'reload schema';

-- =============================================================================
-- Vérification après application (à lancer à la main) :
--
--   select status, count(*) from public.ai_declarations group by 1;
--   -- ne doit plus montrer que « declared » et « rejected »
--
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'ai_declarations' order by ordinal_position;
--   -- plus de reviewed_by ni reviewed_at ; review_note présente
-- =============================================================================
