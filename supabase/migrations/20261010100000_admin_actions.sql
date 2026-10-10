-- Actions d'administration : journal d'audit + motifs de refus.
--
-- À appliquer UNE FOIS dans le SQL Editor de Supabase (Idempotente : on peut la
-- rejouer sans risque). Tant qu'elle n'est pas appliquée, l'admin refuse
-- d'exécuter la moindre action : une action qu'on ne peut pas journaliser ne
-- doit pas avoir lieu.
--
-- Ce fichier vit dans le dépôt de l'admin ; la même migration devra être copiée
-- dans API/supabase/migrations pour que le schéma ait une seule source de vérité.

-- =============================================================================
-- 1. Journal d'audit
-- =============================================================================

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- L'admin qui agit. On garde son email à part : le journal doit rester lisible
  -- même si le compte est un jour anonymisé.
  admin_id uuid references public.users(id) on delete set null,
  admin_email text not null,
  -- Ex. : user.suspend, user.set_role, track.approve, track.refuse…
  action text not null,
  target_type text not null,
  target_id uuid,
  target_label text,
  -- Avant / après, motif. Jamais un secret (mot de passe, jeton).
  details jsonb not null default '{}'::jsonb,
  -- Écrit AVANT l'action (pending), finalisé APRÈS : une action qui plante en
  -- route laisse une trace.
  outcome text not null default 'pending' check (outcome in ('pending', 'success', 'failed')),
  error text,
  finished_at timestamptz
);

create index if not exists idx_admin_audit_log_created_at on public.admin_audit_log (created_at desc);
create index if not exists idx_admin_audit_log_target on public.admin_audit_log (target_type, target_id);

-- Comme les autres tables : RLS activée sans policy, seule la clé secret y accède.
alter table public.admin_audit_log enable row level security;

-- Un journal ne s'efface ni ne se réécrit : une ligne ne peut plus changer une
-- fois son résultat posé, et seuls le résultat, l'erreur et le détail d'une
-- ligne « pending » peuvent être complétés.
create or replace function public.admin_audit_log_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'admin_audit_log rows cannot be deleted' using errcode = '23514';
  end if;

  if old.outcome <> 'pending' then
    raise exception 'admin_audit_log rows are final once their outcome is set' using errcode = '23514';
  end if;

  if new.id <> old.id
     or new.created_at <> old.created_at
     or new.admin_email <> old.admin_email
     or new.action <> old.action
     or new.target_type <> old.target_type
     or new.target_id is distinct from old.target_id then
    raise exception 'Only the outcome, error and details of an audit entry can be completed'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists admin_audit_log_guard on public.admin_audit_log;
create trigger admin_audit_log_guard
  before update or delete on public.admin_audit_log
  for each row execute function public.admin_audit_log_guard();

-- =============================================================================
-- 2. Motifs de refus, visibles par le créateur (à afficher dans le Studio)
-- =============================================================================

alter table public.tracks add column if not exists rejection_reason text;
alter table public.albums add column if not exists rejection_reason text;
alter table public.ai_declarations add column if not exists review_note text;

-- =============================================================================
-- Vérification après application (à lancer à la main) :
--
--   select table_name, column_name from information_schema.columns
--   where table_schema = 'public'
--     and (table_name, column_name) in (
--       ('tracks', 'rejection_reason'), ('albums', 'rejection_reason'),
--       ('ai_declarations', 'review_note'), ('admin_audit_log', 'outcome'));
--   -- doit renvoyer 4 lignes
-- =============================================================================
