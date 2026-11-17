import { expect, test } from "vite-plus/test";
import {
  createDefaultDashboardViewStore,
  DASHBOARD_VIEW_STORAGE_KEY,
  DEFAULT_DASHBOARD_VIEW,
  loadDashboardViewStore,
  parseDashboardViewStore,
  saveDashboardViewStore,
} from "./use-dashboard-view";

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length(): number {
    return this.data.size;
  }
  clear(): void {
    this.data.clear();
  }
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

test("解析缺失/损坏/版本不符的存储时回退默认", (): void => {
  expect(parseDashboardViewStore(null)).toEqual(createDefaultDashboardViewStore());
  expect(parseDashboardViewStore({})).toEqual(createDefaultDashboardViewStore());
  expect(parseDashboardViewStore({ version: 2, bySymbol: {} })).toEqual(
    createDefaultDashboardViewStore(),
  );
  expect(parseDashboardViewStore({ version: 1, bySymbol: [] })).toEqual(
    createDefaultDashboardViewStore(),
  );
});

test("按 symbol 解析合法状态，非法字段回退默认", (): void => {
  const store = parseDashboardViewStore({
    version: 1,
    bySymbol: {
      "932315.CSI": {
        period: "week",
        range: "1y",
        maText: "5 8",
        virtualMaText: "(MA5 + MA8) / 2",
      },
      "930955.CSI": { period: "bad", range: "bad", maText: 1, virtualMaText: null },
      invalid: "not-an-object",
      __proto__: { period: "week" },
    },
  });
  expect(store.bySymbol["932315.CSI"]).toEqual({
    period: "week",
    range: "1y",
    maText: "5 8",
    virtualMaText: "(MA5 + MA8) / 2",
    valuationMetric: "pe",
    valuationRange: "all",
  });
  expect(store.bySymbol["930955.CSI"]).toEqual(DEFAULT_DASHBOARD_VIEW);
  expect(Object.keys(store.bySymbol)).not.toContain("invalid");
  expect(Object.prototype.hasOwnProperty.call(store.bySymbol, "__proto__")).toBe(false);
});

test("旧记录缺估值字段或只有旧版可见集合时逐项回退，不牵连其它字段", (): void => {
  const store = parseDashboardViewStore({
    version: 1,
    bySymbol: {
      "930955.CSI": { period: "week", range: "5y", maText: "5 8", virtualMaText: "" },
      "932315.CSI": { valuationMetrics: ["pe", "pb"], valuationRange: "2y" },
      "000300.SH": { valuationMetric: "ps", valuationRange: "3y" },
      "399006.SZ": { valuationMetric: "dividendYield", valuationRange: "5y" },
      "399001.SZ": { valuationMetric: "bad", valuationRange: "5y" },
    },
  });
  expect(store.bySymbol["930955.CSI"]).toEqual({
    period: "week",
    range: "5y",
    maText: "5 8",
    virtualMaText: "",
    valuationMetric: "pe",
    valuationRange: "all",
  });
  // 旧版存的是可见指标集合（数组），不是单选值：回退默认，非法范围同样回退。
  expect(store.bySymbol["932315.CSI"]?.valuationMetric).toBe("pe");
  expect(store.bySymbol["932315.CSI"]?.valuationRange).toBe("all");
  expect(store.bySymbol["000300.SH"]?.valuationMetric).toBe("ps");
  expect(store.bySymbol["000300.SH"]?.valuationRange).toBe("3y");
  expect(store.bySymbol["399006.SZ"]?.valuationMetric).toBe("dividendYield");
  expect(store.bySymbol["399006.SZ"]?.valuationRange).toBe("5y");
  expect(store.bySymbol["399001.SZ"]?.valuationMetric).toBe("pe");
});

test("读写 localStorage，并对读取/写入异常容错", (): void => {
  const storage = new MemoryStorage();
  const store = {
    version: 1 as const,
    bySymbol: { "932315.CSI": { ...DEFAULT_DASHBOARD_VIEW, period: "month" as const } },
  };
  saveDashboardViewStore(store, storage);
  expect(JSON.parse(storage.getItem(DASHBOARD_VIEW_STORAGE_KEY) ?? "null")).toEqual(store);
  expect(loadDashboardViewStore(storage)).toEqual(store);

  storage.setItem(DASHBOARD_VIEW_STORAGE_KEY, "{broken");
  expect(loadDashboardViewStore(storage)).toEqual(createDefaultDashboardViewStore());

  const broken: Storage = {
    length: 0,
    clear: (): void => {},
    getItem: (): string => {
      throw new Error("blocked");
    },
    key: (): string | null => null,
    removeItem: (): void => {},
    setItem: (): void => {
      throw new Error("quota");
    },
  };
  expect(loadDashboardViewStore(broken)).toEqual(createDefaultDashboardViewStore());
  expect(() => saveDashboardViewStore(store, broken)).not.toThrow();
});
