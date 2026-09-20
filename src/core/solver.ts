import type { JobStatus } from './types';

export interface SolverJob {
  id: string;
  start: number;
  end: number;
  benefit: number;
  status: JobStatus;
}

export interface SolverResult {
  /** 入选作业 id（按导入顺序排序，保证确定性） */
  selectedIds: string[];
  /** 入选作业收益之和（精确整数；输入上界下 <= 5e13） */
  totalBenefit: number;
  /** 入选作业在时间轴上的最大同时重叠数 */
  peakOccupancy: number;
  capacity: number;
  /** 入选作业数 */
  selectedCount: number;
}

export class InfeasibleRequiredError extends Error {
  /** 必选集合本身超过容量时，给出一个最早发生冲突的必选作业 id */
  readonly conflictingId?: string;
  constructor(message: string, conflictingId?: string) {
    super(message);
    this.name = 'InfeasibleRequiredError';
    this.conflictingId = conflictingId;
  }
}

interface Edge {
  to: number;
  /** 剩余容量 */
  cap: number;
  /** 费用（BigInt，可为负） */
  cost: bigint;
  rev: number;
  /** 作业边：对应候选数组下标；时间边为 -1 */
  jobIndex: number;
}

/**
 * 最小二叉堆：元素为 [距离, 节点]，按 BigInt 距离比较。
 * 允许同节点多次插入；由调用方用弹出的 key 与当前 dist 比对来丢弃过期条目。
 */
class Heap {
  private keys: bigint[] = [];
  private vals: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: bigint, value: number): void {
    let i = this.keys.length;
    this.keys.push(key);
    this.vals.push(value);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): [bigint, number] | undefined {
    const n = this.keys.length;
    if (n === 0) return undefined;
    const key = this.keys[0];
    const value = this.vals[0];
    const lastKey = this.keys[n - 1];
    const lastVal = this.vals[n - 1];
    this.keys.pop();
    this.vals.pop();
    if (n > 1) {
      this.keys[0] = lastKey;
      this.vals[0] = lastVal;
      let i = 0;
      const m = this.keys.length;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= m) break;
        const r = l + 1;
        let c = l;
        if (r < m && this.keys[r] < this.keys[l]) c = r;
        if (this.keys[i] <= this.keys[c]) break;
        this.swap(i, c);
        i = c;
      }
    }
    return [key, value];
  }

  private swap(a: number, b: number): void {
    const k = this.keys[a];
    this.keys[a] = this.keys[b];
    this.keys[b] = k;
    const v = this.vals[a];
    this.vals[a] = this.vals[b];
    this.vals[b] = v;
  }
}

/**
 * 精确求解容量约束下的带权作业选择。
 *
 * 模型（坐标压缩时间轴 DAG 上的最小费用流）：
 *   节点 0..m 为排序后的端点时刻，源点 0，汇点 m；
 *   时间边 i -> i+1，容量 capacity，费用 0（一单位流 = 一条作业队轨道）；
 *   作业边 li -> ri，容量 1，费用为负：
 *     普通作业：-benefit
 *     必选作业：-(M + benefit)，其中 M = 全部候选收益和 + 1；
 *   从源点向汇点发送 capacity 个单位流。
 *
 * 作业边流量为 1 即该作业入选；时间边容量保证任一小格上的入选数 <= capacity。
 * 相接端点（end == 下一 start）属于不同小格，天然允许首尾相接。
 *
 * 必选保证（精确，非启发式）：总费用 = -Σbenefit(入选) - M·(入选必选数)。
 * 任意两个可行流的收益差绝对值都 < M（收益总和上界 = M - 1），因此费用
 * 最小化首先最大化“入选必选数”。当必选集合可行（最大重叠 <= capacity）时，
 * 存在一个包含全部必选作业的 capacity-流（区间染色到 capacity 条轨道即可），
 * 故最小费用流必含全部必选作业；之后再在该条件下最大化收益。
 *
 * 排除作业不建边，任何流都无法选中。费用与距离全程 BigInt，无精度损失。
 *
 * 初始图为 DAG 但含负费用边：初始位势按节点顺序做一遍拓扑松弛得到
 * 最短距离；之后用位势 + Dijkstra 迭代 capacity(<=8) 次。
 */
