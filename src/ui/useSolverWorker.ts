import { useCallback, useEffect, useRef, useState } from 'react';
import { loadSnapshot, persistSnapshot, type StoredSnapshot } from '../core/persistence';
import type { Workspace } from '../core/types';
import type { SolveRequest, SolveResponse } from '../solver/solver.worker';

export type SolveState = 'idle' | 'computing' | 'success' | 'error';

export interface SolverStatus {
  state: SolveState;
  /** 最近一次成功结果；失败不会清空它 */
  snapshot: StoredSnapshot | null;
  /** 当前是否正在计算 */
  computing: boolean;
  /** 最近一次失败信息（不影响 snapshot） */
  errorMessage: string | null;
  /** 最近一次成功计算耗时（毫秒） */
  lastElapsedMs: number | null;
  /** 内部字段：进行中的请求对应的工作区版本 */
  pendingVersion?: number;
}

export function useSolverWorker() {
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const expectedIdRef = useRef<number | null>(null);

  const [status, setStatus] = useState<SolverStatus>(() => {
    const initial =
      typeof localStorage !== 'undefined' ? loadSnapshot() : null;
    return {
      state: initial ? 'success' : 'idle',
      snapshot: initial,
      computing: false,
      errorMessage: null,
      lastElapsedMs: null,
    };
  });

  useEffect(() => {
    const worker = new Worker(new URL('../solver/solver.worker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;

    worker.onmessage = (ev: MessageEvent<SolveResponse>) => {
      const msg = ev.data;
      // 过期响应（对应已被取代的请求）直接丢弃
      if (msg.requestId !== expectedIdRef.current) return;
      expectedIdRef.current = null;

      if (msg.type === 'success') {
        // snapshot 在调用 run 时已确定 workspaceVersion；这里回填结果
        setStatus((prev) => {
          if (!prev.pendingVersion) return prev;
          const snapshot: StoredSnapshot = {
            workspaceVersion: prev.pendingVersion,
            capacity: msg.result.capacity,
            solvedAt: new Date().toISOString(),
            result: msg.result,
          };
          persistSnapshot(snapshot);
          return {
            state: 'success',
            snapshot,
            computing: false,
            errorMessage: null,
            lastElapsedMs: msg.elapsedMs,
            pendingVersion: undefined,
          } as SolverStatus;
        });
      } else {
        // 关键语义：失败不清空最近成功结果
        setStatus((prev) => ({
          state: 'error',
          snapshot: prev.snapshot,
          computing: false,
          errorMessage: msg.message,
          lastElapsedMs: prev.lastElapsedMs,
          pendingVersion: undefined,
        }));
      }
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const run = useCallback((workspace: Workspace) => {
    const worker = workerRef.current;
    if (!worker) return;
    requestIdRef.current += 1;
    const id = requestIdRef.current;
    expectedIdRef.current = id;
    const request: SolveRequest = {
      type: 'solve',
      requestId: id,
      capacity: workspace.capacity,
      jobs: workspace.jobs,
    };
    setStatus((prev) => ({
      ...prev,
      state: 'computing',
      computing: true,
      errorMessage: null,
      pendingVersion: workspace.version,
    }));
    worker.postMessage(request);
  }, []);

  return { status, run };
}
