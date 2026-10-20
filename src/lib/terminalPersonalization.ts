/**
 * Derives a warm, natural first-name or friendly greeting from an attendee's name.
 * Handles single names, multi-word names, and irregular spacing safely.
 */
export function formatAttendeeFirstName(fullName: string): string {
  if (!fullName) return 'friend'
  const trimmed = fullName.trim()
  if (!trimmed) return 'friend'

  // Extract first word, filtering out common prefixes/titles if present
  const tokens = trimmed.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return 'friend'

  const firstToken = tokens[0]
  // Normalize casing (e.g. ADEOYE -> Adeoye, saheed -> Saheed)
  return firstToken.charAt(0).toUpperCase() + firstToken.slice(1).toLowerCase()
}

/**
 * Returns a warm, context-sensitive greeting for check-in confirmation
 * based on the activity title and attendee type.
 */
export function getActivityWelcomeMessage(
  sessionTitle: string = '',
  isNonMember: boolean = false,
  firstName: string = ''
): { heading: string; message: string; submessage: string } {
  const lower = sessionTitle.toLowerCase()
  const nameSuffix = firstName ? `, ${firstName}` : ''

  if (isNonMember) {
    return {
      heading: `Welcome${nameSuffix}!`,
      message: "We're so thrilled to have you join us today as our guest.",
      submessage: 'Make yourself at home and enjoy connecting with everyone!'
    }
  }

  if (lower.includes('service') || lower.includes('project') || lower.includes('clean')) {
    return {
      heading: `Thank you${nameSuffix}!`,
      message: "Thank you for being part of today's service activity.",
      submessage: 'Your time and helping hands make a wonderful difference in our community.'
    }
  }

  if (lower.includes('spiritual') || lower.includes('fireside') || lower.includes('devotional') || lower.includes('institute') || lower.includes('temple')) {
    return {
      heading: `Welcome${nameSuffix}!`,
      message: "You're checked in! We're blessed to have you gather with us.",
      submessage: 'May today bring spiritual uplifting, peace, and renewed faith.'
    }
  }

  if (lower.includes('social') || lower.includes('fhe') || lower.includes('dinner') || lower.includes('hangout') || lower.includes('picnic') || lower.includes('game night')) {
    return {
      heading: `Welcome${nameSuffix}!`,
      message: "You're checked in! We're glad you could join us.",
      submessage: 'Have a wonderful time connecting with friends old and new!'
    }
  }

  if (lower.includes('sport') || lower.includes('football') || lower.includes('volleyball') || lower.includes('fitness') || lower.includes('match') || lower.includes('tournament')) {
    return {
      heading: `Ready to go${nameSuffix}!`,
      message: "You're all checked in and on the roster.",
      submessage: 'Have an energetic, fun, and safe time participating today!'
    }
  }


  // Default uplifting YSA welcome
  return {
    heading: `Welcome${nameSuffix}!`,
    message: "You're checked in! We're glad you could join us today.",
    submessage: 'Have a memorable and uplifting time at this activity!'
  }
}
