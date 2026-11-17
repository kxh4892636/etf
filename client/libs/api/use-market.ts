import { useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiCode } from "@shared/api";
import {
  ApiContext,
  type GetDailyBarsResponse,
  type GetValuationsResponse,
  type Security,
} from "./client";

interface UseSecuritiesResult {
  data: Security[];
  isLoading: boolean;
  isError: boolean;
}
interface UseValuationResult {
  data: GetValuationsResponse | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
}
interface UseDailyBarsResult {
  data: GetDailyBarsResponse | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  refetch: () => void;
}

export const useSecurities = (): UseSecuritiesResult => {
  const client = useContext(ApiContext);
  const query = useQuery({
    queryKey: ["securities"],
    queryFn: async ({ signal }): Promise<Security[]> => {
      const response = await client.api.securities.$get({}, { init: { signal } });
      const body = await response.json();
      if (!response.ok || body.code !== apiCode.ok)
        throw new Error(body.message || "证券列表加载失败");
      return body.data?.securities?.filter((item): boolean => Boolean(item?.symbol)) ?? [];
    },
  });
  return { data: query.data ?? [], isLoading: query.isLoading, isError: query.isError };
};

export const useDailyBars = (symbol: string | null): UseDailyBarsResult => {
  const client = useContext(ApiContext);
  const query = useQuery({
    queryKey: ["daily-bars", symbol],
    enabled: Boolean(symbol),
    queryFn: async ({ signal }): Promise<GetDailyBarsResponse> => {
      const response = await client.api["daily-bars"].$get(
        { query: { symbol: symbol ?? "", adjType: "qfq" } },
        { init: { signal } },
      );
      const body = await response.json();
      if (!response.ok || body.code !== apiCode.ok || !body.data)
        throw new Error(body.message || "日线加载失败");
      return body.data;
    },
  });
  return {
    data: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: (): void => {
      void query.refetch();
    },
  };
};

/**
 * 估值查询与日线查询同构：按 symbol 缓存，失败只影响估值区，不阻断 K 线。
 */
export const useValuation = (symbol: string | null): UseValuationResult => {
  const client = useContext(ApiContext);
  const query = useQuery({
    queryKey: ["valuations", symbol],
    enabled: Boolean(symbol),
    queryFn: async ({ signal }): Promise<GetValuationsResponse> => {
      const response = await client.api.valuations.$get(
        { query: { symbol: symbol ?? "" } },
        { init: { signal } },
      );
      const body = await response.json();
      if (!response.ok || body.code !== apiCode.ok || !body.data)
        throw new Error(body.message || "估值加载失败");
      return body.data;
    },
  });
  return {
    data: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
  };
};
