import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PublicAttendanceView } from '../components/public/PublicAttendanceView'
import { TerminalView } from '../components/public/TerminalView'
import { Navbar } from '../components/layout/Navbar'
import { attendanceService } from '../services/attendanceService'
import { adminService } from '../services/adminService'
import { memberService } from '../services/memberService'
import { AuthProvider } from '../context/AuthContext'
import { ThemeProvider } from '../context/ThemeContext'

describe('Brand Asset Integration & Public Terminal Redesign Suite', () => {
  const publicDir = path.resolve(__dirname, '../../public')

  describe('1. Brand Asset Existence & File Integrity', () => {
    it('verifies all expected brand assets exist on disk in the public folder', () => {
      const expectedAssets = [
        'ams_logo_horizontal_green_bg.png',
        'ams_logo_horizontal_light_bg.png',
        'favicon_green_bg.png',
        'Favicon_white_bg.png',
        'YSA AMS logo.png',
        'manifest.json'
      ]

      for (const asset of expectedAssets) {
        const filePath = path.join(publicDir, asset)
        expect(fs.existsSync(filePath), `Expected asset ${asset} to exist on disk`).toBe(true)
        const stat = fs.statSync(filePath)
        expect(stat.size, `Asset ${asset} should not be empty`).toBeGreaterThan(100)
      }
    })

    it('verifies vite.svg default branding has been removed', () => {
      const viteSvgPath = path.join(publicDir, 'vite.svg')
      expect(fs.existsSync(viteSvgPath)).toBe(false)
    })

    it('verifies manifest.json specifies YSA AMS metadata and icons', () => {
      const manifestPath = path.join(publicDir, 'manifest.json')
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      expect(manifest.short_name).toBe('YSA AMS')
      expect(manifest.icons.length).toBeGreaterThanOrEqual(2)
      expect(manifest.icons.some((icon: { src: string }) => icon.src.includes('favicon_green_bg.png'))).toBe(true)
    })
  })

  describe('2. Document Head & Index HTML Configuration', () => {
    it('verifies index.html uses favicon_green_bg.png and manifest.json without default vite.svg', () => {
      const indexPath = path.resolve(__dirname, '../../index.html')
      const indexHtml = fs.readFileSync(indexPath, 'utf8')

      expect(indexHtml).toContain('/favicon_green_bg.png')
      expect(indexHtml).toContain('/manifest.json')
      expect(indexHtml).not.toContain('/vite.svg')
      // Ensure body has light background by default, not dark slate-950
      expect(indexHtml).toContain('bg-slate-50')
      expect(indexHtml).not.toContain('class="bg-slate-950')
    })
  })

  describe('3. Navbar Brand Header Integration', () => {
    it('renders the horizontal light logo by default with accessible alt text', () => {
      const onNavigate = vi.fn()
      render(
        <ThemeProvider>
          <AuthProvider>
            <Navbar currentPath="/" onNavigate={onNavigate} />
          </AuthProvider>
        </ThemeProvider>
      )

      const logoImg = screen.getByAltText(/YSA AMS - Young Single Adult Attendance Management System/i)
      expect(logoImg).toBeInTheDocument()
      expect(logoImg.getAttribute('src')).toBe('/ams_logo_horizontal_light_bg.png')

      const leadershipBtn = screen.getByRole('button', { name: /leadership portal/i })
      expect(leadershipBtn).toBeInTheDocument()
      fireEvent.click(leadershipBtn)
      expect(onNavigate).toHaveBeenCalledWith('/la')
    })
  })

  describe('4. Public Attendance View (Landing & Activity Code Entry)', () => {
    it('renders warm welcome message and YSA AMS brand emblem in light mode', () => {
      const onCodeRedeemed = vi.fn()
      const { container } = render(
        <PublicAttendanceView initialCode="" onCodeRedeemed={onCodeRedeemed} />
      )

      // Warm welcome greeting and supporting text
      expect(screen.getByText("Welcome! We're glad you're here.")).toBeInTheDocument()
      expect(
        screen.getByText(/Enter the activity code shared by your leader to check in/i)
      ).toBeInTheDocument()

      // Standalone brand presentation
      const emblem = screen.getByAltText(/YSA AMS Emblem/i)
      expect(emblem).toBeInTheDocument()
      expect(emblem.getAttribute('src')).toBe('/YSA AMS logo.png')

      // Stake banner
      expect(screen.getByText(/Abeokuta Nigeria Obantoko Stake/i)).toBeInTheDocument()

      // Check light theme classes
      expect(container.querySelector('.bg-white')).toBeInTheDocument()
      expect(container.querySelector('.bg-slate-900')).toBeNull()
      expect(container.querySelector('.bg-slate-950')).toBeNull()
    })

    it('validates 6-character activity code and displays friendly error on invalid submission', async () => {
      const onCodeRedeemed = vi.fn()
      render(<PublicAttendanceView initialCode="" onCodeRedeemed={onCodeRedeemed} />)

      const submitBtn = screen.getByRole('button', { name: /connect & check in/i })

      // Empty submission
      fireEvent.click(submitBtn)
      expect(screen.getByRole('alert')).toHaveTextContent(/Please enter an activity code/i)

      // Code too short
      const input = screen.getByLabelText(/6-Character Activity Code/i)
      fireEvent.change(input, { target: { value: 'ABC' } })
      fireEvent.click(submitBtn)
      expect(screen.getByRole('alert')).toHaveTextContent(/Activity codes are exactly 6/i)

      expect(onCodeRedeemed).not.toHaveBeenCalled()
    })

    it('authorizes terminal and invokes callback upon valid code entry', async () => {
      vi.spyOn(attendanceService, 'authorizeTerminal').mockResolvedValueOnce({
        success: true,
        sessionTitle: 'Single Adult Fireside',
        sessionDate: '2026-10-25'
      })

      const onCodeRedeemed = vi.fn()
      render(<PublicAttendanceView initialCode="" onCodeRedeemed={onCodeRedeemed} />)

      const input = screen.getByLabelText(/6-Character Activity Code/i)
      fireEvent.change(input, { target: { value: '5BV21F' } })

      const submitBtn = screen.getByRole('button', { name: /connect & check in/i })
      fireEvent.click(submitBtn)

      await waitFor(() => {
        expect(onCodeRedeemed).toHaveBeenCalledWith('5BV21F', 'Single Adult Fireside', '2026-10-25')
      })
    })
  })

  describe('5. Public Terminal View (Attendance Form & Confirmation)', () => {
    beforeEach(() => {
      vi.spyOn(adminService, 'listUnits').mockResolvedValue([
        {
          id: 'unit-1',
          unitName: 'Obantoko 1st Ward',
          unitType: 'ward',
          isActive: true,
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01'
        }
      ])
      vi.spyOn(memberService, 'listMembers').mockResolvedValue([])
      vi.spyOn(attendanceService, 'getStoredSessionMetadata').mockReturnValue({
        token: 'test-token',
        sessionId: 'session-123',
        terminalId: 'term-1',
        sessionTitle: 'Stake YSA Conference',
        sessionDate: '2026-10-25',
        participatingUnits: null
      })
      vi.spyOn(attendanceService, 'getStoredTerminalToken').mockReturnValue('test-token')
      vi.spyOn(attendanceService, 'startHeartbeatLoop').mockImplementation(() => {})
      vi.spyOn(attendanceService, 'stopHeartbeatLoop').mockImplementation(() => {})
    })

    it('renders attendance form in light theme with clear welcoming banner and controls', async () => {
      const onRelease = vi.fn()
      const { container } = render(
        <TerminalView
          sessionTitle="Stake YSA Conference"
          sessionDate="2026-10-25"
          onReleaseTerminal={onRelease}
        />
      )

      expect(screen.getByText('Stake YSA Conference')).toBeInTheDocument()
      expect(screen.getByText(/Terminal Connected • Ready for Check-in/i)).toBeInTheDocument()
      expect(screen.getByText(/Welcome!/i)).toBeInTheDocument()
      expect(screen.getByText(/We're glad you're here. Enter your name below/i)).toBeInTheDocument()

      // Light surfaces verified
      expect(container.querySelector('.bg-white')).toBeInTheDocument()
      expect(container.querySelector('.bg-slate-900')).toBeNull()
      expect(container.querySelector('.bg-slate-950')).toBeNull()
    })

    it('completes check-in and transitions to friendly personalized confirmation screen', async () => {
      sessionStorage.setItem('ysaams_terminal_session_id', 'session-123')

      vi.spyOn(attendanceService, 'recordAttendance').mockResolvedValueOnce({
        success: true,
        record: {
          id: 'att-1',
          sessionId: 'session-123',
          attendeeName: 'Oluwaseun Adeleke',
          isNonMember: false,
          unitId: 'unit-1',
          checkInTime: new Date().toISOString()
        }
      })

      const onRelease = vi.fn()
      render(
        <TerminalView
          sessionTitle="Stake YSA Conference"
          sessionDate="2026-10-25"
          onReleaseTerminal={onRelease}
        />
      )

      // Enter name
      const nameInput = screen.getByLabelText(/Full Name/i)
      fireEvent.change(nameInput, { target: { value: 'Oluwaseun Adeleke' } })

      // Select unit
      await waitFor(() => {
        expect(screen.getByText('Obantoko 1st Ward (ward)')).toBeInTheDocument()
      })
      const unitSelect = screen.getByLabelText(/Home Ward or Branch/i)
      fireEvent.change(unitSelect, { target: { value: 'unit-1' } })

      // Submit
      const submitBtn = screen.getByRole('button', { name: /confirm check in/i })
      fireEvent.click(submitBtn)

      // Verify confirmation screen
      await waitFor(() => {
        expect(
          screen.getByText(/You're checked in, Oluwaseun — we're happy you're here!/i)
        ).toBeInTheDocument()
      })

      expect(screen.getByText('Attendance Recorded Successfully')).toBeInTheDocument()
      expect(screen.getByText('Oluwaseun Adeleke')).toBeInTheDocument()
      expect(screen.getByText('Church Member')).toBeInTheDocument()
      expect(screen.getByText('Obantoko 1st Ward')).toBeInTheDocument()

      // Next attendee button reset
      const nextBtn = screen.getByRole('button', { name: /next attendee check in/i })
      expect(nextBtn).toBeInTheDocument()
      fireEvent.click(nextBtn)

      // Form should reset to blank
      await waitFor(() => {
        expect(screen.getByLabelText(/Full Name/i)).toHaveValue('')
      })
    })

    it('supports guest / friend (non-member) flow without requiring ward', async () => {
      sessionStorage.setItem('ysaams_terminal_session_id', 'session-123')

      vi.spyOn(attendanceService, 'recordAttendance').mockResolvedValueOnce({
        success: true,
        record: {
          id: 'att-2',
          sessionId: 'session-123',
          attendeeName: 'Chioma Okeke',
          isNonMember: true,
          unitId: null,
          checkInTime: new Date().toISOString()
        }
      })

      const onRelease = vi.fn()
      render(
        <TerminalView
          sessionTitle="Stake YSA Social"
          sessionDate="2026-10-25"
          onReleaseTerminal={onRelease}
        />
      )

      // Toggle non-member
      const nonMemberCheckbox = screen.getByLabelText(/I am a guest \/ friend/i)
      fireEvent.click(nonMemberCheckbox)

      // Name
      const nameInput = screen.getByLabelText(/Your Full Name/i)
      fireEvent.change(nameInput, { target: { value: 'Chioma Okeke' } })

      // Submit without ward
      const submitBtn = screen.getByRole('button', { name: /confirm check in/i })
      fireEvent.click(submitBtn)

      await waitFor(() => {
        expect(screen.getByText(/You're checked in, Chioma — we're happy you're here!/i)).toBeInTheDocument()
        expect(screen.getByText('Guest / Friend')).toBeInTheDocument()
      })
    })
  })
})
