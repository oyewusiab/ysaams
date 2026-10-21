-- Migration: 20261021000010_dynamic_activity_categories.sql
-- Description: Allow dynamic activity categories while preserving NOT NULL and non-empty integrity constraints.
-- Replaces restrictive CHECK constraint on public.activities(category).

DO $$
BEGIN
    -- 1. Drop the legacy check constraint restricting category to the fixed 7 values
    IF EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE table_schema = 'public' 
          AND table_name = 'activities' 
          AND constraint_name = 'activities_category_check'
    ) THEN
        ALTER TABLE public.activities DROP CONSTRAINT activities_category_check;
    END IF;

    -- 2. Add an idempotent check constraint enforcing non-empty, trimmed category text
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE table_schema = 'public' 
          AND table_name = 'activities' 
          AND constraint_name = 'activities_category_check'
    ) THEN
        ALTER TABLE public.activities 
            ADD CONSTRAINT activities_category_check 
            CHECK (length(trim(category)) > 0);
    END IF;
END $$;

-- 3. Ensure index exists for high-performance category filtering and reporting
CREATE INDEX IF NOT EXISTS idx_activities_category ON public.activities(category);