export function solve(jobs: SolverJob[], capacity: number): SolverResult {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 8) {
    throw new Error(`capacity 非法：${capacity}`);
  }

  const candidates: SolverJob[] = [];
  const requiredJobs: SolverJob[] = [];
  let sumBenefit = 0;
  for (const job of jobs) {
    if (job.status === 'excluded') continue;
    candidates.push(job);
    sumBenefit += job.benefit;
    if (job.status === 'required') requiredJobs.push(job);
  }

  const coords = buildCoords(candidates);
  const m = coords.values.length - 1;
  const S = 0;
  const T = m;

  // 没有任何可选作业（全部被排除）：空选择即最优
  if (candidates.length === 0) {
    return {
      selectedIds: [],
      totalBenefit: 0,
      peakOccupancy: 0,
      capacity,
      selectedCount: 0,
    };
  }

  // 必选可行性：半开区间深度扫描（同时刻先处理 -1 结束，再处理 +1 开始，
  // 即相接不重叠）
  if (requiredJobs.length > 0) {
    const events: { t: number; delta: number; id: string }[] = [];
    for (const job of requiredJobs) {
      events.push({ t: job.start, delta: +1, id: job.id });
      events.push({ t: job.end, delta: -1, id: job.id });
    }
    // delta: -1 排在 +1 前 => 相接点深度先降后升
    events.sort((a, b) => a.t - b.t || a.delta - b.delta);
    let depth = 0;
    let conflictId: string | undefined;
    for (const e of events) {
      depth += e.delta;
      if (depth > capacity) {
        conflictId = e.id;
        break;
      }
    }
    if (conflictId !== undefined) {
      throw new InfeasibleRequiredError(
        `必选作业在部分时段重叠数超过容量 ${capacity}（例如 "${conflictId}" 附近），无解`,
        conflictId,
      );
    }
  }

  const M = BigInt(sumBenefit + 1);

  const graph: Edge[][] = Array.from({ length: m + 1 }, () => []);
  const addEdge = (u: number, v: number, cap: number, cost: bigint, jobIndex: number): void => {
    const forward: Edge = { to: v, cap, cost, rev: graph[v].length, jobIndex };
    const backward: Edge = { to: u, cap: 0, cost: -cost, rev: graph[u].length, jobIndex: -1 };
    graph[u].push(forward);
    graph[v].push(backward);
  };

  for (let i = 0; i < m; i++) {
    addEdge(i, i + 1, capacity, 0n, -1);
  }
  for (let j = 0; j < candidates.length; j++) {
    const job = candidates[j];
    const li = coords.index.get(job.start)!;
    const ri = coords.index.get(job.end)!;
    const cost = job.status === 'required' ? -(M + BigInt(job.benefit)) : -BigInt(job.benefit);
    addEdge(li, ri, 1, cost, j);
  }

  // 初始位势：DAG 上从 S 出发的最短距离（边只由小坐标指向大坐标）
  const potential: bigint[] = new Array(m + 1).fill(0n);
  for (let u = 0; u <= m; u++) {
    const du = potential[u];
    for (const e of graph[u]) {
      if (e.cap > 0 && du + e.cost < potential[e.to]) {
        potential[e.to] = du + e.cost;
      }
    }
  }

  const dist: bigint[] = new Array(m + 1);
  const prevNode: Int32Array = new Int32Array(m + 1);
  const prevEdge: Int32Array = new Int32Array(m + 1);
  const INF = 1n << 120n;

  // 逐单位发送 capacity 个流（带位势的 Dijkstra 最短路增广）
  for (let flow = 0; flow < capacity; flow++) {
    dist.fill(INF);
    dist[S] = 0n;
    const heap = new Heap();
    heap.push(0n, S);

    while (heap.size > 0) {
      const popped = heap.pop();
      if (!popped) break;
      const [key, u] = popped;
      if (key !== dist[u]) continue; // 丢弃过期条目
      const du = key;
      const edges = graph[u];
      for (let ei = 0; ei < edges.length; ei++) {
        const e = edges[ei];
        if (e.cap <= 0) continue;
        const reduced = e.cost + potential[u] - potential[e.to];
        const nd = du + reduced;
        if (nd < dist[e.to]) {
          dist[e.to] = nd;
          prevNode[e.to] = u;
          prevEdge[e.to] = ei;
          heap.push(nd, e.to);
        }
      }
    }

    if (dist[T] === INF) {
      // 时间边构成 0..m 直连通道且容量为 capacity，不会发生
      throw new InfeasibleRequiredError('流网络无法发送足够流量，排程不可行');
    }

    for (let v = 0; v <= m; v++) {
      if (dist[v] < INF) potential[v] += dist[v];
    }

    // 沿增广路更新 1 个单位
    for (let v = T; v !== S; v = prevNode[v]) {
      const u = prevNode[v];
      const ei = prevEdge[v];
      const e = graph[u][ei];
      e.cap -= 1;
      graph[v][e.rev].cap += 1;
    }
  }

  // 入选判定：作业边剩余容量 0 即恰有 1 单位流量经过
  const selected = new Set<number>();
  for (let u = 0; u <= m; u++) {
    for (const e of graph[u]) {
      if (e.jobIndex >= 0 && e.cap === 0) {
        selected.add(e.jobIndex);
      }
    }
  }

  // 结果核对：必选必须全部入选（费用性质保证，此处为防御性断言）
  for (const job of requiredJobs) {
    const j = candidates.indexOf(job);
    if (!selected.has(j)) {
      throw new InfeasibleRequiredError(
        `内部错误：必选作业 "${job.id}" 未被选入，请反馈`,
        job.id,
      );
    }
  }

  // 峰值占用：对入选区间覆盖的小格做差分扫描
  const diff = new Int32Array(m);
  let total = 0;
  for (const j of selected) {
    const job = candidates[j];
    const li = coords.index.get(job.start)!;
    const ri = coords.index.get(job.end)!;
    diff[li] += 1;
    diff[ri] -= 1;
    total += job.benefit;
  }
  let peak = 0;
  let cur = 0;
  for (let i = 0; i < m; i++) {
    cur += diff[i];
    if (cur > peak) peak = cur;
  }

  // candidates 按导入顺序过滤产生，下标升序即导入顺序
  const indices = [...selected].sort((a, b) => a - b);

  return {
    selectedIds: indices.map((j) => candidates[j].id),
    totalBenefit: total,
    peakOccupancy: peak,
    capacity,
    selectedCount: selected.size,
  };
}

function buildCoords(candidates: { start: number; end: number }[]): {
  values: number[];
  index: Map<number, number>;
} {
  const set = new Set<number>();
  for (const j of candidates) {
    set.add(j.start);
    set.add(j.end);
  }
  const values = [...set].sort((a, b) => a - b);
  const index = new Map<number, number>();
  values.forEach((c, i) => index.set(c, i));
  return { values, index };
}
