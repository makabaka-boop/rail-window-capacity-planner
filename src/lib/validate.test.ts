import { describe, it, expect } from "vitest";
import { validateImport } from "./validate.ts";

describe("validateImport", () => {
  it("合法输入", () => {
    const r = validateImport({
      capacity: 3,
      jobs: [{ id: "x", start: 0, end: 1, benefit: 1 }],
    });
    expect(r.ok).toBe(true);
    expect(r.capacity).toBe(3);
    expect(r.jobs).toHaveLength(1);
  });

  it("capacity 越界/非整数逐项报错", () => {
    expect(validateImport({ capacity: 0, jobs: [] }).ok).toBe(false);
    expect(validateImport({ capacity: 9, jobs: [] }).ok).toBe(false);
    expect(validateImport({ capacity: 1.5, jobs: [] }).ok).toBe(false);
    expect(validateImport({ capacity: "2", jobs: [] }).ok).toBe(false);
  });

  it("id 非空且唯一", () => {
    const r = validateImport({
      capacity: 1,
      jobs: [
        { id: "", start: 0, end: 1, benefit: 1 },
        { id: "a", start: 0, end: 1, benefit: 1 },
        { id: "a", start: 2, end: 3, benefit: 1 },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("非空字符串"))).toBe(true);
    expect(r.errors.some((e) => e.includes("重复"))).toBe(true);
  });

  it("区间与收益边界", () => {
    expect(
      validateImport({
        capacity: 1,
        jobs: [{ id: "a", start: 5, end: 5, benefit: 1 }],
      }).ok,
    ).toBe(false);
    expect(
      validateImport({
        capacity: 1,
        jobs: [{ id: "a", start: -1, end: 5, benefit: 1 }],
      }).ok,
    ).toBe(false);
    expect(
      validateImport({
        capacity: 1,
        jobs: [{ id: "a", start: 0, end: 1_000_000_001, benefit: 1 }],
      }).ok,
    ).toBe(false);
    expect(
      validateImport({
        capacity: 1,
        jobs: [{ id: "a", start: 0, end: 1, benefit: 0 }],
      }).ok,
    ).toBe(false);
    // 合法边界值
    expect(
      validateImport({
        capacity: 8,
        jobs: [{ id: "a", start: 0, end: 1_000_000_000, benefit: 1_000_000_000 }],
      }).ok,
    ).toBe(true);
  });

  it("jobs 数量边界", () => {
    expect(validateImport({ capacity: 1, jobs: [] }).ok).toBe(false);
    const tooMany = { capacity: 1, jobs: Array.from({ length: 50001 }, (_, i) => ({ id: `j${i}`, start: 0, end: 1, benefit: 1 })) };
    expect(validateImport(tooMany).ok).toBe(false);
  });
});
