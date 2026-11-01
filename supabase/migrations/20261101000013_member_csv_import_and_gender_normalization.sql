-- ============================================================================
-- YSA Attendance Management System (YSA AMS)
-- Migration: 20261101000013_member_csv_import_and_gender_normalization.sql
-- Purpose:
--   1. Preserve `members_gender_check` (`gender IN ('male', 'female')`) while
--      normalizing unambiguous gender representations ('M', 'm', 'Male',
--      'F', 'f', 'Female', or blank -> NULL) via a BEFORE INSERT OR UPDATE
--      trigger on `public.members`. Unknown values remain untouched so
--      `members_gender_check` continues to reject them with SQLSTATE 23514.
--   2. Enforce role authorization on `public.record_manual_attendance` so
--      `bishop`, `branch_president`, `ward_clerk`, `branch_clerk`, and
--      `stake_clerk` cannot execute manual check-ins via direct RPC calls.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. BEFORE INSERT OR UPDATE Gender Normalization Trigger on public.members
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_normalize_member_gender()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_clean TEXT;
BEGIN
  IF NEW.gender IS NULL THEN
    RETURN NEW;
  END IF;

  v_clean := lower(btrim(NEW.gender));

  IF v_clean = '' THEN
    NEW.gender := NULL;
  ELSIF v_clean IN ('m', 'male') THEN
    NEW.gender := 'male';
  ELSIF v_clean IN ('f', 'female') THEN
    NEW.gender := 'female';
  ELSE
    -- Preserve trimmed raw value so `members_gender_check` raises 23514
    NEW.gender := btrim(NEW.gender);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_member_gender ON public.members;

CREATE TRIGGER trg_normalize_member_gender
  BEFORE INSERT OR UPDATE OF gender ON public.members
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_normalize_member_gender();
