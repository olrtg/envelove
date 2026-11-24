-- Rebuilding `categories` would delete Assigned rows and fail on categorized
-- Transactions, because the migrator's transaction keeps foreign keys on. The
-- `kind` column is swapped instead to replace its CHECK constraint.
ALTER TABLE `categories` ADD `__kind` text;--> statement-breakpoint
ALTER TABLE `categories` ADD `__credit_account_id` text;--> statement-breakpoint
UPDATE `categories` SET `__kind` = `kind`, `__credit_account_id` = `credit_account_id`, `kind` = 'ordinary', `credit_account_id` = NULL;--> statement-breakpoint
ALTER TABLE `categories` DROP COLUMN `kind`;--> statement-breakpoint
ALTER TABLE `categories` ADD `kind` text DEFAULT 'ordinary' NOT NULL CHECK ((`kind` IN ('ordinary', 'ready_to_assign') AND `credit_account_id` IS NULL) OR (`kind` = 'credit_payment' AND `credit_account_id` IS NOT NULL));--> statement-breakpoint
UPDATE `categories` SET `kind` = `__kind`, `credit_account_id` = `__credit_account_id`;--> statement-breakpoint
ALTER TABLE `categories` DROP COLUMN `__kind`;--> statement-breakpoint
ALTER TABLE `categories` DROP COLUMN `__credit_account_id`;--> statement-breakpoint
CREATE UNIQUE INDEX `categories_group_ready_to_assign_unique` ON `categories` (`category_group_id`) WHERE "categories"."kind" = 'ready_to_assign';--> statement-breakpoint
CREATE UNIQUE INDEX `category_groups_plan_inflow_unique` ON `category_groups` (`plan_id`) WHERE "category_groups"."kind" = 'inflow';--> statement-breakpoint
INSERT INTO `category_groups` (`id`, `plan_id`, `name`, `kind`, `position`)
SELECT 'inflow_' || `plans`.`id`, `plans`.`id`, 'Inflow', 'inflow', 0
FROM `plans`;--> statement-breakpoint
INSERT INTO `categories` (`id`, `category_group_id`, `name`, `kind`, `position`)
SELECT 'ready_to_assign_' || `plans`.`id`, 'inflow_' || `plans`.`id`, 'Ready to Assign', 'ready_to_assign', 0
FROM `plans`;
