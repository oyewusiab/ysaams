import React, { useState } from 'react'
import { X, Upload, Trash2, CheckCircle2, AlertCircle, Shield } from 'lucide-react'
import { StakeLeaderSignature, UserProfile } from '../../types/database'
import { gatheringPlaceReportService } from '../../services/gatheringPlaceReportService'

interface SignatureManagementModalProps {
  isOpen: boolean
  onClose: () => void
  currentUser: UserProfile
  leaders: UserProfile[]
  existingSignatures: StakeLeaderSignature[]
  onSignatureUpdated: () => void
}

export const SignatureManagementModal: React.FC<SignatureManagementModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  leaders,
  existingSignatures,
  onSignatureUpdated
}) => {
  const isAdmin = currentUser.roles.includes('system_admin')
  const [selectedLeaderId, setSelectedLeaderId] = useState<string>(
    currentUser.id || leaders[0]?.id || ''
  )
  const [fullName, setFullName] = useState<string>(currentUser.fullName || '')
  const [phoneNumber, setPhoneNumber] = useState<string>(currentUser.phoneNumber || '')
  const [signaturePreview, setSignaturePreview] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Update fields when selected leader changes
  const handleSelectLeader = (leaderId: string) => {
    setSelectedLeaderId(leaderId)
    const targetLeader = leaders.find((l) => l.id === leaderId)
    const sig = existingSignatures.find((s) => s.userId === leaderId)
    if (sig) {
      setFullName(sig.fullName)
      setPhoneNumber(sig.phoneNumber)
      setSignaturePreview(sig.signatureDataUrl)
    } else {
      setFullName(targetLeader?.fullName || '')
      setPhoneNumber(targetLeader?.phoneNumber || '')
      setSignaturePreview(null)
    }
    setError(null)
    setSuccess(null)
  }

  // Handle file input for PNG signature
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.includes('png') && !file.type.includes('image')) {
      setError('Please upload an image file (PNG with transparent background recommended).')
      return
    }

    if (file.size > 2 * 1024 * 1024) {
      setError('Signature image must be under 2MB.')
      return
    }

    const reader = new FileReader()
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string
      setSignaturePreview(dataUrl)
      setError(null)
    }
    reader.readAsDataURL(file)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!fullName.trim()) {
      setError('Full name is required.')
      return
    }
    if (!phoneNumber.trim()) {
      setError('A contact phone number is required.')
      return
    }
    if (!signaturePreview) {
      setError('Please upload a signature image.')
      return
    }

    setIsSubmitting(true)
    setError(null)
    setSuccess(null)

    try {
      await gatheringPlaceReportService.saveSignature(
        {
          userId: selectedLeaderId,
          fullName: fullName.trim(),
          phoneNumber: phoneNumber.trim(),
          signatureDataUrl: signaturePreview
        },
        currentUser
      )
      setSuccess('Signature and contact details securely saved.')
      onSignatureUpdated()
      setTimeout(() => {
        onClose()
      }, 1200)
    } catch (err: any) {
      setError(err.message || 'Failed to save signature.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to remove this signature?')) return
    setIsSubmitting(true)
    setError(null)
    try {
      await gatheringPlaceReportService.deleteSignature(selectedLeaderId, currentUser)
      setSignaturePreview(null)
      setSuccess('Signature removed.')
      onSignatureUpdated()
    } catch (err: any) {
      setError(err.message || 'Failed to remove signature.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-6 text-slate-100 shadow-2xl space-y-5">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <Shield className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Stake Leader Signature Management</h3>
              <p className="text-[11px] text-slate-400">
                Upload and configure electronic signature and contact phone for official reports
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="p-3 bg-red-950/50 border border-red-800 rounded-xl flex items-center space-x-2 text-xs text-red-300">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="p-3 bg-emerald-950/50 border border-emerald-800 rounded-xl flex items-center space-x-2 text-xs text-emerald-300">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            <span>{success}</span>
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-4 text-xs">
          {/* Leader Selection (Admins can select any leader; leaders manage their own) */}
          {isAdmin && leaders.length > 0 && (
            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                Select Stake YSA Leader
              </label>
              <select
                value={selectedLeaderId}
                onChange={(e) => handleSelectLeader(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                {leaders.map((leader) => (
                  <option key={leader.id} value={leader.id}>
                    {leader.fullName} ({leader.email})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Full Name */}
          <div>
            <label className="block text-slate-300 font-semibold mb-1">
              Full Legal Name (as displayed on report)
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Victor Ogundele"
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {/* Phone Number */}
          <div>
            <label className="block text-slate-300 font-semibold mb-1">
              Official Contact Phone Number
            </label>
            <input
              type="text"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="e.g. 08083238902"
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {/* Upload E-Signature */}
          <div>
            <label className="block text-slate-300 font-semibold mb-1">
              Electronic Signature (PNG with transparent background)
            </label>
            <div className="flex items-center space-x-3">
              <label className="cursor-pointer px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl flex items-center space-x-2 text-slate-200 transition font-medium">
                <Upload className="w-4 h-4 text-emerald-400" />
                <span>Upload PNG</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
              {signaturePreview && (
                <button
                  type="button"
                  onClick={handleDelete}
                  className="px-3 py-2 bg-red-950/60 hover:bg-red-900 border border-red-800/80 rounded-xl text-red-300 flex items-center space-x-1.5 transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Remove</span>
                </button>
              )}
            </div>
          </div>

          {/* Signature Preview Canvas */}
          <div>
            <span className="block text-slate-400 text-[11px] mb-1 font-medium">
              Signature Preview:
            </span>
            <div className="h-20 bg-white border border-slate-600 rounded-xl flex items-center justify-center p-2 relative overflow-hidden">
              {signaturePreview ? (
                <img
                  src={signaturePreview}
                  alt="Signature Preview"
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <span className="text-slate-400 italic text-xs">
                  No signature uploaded yet.
                </span>
              )}
            </div>
            <p className="text-[10px] text-slate-500 mt-1">
              Signatures are securely stored and snapshotted when reports are finalized.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end space-x-3 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-semibold shadow-lg shadow-emerald-900/30 transition flex items-center space-x-2"
            >
              {isSubmitting ? (
                <span>Saving...</span>
              ) : (
                <span>Save Signature</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
