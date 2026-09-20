import type { Capacity, ImportPayload, RawJob } from './types';

export interface ValidationError {
  /** 定位信息，如 "jobs[12].start" */
  path: string;
  message: string;
}

export class ValidationFailure extends Error {
  readonly errors: ValidationError[];
  constructor(errors: ValidationError[]) {
    super(`导入校验失败，共 ${errors.length} 项错误`);
    this.name = 'ValidationFailure';
    this.errors = errors;
  }
}

const MAX_BOUND = 1_000_000_000;
const MAX_JOBS = 50_000;

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/**
 * 校验计划员导入的 JSON。任何一项不合法都会收集进错误列表；
 * 调用方必须在校验全部通过后才替换工作区（本函数不产生任何外部副作用）。
 *
 * 校验规则：
 *  - capacity：1..8 的整数
 *  - jobs：长度 1..50000 的数组
 *  - 每项：id 唯一且非空（转为字符串），0 <= start < end <= 1e9，1 <= benefit <= 1e9
 */
export function validatePayload(data: unknown): {
  capacity: Capacity;
  jobs: { id: string; start: number; end: number; benefit: number }[];
} {
  const errors: ValidationError[] = [];

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new ValidationFailure([
      { path: '$', message: 'JSON 顶层必须是对象，形如 {"capacity": 3, "jobs": [...]}' },
    ]);
  }

  const payload = data as ImportPayload;

  let capacity: Capacity | null = null;
  if (!('capacity' in payload)) {
    errors.push({ path: 'capacity', message: '缺少 capacity 字段' });
  } else if (!isInteger(payload.capacity)) {
    errors.push({
      path: 'capacity',
      message: `capacity 必须是整数，收到 ${JSON.stringify(payload.capacity)}`,
    });
  } else if (payload.capacity < 1 || payload.capacity > 8) {
    errors.push({
      path: 'capacity',
      message: `capacity 必须是 1 至 8 的整数，收到 ${payload.capacity}`,
    });
  } else {
    capacity = payload.capacity as Capacity;
  }

  if (!('jobs' in payload)) {
    errors.push({ path: 'jobs', message: '缺少 jobs 字段' });
    throw new ValidationFailure(errors);
  }
  if (!Array.isArray(payload.jobs)) {
    errors.push({
      path: 'jobs',
      message: `jobs 必须是数组，收到 ${typeof payload.jobs}`,
    });
    throw new ValidationFailure(errors);
  }
  if (payload.jobs.length < 1 || payload.jobs.length > MAX_JOBS) {
    errors.push({
      path: 'jobs',
      message: `jobs 数量必须在 1..${MAX_JOBS} 之间，收到 ${payload.jobs.length}`,
    });
  }

  const seen = new Set<string>();
  const jobs: { id: string; start: number; end: number; benefit: number }[] = [];

  payload.jobs.forEach((rawItem, i) => {
    const itemErrors: ValidationError[] = [];
    const prefix = `jobs[${i}]`;

    if (typeof rawItem !== 'object' || rawItem === null || Array.isArray(rawItem)) {
      errors.push({ path: prefix, message: '作业必须是对象' });
      return;
    }
    const item = rawItem as RawJob;

    // id：数字也接受（规范化为字符串），但不允许空串
    let id = '';
    if (!('id' in item)) {
      itemErrors.push({ path: `${prefix}.id`, message: '缺少 id 字段' });
    } else if (item.id === null || typeof item.id === 'boolean') {
      itemErrors.push({
        path: `${prefix}.id`,
        message: `id 必须是非空字符串（或整数），收到 ${JSON.stringify(item.id)}`,
      });
    } else {
      if (typeof item.id !== 'string' && typeof item.id !== 'number') {
        itemErrors.push({
          path: `${prefix}.id`,
          message: `id 必须是非空字符串（或整数），收到 ${typeof item.id}`,
        });
      } else {
        id = String(item.id);
        if (id.trim() === '') {
          itemErrors.push({ path: `${prefix}.id`, message: 'id 不允许为空字符串' });
        } else if (seen.has(id)) {
          itemErrors.push({ path: `${prefix}.id`, message: `id "${id}" 重复，必须唯一` });
        }
      }
    }

    if (!isInteger(item.start)) {
      itemErrors.push({
        path: `${prefix}.start`,
        message: `start 必须是整数，收到 ${JSON.stringify(item.start)}`,
      });
    } else if (item.start < 0 || item.start > MAX_BOUND) {
      itemErrors.push({
        path: `${prefix}.start`,
        message: `start 必须满足 0 <= start <= ${MAX_BOUND}，收到 ${item.start}`,
      });
    }

    if (!isInteger(item.end)) {
      itemErrors.push({
        path: `${prefix}.end`,
        message: `end 必须是整数，收到 ${JSON.stringify(item.end)}`,
      });
    } else if (item.end <= (isInteger(item.start) ? item.start : -1)) {
      itemErrors.push({
        path: `${prefix}.end`,
        message: `end 必须严格大于 start（区间左闭右开，相接不算重叠），start=${item.start}, end=${item.end}`,
      });
    } else if (item.end > MAX_BOUND) {
      itemErrors.push({
        path: `${prefix}.end`,
        message: `end 必须 <= ${MAX_BOUND}，收到 ${item.end}`,
      });
    }

    if (!isInteger(item.benefit)) {
      itemErrors.push({
        path: `${prefix}.benefit`,
        message: `benefit 必须是整数，收到 ${JSON.stringify(item.benefit)}`,
      });
    } else if (item.benefit < 1 || item.benefit > MAX_BOUND) {
      itemErrors.push({
        path: `${prefix}.benefit`,
        message: `benefit 必须满足 1 <= benefit <= ${MAX_BOUND}，收到 ${item.benefit}`,
      });
    }

    if (itemErrors.length > 0) {
      errors.push(...itemErrors);
      return;
    }

    seen.add(id);
    jobs.push({ id, start: item.start as number, end: item.end as number, benefit: item.benefit as number });
  });

  if (errors.length > 0) {
    throw new ValidationFailure(errors);
  }

  // jobs 数量越界时上面已记录；这里仅用于收窄类型
  return { capacity: capacity as Capacity, jobs };
}
