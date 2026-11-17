import { loadConfig } from "./config.ts";
import { createValuationFetcher } from "./libs/hongsehuojian/valuation.ts";
import { openSqliteDatabase } from "./libs/sqlite/database.ts";
import { createSqliteMarketRepository } from "./market/repository/sqlite/sqlite-market-repository.ts";
import { syncValuationData } from "./market/service/sync-valuation.ts";

const main = async (): Promise<void> => {
  const config = loadConfig(".env");
  const db = openSqliteDatabase(config.databaseDsn);
  try {
    const repository = createSqliteMarketRepository(db);
    const summary = await syncValuationData({
      repository,
      fetcher: createValuationFetcher(),
    });
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    db.$client.close();
  }
};

void main().catch((error: unknown): void => {
  console.error(error);
  process.exitCode = 1;
});
