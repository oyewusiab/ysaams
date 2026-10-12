import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { env } from './env'

let supabaseInstance: SupabaseClient | null = null

export function getSupabaseClient(): SupabaseClient {
  if (supabaseInstance) {
    return supabaseInstance
  }

  if (!env.isConfigured) {
    // Return a dummy client placeholder that warns cleanly if invoked before config
    console.warn(`[Supabase Init Warning] ${env.configError}`)
    // Construct client with fallback safe parameters to prevent early crashes during build/tests
    supabaseInstance = createClient(
      env.supabaseUrl || 'https://placeholder.supabase.co',
      env.supabaseAnonKey || 'placeholder-anon-key'
    )
    return supabaseInstance
  }

  supabaseInstance = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  })

  return supabaseInstance
}

export const supabase = getSupabaseClient()
