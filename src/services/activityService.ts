import { ActivityDefinition, ActivitySession } from '../types/database'

/**
 * Generates an unambiguous 6-character alphanumeric session code.
 * Excludes easily confusable characters: 0, O, 1, I, L.
 */
export function generateSessionCode(): string {
  const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
  const length = 6
  let code = ''
  
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(length)
    crypto.getRandomValues(bytes)
    for (let i = 0; i < length; i++) {
      code += alphabet[bytes[i] % alphabet.length]
    }
  } else {
    // Math.random fallback for non-crypto environments
    for (let i = 0; i < length; i++) {
      code += alphabet.charAt(Math.floor(Math.random() * alphabet.length))
    }
  }

  return code
}

export const activityService = {
  generateCode: generateSessionCode,

  async listActivities(): Promise<ActivityDefinition[]> {
    return []
  },

  async listSessions(): Promise<ActivitySession[]> {
    return []
  }
}
