# Production Account Email Correction Specification & Procedure
**Project:** Young Single Adult Attendance Management System (YSA AMS)  
**Stake:** Abeokuta Nigeria Obantoko Stake | The Church of Jesus Christ of Latter-day Saints  
**Supabase Project Reference:** `sqtmtwmdniwekthcngfn`  
**Target User UUID:** `c608b043-4692-44f5-a872-d8848063c9c0`  
**Current Auth Email:** `hardebaryor111@gmail.com`  
**Correct Intended Email:** `hardeybaryor111@gmail.com`  
**Required Role:** `stake_presidency`  
**System Administrator UUID:** `6c42b342-3839-46d6-a1fa-7da227f45d33`  

---

## 1. Architectural & Security Findings

1. **Auth Email Modification (`auth.users`):**  
   Direct SQL updates to `auth.users` bypass GoTrue Auth validation and can desynchronize internal auth states. Using the official Supabase Auth Admin API (accessible via the Supabase Dashboard User Management UI) safely updates the email while strictly preserving the user's UUID, salt, and existing password hash.
2. **Profile Protection Trigger (`trg_protect_profile_fields`):**  
   The trigger function `public.fn_protect_profile_fields()` currently guards `public.user_profiles.email` by checking `IF NOT public.is_system_admin(auth.uid())`. In background execution, triggers, and SQL Editor sessions, `auth.uid()` evaluates to `NULL`, which fails the check and blocks any profile email update.  
   *Security Change:* We enhance `fn_protect_profile_fields()` so that when `NEW.email` is synchronized to match the verified `auth.users.email` (`NEW.email IS NOT DISTINCT FROM (SELECT email FROM auth.users WHERE id = NEW.id)`), it is recognized as an authorized identity synchronization. Direct unauthorized client alterations remain blocked.
3. **Automatic Profile Sync Trigger:**  
   `public.fn_sync_auth_user_profile()` is wired to fire on `AFTER INSERT OR UPDATE OF email ON auth.users`, ensuring future email administrative corrections in Supabase Auth automatically propagate to `public.user_profiles`.
4. **Audit Trail Integrity:**  
   The correction is recorded in `public.audit_logs` attributing the administrative action to the verified System Administrator (`6c42b342-3839-46d6-a1fa-7da227f45d33`), preserving factual accuracy without fabricating actor identities or faking JWT session claims.

---

## 2. Step-by-Step Production Procedure

### STEP 1: Read-Only Safety Verification
**Where to execute:** Supabase Dashboard > **SQL Editor** (`https://supabase.com/dashboard/project/sqtmtwmdniwekthcngfn/sql`)  
**Purpose:** Verify pre-conditions and confirm zero collisions. Zero mutations occur here.

