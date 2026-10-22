CREATE TABLE `cloud_audit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`revision` integer NOT NULL,
	`actor` text NOT NULL,
	`device` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cloud_records` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cloud_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cloud_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`payload` text NOT NULL,
	`updated_at` text NOT NULL,
	`actor` text NOT NULL,
	`device` text NOT NULL
);
