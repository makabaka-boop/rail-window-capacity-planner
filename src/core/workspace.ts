import { IntervalDepthTree } from './segmentTree';
import type { Capacity, Job, JobStatus, Workspace } from './types';

export interface CreateInput {
  capacity: Capacity;
  jobs: { id: string; start: number; end: number; benefit: number }[];
}

/** 由校验通过的数据构造全新工作区；作业初始状态均为普通。 */
export function createWorkspace(input: CreateInput): Workspace {
  const jobs: Job[] = input.jobs.map((j) => ({ ...j, status: 'normal' }));
  return { capacity: input.capacity, jobs, version: 1 };
}

/**
 * 构造必选重叠度索引。区间端点坐标在本工作区生命周期内不变，
 * 所以坐标压缩只做一次；必选集合变化时只做区间加/减。
 */
export function createDepthIndex(workspace: Workspace): {
  coords: number[];
  index: Map<number, number>;
  tree: IntervalDepthTree;
} {
  const set = new Set<number>();
  for (const job of workspace.jobs) {
    set.add(job.start);
    set.add(job.end);
  }
  const coords = [...set].sort((a, b) => a - b);
  const tree = new IntervalDepthTree(coords);
  const index = new Map<number, number>();
  coords.forEach((c, i) => index.set(c, i));
  for (const job of workspace.jobs) {
    if (job.status === 'required') {
      tree.rangeAdd(index.get(job.start)!, index.get(job.end)!, +1);
    }
  }
  return { coords, index, tree };
}

export interface ToggleResult {
  /** 拒绝原因；存在时表示约束与结果均未改变 */
  rejected?: string;
}

/**
 * 修改单个作业状态。
 *
 * 规则：
 *  - 设为必选时，若该作业区间任一小格上的必选重叠数已达 capacity，则拒绝，
 *    且不改动任何既有约束（调用方应整体放弃本次状态更新）。
 *  - 必选 -> 其它状态、排除相关切换永远合法。
 *  - 必选与排除互斥：切换直接覆盖旧状态。
 */
export function applyStatusChange(
  workspace: Workspace,
  tree: IntervalDepthTree,
  index: Map<number, number>,
  jobIndex: number,
  next: JobStatus,
): ToggleResult {
  const job = workspace.jobs[jobIndex];
  if (!job) return { rejected: `作业下标 ${jobIndex} 不存在` };
  if (job.status === next) return {};

  if (next === 'required' && job.status !== 'required') {
    const li = index.get(job.start)!;
    const ri = index.get(job.end)!;
    const currentPeak = tree.rangeMax(li, ri);
    if (currentPeak >= workspace.capacity) {
      return {
        rejected: `拒绝：作业 "${job.id}" 的时段内必选重叠数已达容量 ${workspace.capacity}，设为必选将无可行排程。现有约束与结果保持不变。`,
      };
    }
    tree.rangeAdd(li, ri, +1);
  } else if (job.status === 'required' && next !== 'required') {
    const li = index.get(job.start)!;
    const ri = index.get(job.end)!;
    tree.rangeAdd(li, ri, -1);
  }

  job.status = next;
  workspace.version += 1;
  return {};
}
