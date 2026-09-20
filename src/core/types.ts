/**
 * 作业状态：
 *  - normal：普通，求解器可自由决定是否入选择
 *  - required：必选，必须排入（受 capacity 重叠约束）
 *  - excluded：排除，任何情况下都不会入选
 */
export type JobStatus = 'normal' | 'required' | 'excluded';

export interface Job {
  /** 唯一非空字符串标识（JSON 中可以是数字/字符串，规范化为字符串） */
  id: string;
  /** 开始时刻（含），整数，>=0 */
  start: number;
  /** 结束时刻（不含），整数，> start，<= 1e9 */
  end: number;
  /** 收益，整数，1..1e9 */
  benefit: number;
  status: JobStatus;
}

export type Capacity = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface Workspace {
  capacity: Capacity;
  jobs: Job[];
  /** 单调递增的数据版本：任何成功的导入或约束修改都会使其 +1 */
  version: number;
}

/** 用户 JSON 中单个作业的原始形态 */
export interface RawJob {
  id: unknown;
  start: unknown;
  end: unknown;
  benefit: unknown;
}

export interface ImportPayload {
  capacity: unknown;
  jobs: unknown;
}
