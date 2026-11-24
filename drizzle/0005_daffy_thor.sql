CREATE TABLE `transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `transfers_plan_id_idx` ON `transfers` (`plan_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`category_id` text,
	`transfer_id` text,
	`transfer_side` text,
	`date` text NOT NULL,
	`payee` text,
	`memo` text,
	`amount` integer NOT NULL,
	`cleared` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`transfer_id`) REFERENCES `transfers`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "transactions_amount_nonzero_check" CHECK("__new_transactions"."amount" <> 0),
	CONSTRAINT "transactions_transfer_linkage_check" CHECK(("__new_transactions"."transfer_id" is null and "__new_transactions"."transfer_side" is null) or ("__new_transactions"."transfer_id" is not null and "__new_transactions"."transfer_side" is not null)),
	CONSTRAINT "transactions_transfer_fields_check" CHECK("__new_transactions"."transfer_id" is null or ("__new_transactions"."category_id" is null and "__new_transactions"."payee" is null)),
	CONSTRAINT "transactions_transfer_side_amount_check" CHECK("__new_transactions"."transfer_side" is null or ("__new_transactions"."transfer_side" = 'outflow' and "__new_transactions"."amount" < 0) or ("__new_transactions"."transfer_side" = 'inflow' and "__new_transactions"."amount" > 0))
);
--> statement-breakpoint
INSERT INTO `__new_transactions`("id", "account_id", "category_id", "date", "payee", "memo", "amount", "cleared", "created_at", "updated_at") SELECT "id", "account_id", "category_id", "date", "payee", "memo", "amount", "cleared", "created_at", "updated_at" FROM `transactions`;--> statement-breakpoint
DROP TABLE `transactions`;--> statement-breakpoint
ALTER TABLE `__new_transactions` RENAME TO `transactions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `transactions_account_id_date_created_at_idx` ON `transactions` (`account_id`,`date`,`created_at`);--> statement-breakpoint
CREATE INDEX `transactions_category_id_idx` ON `transactions` (`category_id`);--> statement-breakpoint
CREATE INDEX `transactions_transfer_id_idx` ON `transactions` (`transfer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_transfer_id_side_unique` ON `transactions` (`transfer_id`,`transfer_side`);
