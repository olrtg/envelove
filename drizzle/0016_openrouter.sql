CREATE TABLE `openrouter_connections` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`encrypted_key` text,
	`state` text,
	`verifier` text,
	`return_plan` text,
	`expires_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
