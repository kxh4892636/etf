import type { Security } from "../../../shared/market.ts";

/**
 * 证券目录。数组顺序就是看板的加入顺序，第 1 个是默认选中项（红利低波100）；
 * 新增证券追加在末尾，不重排既有项，否则默认标的会变。
 */
export const supportedSecurities: Security[] = [
  {
    symbol: "930955.CSI",
    name: "红利低波100",
    assetType: "index",
    exchange: "CSI",
    currency: "CNY",
    source: "hongsehuojian",
    earliestTradeDate: "2005-12-30",
  },
  {
    symbol: "932315.CSI",
    name: "中证红利质量",
    assetType: "index",
    exchange: "CSI",
    currency: "CNY",
    source: "hongsehuojian",
    earliestTradeDate: "2013-12-31",
  },
  {
    symbol: "932422.CSI",
    name: "A500红利低波",
    assetType: "index",
    exchange: "CSI",
    currency: "CNY",
    source: "hongsehuojian",
    earliestTradeDate: "2013-12-31",
  },
  {
    symbol: "399989.SZ",
    name: "中证医疗",
    assetType: "index",
    exchange: "SZ",
    currency: "CNY",
    source: "hongsehuojian",
    earliestTradeDate: "2004-12-31",
  },
  {
    symbol: "931643.CSI",
    name: "科创创业50",
    assetType: "index",
    exchange: "CSI",
    currency: "CNY",
    source: "hongsehuojian",
    earliestTradeDate: "2019-12-31",
  },
];
