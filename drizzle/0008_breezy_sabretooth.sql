ALTER TABLE `categories` ADD `credit_account_id` text REFERENCES `accounts`(`id`) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `categories` ADD `kind` text DEFAULT 'ordinary' NOT NULL CHECK ((`kind` = 'ordinary' AND `credit_account_id` IS NULL) OR (`kind` = 'credit_payment' AND `credit_account_id` IS NOT NULL));--> statement-breakpoint
ALTER TABLE `categories` ADD `hidden` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `categories_credit_account_id_unique` ON `categories` (`credit_account_id`);--> statement-breakpoint
ALTER TABLE `category_groups` ADD `kind` text DEFAULT 'ordinary' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `category_groups_plan_credit_payments_unique` ON `category_groups` (`plan_id`) WHERE `kind` = 'credit_card_payments';
