# Supabase Migrations Directory

This directory stores versioned, immutable SQL migrations for the fresh **Abeokuta Nigeria Obantoko Stake YSA Attendance Management System**.

## Migration Rules:
1. All future database modifications must be authored as timestamped sequential migrations (`YYYYMMDDHHMMSS_description.sql`).
2. Migrations must be idempotent (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `DROP TRIGGER IF EXISTS`).
3. No legacy migration files or schemas from previous projects are reused here.
4. Migrations will be authored and applied in Phase 2+ following owner inspection of the target Supabase instance.