```sql
-- =============================================================================
-- STEP 1: READ-ONLY PRE-FLIGHT VERIFICATION
-- =============================================================================
SELECT 
    'Target in auth.users' AS check_name,
    EXISTS(SELECT 1 FROM auth.users WHERE id = 'c608b043-4692-44f5-a872-d8848063c9c0' AND email = 'hardebaryor111@gmail.com') AS pass,
    (SELECT email FROM auth.users WHERE id = 'c608b043-4692-44f5-a872-d8848063c9c0') AS current_val
UNION ALL
SELECT 
    'Target in public.user_profiles',
    EXISTS(SELECT 1 FROM public.user_profiles WHERE id = 'c608b043-4692-44f5-a872-d8848063c9c0' AND email = 'hardebaryor111@gmail.com' AND account_status = 'active'),
    (SELECT email || ' (' || account_status || ')' FROM public.user_profiles WHERE id = 'c608b043-4692-44f5-a872-d8848063c9c0')
UNION ALL
SELECT 
    'Target role is stake_presidency',
    EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = 'c608b043-4692-44f5-a872-d8848063c9c0' AND role_name = 'stake_presidency'),
    (SELECT string_agg(role_name, ', ') FROM public.user_roles WHERE user_id = 'c608b043-4692-44f5-a872-d8848063c9c0')
UNION ALL
SELECT 
    'Collision Check: Intended email not in auth.users',
    NOT EXISTS(SELECT 1 FROM auth.users WHERE lower(email) = 'hardeybaryor111@gmail.com' AND id <> 'c608b043-4692-44f5-a872-d8848063c9c0'),
    COALESCE((SELECT id::text FROM auth.users WHERE lower(email) = 'hardeybaryor111@gmail.com' AND id <> 'c608b043-4692-44f5-a872-d8848063c9c0'), 'CLEAN: No collision')
UNION ALL
SELECT 
    'Collision Check: Intended email not in user_profiles',
    NOT EXISTS(SELECT 1 FROM public.user_profiles WHERE lower(email) = 'hardeybaryor111@gmail.com' AND id <> 'c608b043-4692-44f5-a872-d8848063c9c0'),
    COALESCE((SELECT id::text FROM public.user_profiles WHERE lower(email) = 'hardeybaryor111@gmail.com' AND id <> 'c608b043-4692-44f5-a872-d8848063c9c0'), 'CLEAN: No collision')
UNION ALL
SELECT 
    'System Admin identity verified',
    EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = '6c42b342-3839-46d6-a1fa-7da227f45d33' AND role_name = 'system_admin'),
    (SELECT email FROM public.user_profiles WHERE id = '6c42b342-3839-46d6-a1fa-7da227f45d33');
```
*Expected Result:* All rows must return `pass = true`.

---

### STEP 2: Database Security Enhancement (Profile Sync Authorization)
**Where to execute:** Supabase Dashboard > **SQL Editor**  
**Purpose:** Update `fn_protect_profile_fields()` to permit legitimate email synchronization with `auth.users`, and wire the trigger on `auth.users` for email updates.

```sql
-- =============================================================================
-- STEP 2: PROFILE SYNC SECURITY ENHANCEMENT
-- =============================================================================

-- 1. Refine profile protection trigger function to allow auth synchronization
CREATE OR REPLACE FUNCTION public.fn_protect_profile_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- If user is NOT a system_admin, prevent unauthorized modifications
    IF NOT public.is_system_admin(auth.uid()) THEN
        IF NEW.account_status IS DISTINCT FROM OLD.account_status THEN
            RAISE EXCEPTION 'Unauthorized: Only system administrators can alter account status.';
        END IF;

        IF NEW.email IS DISTINCT FROM OLD.email THEN
            -- Allow synchronization when the profile email matches the verified auth.users email
            IF NEW.email IS NOT DISTINCT FROM (SELECT email FROM auth.users WHERE id = NEW.id) THEN
                NULL; -- Authorized synchronization from auth.users
            ELSE
                RAISE EXCEPTION 'Unauthorized: Profile email address cannot be changed directly.';
            END IF;
        END IF;
    END IF;

    NEW.updated_at := timezone('utc'::text, now());
    RETURN NEW;
END;
$$;

-- 2. Wire auth.users trigger to sync on email updates in addition to inserts
DROP TRIGGER IF EXISTS trg_on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS trg_on_auth_user_sync ON auth.users;

CREATE TRIGGER trg_on_auth_user_sync
AFTER INSERT OR UPDATE OF email ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.fn_sync_auth_user_profile();
```

---

### STEP 3: Change Auth Email via Supabase Auth Admin Interface
**Where to execute:** Supabase Dashboard > **Authentication** > **Users** (`https://supabase.com/dashboard/project/sqtmtwmdniwekthcngfn/auth/users`)  
**Steps:**
1. In the search box, search for `hardebaryor111@gmail.com` or UUID `c608b043-4692-44f5-a872-d8848063c9c0`.
2. Click the user row or the three dots (`...`) on the right side and select **Edit user** (or **Change Email**).
3. Change the email field from `hardebaryor111@gmail.com` to `hardeybaryor111@gmail.com`.
4. Ensure **Auto Confirm Email** is selected/checked (so no external email verification link is required).
5. Click **Save** / **Update user**.

