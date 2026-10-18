import { describe, it, expect } from 'vitest'
import {
  validateClientEnv,
  PRODUCTION_SITE_URL,
  PRODUCTION_AUTH_REDIRECT_URL
} from '../lib/env'

describe('Environment Configuration Safety', () => {
  it('returns structured client configuration without throwing unhandled exceptions', () => {
    const envConfig = validateClientEnv()
    expect(envConfig).toBeDefined()
    expect(typeof envConfig.timezone).toBe('string')
    expect(typeof envConfig.stakeName).toBe('string')
    expect(envConfig.siteUrl).toBe('https://ysaams.vercel.app')
  })

  it('exports canonical production site and auth redirect URLs', () => {
    expect(PRODUCTION_SITE_URL).toBe('https://ysaams.vercel.app')
    expect(PRODUCTION_AUTH_REDIRECT_URL).toBe('https://ysaams.vercel.app/la')
  })

  it('defaults to Africa/Lagos timezone', () => {
    const envConfig = validateClientEnv()
    expect(envConfig.timezone).toBe('Africa/Lagos')
  })

  it('safely handles missing configuration with non-sensitive error description', () => {
    const envConfig = validateClientEnv()
    if (!envConfig.isConfigured) {
      expect(envConfig.configError).toContain('Missing required Supabase client configuration')
      // Ensure no raw passwords or tokens are leaked in error strings
      expect(envConfig.configError).not.toContain('service_role')
      expect(envConfig.configError).not.toContain('password')
    }
  })
})
