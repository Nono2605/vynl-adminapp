import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type Tier = "paying" | "trial" | "free";

export interface SubscriptionLike {
  status: string;
  current_period_end: string | null;
}

// Même règle que resolveEntitlement() de l'API (API/src/lib/entitlement.ts) :
// une période échue ne donne aucun droit payant ; abonnement actif dans sa
// période = payant, essai dans sa période = essai, le reste = gratuit. Si la
// règle change côté API, la changer ici aussi.
export function tierOf(subscriptions: SubscriptionLike[], now: Date = new Date()): Tier {
  let best: Tier = "free";
  for (const sub of subscriptions) {
    const inPeriod = sub.current_period_end === null || Date.parse(sub.current_period_end) > now.getTime();
    if (inPeriod && sub.status === "active") return "paying";
    if (inPeriod && sub.status === "trialing") best = "trial";
  }
  return best;
}

export interface SubscriptionBreakdown {
  totalUsers: number;
  paying: number;
  trial: number;
  free: number;
  pastDue: number;
  // Plans des abonnés payants : { plan: nombre }
  paidByPlan: Record<string, number>;
  // true si le plafond de lignes lues est atteint (les chiffres sont alors minimaux).
  truncated: boolean;
  error?: string;
}

const MAX_ROWS = 5000;

// Répartition payant / essai / gratuit, calculée par UTILISATEUR (un compte avec
// deux abonnements ne compte qu'une fois) à partir de la table subscriptions,
// pas de plays.entitlement : en bêta toutes les écoutes sont « beta » et ne
// disent rien de l'abonnement.
export async function getSubscriptionBreakdown(): Promise<SubscriptionBreakdown> {
  const db = supabaseAdmin();

  const [users, subs] = await Promise.all([
    db.from("users").select("id", { count: "exact", head: true }),
    db
      .from("subscriptions")
      .select("user_id, plan, status, current_period_end")
      .in("status", ["active", "trialing", "past_due"])
      .not("user_id", "is", null)
      .limit(MAX_ROWS),
  ]);

  const empty: SubscriptionBreakdown = {
    totalUsers: 0,
    paying: 0,
    trial: 0,
    free: 0,
    pastDue: 0,
    paidByPlan: {},
    truncated: false,
  };

  if (users.error) return { ...empty, error: users.error.message };
  if (subs.error) return { ...empty, totalUsers: users.count ?? 0, error: subs.error.message };

  const now = new Date();
  const byUser = new Map<string, { subs: (SubscriptionLike & { plan: string })[] }>();
  for (const row of subs.data as { user_id: string; plan: string; status: string; current_period_end: string | null }[]) {
    const entry = byUser.get(row.user_id) ?? { subs: [] };
    entry.subs.push(row);
    byUser.set(row.user_id, entry);
  }

  let paying = 0;
  let trial = 0;
  let pastDue = 0;
  const paidByPlan: Record<string, number> = {};

  for (const { subs: userSubs } of byUser.values()) {
    const tier = tierOf(userSubs, now);
    if (tier === "paying") {
      paying += 1;
      const plan = userSubs.find((s) => s.status === "active")?.plan ?? "unknown";
      paidByPlan[plan] = (paidByPlan[plan] ?? 0) + 1;
    } else if (tier === "trial") {
      trial += 1;
    } else if (userSubs.some((s) => s.status === "past_due")) {
      pastDue += 1;
    }
  }

  const totalUsers = users.count ?? 0;

  return {
    totalUsers,
    paying,
    trial,
    free: Math.max(totalUsers - paying - trial, 0),
    pastDue,
    paidByPlan,
    truncated: (subs.data?.length ?? 0) >= MAX_ROWS,
  };
}
