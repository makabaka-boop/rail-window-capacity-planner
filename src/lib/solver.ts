import type { ConstraintKind, Job, ScheduleResult } from "./types.ts";

/**
 * 精确求解：在 capacity 条并行轨道上选择互不冲突的作业（左闭右开，相接不算重叠），
 * 收益总和最大；required 必须入选，excluded 必须不入选。
 *
 * 算法：时间坐标压缩 + 最小费用最大流
 *   - 节点 = 所有非排除作业端点排序去重后的时间点
 *   - 相邻时间点之间容量为 capacity、费用为 0 的“等待边”
 *   - 每个作业一条 s->e、容量 1 的边，经过该边表示选中此作业
 *   - 从最早端点向最末端点发送恰好 capacity 单位流；一条流即一条轨道
 * 费用采用字典序双分量 (requiredSelected, -benefit)：
 *   先最大化“必选作业入选数量”（该分量取 -1，必选边为 -1、普通边为 0，
 *   最小化即最大化必选入选数），再最小化“负收益”（即最大化收益）。
 * 分量均为普通 number：必选数<=50000，|benefit 总和|<=5e13，全程为精确整数
 * （小于 Number.MAX_SAFF_INTEGER），无需 BigInt，也无任何近似/占位计算。
 *
 * 最多 capacity(<=8) 次增广；首次最短路利用 DAG 拓扑序 O(E)，
 * 后续用势能（Johnson reduced cost）+ 二叉堆 Dijkstra。
 * 5 万作业规模可在数秒内完成。
 */

export interface SolveInput {
  capacity: number;
  jobs: Job[];
  constraints: Map<string, ConstraintKind>;
}

export interface SolveOutput {
  result?: Omit<ScheduleResult, "signature" | "elapsedMs" | "capacity">;
  /** 必选作业本身互相冲突且超过 capacity 时，返回不可行及冲突点信息。 */
  infeasible?: {
    reason: "required-over-capacity";
    /** 发生超限的时间点（事件扫描首次超限行）。 */
    at: number;
    peak: number;
    capacity: number;
  };
}

/** 扫描必选作业，返回峰值占用；超过 capacity 则返回首个超限点。 */
export function checkRequiredFeasibility(
  jobs: Job[],
  constraints: Map<string, ConstraintKind>,
  capacity: number,
): { feasible: true } | { feasible: false; at: number; peak: number } {
  // events: [time, delta]，同一时刻先结束(-1)后开始(+1)，符合左闭右开
  const events: number[] = [];
  for (const j of jobs) {
    if (constraints.get(j.id) === "required") {
      events.push(j.end, -1, j.start, 1);
    }
  }
  sortEvents(events);
  let cur = 0;
  let peak = 0;
  for (let i = 0; i < events.length; i += 2) {
    cur += events[i + 1];
    if (cur > peak) {
      peak = cur;
      if (peak > capacity) {
        return { feasible: false, at: events[i], peak };
      }
    }
  }
  return { feasible: true };
}

/** 事件数组 [time, delta, time, delta, ...] 排序：time 升序，同 time 时 delta 升序（先结束）。 */
function sortEvents(events: number[]): void {
  const pairs: Array<[number, number]> = new Array(events.length / 2);
  for (let i = 0; i < pairs.length; i++) pairs[i] = [events[2 * i], events[2 * i + 1]];
  pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (let i = 0; i < pairs.length; i++) {
    events[2 * i] = pairs[i][0];
    events[2 * i + 1] = pairs[i][1];
  }
}

interface MCMFResult {
  selected: Job[];
  unmetRequired: number;
}

