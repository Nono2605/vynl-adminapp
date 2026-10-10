import Link from "next/link";
import { FilterPills } from "@/components/FilterPills";
import { Notice } from "@/components/Notice";
import { PageHead } from "@/components/PageHead";
import { Pager } from "@/components/Pager";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate } from "@/lib/format";
import { escapeLike, first, oneOf, pageRange, parsePage, pick, type SearchParams } from "@/lib/query";
import { requireAdmin } from "@/lib/session";
import { tierOf } from "@/lib/subscription";
import { supabaseAdmin } from "@/lib/supabase/admin";

const ROLES = ["listener", "creator", "admin"] as const;
const STATUSES = ["active", "suspended", "deleted"] as const;

interface UserRow {
  id: string;
  email: string;
  role: string;
  status: string;
  created_at: string;
  profiles: { username: string; country: string | null } | { username: string; country: string | null }[] | null;
  subscriptions: { status: string; current_period_end: string | null }[] | null;
}

export default async function UsersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();

  const params = await searchParams;
  const q = pick(params, "q");
  const role = oneOf(pick(params, "role"), ROLES);
  const status = oneOf(pick(params, "status"), STATUSES);
  const page = parsePage(params);
  const [from, to] = pageRange(page);

  const db = supabaseAdmin();
  const head = { count: "exact", head: true } as const;

  let query = db
    .from("users")
    .select(
      "id, email, role, status, created_at, profiles(username, country), subscriptions(status, current_period_end)",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range(from, to);
  if (q) query = query.ilike("email", `%${escapeLike(q)}%`);
  if (role) query = query.eq("role", role);
  if (status) query = query.eq("status", status);

  const [list, all, listeners, creators, admins] = await Promise.all([
    query,
    db.from("users").select("id", head),
    db.from("users").select("id", head).eq("role", "listener"),
    db.from("users").select("id", head).eq("role", "creator"),
    db.from("users").select("id", head).eq("role", "admin"),
  ]);

  const rows = (list.data ?? []) as unknown as UserRow[];
  const now = new Date();
  const filters = { q, role, status };

  return (
    <>
      <PageHead title="Users" />

      <FilterPills
        basePath="/users"
        param="role"
        current={role ?? ""}
        params={filters}
        options={[
          { label: "All", value: "", count: all.error ? null : all.count },
          { label: "Listeners", value: "listener", count: listeners.error ? null : listeners.count },
          { label: "Creators", value: "creator", count: creators.error ? null : creators.count },
          { label: "Admins", value: "admin", count: admins.error ? null : admins.count },
        ]}
      />

      <form method="get" action="/users" className="filters">
        {role && <input type="hidden" name="role" value={role} />}
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search by email"
          className="input-field input-field--sm filters__search"
        />
        <select name="status" defaultValue={status ?? ""} className="input-field input-field--sm">
          <option value="">Any status</option>
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-secondary btn-sm">
          Apply
        </button>
        {(q || status) && (
          <Link href={role ? `/users?role=${role}` : "/users"} className="text-link">
            Reset
          </Link>
        )}
      </form>

      {list.error && <Notice>Could not load users: {list.error.message}</Notice>}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Username</th>
              <th>Role</th>
              <th>Status</th>
              <th>Plan</th>
              <th>Country</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="empty">
                  No users match.
                </td>
              </tr>
            )}
            {rows.map((user) => {
              const profile = first(user.profiles);
              return (
                <tr key={user.id}>
                  <td className="cell-main">
                    <Link href={`/users/${user.id}`} className="text-link">
                      {user.email}
                    </Link>
                  </td>
                  <td>{profile?.username ?? "—"}</td>
                  <td>
                    <StatusBadge status={user.role} />
                  </td>
                  <td>
                    <StatusBadge status={user.status} />
                  </td>
                  <td>
                    <StatusBadge status={tierOf(user.subscriptions ?? [], now)} />
                  </td>
                  <td>{profile?.country ?? "—"}</td>
                  <td>{formatDate(user.created_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pager basePath="/users" params={filters} page={page} total={list.count ?? 0} />
    </>
  );
}
