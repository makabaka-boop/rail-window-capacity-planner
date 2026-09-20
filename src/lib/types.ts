/**
 * 核心数据模型。所有数据仅存在于浏览器内存中，不涉及任何在线服务。
 */

/** 导入 JSON 中的单个作业（左闭右开区间 [start, end)）。 */
export interface JobInput {
  id: unknown;
  start: unknown;
  end: unknown;
  benefit: unknown;
}

/** 通过校验后的作业。 */
export interface Job {
  id: string;
  start: number;
  end: number;
  benefit: number;
}

/** 导入文件的顶层结构。 */
export interface ImportPayload {
  capacity: unknown;
  jobs: unknown;
}

/** 作业的约束状态：普通 / 必选 / 排除。 */
export type ConstraintKind = "normal" | "required" | "excluded";

/** 求解后的选中集合结果。 */
export interface ScheduleResult {
  /** 选中作业的 id 列表，按起始时间（再按 id）排序。 */
  selectedIds: string[];
  /** 任意时刻被选中作业占用的最大并行数。 */
  peakOccupancy: number;
  /** 选中作业收益总和（精确整数，<= 5e13，安全整数范围内）。 */
  totalBenefit: number;
  /** 参与计算的约束快照签名，用于判断结果是否过期。 */
  signature: string;
  /** 计算耗时（毫秒）。 */
  elapsedMs: number;
  /** 本次求解的容量与约束（导出 JSON 与屏幕一致）。 */
  capacity: number;
}

/** 导出 JSON 的结构。 */
export interface ExportPayload {
  capacity: number;
  totalBenefit: number;
  peakOccupancy: number;
  selectedIds: string[];
  selectedJobs: Array<{
    id: string;
    start: number;
    end: number;
    benefit: number;
  }>;
}
