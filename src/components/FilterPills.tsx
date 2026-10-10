import Link from "next/link";
import { formatNumber } from "@/lib/format";
import { withParams } from "@/lib/query";

export interface PillOption {
  label: string;
  // Valeur du paramètre d'URL ; "" = « tout ».
  value: string;
  count?: number | null;
}

// Rangée de pastilles qui filtrent sur UN paramètre d'URL (ex. status), en
// gardant les autres filtres et en revenant à la page 1.
export function FilterPills({
  basePath,
  param,
  current,
  options,
  params,
}: {
  basePath: string;
  param: string;
  current: string;
  options: PillOption[];
  params: Record<string, string | undefined>;
}) {
  return (
    <div className="pills">
      {options.map((option) => (
        <Link
          key={option.value || "all"}
          href={withParams(basePath, { ...params, [param]: option.value, page: undefined })}
          className={`pill${option.value === current ? " active" : ""}`}
          aria-current={option.value === current ? "true" : undefined}
        >
          {option.label}
          {option.count !== undefined && option.count !== null ? ` · ${formatNumber(option.count)}` : ""}
        </Link>
      ))}
    </div>
  );
}
