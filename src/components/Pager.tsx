import Link from "next/link";
import { formatNumber } from "@/lib/format";
import { PAGE_SIZE, withParams } from "@/lib/query";

// Pagination par liens (rien à hydrater) : conserve les filtres de l'URL.
export function Pager({
  basePath,
  params,
  page,
  total,
}: {
  basePath: string;
  params: Record<string, string | undefined>;
  page: number;
  total: number;
}) {
  const pages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const href = (target: number) => withParams(basePath, { ...params, page: target > 1 ? target : undefined });

  return (
    <nav className="pager" aria-label="Pagination">
      <span className="muted">
        {formatNumber(total)} {total === 1 ? "result" : "results"}
        {pages > 1 ? ` · page ${page} of ${pages}` : ""}
      </span>
      {pages > 1 && (
        <span className="pager__links">
          {page > 1 ? (
            <Link href={href(page - 1)} className="btn btn-secondary btn-sm">
              Previous
            </Link>
          ) : (
            <span className="btn btn-secondary btn-sm" aria-disabled="true" style={{ opacity: 0.4 }}>
              Previous
            </span>
          )}
          {page < pages ? (
            <Link href={href(page + 1)} className="btn btn-secondary btn-sm">
              Next
            </Link>
          ) : (
            <span className="btn btn-secondary btn-sm" aria-disabled="true" style={{ opacity: 0.4 }}>
              Next
            </span>
          )}
        </span>
      )}
    </nav>
  );
}
