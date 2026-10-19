# Initial Administrator Bootstrap Specification
**Abeokuta Nigeria Obantoko Stake | The Church of Jesus Christ of Latter-day Saints**
**Intended Primary Administrator:** `oyewusi.adebayo1@gmail.com`  
**Security Status:** Design-Only Baseline (Account Provisioning NOT Executed in Phase 2A)

---

## 1. Security Invariants & Zero-Secret Policy

1. **No Embedded Passwords:** Passwords, temporary credentials, or invitation tokens must NEVER be written to Git history, SQL migration files, environment templates, or terminal output.
2. **No Public Escalation:** Public client API endpoints cannot assign or grant the `system_admin` role.
3. **Idempotent Retry Safety:** The bootstrap procedure must be safe to re-run without creating duplicate identities or orphaned records if a network timeout occurs.
4. **Audit Trail Integrity:** Every bootstrap or administrative elevation must log an entry in `public.audit_logs`.

---

## 2. Recommended Bootstrap Architecture

The bootstrap is executed through a **Server-Side Administrative Function** that operates within the Supabase SQL Editor or via an authenticated Edge Function with trusted privileges.

### Phase 1: Identity Creation in `auth.users`
The administrator account is created directly via Supabase Auth:
- **Method A (Supabase Dashboard / Auth UI - Recommended):**
  1. The project owner navigates to **Authentication > Users** in the Supabase Dashboard.
  2. Clicks **Add User > Invite user** or **Create user**.
  3. Enters `oyewusi.adebayo1@gmail.com` with a secure password or triggers an email invite.
  4. Supabase Auth creates the record in `auth.users` and assigns a UUID.

- **Method B (SQL Editor with Secure Cryptographic Hash):**
  If dashboard access is limited, an administrative SQL function creates the user using `auth.users` schema bindings without plaintext password retention in script files.

---

## 3. Trusted Elevation Script (To Be Run in Phase 2B+)

Once the Auth identity exists for `oyewusi.adebayo1@gmail.com`, the following trusted script assigns the profile and `system_admin` role:

```sql
-- =============================================================================
-- TRUSTED SYSTEM ADMINISTRATOR ELEVATION SCRIPT
-- Execute in Supabase SQL Editor ONLY after user identity is created in Auth
-- Target Administrator: oyewusi.adebayo1@gmail.com
-- =============================================================================

DO $$
DECLARE
    v_admin_email TEXT := 'oyewusi.adebayo1@gmail.com';
    v_admin_name  TEXT := 'Adebayo Oyewusi';
    v_user_id     UUID;
BEGIN
    -- 1. Locate existing Auth identity
    SELECT id INTO v_user_id 
    FROM auth.users 
    WHERE lower(email) = lower(v_admin_email);

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Auth user with email % not found. Please create the user in Supabase Auth first.', v_admin_email;
    END IF;

    -- 2. Create or update user profile (preserves existing Auth UUID)
    INSERT INTO public.user_profiles (id, full_name, email, account_status)
    VALUES (v_user_id, v_admin_name, v_admin_email, 'active')
    ON CONFLICT (id) DO UPDATE 
    SET full_name = EXCLUDED.full_name,
        email = COALESCE(EXCLUDED.email, public.user_profiles.email),
        account_status = 'active',
        updated_at = timezone('utc'::text, now());

    -- 3. Assign system_admin role idempotently
    INSERT INTO public.user_roles (user_id, role_name, assigned_by)
    VALUES (v_user_id, 'system_admin', v_user_id)
    ON CONFLICT (user_id, role_name) DO NOTHING;

    -- 4. Record bootstrap in immutable audit log once
    IF NOT EXISTS (
        SELECT 1
        FROM public.audit_logs
        WHERE actor_id = v_user_id
          AND action = 'SYSTEM_ADMIN_BOOTSTRAP'
    ) THEN
        INSERT INTO public.audit_logs (actor_id, action, target_record_id, target_table, outcome, metadata)
        VALUES (
            v_user_id,
            'SYSTEM_ADMIN_BOOTSTRAP',
            v_user_id::text,
            'user_roles',
            'success',
            jsonb_build_object(
                'email', v_admin_email,
                'role', 'system_admin',
                'timestamp', timezone('utc'::text, now())
            )
        );
    END IF;

    RAISE NOTICE 'Successfully provisioned system_admin privileges for % (User ID: %)', v_admin_email, v_user_id;
END $$;
```

---

## 4. Password Reset & Account Recovery

1. **Self-Service Password Recovery:** The application leadership login interface integrates with `supabase.auth.resetPasswordForEmail()`.
2. **Administrative Override:** If email delivery fails, the project owner can generate a password recovery link directly from the Supabase Dashboard: **Authentication > Users > [User] > Send Password Reset**.