function runMinCostFlow(
  coords: number[],
  chainCap: number,
  usable: Array<{ job: Job; required: boolean }>,
): MCMFResult {
  const nodeIndex = new Map<number, number>();
  coords.forEach((t, i) => nodeIndex.set(t, i));
  const V = coords.length;

  // 边使用紧凑类型数组存储（含反向边）。
  const maxEdges = 2 * (coords.length - 1 + usable.length);
  const to = new Int32Array(maxEdges);
  const rev = new Int32Array(maxEdges);
  const cap = new Int8Array(maxEdges);
  const cu = new Int8Array(maxEdges); // 费用分量 1：必选边 -1（选中必选使总费用更小），普通边 0
  const cb = new Float64Array(maxEdges); // 费用分量 2：-benefit
  const jobOfEdge = new Int32Array(maxEdges).fill(-1); // 对应 usable 下标，-1 表示等待边
  const adj: number[][] = Array.from({ length: V }, () => []);
  let edgeCount = 0;

  const addEdge = (
    u: number,
    v: number,
    c: number,
    costU: number,
    costB: number,
    jobIdx: number,
  ): void => {
    const a = edgeCount++;
    const b = edgeCount++;
    to[a] = v; rev[a] = b; cap[a] = c; cu[a] = costU; cb[a] = costB; jobOfEdge[a] = jobIdx;
    to[b] = u; rev[b] = a; cap[b] = 0; cu[b] = -costU; cb[b] = -costB; jobOfEdge[b] = -1;
    adj[u].push(a);
    adj[v].push(b);
  };

  for (let i = 0; i + 1 < V; i++) {
    addEdge(i, i + 1, chainCap, 0, 0, -1);
  }
  for (let k = 0; k < usable.length; k++) {
    const { job, required } = usable[k];
    addEdge(
      nodeIndex.get(job.start)!,
      nodeIndex.get(job.end)!,
      1,
      required ? -1 : 0,
      -job.benefit,
      k,
    );
  }

  // 势能：首次最短路。初始残量网络是 DAG（边下标严格 u<v），按节点顺序松弛即可。
  const INF_U = 1 << 30;
  const pU = new Int32Array(V); // 势能分量 1
  const pB = new Float64Array(V); // 势能分量 2
  pU.fill(INF_U);
  pB.fill(Infinity);
  pU[0] = 0;
  pB[0] = 0;
  for (let u = 0; u < V; u++) {
    if (pU[u] === INF_U) continue;
    const du = pU[u];
    const db = pB[u];
    for (const e of adj[u]) {
      if (cap[e] <= 0) continue;
      const v = to[e];
      const nu = du + cu[e];
      const nb = db + cb[e];
      if (nu < pU[v] || (nu === pU[v] && nb < pB[v])) {
        pU[v] = nu;
        pB[v] = nb;
      }
    }
  }

  const distU = new Int32Array(V);
  const distB = new Float64Array(V);
  const prevEdge = new Int32Array(V);
  const done = new Uint8Array(V);

  // 二叉堆（懒删除）：节点 + 距离快照三套并行数组。
  const heapNode: number[] = [];
  const heapU: number[] = [];
  const heapB: number[] = [];
  const heapPush = (n: number, u: number, b: number): void => {
    let i = heapNode.length;
    heapNode.push(n);
    heapU.push(u);
    heapB.push(b);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heapU[parent] < heapU[i] || (heapU[parent] === heapU[i] && heapB[parent] <= heapB[i])) break;
      swapHeap(i, parent);
      i = parent;
    }
  };
  const swapHeap = (i: number, j: number): void => {
    const tn = heapNode[i]; heapNode[i] = heapNode[j]; heapNode[j] = tn;
    const tu = heapU[i]; heapU[i] = heapU[j]; heapU[j] = tu;
    const tb = heapB[i]; heapB[i] = heapB[j]; heapB[j] = tb;
  };
  const heapPop = (): number => {
    const top = heapNode[0];
    const lastIdx = heapNode.length - 1;
    heapNode[0] = heapNode[lastIdx];
    heapU[0] = heapU[lastIdx];
    heapB[0] = heapB[lastIdx];
    heapNode.pop();
    heapU.pop();
    heapB.pop();
    let i = 0;
    const n = heapNode.length;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let best = i;
      if (
        l < n &&
        (heapU[l] < heapU[best] || (heapU[l] === heapU[best] && heapB[l] < heapB[best]))
      ) {
        best = l;
      }
      if (
        r < n &&
        (heapU[r] < heapU[best] || (heapU[r] === heapU[best] && heapB[r] < heapB[best]))
      ) {
        best = r;
      }
      if (best === i) break;
      swapHeap(i, best);
      i = best;
    }
    return top;
  };

  const source = 0;
  const sink = V - 1;

  for (let flow = 0; flow < chainCap; flow++) {
    distU.fill(INF_U);
    distB.fill(Infinity);
    prevEdge.fill(-1);
    done.fill(0);
    distU[source] = 0;
    distB[source] = 0;
    heapNode.length = 0;
    heapU.length = 0;
    heapB.length = 0;
    heapPush(source, 0, 0);

    while (heapNode.length > 0) {
      const u = heapPop();
      if (done[u]) continue;
      done[u] = 1;
      const du = distU[u];
      const db = distB[u];
      // 懒删除：堆中快照必须等于当前距离。
      for (const e of adj[u]) {
        if (cap[e] <= 0) continue;
        const v = to[e];
        const ru = cu[e] + pU[u] - pU[v];
        const rb = cb[e] + pB[u] - pB[v];
        const nu = du + ru;
        const nb = db + rb;
        if (nu < distU[v] || (nu === distU[v] && nb < distB[v])) {
          distU[v] = nu;
          distB[v] = nb;
          prevEdge[v] = e;
          heapPush(v, nu, nb);
        }
      }
    }

    // 链路边保证 capacity 单位总能送达，此处仅作防御性检查。
    if (distU[sink] === INF_U) break;

    for (let v = 0; v < V; v++) {
      if (distU[v] !== INF_U) {
        pU[v] += distU[v];
        pB[v] += distB[v];
      }
    }
    for (let v = sink; v !== source; v = to[rev[prevEdge[v]]]) {
      const e = prevEdge[v];
      cap[e] -= 1;
      cap[rev[e]] += 1;
    }
  }

  const selected: Job[] = [];
  let unmetRequired = 0;
  for (let k = 0; k < usable.length; k++) {
    // 正向作业边容量由 1 变为 0 表示有流经过（被选中）。
    // 边编号：先建 coords.length-1 条链路边（每条占 2 个槽），作业边紧随其后。
    const e = 2 * (coords.length - 1) + 2 * k;
    if (cap[e] === 0) {
      selected.push(usable[k].job);
    } else if (usable[k].required) {
      unmetRequired++;
    }
  }
  return { selected, unmetRequired };
}

