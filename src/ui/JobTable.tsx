import { useMemo, useState } from "react";
import type { Job } from "../lib/types.ts";
import type { ConstraintKind } from "../lib/types.ts";
import { checkRequiredFeasibility } from "../lib/solver.ts";

interface JobTableProps {
  jobs: Job[];
  capacity: number;
  constraints: Map<string, ConstraintKind>;
  onSetConstraint: (id: string, kind: ConstraintKind) => boolean;
}

const PAGE_SIZE = 50;

export function JobTable({ jobs, capacity, constraints, onSetConstraint }: JobTableProps) {
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | ConstraintKind>("all");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim();
    const list: Array<Job & { kind: ConstraintKind }> = [];
    for (const j of jobs) {
      const kind = constraints.get(j.id) ?? "normal";
      if (kindFilter !== "all" && kind !== kindFilter) continue;
      if (q && !j.id.includes(q)) continue;
      list.push({ ...j, kind });
    }
    return list;
  }, [jobs, constraints, query, kindFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const rows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const counts = useMemo(() => {
    let required = 0;
    let excluded = 0;
    for (const j of jobs) {
      const k = constraints.get(j.id);
      if (k === "required") required++;
      else if (k === "excluded") excluded++;
    }
    return { required, excluded };
  }, [jobs, constraints]);

  const goToPage = (p: number) => setPage(Math.max(0, Math.min(p, pageCount - 1)));

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>作业清单（{jobs.length} 项）</h2>
        <div className="muted">
          必选 {counts.required} · 排除 {counts.excluded} · 容量 {capacity}
        </div>
      </div>

      <div className="toolbar">
        <input
          type="search"
          placeholder="按 id 过滤（子串匹配）"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
        />
        <div className="seg">
          {(["all", "required", "excluded", "normal"] as const).map((k) => (
            <button
              key={k}
              className={kindFilter === k ? "seg-btn active" : "seg-btn"}
              onClick={() => {
                setKindFilter(k);
                setPage(0);
              }}
            >
              {k === "all" ? "全部" : k === "required" ? "必选" : k === "excluded" ? "排除" : "普通"}
            </button>
          ))}
        </div>
      </div>

      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>id</th>
              <th className="num">start</th>
              <th className="num">end</th>
              <th className="num">benefit</th>
              <th>约束</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((j) => (
              <tr key={j.id} className={`row-${j.kind}`}>
                <td title={j.id}>{j.id}</td>
                <td className="num">{j.start}</td>
                <td className="num">{j.end}</td>
                <td className="num">{j.benefit.toLocaleString()}</td>
                <td>
                  <div className="seg">
                    {(["normal", "required", "excluded"] as const).map((k) => (
                      <button
                        key={k}
                        className={j.kind === k ? `seg-btn active kind-${k}` : "seg-btn"}
                        onClick={() => onSetConstraint(j.id, k)}
                        title={
                          k === "required"
                            ? "设为必选：若必选重叠峰值将超过容量则拒绝修改"
                            : k === "excluded"
                              ? "设为排除：排程不选此项"
                              : "恢复普通"
                        }
                      >
                        {k === "normal" ? "普通" : k === "required" ? "必选" : "排除"}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="muted center">
                  无匹配作业
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="pager">
        <button className="btn" onClick={() => goToPage(0)} disabled={safePage === 0}>
          «
        </button>
        <button className="btn" onClick={() => goToPage(safePage - 1)} disabled={safePage === 0}>
          ‹
        </button>
        <span className="muted">
          第 {safePage + 1} / {pageCount} 页（{filtered.length} 项）
        </span>
        <button className="btn" onClick={() => goToPage(safePage + 1)} disabled={safePage >= pageCount - 1}>
          ›
        </button>
        <button className="btn" onClick={() => goToPage(pageCount - 1)} disabled={safePage >= pageCount - 1}>
          »
        </button>
      </div>
    </section>
  );
}

/** 预检查：把 id 设为必选后，必选集合的重叠峰值是否仍不超过 capacity。 */
export function canMarkRequired(
  jobs: Job[],
  constraints: Map<string, ConstraintKind>,
  id: string,
  capacity: number,
): boolean {
  const trial = new Map(constraints);
  trial.set(id, "required");
  return checkRequiredFeasibility(jobs, trial, capacity).feasible;
}
