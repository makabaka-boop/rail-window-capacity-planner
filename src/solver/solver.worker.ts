import { solve, type SolverJob, type SolverResult } from '../core/solver';
import type { InfeasibleRequiredError } from '../core/solver';

export interface SolveRequest {
  type: 'solve';
  requestId: number;
  jobs: SolverJob[];
  capacity: number;
}

export type SolveResponse =
  | {
      type: 'success';
      requestId: number;
      result: SolverResult;
      elapsedMs: number;
    }
  | {
      type: 'error';
      requestId: number;
      message: string;
      conflictingId?: string;
    };

const ctx = self as unknown as {
  onmessage: ((ev: MessageEvent<SolveRequest>) => void) | null;
  postMessage: (msg: SolveResponse) => void;
};

ctx.onmessage = (ev: MessageEvent<SolveRequest>) => {
  const msg = ev.data;
  if (msg.type !== 'solve') return;
  const started = performance.now();
  try {
    const result = solve(msg.jobs, msg.capacity);
    const response: SolveResponse = {
      type: 'success',
      requestId: msg.requestId,
      result,
      elapsedMs: Math.round(performance.now() - started),
    };
    ctx.postMessage(response);
  } catch (err) {
    const infeasible = err as InfeasibleRequiredError;
    const response: SolveResponse = {
      type: 'error',
      requestId: msg.requestId,
      message: err instanceof Error ? err.message : String(err),
      conflictingId: infeasible?.conflictingId,
    };
    ctx.postMessage(response);
  }
};

export {};
