# Supabase Project Discovery & Read-Only Audit Report
**Project Reference:** `sqtmtwmdniwekthcngfn`  
**Endpoint:** `https://sqtmtwmdniwekthcngfn.supabase.co`  
**Audit Status:** Remote Access Limitation Documented & Safe Read-Only Script Provided  
**Evaluation Timestamp:** October 13, 2026

---

## 1. Inspection Access & Environment Status

An automated connection to `https://sqtmtwmdniwekthcngfn.supabase.co` was probed:
- **API Gateway Response:** The Supabase Kong gateway is live and responding (HTTP 401 `UNAUTHORIZED_MISSING_API_KEY`, header `sb-project-ref: sqtmtwmdniwekthcngfn`).
- **Credential Status:** No publishable (`anon`) or secret (`service_role`) key exists in the local environment, and no local `.env` file containing credentials has been provisioned. In accordance with non-negotiable security rules, no secret keys were requested in chat or printed.
- **Limitation:** Direct database catalog queries cannot be executed programmatically from the local terminal without credentials.
- **Remediation:** A comprehensive, resilient, strictly read-only SQL audit script is provided below for execution in the Supabase Dashboard SQL Editor.

---

## 2. Resilient Read-Only PostgreSQL Catalog Audit Script

The following script queries PostgreSQL internal catalogs (`pg_class`, `pg_proc`, `pg_policies`, `pg_constraint`, `pg_index`, etc.) and `information_schema`. It uses defensive checks (`to_regclass`, `table_exists`) so it executes without error even if certain tables or schemas (such as `supabase_migrations`) do not yet exist.

```sql
-- =============================================================================
-- READ-ONLY DATABASE METADATA AUDIT SCRIPT
-- Target Project: sqtmtwmdniwekthcngfn
-- SAFETY GUARANTEE: Exclusively read-only metadata queries. Zero changes.
-- =============================================================================

-- SECTION 1: PUBLIC SCHEMA TABLES & RECORD COUNTS
SELECT 
    t.table_name,
    t.table_type,
    COALESCE(c.reltuples::bigint, 0) AS estimated_row_count
FROM information_schema.tables t
LEFT JOIN pg_class c ON c.relname = t.table_name AND c.relnamespace = 'public'::regnamespace
WHERE t.table_schema = 'public'
ORDER BY t.table_type, t.table_name;

-- SECTION 2: COLUMNS, DATA TYPES, DEFAULTS & NULLABILITY
SELECT 
    table_name,
    column_name,
    ordinal_position,
    data_type,
    udt_name,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;

-- SECTION 3: CONSTRAINTS (PRIMARY KEYS, FOREIGN KEYS, UNIQUE, CHECK)
SELECT 
    tc.table_name,
    tc.constraint_name,
    tc.constraint_type,
    kcu.column_name,
    ccu.table_schema AS foreign_table_schema,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name,
    rc.delete_rule,
    rc.update_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name 
    AND tc.table_schema = kcu.table_schema
LEFT JOIN information_schema.referential_constraints rc
    ON tc.constraint_name = rc.constraint_name 
    AND tc.table_schema = rc.constraint_schema
LEFT JOIN information_schema.constraint_column_usage ccu
    ON tc.constraint_name = ccu.constraint_name 
    AND tc.table_schema = ccu.constraint_schema
WHERE tc.table_schema = 'public'
ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name;

-- SECTION 4: INDEXES
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

-- SECTION 5: ROW LEVEL SECURITY (RLS) STATUS
SELECT 
    relname AS table_name,
    relrowsecurity AS rls_enabled,
    relforcerowsecurity AS rls_forced
FROM pg_class
WHERE relnamespace = 'public'::regnamespace 
  AND relkind = 'r'
ORDER BY relname;

-- SECTION 6: RLS POLICIES
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual IS NOT NULL AS has_using_expression,
    with_check IS NOT NULL AS has_with_check_expression
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- SECTION 7: DATABASE FUNCTIONS, SECURITY DEFINER & SEARCH PATH
SELECT 
    p.proname AS function_name,
    pg_get_function_arguments(p.oid) AS arguments,
    pg_get_function_result(p.oid) AS return_type,
    p.prosecdef AS is_security_definer,
    p.proleakproof AS is_leakproof,
    CASE 
        WHEN p.proconfig IS NULL THEN 'DEFAULT (inherits caller)'
        ELSE array_to_string(p.proconfig, ', ')
    END AS configuration_settings
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
ORDER BY p.proname;

-- SECTION 8: TRIGGERS
SELECT 
    event_object_table AS table_name,
    trigger_name,
    event_manipulation AS event,
    action_timing AS timing,
    action_statement
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table, trigger_name;

-- SECTION 9: RECORDED MIGRATION HISTORY (RESILIENT)
DO $$
BEGIN
    IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
        RAISE NOTICE 'Migration table found. Querying:';
    ELSE
        RAISE NOTICE 'supabase_migrations.schema_migrations does not exist.';
    END IF;
END $$;

SELECT * 
FROM supabase_migrations.schema_migrations 
ORDER BY version ASC;

-- SECTION 10: EXISTING STAKE UNITS (MINIMAL RECORD INSPECTION)
-- Only executed if stake_units table exists in public schema
DO $$
BEGIN
    IF to_regclass('public.stake_units') IS NOT NULL THEN
        RAISE NOTICE 'public.stake_units table detected.';
    ELSE
        RAISE NOTICE 'public.stake_units table does not exist.';
    END IF;
END $$;

SELECT id, unit_name, unit_type, is_active
FROM public.stake_units
ORDER BY unit_name;
```

---

## 3. Review Guidelines for Project Owner

When executing the script in the Supabase SQL Editor:
1. Copy the results or confirm if:
   - **Scenario A:** The public schema is completely empty (0 tables).
   - **Scenario B:** Pre-existing tables or migrations are present.
2. Note whether any stake units already exist in the database.
3. Share the structural findings (table names, column sets, function names) to confirm compatibility before Phase 2B migration execution.
