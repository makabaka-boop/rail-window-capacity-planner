import { useCallback, useMemo, useRef, useState } from "react";
import type { ConstraintKind, Job, ScheduleResult } from "../lib/types.ts";
import { validateImport } from "../lib/validate.ts";
import { buildSignature, checkRequiredFeasibility, solveSchedule } from "../lib/solver.ts";
import { JobTable, canMarkRequired } from "./JobTable.tsx";
import { ResultPanel } from "./ResultPanel.tsx";

interface Workspace {
  capacity: number;
  jobs: Job[];
}

export function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [constraints, setConstraints] = useState<Map<string, ConstraintKind>>(new Map());
  const [result, setResult] = useState<ScheduleResult | null>(null);
  const [importErrors, setImportErrors] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const signature = useMemo(
    () => (workspace ? buildSignature(workspace.capacity, constraints) : ""),
    [workspace, constraints],
  );
  const stale = result !== null && result.signature !== signature;

  const handleFile = useCallback(async (file: File): Promise<void> => {
    setNotice(null);
    let raw: unknown;
    try {
      const text = await file.text();
      raw = JSON.parse(text);
    } catch (e) {
      // 非法导入：逐项报错，工作区（含旧约束与结果）原样保留。
      setImportErrors([`JSON 解析失败：${(e as Error).message}`]);
      return;
    }
    const report = validateImport(raw);
    if (!report.ok) {
      setImportErrors(report.errors);
      return;
    }
    // 合法导入：替换工作区；约束与结果属于旧数据，随之重置。
    setWorkspace({ capacity: report.capacity!, jobs: report.jobs! });
    setConstraints(new Map());
    setResult(null);
    setImportErrors(null);
    setNotice(`已导入 ${report.jobs!.length} 项作业，容量 ${report.capacity}。`);
  }, []);

  const setConstraint = useCallback(
    (id: string, kind: ConstraintKind): boolean => {
      if (!workspace) return false;
      const current = constraints.get(id) ?? "normal";
      if (current === kind) return true;

      if (kind === "required") {
        // 必选重叠数超过 capacity 时拒绝修改：旧约束与结果一律不变。
        if (!canMarkRequired(workspace.jobs, constraints, id, workspace.capacity)) {
          const trial = new Map(constraints);
          trial.set(id, "required");
          const check = checkRequiredFeasibility(workspace.jobs, trial, workspace.capacity);
          if (!check.feasible) {
            setNotice(
              `拒绝修改：将作业「${id}」设为必选后，时刻 ${check.at} 的必选并行数为 ${check.peak}，超过容量 ${workspace.capacity}。原有约束与结果保持不变。`,
            );
          }
          return false;
        }
      }

      const next = new Map(constraints);
      if (kind === "normal") next.delete(id);
      else next.set(id, kind);
      setConstraints(next);
      setNotice(null);
      return true;
    },
    [workspace, constraints],
  );

  const compute = useCallback((): void => {
    if (!workspace || busy) return;
    setBusy(true);
    setNotice(null);
    // 让出一帧，使“计算中…”状态可渲染（计算为同步、亚秒~数秒级）。
    window.setTimeout(() => {
      const t0 = performance.now();
      const out = solveSchedule({
        capacity: workspace.capacity,
        jobs: workspace.jobs,
        constraints,
      });
      const elapsedMs = performance.now() - t0;
      if (out.infeasible) {
        const i = out.infeasible;
        // 失败计算不得清空最近成功结果。
        setBusy(false);
        setNotice(
          `计算失败：时刻 ${i.at} 的必选作业并行数 ${i.peak} 超过容量 ${i.capacity}，无可行排程。请调整必选约束后重算。`,
        );
        return;
      }
      const r: ScheduleResult = {
        ...out.result!,
        signature: buildSignature(workspace.capacity, constraints),
        elapsedMs,
        capacity: workspace.capacity,
      };
      setResult(r);
      setBusy(false);
    }, 20);
  }, [workspace, constraints, busy]);

  const loadSample = useCallback(() => {
    const jobs: Job[] = [
      { id: "A-接触网检修", start: 0, end: 3, benefit: 10 },
      { id: "B-钢轨探伤", start: 2, end: 6, benefit: 15 },
      { id: "C-道岔维护", start: 3, end: 5, benefit: 8 },
      { id: "D-信号检测", start: 6, end: 9, benefit: 12 },
      { id: "E-桥梁巡检", start: 4, end: 8, benefit: 9 },
    ];
    setWorkspace({ capacity: 2, jobs });
    setConstraints(new Map());
    setResult(null);
    setImportErrors(null);
    setNotice("已载入示例数据（容量 2）。");
  }, []);

  return (
    <div className="app">
      <header className="header">
        <h1>夜间铁路检修排程器</h1>
        <p className="muted">
          纯前端离线应用 · 容量约束下精确最大化收益 · 数据仅保存在本浏览器内存，不调用任何在线服务
        </p>
      </header>

      <section className="panel">
        <div className="panel-head">
          <h2>数据导入</h2>
          <div className="actions">
            <button className="btn" onClick={loadSample}>
              载入示例
            </button>
            <button className="btn primary" onClick={() => fileRef.current?.click()}>
              选择 JSON 文件
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
                e.target.value = "";
              }}
            />
          </div>
        </div>
        <p className="muted">
          JSON 结构：<code>{"{ capacity: 1..8, jobs: [{ id, start, end, benefit }] }"}</code>
          ，区间左闭右开 <code>[start, end)</code>，相接不重叠；0≤start&lt;end≤10⁹，1≤benefit≤10⁹，jobs 1..50000 项。
        </p>
        {importErrors && (
          <div className="banner error">
            <strong>导入被拒绝（{importErrors.length} 项错误，工作区未改动）：</strong>
            <ul className="error-list">
              {importErrors.slice(0, 200).map((msg, i) => (
                <li key={i}>{msg}</li>
              ))}
              {importErrors.length > 200 && <li>…其余 {importErrors.length - 200} 项错误省略</li>}
            </ul>
          </div>
        )}
        {notice && !importErrors && <div className="banner info">{notice}</div>}
      </section>

      {workspace && (
        <div className="two-col">
          <JobTable
            jobs={workspace.jobs}
            capacity={workspace.capacity}
            constraints={constraints}
            onSetConstraint={setConstraint}
          />
          <ResultPanel
            result={result}
            stale={stale}
            busy={busy}
            jobs={workspace.jobs}
            onCompute={compute}
          />
        </div>
      )}
    </div>
  );
}
