# Supabase Inspection Plan & Safe Read-Only Audit
**Target Supabase Project:** `https://sqtmtwmdniwekthcngfn.supabase.co`  
**Purpose:** Inspect current database state without altering, resetting, or modifying any data.

---

## Instructions for Project Owner

To verify whether your Supabase instance currently contains tables, migrations, or policies, execute the following **read-only SQL script** in the **Supabase Dashboard SQL Editor**:
1. Log into your Supabase Dashboard: [https://supabase.com/dashboard/project/sqtmtwmdniwekthcngfn](https://supabase.com/dashboard/project/sqtmtwmdniwekthcngfn)
2. In the left navigation, click **SQL Editor**.
3. Create a new query, paste the script below, and click **Run**.
4. The script is strictly read-only (`SELECT` statements only). It will not delete, alter, or insert any records.

---

## Safe Read-Only SQL Inspection Script

```sql
-- =============================================================================
-- READ-ONLY SUPABASE PROJECT AUDIT SCRIPT
-- Project: sqtmtwmdniwekthcngfn
-- SAFETY GUARANTEE: Read-only metadata queries. Zero schema or data changes.
-- =============================================================================

-- 1. Inventory of Tables in the 'public' Schema
SELECT 
    table_name,
    (SELECT count(*) FROM information_schema.columns WHERE table_name = t.table_name AND table_schema = 'public') AS column_count
FROM information_schema.tables t
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- 2. Row-Level Security (RLS) Status on Public Tables
SELECT 
    relname AS table_name,
    relrowsecurity AS rls_enabled,
    relforcerowsecurity AS rls_forced
FROM pg_class
WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
ORDER BY relname;

-- 3. Configured RLS Policies
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual IS NOT NULL AS has_using_clause,
    with_check IS NOT NULL AS has_check_clause
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- 4. Custom Database Functions & Stored Procedures (RPCs)
SELECT 
    p.proname AS function_name,
    pg_get_function_arguments(p.oid) AS argument_list,
    p.prosecdef AS is_security_definer,
    pg_get_function_result(p.oid) AS return_type
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
ORDER BY p.proname;

-- 5. Database Triggers on Public Tables
SELECT 
    event_object_table AS table_name,
    trigger_name,
    event_manipulation AS event,
    action_timing AS timing,
    action_statement
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table, trigger_name;

-- 6. Recorded Migrations (if supabase_migrations schema exists)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'supabase_migrations' AND table_name = 'schema_migrations'
    ) THEN
        RAISE NOTICE 'Migration table found. Querying schema_migrations:';
    ELSE
        RAISE NOTICE 'No supabase_migrations.schema_migrations table found (database has no recorded CLI migrations).';
    END IF;
END $$;

SELECT * FROM supabase_migrations.schema_migrations ORDER BY version ASC;
```

---

## Evaluating Results for Phase 2 Planning

- **Case A: Database is completely empty (0 public tables):**
  - In Phase 2, we will author fresh, sequential migrations starting with `00001_initial_schema.sql` directly into `supabase/migrations/` and apply them.
- **Case B: Tables already exist:**
  - Review whether they match the required relational schema or represent pre-existing drafts.
  - Inform the engineering lead of existing tables so migrations can be safely aligned.
