import React, { useState, useEffect } from 'react'
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  Send,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  Clock,
  Building2,
  Check
} from 'lucide-react'
import {
  gatheringPlaceService,
  validateSurveySubmission
} from '../../services/gatheringPlaceService'
import {
  GatheringPlaceAssessment,
  GatheringPlaceSubmissionPayload,
  WARD_BRANCH_OPTIONS,
  CURRENT_STATUS_OPTIONS,
  EDUCATION_LEVEL_OPTIONS,
  SELF_RELIANCE_PARTICIPATION_OPTIONS,
  HARD_SKILLS_OPTIONS,
  SOFT_SKILLS_OPTIONS,
  SELF_RELIANCE_CLASS_OPTIONS,
  GOALS_OPTIONS,
  EXPERIENCE_LEVEL_OPTIONS,
  DAYS_OPTIONS,
  TIME_PERIOD_OPTIONS
} from '../../types/gatheringPlace'

interface PublicSurveyViewProps {
  onNavigateHome?: () => void
}

type SurveyStep = 'intro' | 'about' | 'skills' | 'goals' | 'ideas' | 'availability' | 'review' | 'success'

export const PublicSurveyView: React.FC<PublicSurveyViewProps> = ({ onNavigateHome }) => {
  const [assessment, setAssessment] = useState<GatheringPlaceAssessment | null>(null)
  const [isLoadingAssessment, setIsLoadingAssessment] = useState(true)
  const [currentStep, setCurrentStep] = useState<SurveyStep>('intro')

  // Survey Form State
  const [wardBranch, setWardBranch] = useState<string>('')
  const [currentStatus, setCurrentStatus] = useState<string>('')
  const [currentStatusOther, setCurrentStatusOther] = useState<string>('')
  const [educationLevel, setEducationLevel] = useState<string>('')
  const [educationLevelOther, setEducationLevelOther] = useState<string>('')
  const [currentSelfReliance, setCurrentSelfReliance] = useState<string>('')

  // Ranked Hard Skills (Distinct)
  const [hardSkillFirst, setHardSkillFirst] = useState<string>('')
  const [hardSkillFirstOther, setHardSkillFirstOther] = useState<string>('')
  const [hardSkillSecond, setHardSkillSecond] = useState<string>('')
  const [hardSkillSecondOther, setHardSkillSecondOther] = useState<string>('')
  const [hardSkillThird, setHardSkillThird] = useState<string>('')
  const [hardSkillThirdOther, setHardSkillThirdOther] = useState<string>('')

  // Soft Skills (Max 3)
  const [softSkills, setSoftSkills] = useState<string[]>([])
  const [softSkillsOther, setSoftSkillsOther] = useState<string>('')

  // Self-Reliance Class
  const [selfRelianceClass, setSelfRelianceClass] = useState<string>('')

  // Goals (Max 3)
  const [desiredOutcomes, setDesiredOutcomes] = useState<string[]>([])
  const [desiredOutcomesOther, setDesiredOutcomesOther] = useState<string>('')

  // Experience Level
  const [experienceLevel, setExperienceLevel] = useState<string>('')

  // Open-ended
  const [outcome56Month, setOutcome56Month] = useState<string>('')
  const [additionalSkills, setAdditionalSkills] = useState<string>('')
  const [suggestions, setSuggestions] = useState<string>('')

  // Availability
  const [preferredDays, setPreferredDays] = useState<string[]>([])
  const [preferredTimes, setPreferredTimes] = useState<string[]>([])

  // Submission State
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [validationWarning, setValidationWarning] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    async function load() {
      try {
        const active = await gatheringPlaceService.getActiveAssessment()
        if (mounted) {
          setAssessment(active)
        }
      } catch (err) {
        console.error('Failed to load active assessment', err)
      } finally {
        if (mounted) setIsLoadingAssessment(false)
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [])

  // Scroll to top on step changes for mobile usability
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
    setValidationWarning(null)
  }, [currentStep])

  const toggleSoftSkill = (skill: string) => {
    setSoftSkills((prev) => {
      if (prev.includes(skill)) {
        if (skill === 'Other') setSoftSkillsOther('')
        return prev.filter((s) => s !== skill)
      }
      if (prev.length >= 3) {
        setValidationWarning('You can select a maximum of 3 soft skills.')
        return prev
      }
      setValidationWarning(null)
      return [...prev, skill]
    })
  }

  const toggleDesiredOutcome = (goal: string) => {
    setDesiredOutcomes((prev) => {
      if (prev.includes(goal)) {
        if (goal === 'Other') setDesiredOutcomesOther('')
        return prev.filter((g) => g !== goal)
      }
      if (prev.length >= 3) {
        setValidationWarning('You can select a maximum of 3 goals.')
        return prev
      }
      setValidationWarning(null)
      return [...prev, goal]
    })
  }

  const toggleDay = (day: string) => {
    setPreferredDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    )
  }

  const toggleTimePeriod = (time: string) => {
    setPreferredTimes((prev) =>
      prev.includes(time) ? prev.filter((t) => t !== time) : [...prev, time]
    )
  }

  // Resolved values for selections with "Other" specification
  const getResolvedStatus = (): string =>
    currentStatus === 'Other' && currentStatusOther.trim()
      ? `Other: ${currentStatusOther.trim()}`
      : currentStatus

  const getResolvedEducation = (): string =>
    educationLevel === 'Other' && educationLevelOther.trim()
      ? `Other: ${educationLevelOther.trim()}`
      : educationLevel

  const getResolvedHardFirst = (): string =>
    hardSkillFirst === 'Other' && hardSkillFirstOther.trim()
      ? `Other: ${hardSkillFirstOther.trim()}`
      : hardSkillFirst

  const getResolvedHardSecond = (): string =>
    hardSkillSecond === 'Other' && hardSkillSecondOther.trim()
      ? `Other: ${hardSkillSecondOther.trim()}`
      : hardSkillSecond

  const getResolvedHardThird = (): string =>
    hardSkillThird === 'Other' && hardSkillThirdOther.trim()
      ? `Other: ${hardSkillThirdOther.trim()}`
      : hardSkillThird

  const getResolvedSoftSkills = (): string[] =>
    softSkills.map((s) =>
      s === 'Other' && softSkillsOther.trim() ? `Other: ${softSkillsOther.trim()}` : s
    )

  const getResolvedDesiredOutcomes = (): string[] =>
    desiredOutcomes.map((g) =>
      g === 'Other' && desiredOutcomesOther.trim() ? `Other: ${desiredOutcomesOther.trim()}` : g
    )

  // Section Validation Helpers
  const validateSectionAbout = (): boolean => {
    if (!wardBranch) {
      setValidationWarning('Please select which Ward or Branch you belong to.')
      return false
    }
    if (!currentStatus) {
      setValidationWarning('Please select your current status.')
      return false
    }
    if (currentStatus === 'Other' && !currentStatusOther.trim()) {
      setValidationWarning('Please specify your current status in the field provided.')
      return false
    }
    if (!educationLevel) {
      setValidationWarning('Please select your highest level of education.')
      return false
    }
    if (educationLevel === 'Other' && !educationLevelOther.trim()) {
      setValidationWarning('Please specify your highest level of education in the field provided.')
      return false
    }
    if (!currentSelfReliance) {
      setValidationWarning('Please answer whether you participate in any skill or Self-Reliance program.')
      return false
    }
    setValidationWarning(null)
    return true
  }

  const validateSectionSkills = (): boolean => {
    if (!hardSkillFirst || !hardSkillSecond || !hardSkillThird) {
      setValidationWarning('Please select your 1st, 2nd, and 3rd preferred practical skills.')
      return false
    }
    if (hardSkillFirst === 'Other' && !hardSkillFirstOther.trim()) {
      setValidationWarning('Please specify your 1st preferred practical skill.')
      return false
    }
    if (hardSkillSecond === 'Other' && !hardSkillSecondOther.trim()) {
      setValidationWarning('Please specify your 2nd preferred practical skill.')
      return false
    }
    if (hardSkillThird === 'Other' && !hardSkillThirdOther.trim()) {
      setValidationWarning('Please specify your 3rd preferred practical skill.')
      return false
    }
    const h1 = getResolvedHardFirst()
    const h2 = getResolvedHardSecond()
    const h3 = getResolvedHardThird()
    if (h1 === h2 || h1 === h3 || h2 === h3) {
      setValidationWarning('Please select three different skills for your first, second, and third preferences.')
      return false
    }
    if (softSkills.length === 0) {
      setValidationWarning('Please select at least one soft skill to develop (up to 3).')
      return false
    }
    if (softSkills.length > 3) {
      setValidationWarning('You can select a maximum of 3 soft skills.')
      return false
    }
    if (softSkills.includes('Other') && !softSkillsOther.trim()) {
      setValidationWarning('Please specify the other soft skill you would like to develop.')
      return false
    }
    if (!selfRelianceClass) {
      setValidationWarning('Please select which Self-Reliance class interests you.')
      return false
    }
    setValidationWarning(null)
    return true
  }

  const validateSectionGoals = (): boolean => {
    if (desiredOutcomes.length === 0) {
      setValidationWarning('Please select at least one goal you hope to achieve (up to 3).')
      return false
    }
    if (desiredOutcomes.length > 3) {
      setValidationWarning('You can select a maximum of 3 goals.')
      return false
    }
    if (desiredOutcomes.includes('Other') && !desiredOutcomesOther.trim()) {
      setValidationWarning('Please specify your other goal or expected outcome in the field provided.')
      return false
    }
    if (!experienceLevel) {
      setValidationWarning('Please select your current level of experience.')
      return false
    }
    setValidationWarning(null)
    return true
  }

  const validateSectionAvailability = (): boolean => {
    if (preferredDays.length === 0) {
      setValidationWarning('Please select at least one convenient day.')
      return false
    }
    if (preferredTimes.length === 0) {
      setValidationWarning('Please select at least one convenient time period.')
      return false
    }
    setValidationWarning(null)
    return true
  }

  const handleFinalSubmit = async () => {
    if (!assessment) return

    const payload: GatheringPlaceSubmissionPayload = {
      assessment_id: assessment.id,
      ward_branch: wardBranch,
      current_status: getResolvedStatus(),
      education_level: getResolvedEducation(),
      current_self_reliance_participation: currentSelfReliance,
      hard_skill_first_choice: getResolvedHardFirst(),
      hard_skill_second_choice: getResolvedHardSecond(),
      hard_skill_third_choice: getResolvedHardThird(),
      soft_skills: getResolvedSoftSkills(),
      self_reliance_class_interest: selfRelianceClass,
      desired_outcomes: getResolvedDesiredOutcomes(),
      experience_level: experienceLevel,
      desired_5_6_month_outcome: outcome56Month,
      additional_skills_suggestions: additionalSkills,
      gathering_place_suggestions: suggestions,
      preferred_days: preferredDays,
      preferred_time_periods: preferredTimes
    }

    const check = validateSurveySubmission(payload)
    if (!check.valid) {
      setSubmitError(check.error || 'Please fill in all required fields.')
      return
    }

    setIsSubmitting(true)
    setSubmitError(null)

    try {
      await gatheringPlaceService.submitResponse(payload)
      setCurrentStep('success')
    } catch (err: any) {
      setSubmitError(err.message || 'An error occurred while submitting your survey. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const resetForm = () => {
    setWardBranch('')
    setCurrentStatus('')
    setCurrentStatusOther('')
    setEducationLevel('')
    setEducationLevelOther('')
    setCurrentSelfReliance('')
    setHardSkillFirst('')
    setHardSkillFirstOther('')
    setHardSkillSecond('')
    setHardSkillSecondOther('')
    setHardSkillThird('')
    setHardSkillThirdOther('')
    setSoftSkills([])
    setSoftSkillsOther('')
    setSelfRelianceClass('')
    setDesiredOutcomes([])
    setDesiredOutcomesOther('')
    setExperienceLevel('')
    setOutcome56Month('')
    setAdditionalSkills('')
    setSuggestions('')
    setPreferredDays([])
    setPreferredTimes([])
    setSubmitError(null)
    setValidationWarning(null)
    setCurrentStep('intro')
  }


  if (isLoadingAssessment) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center p-6 text-center">
        <Loader2 className="w-10 h-10 text-emerald-600 animate-spin mb-4" />
        <h3 className="text-base font-semibold text-slate-800">Loading Needs Assessment...</h3>
        <p className="text-xs text-slate-500 mt-1">Abeokuta Nigeria Obantoko Stake</p>
      </div>
    )
  }

  // Handle closed survey state
  if (assessment && assessment.status === 'closed') {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 sm:py-16">
        <div className="bg-white border border-slate-200 rounded-3xl p-8 sm:p-10 text-center shadow-xl shadow-slate-200/50">
          <div className="w-16 h-16 bg-amber-50 border border-amber-200 rounded-2xl flex items-center justify-center mx-auto mb-6 text-amber-600">
            <Building2 className="w-8 h-8" />
          </div>
          <span className="text-xs font-mono font-semibold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200">
            Abeokuta Nigeria Obantoko Stake
          </span>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 mt-4 mb-3">
            Gathering Place Needs Assessment Closed
          </h1>
          <p className="text-sm text-slate-600 leading-relaxed max-w-lg mx-auto mb-6">
            Thank you for your interest! The survey response collection period for this cycle has now closed.
            The Stake leadership is currently reviewing all submissions to finalize programs and skill tracks for our 2027 Gathering Place.
          </p>
          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 text-xs text-slate-600 mb-8 max-w-md mx-auto">
            If you have questions or inquiries regarding upcoming Self-Reliance activities, please reach out to your Ward/Branch YSA Leader or Stake Presidency.
          </div>
          {onNavigateHome && (
            <button
              onClick={onNavigateHome}
              className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-semibold transition cursor-pointer shadow-md shadow-emerald-600/20"
            >
              Return to Home
            </button>
          )}
        </div>
      </div>
    )
  }

  // Success Confirmation Screen
  if (currentStep === 'success') {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 sm:py-16">
        <div className="bg-white border border-emerald-100 rounded-3xl p-8 sm:p-12 text-center shadow-xl shadow-emerald-500/5">
          <div className="w-20 h-20 bg-emerald-50 border-2 border-emerald-500/20 rounded-3xl flex items-center justify-center mx-auto mb-6 text-emerald-600 animate-in zoom-in-95 duration-300">
            <CheckCircle2 className="w-10 h-10" />
          </div>
          <span className="text-xs font-mono font-semibold uppercase tracking-wider text-emerald-800 bg-emerald-50 px-3.5 py-1 rounded-full border border-emerald-200">
            Abeokuta Nigeria Obantoko Stake | 2027
          </span>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 mt-4 mb-3">
            Response Submitted Successfully!
          </h1>
          <p className="text-sm sm:text-base text-slate-600 leading-relaxed max-w-lg mx-auto mb-6">
            Thank you for completing the YSA Gathering Place Needs Assessment. Your valuable input will guide our Stake leadership in preparing high-impact skill acquisition, career development, and Self-Reliance programs.
          </p>
          <div className="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-5 text-left text-xs text-emerald-900 space-y-2 max-w-lg mx-auto mb-8">
            <div className="flex items-center font-bold text-emerald-950 text-sm">
              <Sparkles className="w-4 h-4 mr-2 text-emerald-600" />
              What happens next?
            </div>
            <p className="leading-relaxed">
              Our Stake leadership will analyze all survey feedback to establish the 2027 curriculum, schedule class times that work best for everyone, and assemble instructors. We look forward to learning and growing together!
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={resetForm}
              className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs sm:text-sm font-semibold transition cursor-pointer"
            >
              Submit Another Response
            </button>
            {onNavigateHome && (
              <button
                onClick={onNavigateHome}
                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs sm:text-sm font-semibold transition cursor-pointer shadow-md shadow-emerald-600/20"
              >
                Return to YSA AMS
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  // Step Progress Calculation
  const stepOrder: SurveyStep[] = ['about', 'skills', 'goals', 'ideas', 'availability', 'review']
  const stepIndex = stepOrder.indexOf(currentStep)
  const progressPercent = stepIndex >= 0 ? Math.round(((stepIndex + 1) / stepOrder.length) * 100) : 0

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 sm:py-12">
      {/* Header Banner */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 mb-6 shadow-sm">
        <div className="flex items-center space-x-2 text-xs font-mono font-semibold uppercase tracking-wider text-emerald-700 mb-2">
          <Building2 className="w-4 h-4" />
          <span>Abeokuta Nigeria Obantoko Stake • 2027</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 leading-tight">
          YSA Gathering Place: Skills & Self-Reliance Needs Assessment
        </h1>
        <p className="text-xs sm:text-sm font-medium text-emerald-700 mt-1">
          Skills Acquisition • Self-Reliance • Personal Development
        </p>

        {currentStep !== 'intro' && (
          <div className="mt-6 pt-6 border-t border-slate-100">
            <div className="flex justify-between items-center text-xs font-semibold text-slate-600 mb-2">
              <span>
                Step {stepIndex + 1} of {stepOrder.length}:{' '}
                {currentStep === 'about' && 'About You'}
                {currentStep === 'skills' && 'Skills You Would Like to Learn'}
                {currentStep === 'goals' && 'Goals & Expectations'}
                {currentStep === 'ideas' && 'Ideas & Suggestions'}
                {currentStep === 'availability' && 'Your Availability'}
                {currentStep === 'review' && 'Review & Submit'}
              </span>
              <span className="text-emerald-700 font-mono">{progressPercent}%</span>
            </div>
            <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
              <div
                className="bg-emerald-600 h-full transition-all duration-300 rounded-full"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Validation Warning Alert */}
      {validationWarning && (
        <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-center justify-between text-xs sm:text-sm text-amber-800">
          <div className="flex items-center space-x-3">
            <AlertCircle className="w-5 h-5 flex-shrink-0 text-amber-600" />
            <span className="font-medium">{validationWarning}</span>
          </div>
          <button
            onClick={() => setValidationWarning(null)}
            className="text-amber-600 hover:text-amber-900 ml-2 font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* Submission Error Alert */}
      {submitError && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-2xl flex items-center justify-between text-xs sm:text-sm text-red-800">
          <div className="flex items-center space-x-3">
            <AlertCircle className="w-5 h-5 flex-shrink-0 text-red-600" />
            <span className="font-medium">{submitError}</span>
          </div>
          <button
            onClick={() => setSubmitError(null)}
            className="text-red-600 hover:text-red-900 ml-2 font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* STEP 0: WELCOME & INSTRUCTIONS */}
      {currentStep === 'intro' && (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-10 shadow-sm space-y-6">
          <div className="prose prose-slate max-w-none text-slate-700 text-sm sm:text-base leading-relaxed space-y-4">
            <p className="font-medium text-slate-900">Dear Young Single Adult,</p>
            <p>
              As we prepare to establish our own functional Gathering Place in 2027, we want to ensure that the programs and skills offered are relevant to your needs, interests, aspirations, and availability.
            </p>
            <p>
              We invite you to share your opinions by completing this short survey. Your responses will help us plan meaningful skill acquisition programs, Self-Reliance classes, and other activities that will support your spiritual, personal, educational, and career development.
            </p>
            <p>
              Your input matters. We look forward to building a Gathering Place where every YSA can learn, grow, and become more self-reliant.
            </p>
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-xs sm:text-sm font-semibold text-amber-900">
              PLEASE NOTE: This is not an automatic registration or sign-up for any class. It is a resource to help us plan, assess needs, and make informed decisions.
            </div>
            <p className="font-medium text-slate-900">Thank you!</p>
          </div>

          <div className="pt-6 border-t border-slate-100 flex flex-col sm:flex-row justify-between items-center gap-4">
            <div className="flex items-center text-xs text-slate-500">
              <Clock className="w-4 h-4 mr-1.5 text-slate-400" />
              Takes approximately 3–4 minutes
            </div>
            <button
              type="button"
              onClick={() => setCurrentStep('about')}
              className="w-full sm:w-auto px-8 py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-bold flex items-center justify-center space-x-2 transition cursor-pointer shadow-lg shadow-emerald-600/20"
            >
              <span>Begin Assessment</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 1: SECTION 1 — ABOUT YOU */}
      {currentStep === 'about' && (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-10 shadow-sm space-y-8">
          <div>
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-emerald-700">Section 1 of 5</span>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 mt-1">About You</h2>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">Please provide basic demographic context.</p>
          </div>

          {/* Q1: Ward or Branch */}
          <div className="space-y-2">
            <label className="block text-sm font-bold text-slate-900">
              1. Which Ward or Branch do you belong to? <span className="text-red-500">*</span>
            </label>
            <select
              value={wardBranch}
              onChange={(e) => setWardBranch(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white text-slate-900 text-sm"
              required
            >
              <option value="">-- Select your Ward or Branch --</option>
              {WARD_BRANCH_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>

          {/* Q2: Current Status */}
          <div className="space-y-3">
            <label className="block text-sm font-bold text-slate-900">
              2. What is your current status? <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {CURRENT_STATUS_OPTIONS.map((opt) => (
                <label
                  key={opt}
                  className={`flex items-center p-3.5 rounded-xl border cursor-pointer transition text-xs sm:text-sm font-medium ${
                    currentStatus === opt
                      ? 'bg-emerald-50 border-emerald-500 text-emerald-900'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="currentStatus"
                    value={opt}
                    checked={currentStatus === opt}
                    onChange={() => {
                      setCurrentStatus(opt)
                      if (opt !== 'Other') setCurrentStatusOther('')
                      setValidationWarning(null)
                    }}
                    className="w-4 h-4 text-emerald-600 focus:ring-emerald-500 mr-3"
                  />
                  <span>{opt}</span>
                </label>
              ))}
            </div>

            {currentStatus === 'Other' && (
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5 animate-in fade-in-50 duration-200">
                <label className="block text-xs font-semibold text-slate-800">
                  Please specify your current status <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={currentStatusOther}
                  onChange={(e) => {
                    setCurrentStatusOther(e.target.value)
                    setValidationWarning(null)
                  }}
                  placeholder="e.g., NYSC Corp Member, Freelancer, Volunteering..."
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white text-slate-900 text-xs sm:text-sm"
                  maxLength={100}
                  autoFocus
                />
              </div>
            )}
          </div>

          {/* Q3: Highest Level of Education */}
          <div className="space-y-3">
            <label className="block text-sm font-bold text-slate-900">
              3. What is your highest level of education? <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {EDUCATION_LEVEL_OPTIONS.map((opt) => (
                <label
                  key={opt}
                  className={`flex items-center p-3.5 rounded-xl border cursor-pointer transition text-xs sm:text-sm font-medium ${
                    educationLevel === opt
                      ? 'bg-emerald-50 border-emerald-500 text-emerald-900'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="educationLevel"
                    value={opt}
                    checked={educationLevel === opt}
                    onChange={() => {
                      setEducationLevel(opt)
                      if (opt !== 'Other') setEducationLevelOther('')
                      setValidationWarning(null)
                    }}
                    className="w-4 h-4 text-emerald-600 focus:ring-emerald-500 mr-3"
                  />
                  <span>{opt}</span>
                </label>
              ))}
            </div>

            {educationLevel === 'Other' && (
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5 animate-in fade-in-50 duration-200">
                <label className="block text-xs font-semibold text-slate-800">
                  Please specify your highest level of education <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={educationLevelOther}
                  onChange={(e) => {
                    setEducationLevelOther(e.target.value)
                    setValidationWarning(null)
                  }}
                  placeholder="e.g., Primary school, Vocational certificate, Professional diploma..."
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white text-slate-900 text-xs sm:text-sm"
                  maxLength={100}
                  autoFocus
                />
              </div>
            )}
          </div>

          {/* Q4: Outside Program Participation */}
          <div className="space-y-3">
            <label className="block text-sm font-bold text-slate-900">
              4. Are you currently participating in any skill acquisition or Self-Reliance program outside the Gathering Place?{' '}
              <span className="text-red-500">*</span>
            </label>
            <div className="space-y-2">
              {SELF_RELIANCE_PARTICIPATION_OPTIONS.map((opt) => (
                <label
                  key={opt}
                  className={`flex items-center p-3.5 rounded-xl border cursor-pointer transition text-xs sm:text-sm font-medium ${
                    currentSelfReliance === opt
                      ? 'bg-emerald-50 border-emerald-500 text-emerald-900'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="currentSelfReliance"
                    value={opt}
                    checked={currentSelfReliance === opt}
                    onChange={() => setCurrentSelfReliance(opt)}
                    className="w-4 h-4 text-emerald-600 focus:ring-emerald-500 mr-3"
                  />
                  <span>{opt}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Navigation Buttons */}
          <div className="pt-6 border-t border-slate-100 flex justify-between items-center">
            <button
              type="button"
              onClick={() => setCurrentStep('intro')}
              className="px-5 py-2.5 text-xs font-semibold text-slate-600 hover:text-slate-900 transition flex items-center space-x-1"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              <span>Back</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (validateSectionAbout()) setCurrentStep('skills')
              }}
              className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs sm:text-sm font-bold flex items-center space-x-2 transition cursor-pointer shadow-md shadow-emerald-600/20"
            >
              <span>Continue to Skills</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: SECTION 2 — SKILLS YOU WOULD LIKE TO LEARN */}
      {currentStep === 'skills' && (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-10 shadow-sm space-y-8">
          <div>
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-emerald-700">Section 2 of 5</span>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 mt-1">Skills You Would Like to Learn</h2>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              Rank your practical skills and choose your soft skill and Self-Reliance interests.
            </p>
          </div>

          {/* Question 5 — Ranked Hard Skills */}
          <div className="p-5 bg-slate-50 border border-slate-200 rounded-2xl space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                5. Ranked Practical (Hard) Skills <span className="text-red-500">*</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Identify your top THREE preferred practical skills in priority order. Each choice must be distinct.
              </p>
            </div>

            {/* 5a. First Choice */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700">
                5a. What is your FIRST most preferred practical skill? <span className="text-red-500">*</span>
              </label>
              <select
                value={hardSkillFirst}
                onChange={(e) => {
                  setHardSkillFirst(e.target.value)
                  if (e.target.value !== 'Other') setHardSkillFirstOther('')
                  setValidationWarning(null)
                }}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white text-slate-900 text-xs sm:text-sm"
              >
                <option value="">-- Choose 1st Preference --</option>
                {HARD_SKILLS_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
              {hardSkillFirst === 'Other' && (
                <div className="pt-1 animate-in fade-in-50 duration-200">
                  <input
                    type="text"
                    value={hardSkillFirstOther}
                    onChange={(e) => {
                      setHardSkillFirstOther(e.target.value)
                      setValidationWarning(null)
                    }}
                    placeholder="Please specify your 1st preferred skill (e.g. Solar Installation, Plumbing...)"
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white text-slate-900 text-xs sm:text-sm"
                    maxLength={100}
                    autoFocus
                  />
                </div>
              )}
            </div>

            {/* 5b. Second Choice */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700">
                5b. What is your SECOND most preferred practical skill? <span className="text-red-500">*</span>
              </label>
              <select
                value={hardSkillSecond}
                onChange={(e) => {
                  setHardSkillSecond(e.target.value)
                  if (e.target.value !== 'Other') setHardSkillSecondOther('')
                  setValidationWarning(null)
                }}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white text-slate-900 text-xs sm:text-sm"
              >
                <option value="">-- Choose 2nd Preference --</option>
                {HARD_SKILLS_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
              {hardSkillSecond === 'Other' && (
                <div className="pt-1 animate-in fade-in-50 duration-200">
                  <input
                    type="text"
                    value={hardSkillSecondOther}
                    onChange={(e) => {
                      setHardSkillSecondOther(e.target.value)
                      setValidationWarning(null)
                    }}
                    placeholder="Please specify your 2nd preferred skill (e.g. Solar Installation, Plumbing...)"
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white text-slate-900 text-xs sm:text-sm"
                    maxLength={100}
                    autoFocus
                  />
                </div>
              )}
            </div>

            {/* 5c. Third Choice */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700">
                5c. What is your THIRD most preferred practical skill? <span className="text-red-500">*</span>
              </label>
              <select
                value={hardSkillThird}
                onChange={(e) => {
                  setHardSkillThird(e.target.value)
                  if (e.target.value !== 'Other') setHardSkillThirdOther('')
                  setValidationWarning(null)
                }}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white text-slate-900 text-xs sm:text-sm"
              >
                <option value="">-- Choose 3rd Preference --</option>
                {HARD_SKILLS_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
              {hardSkillThird === 'Other' && (
                <div className="pt-1 animate-in fade-in-50 duration-200">
                  <input
                    type="text"
                    value={hardSkillThirdOther}
                    onChange={(e) => {
                      setHardSkillThirdOther(e.target.value)
                      setValidationWarning(null)
                    }}
                    placeholder="Please specify your 3rd preferred skill (e.g. Solar Installation, Plumbing...)"
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white text-slate-900 text-xs sm:text-sm"
                    maxLength={100}
                    autoFocus
                  />
                </div>
              )}
            </div>

            {/* Distinct Hard Skills Invariant Alert */}
            {hardSkillFirst &&
              hardSkillSecond &&
              hardSkillThird &&
              (getResolvedHardFirst() === getResolvedHardSecond() ||
                getResolvedHardFirst() === getResolvedHardThird() ||
                getResolvedHardSecond() === getResolvedHardThird()) && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-medium flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 text-red-600" />
                  <span>Please select three different skills for your first, second, and third preferences.</span>
                </div>
              )}
          </div>

          {/* Question 6 — Soft Skills (Multi-select, Max 3) */}
          <div className="space-y-3">
            <div className="flex justify-between items-baseline">
              <label className="block text-sm font-bold text-slate-900">
                6. Which soft skills would you like to develop? <span className="text-red-500">*</span>
              </label>
              <span className="text-xs font-mono text-slate-500">
                Selected: <strong className={softSkills.length > 3 ? 'text-red-600' : 'text-emerald-700'}>{softSkills.length}</strong> / 3 max
              </span>
            </div>
            <p className="text-xs text-slate-500 -mt-1">Select up to 3 options that interest you most.</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {SOFT_SKILLS_OPTIONS.map((opt) => {
                const isSelected = softSkills.includes(opt)
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => toggleSoftSkill(opt)}
                    className={`flex items-center text-left p-3 rounded-xl border transition text-xs sm:text-sm font-medium cursor-pointer ${
                      isSelected
                        ? 'bg-emerald-50 border-emerald-500 text-emerald-950'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded border mr-3 flex items-center justify-center flex-shrink-0 ${
                        isSelected ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-slate-300'
                      }`}
                    >
                      {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                    </div>
                    <span>{opt}</span>
                  </button>
                )
              })}
            </div>

            {softSkills.includes('Other') && (
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5 animate-in fade-in-50 duration-200">
                <label className="block text-xs font-semibold text-slate-800">
                  Please specify the other soft skill you would like to develop <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={softSkillsOther}
                  onChange={(e) => {
                    setSoftSkillsOther(e.target.value)
                    setValidationWarning(null)
                  }}
                  placeholder="e.g., Negotiation, Conflict Resolution, Active Listening..."
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white text-slate-900 text-xs sm:text-sm"
                  maxLength={100}
                  autoFocus
                />
              </div>
            )}
          </div>

          {/* Question 7 — Self-Reliance Classes (Single-select) */}
          <div className="space-y-3">
            <label className="block text-sm font-bold text-slate-900">
              7. Which Self-Reliance classes would you be interested in attending? <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {SELF_RELIANCE_CLASS_OPTIONS.map((opt) => (
                <label
                  key={opt}
                  className={`flex items-center p-3.5 rounded-xl border cursor-pointer transition text-xs sm:text-sm font-medium ${
                    selfRelianceClass === opt
                      ? 'bg-emerald-50 border-emerald-500 text-emerald-900'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="selfRelianceClass"
                    value={opt}
                    checked={selfRelianceClass === opt}
                    onChange={() => setSelfRelianceClass(opt)}
                    className="w-4 h-4 text-emerald-600 focus:ring-emerald-500 mr-3"
                  />
                  <span>{opt}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Navigation Buttons */}
          <div className="pt-6 border-t border-slate-100 flex justify-between items-center">
            <button
              type="button"
              onClick={() => setCurrentStep('about')}
              className="px-5 py-2.5 text-xs font-semibold text-slate-600 hover:text-slate-900 transition flex items-center space-x-1"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              <span>Back</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (validateSectionSkills()) setCurrentStep('goals')
              }}
              className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs sm:text-sm font-bold flex items-center space-x-2 transition cursor-pointer shadow-md shadow-emerald-600/20"
            >
              <span>Continue to Goals</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: SECTION 3 — GOALS & EXPECTATIONS */}
      {currentStep === 'goals' && (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-10 shadow-sm space-y-8">
          <div>
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-emerald-700">Section 3 of 5</span>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 mt-1">Your Goals and Expectations</h2>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              Help us understand what success looks like for you.
            </p>
          </div>

          {/* Question 8 — Desired Outcomes (Max 3) */}
          <div className="space-y-3">
            <div className="flex justify-between items-baseline">
              <label className="block text-sm font-bold text-slate-900">
                8. What do you hope to achieve by participating in the Gathering Place program?{' '}
                <span className="text-red-500">*</span>
              </label>
              <span className="text-xs font-mono text-slate-500">
                Selected: <strong className={desiredOutcomes.length > 3 ? 'text-red-600' : 'text-emerald-700'}>{desiredOutcomes.length}</strong> / 3 max
              </span>
            </div>
            <p className="text-xs text-slate-500 -mt-1">Select up to 3 priority outcomes.</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {GOALS_OPTIONS.map((opt) => {
                const isSelected = desiredOutcomes.includes(opt)
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => toggleDesiredOutcome(opt)}
                    className={`flex items-center text-left p-3 rounded-xl border transition text-xs sm:text-sm font-medium cursor-pointer ${
                      isSelected
                        ? 'bg-emerald-50 border-emerald-500 text-emerald-950'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded border mr-3 flex items-center justify-center flex-shrink-0 ${
                        isSelected ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-slate-300'
                      }`}
                    >
                      {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                    </div>
                    <span>{opt}</span>
                  </button>
                )
              })}
            </div>

            {desiredOutcomes.includes('Other') && (
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5 animate-in fade-in-50 duration-200">
                <label className="block text-xs font-semibold text-slate-800">
                  Please specify your other goal or expected outcome <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={desiredOutcomesOther}
                  onChange={(e) => {
                    setDesiredOutcomesOther(e.target.value)
                    setValidationWarning(null)
                  }}
                  placeholder="e.g., Prepare for missionary service, Mentorship connection..."
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white text-slate-900 text-xs sm:text-sm"
                  maxLength={100}
                  autoFocus
                />
              </div>
            )}
          </div>

          {/* Question 9 — Experience Level */}
          <div className="space-y-3">
            <label className="block text-sm font-bold text-slate-900">
              9. What level of experience do you have in your most preferred skill(s)? <span className="text-red-500">*</span>
            </label>
            <div className="space-y-2">
              {EXPERIENCE_LEVEL_OPTIONS.map((opt) => (
                <label
                  key={opt}
                  className={`flex items-center p-3.5 rounded-xl border cursor-pointer transition text-xs sm:text-sm font-medium ${
                    experienceLevel === opt
                      ? 'bg-emerald-50 border-emerald-500 text-emerald-900'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="experienceLevel"
                    value={opt}
                    checked={experienceLevel === opt}
                    onChange={() => setExperienceLevel(opt)}
                    className="w-4 h-4 text-emerald-600 focus:ring-emerald-500 mr-3"
                  />
                  <span>{opt}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Question 10 — Specific 5-6 month outcome (Optional short text) */}
          <div className="space-y-1.5">
            <label className="block text-sm font-bold text-slate-900">
              10. What specific outcome would you like to achieve within 5–6 months of participating?{' '}
              <span className="text-xs font-normal text-slate-400">(Optional)</span>
            </label>
            <p className="text-xs text-slate-500">
              Example: Get a job, launch a business, become proficient in graphic design, or earn an additional income.
            </p>
            <input
              type="text"
              value={outcome56Month}
              onChange={(e) => setOutcome56Month(e.target.value)}
              placeholder="Your 5–6 month target outcome..."
              className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
              maxLength={250}
            />
          </div>

          {/* Navigation Buttons */}
          <div className="pt-6 border-t border-slate-100 flex justify-between items-center">
            <button
              type="button"
              onClick={() => setCurrentStep('skills')}
              className="px-5 py-2.5 text-xs font-semibold text-slate-600 hover:text-slate-900 transition flex items-center space-x-1"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              <span>Back</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (validateSectionGoals()) setCurrentStep('ideas')
              }}
              className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs sm:text-sm font-bold flex items-center space-x-2 transition cursor-pointer shadow-md shadow-emerald-600/20"
            >
              <span>Continue to Ideas</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 4: SECTION 4 — IDEAS & SUGGESTIONS */}
      {currentStep === 'ideas' && (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-10 shadow-sm space-y-8">
          <div>
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-emerald-700">Section 4 of 5</span>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 mt-1">Your Ideas and Suggestions</h2>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              These open-ended suggestions are optional but very valuable to the Stake leadership.
            </p>
          </div>

          {/* Question 11 — Other skills/activities */}
          <div className="space-y-1.5">
            <label className="block text-sm font-bold text-slate-900">
              11. What other skills, classes, or activities would you like us to introduce?{' '}
              <span className="text-xs font-normal text-slate-400">(Optional)</span>
            </label>
            <textarea
              rows={3}
              value={additionalSkills}
              onChange={(e) => setAdditionalSkills(e.target.value)}
              placeholder="Tell us any other skills, classes, workshops, or activities..."
              className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
              maxLength={1000}
            />
          </div>

          {/* Question 12 — General suggestions */}
          <div className="space-y-1.5">
            <label className="block text-sm font-bold text-slate-900">
              12. What suggestions or ideas do you have to make our Stake Gathering Place successful and beneficial to YSA?{' '}
              <span className="text-xs font-normal text-slate-400">(Optional)</span>
            </label>
            <textarea
              rows={3}
              value={suggestions}
              onChange={(e) => setSuggestions(e.target.value)}
              placeholder="Share your ideas on venue, mentors, structure, fellowship, or materials..."
              className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
              maxLength={1000}
            />
          </div>

          {/* Navigation Buttons */}
          <div className="pt-6 border-t border-slate-100 flex justify-between items-center">
            <button
              type="button"
              onClick={() => setCurrentStep('goals')}
              className="px-5 py-2.5 text-xs font-semibold text-slate-600 hover:text-slate-900 transition flex items-center space-x-1"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              <span>Back</span>
            </button>
            <button
              type="button"
              onClick={() => setCurrentStep('availability')}
              className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs sm:text-sm font-bold flex items-center space-x-2 transition cursor-pointer shadow-md shadow-emerald-600/20"
            >
              <span>Continue to Availability</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 5: SECTION 5 — AVAILABILITY */}
      {currentStep === 'availability' && (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-10 shadow-sm space-y-8">
          <div>
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-emerald-700">Section 5 of 5</span>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 mt-1">Your Availability</h2>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              Select all days and time slots that work best for your schedule.
            </p>
          </div>

          {/* Question 13 — Days (Multi-select) */}
          <div className="space-y-3">
            <label className="block text-sm font-bold text-slate-900">
              13. Which days would be most convenient for you to attend Gathering Place classes?{' '}
              <span className="text-red-500">*</span>
            </label>
            <p className="text-xs text-slate-500 -mt-1">Select all that apply.</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {DAYS_OPTIONS.map((day) => {
                const isSelected = preferredDays.includes(day)
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleDay(day)}
                    className={`flex items-center text-left p-3 rounded-xl border transition text-xs sm:text-sm font-medium cursor-pointer ${
                      isSelected
                        ? 'bg-emerald-50 border-emerald-500 text-emerald-950 font-semibold'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded border mr-2 flex items-center justify-center flex-shrink-0 ${
                        isSelected ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-slate-300'
                      }`}
                    >
                      {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                    </div>
                    <span>{day}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Question 14 — Times (Multi-select) */}
          <div className="space-y-3">
            <label className="block text-sm font-bold text-slate-900">
              14. What time would be most convenient for you? <span className="text-red-500">*</span>
            </label>
            <p className="text-xs text-slate-500 -mt-1">Select all that apply.</p>
            <div className="space-y-2.5">
              {TIME_PERIOD_OPTIONS.map((time) => {
                const isSelected = preferredTimes.includes(time)
                return (
                  <button
                    key={time}
                    type="button"
                    onClick={() => toggleTimePeriod(time)}
                    className={`w-full flex items-center text-left p-3.5 rounded-xl border transition text-xs sm:text-sm font-medium cursor-pointer ${
                      isSelected
                        ? 'bg-emerald-50 border-emerald-500 text-emerald-950 font-semibold'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded border mr-3 flex items-center justify-center flex-shrink-0 ${
                        isSelected ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-slate-300'
                      }`}
                    >
                      {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                    </div>
                    <span>{time}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Navigation Buttons */}
          <div className="pt-6 border-t border-slate-100 flex justify-between items-center">
            <button
              type="button"
              onClick={() => setCurrentStep('ideas')}
              className="px-5 py-2.5 text-xs font-semibold text-slate-600 hover:text-slate-900 transition flex items-center space-x-1"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              <span>Back</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (validateSectionAvailability()) setCurrentStep('review')
              }}
              className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs sm:text-sm font-bold flex items-center space-x-2 transition cursor-pointer shadow-md shadow-emerald-600/20"
            >
              <span>Review Your Answers</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 6: REVIEW BEFORE FINAL SUBMIT */}
      {currentStep === 'review' && (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-10 shadow-sm space-y-6">
          <div>
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-emerald-700">Review Summary</span>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 mt-1">Review Your Responses</h2>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              Please double check your answers before submitting.
            </p>
          </div>

          <div className="divide-y divide-slate-100 border border-slate-200 rounded-2xl overflow-hidden text-xs sm:text-sm">
            {/* Unit & Demographics */}
            <div className="p-4 bg-slate-50/50 flex flex-col sm:flex-row sm:justify-between gap-1">
              <span className="font-semibold text-slate-500">Unit / Ward:</span>
              <span className="font-bold text-slate-900">{wardBranch}</span>
            </div>
            <div className="p-4 flex flex-col sm:flex-row sm:justify-between gap-1">
              <span className="font-semibold text-slate-500">Current Status:</span>
              <span className="font-medium text-slate-800">{getResolvedStatus()}</span>
            </div>
            <div className="p-4 bg-slate-50/50 flex flex-col sm:flex-row sm:justify-between gap-1">
              <span className="font-semibold text-slate-500">Highest Education:</span>
              <span className="font-medium text-slate-800">{getResolvedEducation()}</span>
            </div>
            <div className="p-4 flex flex-col sm:flex-row sm:justify-between gap-1">
              <span className="font-semibold text-slate-500">Outside Programs:</span>
              <span className="font-medium text-slate-800">{currentSelfReliance}</span>
            </div>

            {/* Ranked Practical Skills */}
            <div className="p-4 bg-emerald-50/40 space-y-1.5">
              <span className="font-bold text-emerald-950 block">Ranked Practical Skills:</span>
              <ol className="list-decimal list-inside space-y-1 text-slate-800 pl-1">
                <li>
                  <strong>1st Preference:</strong> {getResolvedHardFirst()}
                </li>
                <li>
                  <strong>2nd Preference:</strong> {getResolvedHardSecond()}
                </li>
                <li>
                  <strong>3rd Preference:</strong> {getResolvedHardThird()}
                </li>
              </ol>
            </div>

            {/* Soft Skills & Self-Reliance */}
            <div className="p-4 flex flex-col sm:flex-row sm:justify-between gap-1">
              <span className="font-semibold text-slate-500">Soft Skills:</span>
              <span className="font-medium text-slate-800">{getResolvedSoftSkills().join(', ')}</span>
            </div>
            <div className="p-4 bg-slate-50/50 flex flex-col sm:flex-row sm:justify-between gap-1">
              <span className="font-semibold text-slate-500">Self-Reliance Class:</span>
              <span className="font-medium text-slate-800">{selfRelianceClass}</span>
            </div>

            {/* Goals & Experience */}
            <div className="p-4 flex flex-col sm:flex-row sm:justify-between gap-1">
              <span className="font-semibold text-slate-500">Desired Outcomes:</span>
              <span className="font-medium text-slate-800">{getResolvedDesiredOutcomes().join(', ')}</span>
            </div>
            <div className="p-4 bg-slate-50/50 flex flex-col sm:flex-row sm:justify-between gap-1">
              <span className="font-semibold text-slate-500">Experience Level:</span>
              <span className="font-medium text-slate-800">{experienceLevel}</span>
            </div>

            {/* Availability */}
            <div className="p-4 flex flex-col sm:flex-row sm:justify-between gap-1">
              <span className="font-semibold text-slate-500">Convenient Days:</span>
              <span className="font-medium text-slate-800">{preferredDays.join(', ')}</span>
            </div>
            <div className="p-4 bg-slate-50/50 flex flex-col sm:flex-row sm:justify-between gap-1">
              <span className="font-semibold text-slate-500">Convenient Times:</span>
              <span className="font-medium text-slate-800">{preferredTimes.join(', ')}</span>
            </div>

            {/* Open-Ended (If provided) */}
            {outcome56Month && (
              <div className="p-4 space-y-1">
                <span className="font-semibold text-slate-500 block">5–6 Month Goal:</span>
                <p className="text-slate-800 italic bg-white p-2.5 rounded-lg border border-slate-200">
                  "{outcome56Month}"
                </p>
              </div>
            )}
            {additionalSkills && (
              <div className="p-4 bg-slate-50/50 space-y-1">
                <span className="font-semibold text-slate-500 block">Additional Skills Suggested:</span>
                <p className="text-slate-800 italic bg-white p-2.5 rounded-lg border border-slate-200">
                  "{additionalSkills}"
                </p>
              </div>
            )}
            {suggestions && (
              <div className="p-4 space-y-1">
                <span className="font-semibold text-slate-500 block">Gathering Place Suggestions:</span>
                <p className="text-slate-800 italic bg-white p-2.5 rounded-lg border border-slate-200">
                  "{suggestions}"
                </p>
              </div>
            )}
          </div>

          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 text-xs text-slate-500">
            Note: By clicking Submit, your responses will be securely stored anonymously to help the Abeokuta Nigeria Obantoko Stake plan the 2027 Gathering Place.
          </div>

          {/* Submission Buttons */}
          <div className="pt-6 border-t border-slate-100 flex flex-col sm:flex-row justify-between items-center gap-3">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => setCurrentStep('availability')}
              className="w-full sm:w-auto px-5 py-2.5 text-xs font-semibold text-slate-600 hover:text-slate-900 transition flex items-center justify-center space-x-1"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              <span>Modify Answers</span>
            </button>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={handleFinalSubmit}
              className="w-full sm:w-auto px-8 py-3.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white rounded-xl text-sm font-bold flex items-center justify-center space-x-2 transition cursor-pointer shadow-lg shadow-emerald-600/25"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  <span>Submitting Response...</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  <span>Submit Needs Assessment</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
