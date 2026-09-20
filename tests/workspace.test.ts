import { describe, expect, it } from 'vitest';
import { applyStatusChange, createDepthIndex, createWorkspace } from '../src/core/workspace';
import { IntervalDepthTree } from '../src/core/segmentTree';
import { buildResultJson } from '../src/core/persistence';

describe('IntervalDepthTree：半开区间语义', () => {
  it('相接区间不增加彼此区间内最大值', () => {
    const coords = [0, 10, 20];
    const t = new IntervalDepthTree(coords);
    t.rangeAdd(0, 1, 1); // [0,10)
    t.rangeAdd(1, 2, 1); // [10,20)
    expect(t.rangeMax(0, 1)).toBe(1);
    expect(t.rangeMax(1, 2)).toBe(1);
    // 覆盖整个 [0,20)
    expect(t.rangeMax(0, 2)).toBe(1);
  });

  it('重叠区间最大值反映深度', () => {
    const coords = [0, 5, 10, 15];
    const t = new IntervalDepthTree(coords);
    t.rangeAdd(0, 3, 1); // [0,15)
    t.rangeAdd(1, 2, 1); // [5,10)
    expect(t.rangeMax(0, 3)).toBe(2);
    expect(t.rangeMax(0, 1)).toBe(1);
    t.rangeAdd(1, 2, -1);
    expect(t.rangeMax(0, 3)).toBe(1);
  });
});

describe('必选切换的拒绝语义', () => {
  const ws = () =>
    createWorkspace({
      capacity: 2,
      jobs: [
        { id: 'a', start: 0, end: 10, benefit: 5 },
        { id: 'b', start: 1, end: 9, benefit: 5 },
        { id: 'c', start: 2, end: 8, benefit: 5 },
        { id: 'd', start: 10, end: 20, benefit: 5 },
      ],
    });

  it('达到容量后拒绝新必选且状态/版本不变', () => {
    const w = ws();
    const { tree, index } = createDepthIndex(w);
    const change = (i: number, s: 'normal' | 'required' | 'excluded') =>
      applyStatusChange(w, tree, index, i, s);

    expect(change(0, 'required').rejected).toBeUndefined();
    expect(change(1, 'required').rejected).toBeUndefined();
    const before = { status: w.jobs[2].status, version: w.version };
    const r = change(2, 'required'); // c 与 a,b 重叠，深度将达 3 > 2
    expect(r.rejected).toBeDefined();
    expect(w.jobs[2].status).toBe(before.status);
    expect(w.version).toBe(before.version);

    // d 与 a 在端点 10 相接，不冲突，应允许
    expect(change(3, 'required').rejected).toBeUndefined();
    expect(w.jobs[3].status).toBe('required');
  });

  it('删除必选后立即腾出容量，可再设置其它必选', () => {
    const w = ws();
    const { tree, index } = createDepthIndex(w);
    applyStatusChange(w, tree, index, 0, 'required');
    applyStatusChange(w, tree, index, 1, 'required');
    expect(applyStatusChange(w, tree, index, 2, 'required').rejected).toBeDefined();
    applyStatusChange(w, tree, index, 0, 'normal');
    expect(applyStatusChange(w, tree, index, 2, 'required').rejected).toBeUndefined();
  });

  it('排除与必选互斥覆盖，且排除不参与必选容量', () => {
    const w = ws();
    const { tree, index } = createDepthIndex(w);
    applyStatusChange(w, tree, index, 0, 'required');
    applyStatusChange(w, tree, index, 0, 'excluded');
    expect(w.jobs[0].status).toBe('excluded');
    // 排除后原容量释放，b、c 可同时必选
    expect(applyStatusChange(w, tree, index, 1, 'required').rejected).toBeUndefined();
    expect(applyStatusChange(w, tree, index, 2, 'required').rejected).toBeUndefined();
  });
});

describe('结果 JSON：屏幕集合与下载一致', () => {
  it('buildResultJson 直接取 solver 结果，无派生改写', () => {
    const snapshot = {
      workspaceVersion: 4,
      capacity: 2,
      solvedAt: '2026-09-20T00:00:00.000Z',
      result: {
        selectedIds: ['x', 'y', 'z'],
        totalBenefit: 42,
        peakOccupancy: 2,
        capacity: 2,
        selectedCount: 3,
      },
    };
    const json = buildResultJson(snapshot);
    expect(json.selectedIds).toEqual(snapshot.result.selectedIds);
    expect(json.totalBenefit).toBe(42);
    expect(json.peakOccupancy).toBe(2);
    expect(json.selectedCount).toBe(3);
  });
});
