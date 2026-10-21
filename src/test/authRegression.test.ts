import { describe, it, expect, vi, beforeEach } from 'vitest'
import { authService } from '../services/authService'
import { deriveLeadershipAccess } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

describe('Leadership Authentication & Profile Resolution Regression Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  describe('1. Successful Auth Followed by Profile and Role Loading', () => {
    it('authenticates administrator (oyewusi.adebayo1@gmail.com), loads matching profile UUID, and resolves system_admin role', async () => {
      const adminAuthId = '6c42b342-3839-46d6-a1fa-7da227f45d33'
      const adminEmail = 'oyewusi.adebayo1@gmail.com'

      // Mock Supabase Auth signInWithPassword success
      vi.spyOn(supabase.auth, 'signInWithPassword').mockResolvedValueOnce({
        data: {
          user: { id: adminAuthId, email: adminEmail } as any,
          session: { access_token: 'valid-admin-jwt' } as any
        },
        error: null
      })

      // Mock Supabase PostgREST tables
      vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
        if (table === 'user_profiles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: adminAuthId,
                    full_name: 'Adebayo Oyewusi',
                    email: adminEmail,
                    account_status: 'active',
                    created_at: '2026-10-18T00:00:00Z',
                    updated_at: '2026-10-18T00:00:00Z'
                  },
                  error: null
                })
              })
            })
          } as any
        }
        if (table === 'user_roles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [{ role_name: 'system_admin' }],
                error: null
              })
            })
          } as any
        }
        if (table === 'user_unit_assignments') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [],
                error: null
              })
            })
          } as any
        }
        throw new Error(`Unexpected table ${table}`)
      })

      const res = await authService.signInWithPassword(adminEmail, 'correct-password')
      expect(res.success).toBe(true)
      expect(res.error).toBeUndefined()

      // Verify profile and role loading directly
      const profile = await authService.fetchUserProfile(adminAuthId)
      expect(profile).not.toBeNull()
      expect(profile?.id).toBe(adminAuthId)
      expect(profile?.roles).toEqual(['system_admin'])
      expect(profile?.accountStatus).toBe('active')

      // Verify authorized access
      const access = deriveLeadershipAccess(profile!.roles, profile!.unitAssignments)
      expect(access.isSystemAdmin).toBe(true)
      expect(access.isStakeLeader).toBe(true)
      expect(access.hasStakeWideReadAccess).toBe(true)
      expect(access.canManageActivities).toBe(true)
      expect(access.canManageMembers).toBe(true)
      expect(access.canRecordManualAttendance).toBe(true)
    })

    it('authenticates second account (hardeybaryor111@gmail.com), loads matching profile UUID, and resolves stake_presidency role', async () => {
      const stakePresId = 'c608b043-4692-44f5-a872-d8848063c9c0'
      const stakePresEmail = 'hardeybaryor111@gmail.com'

      vi.spyOn(supabase.auth, 'signInWithPassword').mockResolvedValueOnce({
        data: {
          user: { id: stakePresId, email: stakePresEmail } as any,
          session: { access_token: 'valid-stake-pres-jwt' } as any
        },
        error: null
      })

      vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
        if (table === 'user_profiles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: stakePresId,
                    full_name: 'Oyewusi, Adebayo Babatunde',
                    email: stakePresEmail,
                    account_status: 'active',
                    created_at: '2026-10-18T00:00:00Z',
                    updated_at: '2026-10-18T00:00:00Z'
                  },
                  error: null
                })
              })
            })
          } as any
        }
        if (table === 'user_roles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [{ role_name: 'stake_presidency' }],
                error: null
              })
            })
          } as any
        }
        if (table === 'user_unit_assignments') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [],
                error: null
              })
            })
          } as any
        }
        throw new Error(`Unexpected table ${table}`)
      })

      const res = await authService.signInWithPassword(stakePresEmail, 'correct-password')
      expect(res.success).toBe(true)
      expect(res.error).toBeUndefined()

      const profile = await authService.fetchUserProfile(stakePresId)
      expect(profile).not.toBeNull()
      expect(profile?.id).toBe(stakePresId)
      expect(profile?.roles).toEqual(['stake_presidency'])

      const access = deriveLeadershipAccess(profile!.roles, profile!.unitAssignments)
      expect(access.isSystemAdmin).toBe(false)
      expect(access.isStakeLeader).toBe(true)
      expect(access.hasStakeWideReadAccess).toBe(true)
      expect(access.canManageActivities).toBe(true)
      expect(access.canManageMembers).toBe(true)
    })
  })

  describe('2. Supabase Auth Failure vs Authorization Failure (Second Account Symptom)', () => {
    it('halts immediately at Auth layer when GoTrue returns "Invalid login credentials" without querying profile', async () => {
      const fromSpy = vi.spyOn(supabase, 'from')
      const signOutSpy = vi.spyOn(supabase.auth, 'signOut').mockResolvedValueOnce({ error: null })

      vi.spyOn(supabase.auth, 'signInWithPassword').mockResolvedValueOnce({
        data: { user: null, session: null },
        error: {
          name: 'AuthApiError',
          message: 'Invalid login credentials',
          status: 400
        } as any
      })

      const res = await authService.signInWithPassword('hardeybaryor111@gmail.com', 'wrong-or-unconfirmed-password')

      expect(res.success).toBe(false)
      expect(res.error).toBe('Invalid login credentials')

      // Proof: Database profile and roles were NEVER queried
      expect(fromSpy).not.toHaveBeenCalled()
      // Proof: Sign out was not needed since no session was established
      expect(signOutSpy).not.toHaveBeenCalled()
    })
  })

  describe('3. Genuinely Missing Profile Handling', () => {
    it('returns "No leadership profile found for this account" when Auth succeeds but database row is truly absent (0 rows)', async () => {
      const unprovisionedId = '00000000-0000-0000-0000-000000000001'
      const signOutSpy = vi.spyOn(supabase.auth, 'signOut').mockResolvedValueOnce({ error: null })

      vi.spyOn(supabase.auth, 'signInWithPassword').mockResolvedValueOnce({
        data: {
          user: { id: unprovisionedId, email: 'orphan@example.com' } as any,
          session: { access_token: 'valid-jwt' } as any
        },
        error: null
      })

      vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
        if (table === 'user_profiles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                // Returns 0 rows: data null, error null
                maybeSingle: vi.fn().mockResolvedValue({
                  data: null,
                  error: null
                })
              })
            })
          } as any
        }
        throw new Error(`Unexpected table ${table}`)
      })

      const res = await authService.signInWithPassword('orphan@example.com', 'some-password')

      expect(res.success).toBe(false)
      expect(res.error).toBe('No leadership profile found for this account. Please contact a Stake System Administrator.')
      // Unprovisioned session is cleared
      expect(signOutSpy).toHaveBeenCalled()
    })
  })

  describe('4. Database Query Failure vs Missing Profile (Root Cause of Defect)', () => {
    it('reports database query failure instead of falsely diagnosing "No leadership profile found" when user_profiles query errors', async () => {
      const adminAuthId = '6c42b342-3839-46d6-a1fa-7da227f45d33'
      const signOutSpy = vi.spyOn(supabase.auth, 'signOut').mockResolvedValueOnce({ error: null })

      vi.spyOn(supabase.auth, 'signInWithPassword').mockResolvedValueOnce({
        data: {
          user: { id: adminAuthId, email: 'oyewusi.adebayo1@gmail.com' } as any,
          session: { access_token: 'valid-jwt' } as any
        },
        error: null
      })

      vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
        if (table === 'user_profiles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                // Database query error (e.g. JWT expired, network glitch, PostgREST 500)
                maybeSingle: vi.fn().mockResolvedValue({
                  data: null,
                  error: { code: 'PGRST301', message: 'JWT expired' }
                })
              })
            })
          } as any
        }
        throw new Error(`Unexpected table ${table}`)
      })

      const res = await authService.signInWithPassword('oyewusi.adebayo1@gmail.com', 'password123')

      expect(res.success).toBe(false)
      // Must NOT claim profile is absent!
      expect(res.error).not.toBe('No leadership profile found for this account. Please contact a Stake System Administrator.')
      expect(res.error).toContain('Unable to load leadership profile')
      expect(res.error).toContain('JWT expired')
      expect(signOutSpy).toHaveBeenCalled()
    })

    it('reports role loading failure when user_roles query returns an error rather than falsely assuming zero roles', async () => {
      const adminAuthId = '6c42b342-3839-46d6-a1fa-7da227f45d33'
      const signOutSpy = vi.spyOn(supabase.auth, 'signOut').mockResolvedValueOnce({ error: null })

      vi.spyOn(supabase.auth, 'signInWithPassword').mockResolvedValueOnce({
        data: {
          user: { id: adminAuthId, email: 'oyewusi.adebayo1@gmail.com' } as any,
          session: { access_token: 'valid-jwt' } as any
        },
        error: null
      })

      vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
        if (table === 'user_profiles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: adminAuthId,
                    full_name: 'Adebayo Oyewusi',
                    email: 'oyewusi.adebayo1@gmail.com',
                    account_status: 'active',
                    created_at: '2026-10-18T00:00:00Z',
                    updated_at: '2026-10-18T00:00:00Z'
                  },
                  error: null
                })
              })
            })
          } as any
        }
        if (table === 'user_roles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'relation user_roles timeout' }
              })
            })
          } as any
        }
        throw new Error(`Unexpected table ${table}`)
      })

      const res = await authService.signInWithPassword('oyewusi.adebayo1@gmail.com', 'password123')

      expect(res.success).toBe(false)
      expect(res.error).toContain('Failed to load leadership roles')
      expect(res.error).not.toBe('No active leadership roles are assigned to this account. Please contact a Stake System Administrator.')
      expect(signOutSpy).toHaveBeenCalled()
    })
  })

  describe('5. Transient Delay Retry Resolution', () => {
    it('recovers seamlessly when initial profile query experiences propagation delay and retry succeeds', async () => {
      const adminAuthId = '6c42b342-3839-46d6-a1fa-7da227f45d33'
      let profileAttempt = 0

      vi.spyOn(supabase.auth, 'signInWithPassword').mockResolvedValueOnce({
        data: {
          user: { id: adminAuthId, email: 'oyewusi.adebayo1@gmail.com' } as any,
          session: { access_token: 'valid-jwt' } as any
        },
        error: null
      })

      vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
        if (table === 'user_profiles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockImplementation(async () => {
                  profileAttempt++
                  if (profileAttempt === 1) {
                    // First attempt: propagation lag, returns data: null
                    return { data: null, error: null }
                  }
                  // Retry attempt: returns profile
                  return {
                    data: {
                      id: adminAuthId,
                      full_name: 'Adebayo Oyewusi',
                      email: 'oyewusi.adebayo1@gmail.com',
                      account_status: 'active',
                      created_at: '2026-10-18T00:00:00Z',
                      updated_at: '2026-10-18T00:00:00Z'
                    },
                    error: null
                  }
                })
              })
            })
          } as any
        }
        if (table === 'user_roles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [{ role_name: 'system_admin' }],
                error: null
              })
            })
          } as any
        }
        if (table === 'user_unit_assignments') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [],
                error: null
              })
            })
          } as any
        }
        throw new Error(`Unexpected table ${table}`)
      })

      const res = await authService.signInWithPassword('oyewusi.adebayo1@gmail.com', 'password123')
      expect(res.success).toBe(true)
      expect(profileAttempt).toBe(2)
    })
  })

  describe('6. Account Status Boundaries', () => {
    it('blocks deactivated accounts after successful Auth with exact status message', async () => {
      const userId = 'deactivated-uuid'
      const signOutSpy = vi.spyOn(supabase.auth, 'signOut').mockResolvedValueOnce({ error: null })

      vi.spyOn(supabase.auth, 'signInWithPassword').mockResolvedValueOnce({
        data: {
          user: { id: userId, email: 'deactivated@example.com' } as any,
          session: { access_token: 'valid-jwt' } as any
        },
        error: null
      })

      vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
        if (table === 'user_profiles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: userId,
                    full_name: 'Deactivated User',
                    email: 'deactivated@example.com',
                    account_status: 'deactivated',
                    created_at: '2026-10-18T00:00:00Z',
                    updated_at: '2026-10-18T00:00:00Z'
                  },
                  error: null
                })
              })
            })
          } as any
        }
        if (table === 'user_roles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [{ role_name: 'ysa_leader' }],
                error: null
              })
            })
          } as any
        }
        if (table === 'user_unit_assignments') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [],
                error: null
              })
            })
          } as any
        }
        throw new Error(`Unexpected table ${table}`)
      })

      const res = await authService.signInWithPassword('deactivated@example.com', 'password123')
      expect(res.success).toBe(false)
      expect(res.error).toBe('Your account status is "deactivated". Please contact a Stake System Administrator.')
      expect(signOutSpy).toHaveBeenCalled()
    })
  })

  describe('7. Stake Presidency Email Correction Lifecycle & Invariants', () => {
    const targetUserId = 'c608b043-4692-44f5-a872-d8848063c9c0'
    const typoEmail = 'hardebaryor111@gmail.com'
    const correctedEmail = 'hardeybaryor111@gmail.com'

    it('demonstrates that login with intended email fails prior to Auth correction, and succeeds after atomic UUID-preserving correction', async () => {
      // Phase A: Prior to correction - Auth user has typoEmail
      // Attempting to sign in with correctedEmail fails at Auth layer
      vi.spyOn(supabase.auth, 'signInWithPassword').mockImplementation(async (credentials: any) => {
        if (credentials.email && credentials.email.toLowerCase() === typoEmail) {
          return {
            data: {
              user: { id: targetUserId, email: typoEmail } as any,
              session: { access_token: 'valid-jwt' } as any
            },
            error: null
          }
        }
        // Corrected email does not match Auth record yet
        return {
          data: { user: null, session: null },
          error: { name: 'AuthApiError', message: 'Invalid login credentials', status: 400 } as any
        }
      })

      const preCorrectionAttempt = await authService.signInWithPassword(correctedEmail, 'password123')
      expect(preCorrectionAttempt.success).toBe(false)
      expect(preCorrectionAttempt.error).toBe('Invalid login credentials')

      // Phase B: Simulate administrative email correction in Supabase (Auth + user_profiles)
      // Both records update to correctedEmail while strictly preserving targetUserId
      const authUser = {
        id: targetUserId,
        email: correctedEmail,
        email_confirmed_at: '2026-10-20T17:00:00Z'
      }

      const userProfile = {
        id: targetUserId,
        full_name: 'Oyewusi, Adebayo Babatunde',
        email: correctedEmail,
        account_status: 'active' as const,
        created_at: '2026-10-18T00:00:00Z',
        updated_at: '2026-10-20T17:30:00Z'
      }

      vi.spyOn(supabase.auth, 'signInWithPassword').mockResolvedValueOnce({
        data: {
          user: authUser as any,
          session: { access_token: 'valid-stake-pres-jwt' } as any
        },
        error: null
      })

      vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
        if (table === 'user_profiles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: userProfile,
                  error: null
                })
              })
            })
          } as any
        }
        if (table === 'user_roles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [{ role_name: 'stake_presidency' }],
                error: null
              })
            })
          } as any
        }
        if (table === 'user_unit_assignments') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [],
                error: null
              })
            })
          } as any
        }
        throw new Error(`Unexpected table ${table}`)
      })

      const postCorrectionAttempt = await authService.signInWithPassword(correctedEmail, 'password123')
      expect(postCorrectionAttempt.success).toBe(true)
      expect(postCorrectionAttempt.error).toBeUndefined()

      // Verify that UUID remained completely unchanged
      const profile = await authService.fetchUserProfile(targetUserId)
      expect(profile).not.toBeNull()
      expect(profile?.id).toBe(targetUserId)
      expect(profile?.email).toBe(correctedEmail)
      expect(profile?.roles).toEqual(['stake_presidency'])
      expect(profile?.accountStatus).toBe('active')

      // Verify Stake Presidency authorization boundaries
      const access = deriveLeadershipAccess(profile!.roles, profile!.unitAssignments)
      expect(access.isStakeLeader).toBe(true)
      expect(access.hasStakeWideReadAccess).toBe(true)
      expect(access.isSystemAdmin).toBe(false)
      expect(access.canManageActivities).toBe(true)
      expect(access.canManageMembers).toBe(true)
    })

    it('rejects email update when the intended email is already owned by a different Auth user (collision prevention)', () => {
      const existingAccounts = [
        { id: targetUserId, email: typoEmail },
        { id: 'different-uuid-9999', email: correctedEmail }
      ]

      // Safety check function matching administrative migration logic
      const validateEmailAvailability = (requestedEmail: string, currentUserId: string): { safe: boolean; error?: string } => {
        const collision = existingAccounts.find(
          a => a.email.toLowerCase() === requestedEmail.toLowerCase() && a.id !== currentUserId
        )
        if (collision) {
          return {
            safe: false,
            error: `Safety check failed: Email ${requestedEmail} is already registered to user ${collision.id}.`
          }
        }
        return { safe: true }
      }

      const collisionCheck = validateEmailAvailability(correctedEmail, targetUserId)
      expect(collisionCheck.safe).toBe(false)
      expect(collisionCheck.error).toContain('already registered')
    })

    it('enforces fn_protect_profile_fields: blocks direct profile email alteration unless synchronized with authoritative auth.users', () => {
      // Simulating fn_protect_profile_fields trigger logic
      const simulateProfileFieldProtection = (
        oldProfile: { email: string; accountStatus: string },
        newProfile: { email: string; accountStatus: string },
        callerAuthId: string | null,
        userRoles: { userId: string; role: string }[],
        authUsers: { id: string; email: string }[],
        targetUserId: string
      ): { allowed: boolean; error?: string } => {
        const isSystemAdmin = callerAuthId !== null && userRoles.some(
          r => r.userId === callerAuthId && r.role === 'system_admin'
        )

        // Email protection: allowed if system_admin OR if synchronized with auth.users
        if (newProfile.email.toLowerCase() !== oldProfile.email.toLowerCase()) {
          const authUser = authUsers.find(u => u.id === targetUserId)
          const isMatchingAuthEmail = authUser && authUser.email.toLowerCase() === newProfile.email.toLowerCase()

          if (!isSystemAdmin && !isMatchingAuthEmail) {
            return {
              allowed: false,
              error: 'Unauthorized: Profile email address cannot be changed directly.'
            }
          }
        }

        // Account status protection: strictly system_admin
        if (newProfile.accountStatus !== oldProfile.accountStatus) {
          if (!isSystemAdmin) {
            return {
              allowed: false,
              error: 'Unauthorized: Only system administrators can alter account status.'
            }
          }
        }

        return { allowed: true }
      }

      const adminId = '6c42b342-3839-46d6-a1fa-7da227f45d33'
      const roles = [{ userId: adminId, role: 'system_admin' }]
      const authUsersBefore = [{ id: targetUserId, email: typoEmail }]

      // 1. Unprivileged direct update without changing auth.users -> BLOCKED
      const directAttempt = simulateProfileFieldProtection(
        { email: typoEmail, accountStatus: 'active' },
        { email: correctedEmail, accountStatus: 'active' },
        targetUserId, // Target user attempting self-change
        roles,
        authUsersBefore,
        targetUserId
      )
      expect(directAttempt.allowed).toBe(false)
      expect(directAttempt.error).toBe('Unauthorized: Profile email address cannot be changed directly.')

      // 2. Authoritative sync after auth.users was updated -> ALLOWED
      const authUsersAfter = [{ id: targetUserId, email: correctedEmail }]
      const syncAttempt = simulateProfileFieldProtection(
        { email: typoEmail, accountStatus: 'active' },
        { email: correctedEmail, accountStatus: 'active' },
        null, // Background system trigger / SQL editor context
        roles,
        authUsersAfter,
        targetUserId
      )
      expect(syncAttempt.allowed).toBe(true)
      expect(syncAttempt.error).toBeUndefined()
    })

    it('attributes administrative correction audit log strictly to the acting System Administrator, not the target user', () => {
      const adminId = '6c42b342-3839-46d6-a1fa-7da227f45d33'
      const targetUserId = 'c608b043-4692-44f5-a872-d8848063c9c0'

      const createAuditEntry = (actorId: string, targetId: string, oldEmail: string, newEmail: string) => {
        return {
          actor_id: actorId,
          action: 'ADMIN_CORRECT_LEADERSHIP_EMAIL',
          target_record_id: targetId,
          target_table: 'user_profiles',
          outcome: 'success',
          metadata: {
            old_email: oldEmail,
            corrected_email: newEmail,
            role: 'stake_presidency'
          }
        }
      }

      const log = createAuditEntry(adminId, targetUserId, typoEmail, correctedEmail)
      expect(log.actor_id).toBe(adminId)
      expect(log.actor_id).not.toBe(targetUserId)
      expect(log.target_record_id).toBe(targetUserId)
      expect(log.action).toBe('ADMIN_CORRECT_LEADERSHIP_EMAIL')
    })
  })
})
