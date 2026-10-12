/**
 * Safe client environment variable validation.
 *
 * SECURITY INVARIANT:
 * - Never log or output secret keys, tokens, or credential strings.
 * - Only publishable, client-safe variables (prefixed with VITE_) are accessible.
 */

export interface ClientEnv {
  supabaseUrl: string
  supabaseAnonKey: string
  timezone: string
  stakeName: string
  isConfigured: boolean
  configError: string | null
}

export function validateClientEnv(): ClientEnv {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''
  const timezone = import.meta.env.VITE_APP_TIMEZONE || 'Africa/Lagos'
  const stakeName = import.meta.env.VITE_APP_STAKE_NAME || 'Abeokuta Nigeria Obantoko Stake'

  let configError: string | null = null

  if (!supabaseUrl || !supabaseAnonKey) {
    configError = 'Missing required Supabase client configuration. Please ensure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are defined in your environment.'
  } else if (!supabaseUrl.startsWith('https://')) {
    configError = 'Invalid VITE_SUPABASE_URL format. Must be a secure HTTPS endpoint.'
  }

  return {
    supabaseUrl,
    supabaseAnonKey,
    timezone,
    stakeName,
    isConfigured: configError === null,
    configError
  }
}

export const env = validateClientEnv()
