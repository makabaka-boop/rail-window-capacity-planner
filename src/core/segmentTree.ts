/**
 * 必选作业重叠度维护。
 *
 * 坐标是全部作业端点压缩后的有序坐标；坐标索引 p 对应的“小格”为
 * [coords[p], coords[p+1])，即左闭右开。一条作业 [start, end) 覆盖的是
 * 其端点坐标索引构成的半开区间 [li, ri)。
 *
 * 这与求解器的语义一致：端点相接（一个 end == 另一个 start）落在
 * 不同小格，不会被计为重叠。
 *
 * 支持：
 *  - rangeMax(li, ri)：区间内最大重叠数（不含 ri）
 *  - rangeAdd(li, ri, +1/-1)：必选集合增删
 */
export class IntervalDepthTree {
  private readonly n: number;
  private readonly mx: Int32Array;
  private readonly lazy: Int32Array;

  constructor(coords: number[]) {
    // 小格数量 = 端点数 - 1
    this.n = Math.max(0, coords.length - 1);
    const size = 4 * Math.max(1, this.n);
    this.mx = new Int32Array(size);
    this.lazy = new Int32Array(size);
  }

  rangeMax(li: number, ri: number): number {
    if (li >= ri || li >= this.n) return 0;
    return this.query(1, 0, this.n, li, Math.min(ri, this.n));
  }

  rangeAdd(li: number, ri: number, delta: number): void {
    if (li >= ri || li >= this.n) return;
    this.update(1, 0, this.n, li, Math.min(ri, this.n), delta);
  }

  private query(node: number, l: number, r: number, ql: number, qr: number): number {
    if (qr <= l || r <= ql) return 0;
    if (ql <= l && r <= qr) return this.mx[node];
    this.push(node);
    const m = (l + r) >> 1;
    const left = this.query(node << 1, l, m, ql, qr);
    const right = this.query((node << 1) | 1, m, r, ql, qr);
    return Math.max(left, right);
  }

  private update(node: number, l: number, r: number, ql: number, qr: number, delta: number): void {
    if (qr <= l || r <= ql) return;
    if (ql <= l && r <= qr) {
      this.mx[node] += delta;
      this.lazy[node] += delta;
      return;
    }
    this.push(node);
    const m = (l + r) >> 1;
    this.update(node << 1, l, m, ql, qr, delta);
    this.update((node << 1) | 1, m, r, ql, qr, delta);
    this.mx[node] = Math.max(this.mx[node << 1], this.mx[(node << 1) | 1]);
  }

  private push(node: number): void {
    const v = this.lazy[node];
    if (v !== 0) {
      const left = node << 1;
      this.mx[left] += v;
      this.lazy[left] += v;
      this.mx[left | 1] += v;
      this.lazy[left | 1] += v;
      this.lazy[node] = 0;
    }
  }
}
