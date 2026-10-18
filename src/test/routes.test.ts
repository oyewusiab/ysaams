import { describe, it, expect } from 'vitest'
import {
  isLeadershipPath,
  resolveInitialRoutePath,
  resolveLeadershipSubpath,
  extractSessionCode
} from '../App'

describe('Route Architecture & Separation', () => {
  it('correctly identifies leadership portal paths', () => {
    expect(isLeadershipPath('/la')).toBe(true)
    expect(isLeadershipPath('/la/')).toBe(true)
    expect(isLeadershipPath('/la/dashboard')).toBe(true)
    expect(isLeadershipPath('/la/activities')).toBe(true)
    expect(isLeadershipPath('/la/attendance')).toBe(true)
    expect(isLeadershipPath('/la/members')).toBe(true)
    expect(isLeadershipPath('/la/reports')).toBe(true)
    expect(isLeadershipPath('/la/units')).toBe(true)
    expect(isLeadershipPath('/la/users')).toBe(true)
    expect(isLeadershipPath('/la/settings')).toBe(true)
    expect(isLeadershipPath('/la/audit-logs')).toBe(true)
  })

  it('rejects public and terminal paths from leadership detection', () => {
    expect(isLeadershipPath('/')).toBe(false)
    expect(isLeadershipPath('/terminal')).toBe(false)
    expect(isLeadershipPath('/5BV21F')).toBe(false)
    expect(isLeadershipPath('/other')).toBe(false)
  })

  it('resolves leadership subpaths accurately', () => {
    expect(resolveLeadershipSubpath('/la')).toBe('dashboard')
    expect(resolveLeadershipSubpath('/la/')).toBe('dashboard')
    expect(resolveLeadershipSubpath('/la/activities')).toBe('activities')
    expect(resolveLeadershipSubpath('/la/reports')).toBe('reports')
    expect(resolveLeadershipSubpath('/la/audit-logs')).toBe('audit-logs')
    expect(resolveLeadershipSubpath('/la/unknown-route')).toBe('dashboard')
  })

  it('routes Supabase recovery, invitation, confirmation, and expired-link callbacks to /la even when landing on /', () => {
    expect(
      resolveInitialRoutePath('/', '#access_token=abc&refresh_token=def&type=recovery', '')
    ).toBe('/la')
    expect(
      resolveInitialRoutePath('/', '#access_token=abc&refresh_token=def&type=invite', '')
    ).toBe('/la')
    expect(
      resolveInitialRoutePath('/', '#access_token=abc&type=signup', '')
    ).toBe('/la')
    expect(
      resolveInitialRoutePath(
        '/',
        '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
        ''
      )
    ).toBe('/la')
    expect(resolveInitialRoutePath('/la/settings', '#type=recovery', '')).toBe('/la/settings')
    expect(resolveInitialRoutePath('/', '', '')).toBe('/')
    expect(resolveInitialRoutePath('/5BV21F', '', '')).toBe('/5BV21F')
  })

  it('extracts valid 6-character session codes from direct links', () => {
    expect(extractSessionCode('/5BV21F')).toBe('5BV21F')
    expect(extractSessionCode('/7km9pq')).toBe('7KM9PQ')
    expect(extractSessionCode('/5bv21f/')).toBe('5BV21F')
  })

  it('strictly excludes leadership and terminal paths from session code extraction', () => {
    expect(extractSessionCode('/la')).toBeNull()
    expect(extractSessionCode('/la/dashboard')).toBeNull()
    expect(extractSessionCode('/terminal')).toBeNull()
    expect(extractSessionCode('/')).toBeNull()
    expect(extractSessionCode('/123')).toBeNull() // invalid length
    expect(extractSessionCode('/TOOLONG123')).toBeNull() // invalid length
  })
})
