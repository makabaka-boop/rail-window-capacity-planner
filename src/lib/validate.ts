import type { ImportPayload, Job } from "./types.ts";

export interface ValidationReport {
  ok: boolean;
  capacity?: number;
  jobs?: Job[];
  /** 逐项错误信息；非法导入时至少有一条。 */
  errors: string[];
}

function isInt32Safe(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v);
}

/**
 * 按规格完整校验导入内容：
 * - capacity：1..8 的整数
 * - jobs：长度 1..50000 的数组
 * - 每项：唯一非空字符串 id；start/end 为整数，0<=start<end<=1e9；benefit 为 1..1e9 的整数
 * 出现任何非法项都返回全部错误（逐项报错），调用方不得据此修改工作区。
 */
export function validateImport(raw: unknown): ValidationReport {
  const errors: string[] = [];

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ["顶层必须是 JSON 对象，形如 { capacity, jobs }"] };
  }
  const payload = raw as Partial<ImportPayload>;

  let capacity = 0;
  if (!isInt32Safe(payload.capacity)) {
    errors.push(`capacity 必须是整数，收到：${describeValue(payload.capacity)}`);
  } else if (payload.capacity < 1 || payload.capacity > 8) {
    errors.push(`capacity 必须在 1..8 之间，收到：${payload.capacity}`);
  } else {
    capacity = payload.capacity;
  }

  if (!Array.isArray(payload.jobs)) {
    errors.push(`jobs 必须是数组，收到：${describeValue(payload.jobs)}`);
    return { ok: false, errors };
  }
  const arr = payload.jobs as unknown[];
  if (arr.length < 1) {
    errors.push("jobs 至少包含 1 项作业");
  }
  if (arr.length > 50000) {
    errors.push(`jobs 最多包含 50000 项作业，收到：${arr.length}`);
  }

  const jobs: Job[] = [];
  const seen = new Map<string, number>();
  const limit = Math.min(arr.length, 50000);
  for (let i = 0; i < limit; i++) {
    const item = arr[i];
    const where = `jobs[${i}]`;
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      errors.push(`${where}：必须是对象`);
      continue;
    }
    const j = item as Record<string, unknown>;

    let id = "";
    if (typeof j.id !== "string" || j.id.length === 0) {
      errors.push(`${where}.id：必须是非空字符串，收到：${describeValue(j.id)}`);
    } else {
      id = j.id;
      const prev = seen.get(id);
      if (prev !== undefined) {
        errors.push(`${where}.id：id "${id}" 与 jobs[${prev}] 重复（id 必须唯一）`);
      } else {
        seen.set(id, i);
      }
    }

    let start = 0;
    let end = 0;
    if (!isInt32Safe(j.start)) {
      errors.push(`${where}${id ? `(id="${id}")` : ""}.start：必须是整数，收到：${describeValue(j.start)}`);
    } else {
      start = j.start;
    }
    if (!isInt32Safe(j.end)) {
      errors.push(`${where}${id ? `(id="${id}")` : ""}.end：必须是整数，收到：${describeValue(j.end)}`);
    } else {
      end = j.end;
    }
    if (isInt32Safe(j.start) && isInt32Safe(j.end)) {
      if (j.start < 0 || j.start > 1_000_000_000) {
        errors.push(`${where}${id ? `(id="${id}")` : ""}.start：必须满足 0<=start，收到：${j.start}`);
      }
      if (j.end < 0 || j.end > 1_000_000_000) {
        errors.push(`${where}${id ? `(id="${id}")` : ""}.end：必须满足 end<=1000000000，收到：${j.end}`);
      }
      if (
        j.start >= 0 &&
        j.end <= 1_000_000_000 &&
        j.start >= j.end
      ) {
        errors.push(
          `${where}${id ? `(id="${id}")` : ""}：必须满足 start<end，收到 start=${j.start}, end=${j.end}`,
        );
      }
    }

    if (!isInt32Safe(j.benefit)) {
      errors.push(`${where}${id ? `(id="${id}")` : ""}.benefit：必须是整数，收到：${describeValue(j.benefit)}`);
    } else if (j.benefit < 1 || j.benefit > 1_000_000_000) {
      errors.push(`${where}${id ? `(id="${id}")` : ""}.benefit：必须在 1..1000000000 之间，收到：${j.benefit}`);
    }

    if (
      id !== "" &&
      isInt32Safe(j.start) &&
      isInt32Safe(j.end) &&
      isInt32Safe(j.benefit) &&
      j.start < j.end &&
      j.start >= 0 &&
      j.end <= 1_000_000_000 &&
      j.benefit >= 1 &&
      j.benefit <= 1_000_000_000
    ) {
      jobs.push({ id, start, end, benefit: j.benefit });
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, capacity, jobs, errors: [] };
}

function describeValue(v: unknown): string {
  if (typeof v === "string") return JSON.stringify(v.length > 40 ? v.slice(0, 40) + "…" : v);
  if (v === null) return "null";
  if (Array.isArray(v)) return `array(${v.length})`;
  if (typeof v === "object") return "object";
  return String(v);
}
