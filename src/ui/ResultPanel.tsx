import { useMemo, useState } from "react";
import type { ExportPayload, Job, ScheduleResult } from "../lib/types.ts";

interface ResultPanelProps {
  result: ScheduleResult | null;
  stale: boolean;
  jobs: Job[];
  busy: boolean;
  onCompute: () => void;
}

const PAGE_SIZE = 100;

export function ResultPanel({ result, stale, busy, jobs, onCompute }: ResultPanelProps) {
  const [page, setPage] = useState(0);

  const jobById = useMemo(() => {
    const m = new Map<string, Job>();
    for (const j of jobs) m.set(j.id, j);
    return m;
  }, [jobs]);

  const selectedJobs = useMemo(() => {
    if (!result) return [];
    return result.selectedIds.map((id) => jobById.get(id)).filter((j): j is Job => Boolean(j));
  }, [result, jobById]);

  const pageCount = Math.max(1, Math.ceil(selectedJobs.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const rows = selectedJobs.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const download = (): void => {
    if (!result || stale) return;
    const payload: ExportPayload = {
      capacity: result.capacity,
      totalBenefit: result.totalBenefit,
      peakOccupancy: result.peakOccupancy,
      selectedIds: result.selectedIds,
      selectedJobs: selectedJobs.map((j) => ({
        id: j.id,
        start: j.start,
        end: j.end,
        benefit: j.benefit,
      })),
    };
    // 屏幕集合与下载内容完全一致（同一 result 数据源）。
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "schedule-result.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="panel result-panel">
      <div className="panel-head">
        <h2>排程结果</h2>
        <div className="actions">
          <button className="btn primary" onClick={onCompute} disabled={busy}>
            {busy ? "计算中…" : stale ? "重新计算" : result ? "重新计算" : "开始排程"}
          </button>
          <button
            className="btn"
            onClick={download}
            disabled={!result || stale || busy}
            title={stale ? "约束已改变，请先重新计算" : "下载与屏幕一致的 JSON"}
          >
            下载 JSON
          </button>
        </div>
      </div>

      {!result && <p className="muted">尚未生成结果。导入数据并点击“开始排程”。</p>}

      {result && (
        <>
          {stale && (
            <div className="banner warn">
              约束或容量在上次成功计算后发生变化，以下结果已过期；点击“重新计算”生成新结果。
              （过期结果保留显示，失败计算不会清空它。）
            </div>
          )}
          <div className="stats">
            <div className="stat">
              <div className="stat-label">入选作业</div>
              <div className="stat-value">{result.selectedIds.length}</div>
            </div>
            <div className="stat">
              <div className="stat-label">峰值占用</div>
              <div className="stat-value">
                {result.peakOccupancy}
                <span className="stat-unit"> / {result.capacity}</span>
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">总收益</div>
              <div className="stat-value">{result.totalBenefit.toLocaleString()}</div>
            </div>
            <div className="stat">
              <div className="stat-label">耗时</div>
              <div className="stat-value">
                {result.elapsedMs.toFixed(0)}
                <span className="stat-unit"> ms</span>
              </div>
            </div>
          </div>

          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th>#</th>
                  <th>id</th>
                  <th className="num">start</th>
                  <th className="num">end</th>
                  <th className="num">benefit</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((j, i) => (
                  <tr key={j.id}>
                    <td className="muted">{safePage * PAGE_SIZE + i + 1}</td>
                    <td>{j.id}</td>
                    <td className="num">{j.start}</td>
                    <td className="num">{j.end}</td>
                    <td className="num">{j.benefit.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pageCount > 1 && (
            <div className="pager">
              <button className="btn" onClick={() => setPage(0)} disabled={safePage === 0}>
                «
              </button>
              <button className="btn" onClick={() => setPage(safePage - 1)} disabled={safePage === 0}>
                ‹
              </button>
              <span className="muted">
                第 {safePage + 1} / {pageCount} 页
              </span>
              <button className="btn" onClick={() => setPage(safePage + 1)} disabled={safePage >= pageCount - 1}>
                ›
              </button>
              <button className="btn" onClick={() => setPage(pageCount - 1)} disabled={safePage >= pageCount - 1}>
                »
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
