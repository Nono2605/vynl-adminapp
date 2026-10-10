import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Une période de royalties close (closed / computed / published) est immuable :
// ce qui a servi à la calculer ne doit plus bouger (spec de rémunération,
// section 11). La base n'impose pas encore cette règle par trigger ; en
// attendant, l'admin refuse lui-même de modifier une écoute qui y appartient.
const FROZEN_STATUSES = ["closed", "computed", "published"];

export interface FrozenPeriod {
  id: string;
  period_start: string;
  period_end: string;
  status: string;
}

// La période figée qui contient cet instant (jour UTC), ou null.
export async function findFrozenPeriod(at: string): Promise<FrozenPeriod | null> {
  const day = at.slice(0, 10);
  const { data, error } = await supabaseAdmin()
    .from("royalty_periods")
    .select("id, period_start, period_end, status")
    .in("status", FROZEN_STATUSES)
    .lte("period_start", day)
    .gte("period_end", day)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not check the royalty periods: ${error.message}`);
  return data as FrozenPeriod | null;
}
