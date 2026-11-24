CREATE TABLE `category_assignments` (
	`category_id` text NOT NULL,
	`month` text NOT NULL,
	`amount` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`category_id`, `month`),
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "category_assignments_month_check" CHECK("category_assignments"."month" glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]' and substr("category_assignments"."month", 6, 2) between '01' and '12')
);
