CREATE TABLE `security_valuation` (
	`symbol` text NOT NULL,
	`metric` text NOT NULL,
	`trade_date` text NOT NULL,
	`value` real NOT NULL,
	`percentile` real,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`symbol`, `metric`, `trade_date`)
);
