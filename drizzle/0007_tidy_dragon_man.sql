CREATE TABLE `payees` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payees_plan_id_name_key_unique` ON `payees` (`plan_id`,`name_key`);--> statement-breakpoint
INSERT INTO `payees` (`id`, `plan_id`, `name`, `name_key`, `created_at`, `updated_at`)
SELECT
	'payee_' || `canonical`.`id`,
	`canonical`.`plan_id`,
	trim(`canonical`.`payee`),
	lower(trim(`canonical`.`payee`)),
	`canonical`.`created_at`,
	`canonical`.`updated_at`
FROM (
	SELECT
		`transactions`.`id`,
		`accounts`.`plan_id`,
		`transactions`.`payee`,
		`transactions`.`created_at`,
		`transactions`.`updated_at`,
		row_number() OVER (
			PARTITION BY `accounts`.`plan_id`, lower(trim(`transactions`.`payee`))
			ORDER BY `transactions`.`created_at` DESC, `transactions`.`id` DESC
		) AS `row_number`
	FROM `transactions`
	INNER JOIN `accounts` ON `transactions`.`account_id` = `accounts`.`id`
	WHERE
		`transactions`.`transfer_id` IS NULL
		AND trim(coalesce(`transactions`.`payee`, '')) <> ''
) AS `canonical`
WHERE `canonical`.`row_number` = 1;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`category_id` text,
	`payee_id` text,
	`transfer_id` text,
	`transfer_side` text,
	`date` text NOT NULL,
	`memo` text,
	`amount` integer NOT NULL,
	`cleared` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`payee_id`) REFERENCES `payees`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`transfer_id`) REFERENCES `transfers`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "transactions_amount_nonzero_check" CHECK("__new_transactions"."amount" <> 0),
	CONSTRAINT "transactions_transfer_linkage_check" CHECK(("__new_transactions"."transfer_id" is null and "__new_transactions"."transfer_side" is null) or ("__new_transactions"."transfer_id" is not null and "__new_transactions"."transfer_side" is not null)),
	CONSTRAINT "transactions_transfer_fields_check" CHECK("__new_transactions"."transfer_id" is null or ("__new_transactions"."category_id" is null and "__new_transactions"."payee_id" is null)),
	CONSTRAINT "transactions_transfer_side_amount_check" CHECK("__new_transactions"."transfer_side" is null or ("__new_transactions"."transfer_side" = 'outflow' and "__new_transactions"."amount" < 0) or ("__new_transactions"."transfer_side" = 'inflow' and "__new_transactions"."amount" > 0))
);
--> statement-breakpoint
INSERT INTO `__new_transactions`("id", "account_id", "category_id", "payee_id", "transfer_id", "transfer_side", "date", "memo", "amount", "cleared", "created_at", "updated_at")
SELECT
	`transactions`.`id`,
	`transactions`.`account_id`,
	`transactions`.`category_id`,
	CASE
		WHEN `transactions`.`transfer_id` IS NULL
			AND trim(coalesce(`transactions`.`payee`, '')) <> ''
		THEN `payees`.`id`
		ELSE NULL
	END,
	`transactions`.`transfer_id`,
	`transactions`.`transfer_side`,
	`transactions`.`date`,
	`transactions`.`memo`,
	`transactions`.`amount`,
	`transactions`.`cleared`,
	`transactions`.`created_at`,
	`transactions`.`updated_at`
FROM `transactions`
INNER JOIN `accounts` ON `transactions`.`account_id` = `accounts`.`id`
LEFT JOIN `payees` ON
	`payees`.`plan_id` = `accounts`.`plan_id`
	AND `payees`.`name_key` = lower(trim(`transactions`.`payee`));--> statement-breakpoint
DROP TABLE `transactions`;--> statement-breakpoint
ALTER TABLE `__new_transactions` RENAME TO `transactions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `transactions_account_id_date_created_at_idx` ON `transactions` (`account_id`,`date`,`created_at`);--> statement-breakpoint
CREATE INDEX `transactions_category_id_idx` ON `transactions` (`category_id`);--> statement-breakpoint
CREATE INDEX `transactions_payee_id_idx` ON `transactions` (`payee_id`);--> statement-breakpoint
CREATE INDEX `transactions_transfer_id_idx` ON `transactions` (`transfer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_transfer_id_side_unique` ON `transactions` (`transfer_id`,`transfer_side`);
