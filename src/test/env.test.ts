import { describe, it, expect } from 'vitest'
import { validateClientEnv } from '../lib/env'

describe('Environment Configuration Safety', () => {
  it('returns structured client configuration without throwing unhandled exceptions', () => {
    const envConfig = validateClientEnv()
    expect(envConfig).toBeDefined()
    expect(typeof envConfig.timezone).toBe('string')
    expect(typeof envConfig.stakeName).toBe('string')
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
