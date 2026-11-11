/**
-- ============================================================================
-- YSA Attendance Management System (YSA AMS)
-- Module: YSA Gathering Place — Skills & Self-Reliance Needs Assessment
-- Stake: Abeokuta Nigeria Obantoko Stake | 2027
-- ============================================================================
*/

export type AssessmentStatus = 'draft' | 'active' | 'closed' | 'archived'

export interface GatheringPlaceAssessment {
  id: string
  title: string
  description: string
  assessmentYear: number
  status: AssessmentStatus
  publicSlug: string
  createdAt: string
  updatedAt: string
  closedAt?: string | null
  totalResponses?: number
}

export interface GatheringPlaceResponse {
  id: string
  assessmentId: string
  wardBranch: string
  currentStatus: string
  educationLevel: string
  currentSelfRelianceParticipation: string
  hardSkillFirstChoice: string
  hardSkillSecondChoice: string
  hardSkillThirdChoice: string
  softSkills: string[]
  selfRelianceClassInterest: string
  desiredOutcomes: string[]
  experienceLevel: string
  desired56MonthOutcome?: string | null
  additionalSkillsSuggestions?: string | null
  gatheringPlaceSuggestions?: string | null
  preferredDays: string[]
  preferredTimePeriods: string[]
  submittedAt: string
  updatedAt?: string
}

export interface GatheringPlaceSubmissionPayload {
  assessment_id: string
  ward_branch: string
  current_status: string
  education_level: string
  current_self_reliance_participation: string
  hard_skill_first_choice: string
  hard_skill_second_choice: string
  hard_skill_third_choice: string
  soft_skills: string[]
  self_reliance_class_interest: string
  desired_outcomes: string[]
  experience_level: string
  desired_5_6_month_outcome?: string
  additional_skills_suggestions?: string
  gathering_place_suggestions?: string
  preferred_days: string[]
  preferred_time_periods: string[]
}

// ----------------------------------------------------------------------------
// Survey Options Constants (Abeokuta Nigeria Obantoko Stake)
// ----------------------------------------------------------------------------

export const WARD_BRANCH_OPTIONS = [
  'Abiola-Way Ward',
  'Alabata Branch',
  'Apena Branch',
  'Apete Branch',
  'Camp Ward',
  'Kugba Ward',
  'Obantoko Ward',
  'Odeda Ward'
] as const

export const CURRENT_STATUS_OPTIONS = [
  'Student',
  'Employed',
  'Self-employed / Business owner',
  'Currently seeking employment',
  'Learning a trade / Skill',
  'Other'
] as const

export const EDUCATION_LEVEL_OPTIONS = [
  'Secondary school',
  'OND / NCE',
  "HND / Bachelor's degree",
  'Postgraduate degree',
  'Currently in school',
  'Other'
] as const

export const SELF_RELIANCE_PARTICIPATION_OPTIONS = [
  'Yes',
  'No',
  'I have participated in the past'
] as const

export const HARD_SKILLS_OPTIONS = [
  'Computer Literacy & Microsoft Office',
  'Graphic Design (Canva, Photoshop, etc.)',
  'Web Design & Development',
  'Data Analytics (Excel, Power BI, etc.)',
  'Artificial Intelligence (AI) & Digital Tools',
  'Digital Marketing & Social Media Management',
  'Photography & Videography',
  'Video Editing',
  'Fashion Design & Tailoring',
  'Catering, Baking & Food Processing',
  'Hairdressing / Beauty & Personal Care',
  'Electrical Installation / Technical Skills',
  'Phone / Computer Repairs',
  'Driving',
  'Business Management & Entrepreneurship',
  'Bookkeeping & Accounting',
  'Other'
] as const

export const SOFT_SKILLS_OPTIONS = [
  'Communication Skills',
  'Leadership & Teamwork',
  'Public Speaking',
  'Time Management & Productivity',
  'Problem-Solving & Critical Thinking',
  'CV Writing & Interview Skills',
  'Personal Development & Confidence',
  'Professionalism & Workplace Ethics',
  'Emotional Resilience',
  'Relationship & Social Skills',
  'Other'
] as const

export const SELF_RELIANCE_CLASS_OPTIONS = [
  'Education for Better Work',
  'Find a Better Job',
  'Starting and Growing My Business',
  'Personal Finance / Managing Money',
  'Emotional Resilience',
  'I am not sure yet'
] as const

export const GOALS_OPTIONS = [
  'Acquire a new skill',
  'Get a job or improve my employment opportunities',
  'Start or grow my own business',
  'Improve my income and financial independence',
  'Improve my education or career prospects',
  'Develop my leadership and personal abilities',
  'Build meaningful friendships and networks',
  'Become more self-reliant',
  'Prepare to serve others better',
  'Other'
] as const

export const EXPERIENCE_LEVEL_OPTIONS = [
  'Beginner — I have little or no experience',
  'Intermediate — I have some experience',
  'Advanced — I want to improve or become a professional'
] as const

export const DAYS_OPTIONS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday'
] as const

export const TIME_PERIOD_OPTIONS = [
  'Morning (8 AM – 12 PM)',
  'Afternoon (12 PM – 4 PM)',
  'Evening (4 PM – 7 PM)'
] as const

// ----------------------------------------------------------------------------
// Analytics Data Structures
// ----------------------------------------------------------------------------

export interface SkillPreferenceItem {
  skill: string
  firstChoiceCount: number
  secondChoiceCount: number
  thirdChoiceCount: number
  overallCount: number
  overallPercentage: number
}

export interface FrequencyItem {
  label: string
  count: number
  percentage: number
}

export interface DayTimeMatrixCell {
  day: string
  timePeriod: string
  count: number
}

export interface WardAnalyticsItem {
  unitName: string
  responseCount: number
  percentage: number
  topHardSkill: string
  topSoftSkill: string
  topSelfRelianceClass: string
  topDay: string
  topTimePeriod: string
}

export interface RecommendedScheduleSlot {
  day: string
  timePeriod: string
  score: number
  rationale: string
}

export interface GatheringPlaceAnalytics {
  totalResponses: number
  participatingUnitsCount: number
  mostPreferredHardSkill: string
  mostPreferredSoftSkill: string
  mostRequestedSelfRelianceClass: string
  mostPreferredDay: string
  mostPreferredTimePeriod: string
  hardSkillsRanked: SkillPreferenceItem[]
  softSkillsRanked: FrequencyItem[]
  selfRelianceClassesRanked: FrequencyItem[]
  desiredOutcomesRanked: FrequencyItem[]
  experienceDistribution: FrequencyItem[]
  statusDistribution: FrequencyItem[]
  educationDistribution: FrequencyItem[]
  outsideParticipationDistribution: FrequencyItem[]
  daysDemand: FrequencyItem[]
  timePeriodsDemand: FrequencyItem[]
  dayTimeMatrix: DayTimeMatrixCell[]
  recommendedSchedule: RecommendedScheduleSlot[]
  wardBreakdown: WardAnalyticsItem[]
  openEndedFeedback: {
    outcomes: { id: string; ward: string; text: string; date: string }[]
    additionalSkills: { id: string; ward: string; text: string; date: string }[]
    suggestions: { id: string; ward: string; text: string; date: string }[]
  }
}

export interface ResponseFilters {
  wardBranch?: string
  currentStatus?: string
  educationLevel?: string
  searchQuery?: string
}
