import Link from "next/link";
import { Notice } from "@/components/Notice";
import { PageHead } from "@/components/PageHead";
import { ANALYTICS_MIGRATION, filterParams, type Result } from "@/lib/analytics";
import { DEVICES, PLANS, describeFilters, type AnalyticsFilters } from "@/lib/analyticsFilters";
import { REGION_OPTIONS } from "@/lib/geo";
import { withParams } from "@/lib/query";

const TABS = [
  { id: "overview", label: "Overview", path: "/analytics" },
  { id: "artists", label: "Artists", path: "/analytics/artists" },
  { id: "genres", label: "Genres", path: "/analytics/genres" },
  { id: "geography", label: "Geography", path: "/analytics/geography" },
  { id: "listeners", label: "Listeners", path: "/analytics/listeners" },
  { id: "sources", label: "Sources", path: "/analytics/sources" },
] as const;

export type AnalyticsTab = (typeof TABS)[number]["id"];

// Titre, onglets, filtres (un simple formulaire GET : l'adresse partage la vue exacte)
// et rappel de ce qui est affiché. `path` : la page courante, pour que le formulaire
// recharge la même page.
export function AnalyticsHeader({
  title,
  active,
  path,
  filters,
  plain = false,
}: {
  title: string;
  active: AnalyticsTab;
  path: string;
  filters: AnalyticsFilters;
  // Titre en police simple : pour un nom saisi par un utilisateur (artiste).
  plain?: boolean;
}) {
  const params = filterParams(filters);
  const groups = ["Markets", "Continents", "Subregions"] as const;

  return (
    <>
      <PageHead title={title} plain={plain} />

      <nav className="pills" aria-label="Analytics sections">
        {TABS.map((tab) => (
          <Link
            key={tab.id}
            href={withParams(tab.path, params)}
            className={`pill${tab.id === active ? " active" : ""}`}
            aria-current={tab.id === active ? "page" : undefined}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <form method="get" action={path} className="filters">
        <select name="range" defaultValue={filters.preset ?? "30d"} className="input-field input-field--sm" aria-label="Period">
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
        </select>
        <input
          type="date"
          name="from"
          defaultValue={filters.fromDate}
          className="input-field input-field--sm"
          aria-label="From (replaces the period when both dates are set)"
          title="From (replaces the period when both dates are set)"
        />
        <input type="date" name="to" defaultValue={filters.toDate} className="input-field input-field--sm" aria-label="To" title="To" />
        <select name="region" defaultValue={filters.region} className="input-field input-field--sm" aria-label="Region">
          <option value="">All regions</option>
          {groups.map((group) => (
            <optgroup key={group} label={group}>
              {REGION_OPTIONS.filter((option) => option.group === group).map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <input
          type="text"
          name="country"
          defaultValue={filters.country}
          placeholder="Country (CH)"
          maxLength={2}
          pattern="[A-Za-z]{2}"
          className="input-field input-field--sm"
          style={{ width: "8.5rem" }}
          aria-label="Country code"
        />
        <select name="device" defaultValue={filters.device} className="input-field input-field--sm" aria-label="Device">
          <option value="">Any device</option>
          {DEVICES.map((device) => (
            <option key={device} value={device}>
              {device}
            </option>
          ))}
        </select>
        <select name="plan" defaultValue={filters.plan} className="input-field input-field--sm" aria-label="Listening plan">
          <option value="">Any plan</option>
          {PLANS.map((plan) => (
            <option key={plan} value={plan}>
              {plan.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-secondary btn-sm">
          Apply
        </button>
        <Link href={path} className="text-link">
          Reset
        </Link>
      </form>

      {filters.warning && <Notice>{filters.warning}</Notice>}
      <p className="muted" style={{ marginBottom: "var(--space-sm)" }}>
        {describeFilters(filters)} · days are UTC · a play counts once it has qualified (30 s listened)
      </p>
    </>
  );
}

// Avertissement quand une fonction SQL manque (migration pas appliquée) ou échoue.
export function AnalyticsNotice({ results }: { results: Result<unknown>[] }) {
  const failed = results.find((result) => result.error);
  if (!failed) return null;

  return failed.missing ? (
    <Notice>
      The analytics functions are not installed yet. Apply <code>{ANALYTICS_MIGRATION}</code> in the Supabase SQL editor, then reload.
    </Notice>
  ) : (
    <Notice>Some figures could not be loaded: {failed.error}</Notice>
  );
}
