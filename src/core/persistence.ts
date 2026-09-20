import type { SolverResult } from './solver';
import type { Workspace } from './types';

export interface StoredSnapshot {
  workspaceVersion: number;
  capacity: number;
  solvedAt: string;
  result: SolverResult;
}

const STORAGE_KEY = 'rail-possession-scheduler:v1';
const SNAPSHOT_KEY = 'rail-possession-scheduler:snapshot:v1';

interface PersistedWorkspace {
  capacity: number;
  version: number;
  jobs: Workspace['jobs'];
}

export function persistWorkspace(workspace: Workspace): void {
  try {
    const data: PersistedWorkspace = {
      capacity: workspace.capacity,
      version: workspace.version,
      jobs: workspace.jobs,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // 存储不可用（隐私模式/超额）不影响内存中的功能
  }
}

export function loadWorkspace(): Workspace | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as PersistedWorkspace;
    if (
      typeof data !== 'object' ||
      data === null ||
      !Number.isInteger(data.capacity) ||
      !Array.isArray(data.jobs)
    ) {
      return null;
    }
    return {
      capacity: data.capacity as Workspace['capacity'],
      version: typeof data.version === 'number' ? data.version : 1,
      jobs: data.jobs,
    };
  } catch {
    return null;
  }
}

export function persistSnapshot(snapshot: StoredSnapshot): void {
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    // 忽略：结果持久化失败不影响当前会话
  }
}

export function loadSnapshot(): StoredSnapshot | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    return raw ? (JSON.parse(raw) as StoredSnapshot) : null;
  } catch {
    return null;
  }
}

/**
 * 屏幕展示集合与下载文件必须一致：统一由此函数构造结果 JSON。
 * 不含任何占位值或派生猜测字段。
 */
export function buildResultJson(snapshot: StoredSnapshot): {
  capacity: number;
  workspaceVersion: number;
  solvedAt: string;
  totalBenefit: number;
  peakOccupancy: number;
  selectedCount: number;
  selectedIds: string[];
} {
  return {
    capacity: snapshot.capacity,
    workspaceVersion: snapshot.workspaceVersion,
    solvedAt: snapshot.solvedAt,
    totalBenefit: snapshot.result.totalBenefit,
    peakOccupancy: snapshot.result.peakOccupancy,
    selectedCount: snapshot.result.selectedCount,
    selectedIds: snapshot.result.selectedIds,
  };
}
