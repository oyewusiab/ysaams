# YSA AMS — Young Single Adult Attendance Management System
**Abeokuta Nigeria Obantoko Stake | The Church of Jesus Christ of Latter-day Saints**

A secure, mobile-friendly attendance management system built for stake-wide and unit-level YSA activities, reporting, and member engagement.

---

## Technical Stack
- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS v4
- **Icons & Styling:** Lucide React, Tailwind CSS
- **Backend & Database:** Supabase (PostgreSQL, Row-Level Security, RPCs, Auth)
- **Testing:** Vitest, Testing Library, JSDOM
- **Timezone:** `Africa/Lagos` (UTC+1)

---

## Project Structure
```
ysaams/
├── docs/                        # Architecture, requirements, and inspection documentation
│   ├── REQUIREMENTS.md          # Complete business logic & security requirements
│   └── SUPABASE_INSPECTION_PLAN.md # Safe read-only database inspection guide
├── public/                      # Static branding assets and icons
├── src/
│   ├── components/              # UI components
│   │   ├── layout/              # Header, navigation, and user session badge
│   │   ├── leadership/          # Leadership portal views (/la/*)
│   │   └── public/              # Public attendance forms & terminal check-in
│   ├── context/                 # React AuthContext (authentication & roles)
│   ├── lib/                     # Supabase client singleton & safe env validator
│   ├── services/                # Typed domain services (auth, activities, attendance, reports)
│   ├── test/                    # Automated Vitest test suites
│   ├── types/                   # TypeScript interfaces & database definitions
│   ├── App.tsx                  # Top-level path and role router
│   └── main.tsx                 # React DOM mount entrypoint
├── supabase/
│   └── migrations/              # Versioned SQL migrations
├── .env.example                 # Safe environment configuration template
├── package.json                 # Project dependencies and npm scripts
├── tsconfig.json                # TypeScript compiler configuration
└── vite.config.ts               # Vite build and test configuration
```

---

## Getting Started

### 1. Installation
```bash
npm install
```

### 2. Configure Environment
Copy `.env.example` to `.env.local` and provide your publishable Supabase credentials:
```bash
cp .env.example .env.local
```

*Note: Never place service-role keys or database passwords in client environment variables.*

### 3. Development Server
```bash
npm run dev
```

### 4. Running Tests & Static Validation
```bash
npm test        # Run Vitest test suites
npm run lint    # Run code linter
npm run build   # Type-check and produce production bundle
```

---

## Route Overview
- `/`: Public attendance landing and session code redemption
- `/:sessionCode`: Direct attendance link with automatic URL scrubbing
- `/terminal`: Redeemed terminal check-in kiosk
- `/la`: Leadership portal entry
- `/la/dashboard`: High-level attendance dashboard
- `/la/activities`: Activity creation and session code generation
- `/la/attendance`: Live check-in monitor
- `/la/members`: Member registry and census
- `/la/reports`: Monthly attendance registers & export
- `/la/units`: Stake ward and branch management
- `/la/users`: Leader and administrator user provisioning
- `/la/settings`: Stake configuration & Lagos timezone defaults
- `/la/audit-logs`: Append-only security audit log
