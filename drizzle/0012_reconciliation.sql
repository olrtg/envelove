ALTER TABLE `accounts` ADD `last_reconciled_at` integer;--> statement-breakpoint
ALTER TABLE `transactions` ADD `reconciled` integer DEFAULT false NOT NULL CONSTRAINT transactions_reconciled_cleared_check CHECK (reconciled = 0 OR cleared = 1);--> statement-breakpoint
ALTER TABLE `transactions` ADD `reconciliation_adjustment` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- Starter Plans created after 0010 could be missing their system category.
INSERT INTO category_groups (id, plan_id, name, kind, position)
SELECT 'inflow_' || p.id, p.id, 'Inflow', 'inflow', 0 FROM plans p
WHERE NOT EXISTS (
  SELECT 1 FROM category_groups g WHERE g.plan_id = p.id AND g.kind = 'inflow'
);--> statement-breakpoint
INSERT INTO categories (id, category_group_id, name, kind, position)
SELECT 'ready_to_assign_' || g.plan_id, g.id, 'Ready to Assign', 'ready_to_assign', 0
FROM category_groups g
WHERE g.kind = 'inflow' AND NOT EXISTS (
  SELECT 1 FROM categories c WHERE c.category_group_id = g.id AND c.kind = 'ready_to_assign'
);