export function solveSchedule(input: SolveInput): SolveOutput {
  const { capacity, jobs, constraints } = input;

  const feasibility = checkRequiredFeasibility(jobs, constraints, capacity);
  if (!feasibility.feasible) {
    return {
      infeasible: {
        reason: "required-over-capacity",
        at: feasibility.at,
        peak: feasibility.peak,
        capacity,
      },
    };
  }

  const usable = jobs
    .filter((j) => constraints.get(j.id) !== "excluded")
    .map((job) => ({ job, required: constraints.get(job.id) === "required" }));

  // 理论上不会发生（无作业无法导入），仍做防御处理。
  if (usable.length === 0) {
    return { result: { selectedIds: [], peakOccupancy: 0, totalBenefit: 0 } };
  }

  const coordSet = new Set<number>();
  for (const { job } of usable) {
    coordSet.add(job.start);
    coordSet.add(job.end);
  }
  const coords = [...coordSet].sort((a, b) => a - b);

  const { selected, unmetRequired } = runMinCostFlow(coords, capacity, usable);
  if (unmetRequired > 0) {
    // 与扫描结论不一致时的防御性分支（不应发生）。
    const reqPeak = requiredPeakTime(usable);
    return {
      infeasible: {
        reason: "required-over-capacity",
        at: reqPeak.at,
        peak: reqPeak.peak,
        capacity,
      },
    };
  }

  selected.sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // 峰值占用：事件扫描，同一时刻先结束后开始（相接不算重叠）。
  const events: number[] = [];
  for (const j of selected) events.push(j.end, -1, j.start, 1);
  sortEvents(events);
  let cur = 0;
  let peak = 0;
  for (let i = 0; i < events.length; i += 2) {
    cur += events[i + 1];
    if (cur > peak) peak = cur;
  }

  let total = 0;
  for (const j of selected) total += j.benefit;

  return {
    result: {
      selectedIds: selected.map((j) => j.id),
      peakOccupancy: peak,
      totalBenefit: total,
    },
  };
}

function requiredPeakTime(usable: Array<{ job: Job; required: boolean }>): {
  at: number;
  peak: number;
} {
  const events: number[] = [];
  for (const { job, required } of usable) {
    if (required) events.push(job.end, -1, job.start, 1);
  }
  sortEvents(events);
  let cur = 0;
  let peak = 0;
  let at = 0;
  for (let i = 0; i < events.length; i += 2) {
    cur += events[i + 1];
    if (cur > peak) {
      peak = cur;
      at = events[i];
    }
  }
  return { at, peak };
}

/** 约束快照签名：容量 + 每个作业的状态（按 id 排序），用于判断已显示结果是否过期。 */
export function buildSignature(capacity: number, constraints: Map<string, ConstraintKind>): string {
  const entries = [...constraints.entries()]
    .filter(([, kind]) => kind !== "normal")
    .map(([id, kind]) => [id, kind === "required" ? "R" : "X"] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return `c${capacity}|${entries.map(([id, k]) => `${k}:${id}`).join(",")}`;
}
