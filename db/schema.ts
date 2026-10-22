import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const state = sqliteTable('cloud_state', { id: integer('id').primaryKey(), revision: integer('revision').notNull(), payload: text('payload').notNull(), updatedAt: text('updated_at').notNull(), actor: text('actor').notNull(), device: text('device').notNull() });
export const settings = sqliteTable('cloud_settings', { id: integer('id').primaryKey(), payload: text('payload').notNull() });
export const records = sqliteTable('cloud_records', { id: text('id').primaryKey(), category: text('category').notNull(), payload: text('payload').notNull(), createdAt: text('created_at').notNull() });
export const audit = sqliteTable('cloud_audit', { id: integer('id').primaryKey({ autoIncrement: true }), revision: integer('revision').notNull(), actor: text('actor').notNull(), device: text('device').notNull(), createdAt: text('created_at').notNull() });