*Result:* GoTrue updates `auth.users`. Because `trg_on_auth_user_sync` and the enhanced `fn_protect_profile_fields` are in place, `public.user_profiles.email` automatically updates to `hardeybaryor111@gmail.com`.

---

### STEP 4: Audit Trail Recording & Sync Assurance
**Where to execute:** Supabase Dashboard > **SQL Editor**  
**Purpose:** Ensure `public.user_profiles.email` is fully synchronized and write the immutable audit log entry attributing the action to System Administrator `6c42b342-3839-46d6-a1fa-7da227f45d33`.

```sql
-- =============================================================================
-- STEP 4: AUDIT TRAIL LOGGING & SYNC ASSURANCE
-- =============================================================================
DO $$
DECLARE
    v_admin_uuid   UUID := '6c42b342-3839-46d6-a1fa-7da227f45d33';
    v_target_uuid  UUID := 'c608b043-4692-44f5-a872-d8848063c9c0';
    v_auth_email   TEXT;
    v_profile_email TEXT;
    v_now          TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
    SELECT email INTO v_auth_email FROM auth.users WHERE id = v_target_uuid;
    SELECT email INTO v_profile_email FROM public.user_profiles WHERE id = v_target_uuid;

    -- Safety check: Auth must already have the corrected email
    IF v_auth_email <> 'hardeybaryor111@gmail.com' THEN
        RAISE EXCEPTION 'Auth email is %, expected hardeybaryor111@gmail.com. Complete Step 3 first.', v_auth_email;
    END IF;

    -- Ensure profile matches auth.users
    IF v_profile_email <> v_auth_email THEN
        UPDATE public.user_profiles
        SET email = v_auth_email,
            updated_at = v_now
        WHERE id = v_target_uuid;
    END IF;

    -- Record accurate administrative audit log
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        target_record_id,
        target_table,
        outcome,
        metadata,
        created_at
    )
    VALUES (
        v_admin_uuid,
        'ADMIN_CORRECT_LEADERSHIP_EMAIL',
        v_target_uuid::text,
        'user_profiles',
        'success',
        jsonb_build_object(
            'old_email', 'hardebaryor111@gmail.com',
            'corrected_email', v_auth_email,
            'role', 'stake_presidency',
            'reason', 'Stake Presidency login typo correction',
            'executed_at', v_now
        ),
        v_now
    );

    RAISE NOTICE 'SUCCESS: Stake Presidency email corrected to % and audited under admin %', v_auth_email, v_admin_uuid;
END $$;
```

---

### STEP 5: Verification & Acceptance
**Where to execute:** Supabase Dashboard > **SQL Editor** & Web Browser

**1. SQL Verification Query:**
```sql
SELECT 
    u.id AS auth_uuid,
    u.email AS auth_email,
    u.email_confirmed_at,
    p.email AS profile_email,
    p.account_status,
    p.full_name,
    r.role_name,
    a.action AS latest_audit_action,
    a.actor_id AS audit_actor_admin,
    a.created_at AS audited_at
FROM auth.users u
JOIN public.user_profiles p ON p.id = u.id
JOIN public.user_roles r ON r.user_id = u.id
LEFT JOIN LATERAL (
    SELECT action, actor_id, created_at 
    FROM public.audit_logs 
    WHERE target_record_id = u.id::text 
    ORDER BY created_at DESC 
    LIMIT 1
) a ON true
WHERE u.id = 'c608b043-4692-44f5-a872-d8848063c9c0';
```

**2. Application Sign-In Test:**
1. Navigate to `/la` (Leadership Login).
2. Enter email: `hardeybaryor111@gmail.com`.
3. Enter existing password.
4. Verify user signs in successfully and lands on the Stake Presidency leadership dashboard with stake-wide metrics.
