# Nexus AgriRise Africa 🌍🚀

AI-powered Agribusiness Intelligence System for Africa. This platform empowers agribusinesses, NGOs, and regional trade organizations with data-driven insights to accelerate agricultural growth and cross-border trade.

## 🏗️ Architecture Summary

- **Framework**: Next.js 16 (App Router, Turbopack)
- **Styling**: Tailwind CSS v4
- **Database & Auth**: Supabase (Postgres + RLS)
- **AI Engine**: Google Gemini (`@google/generative-ai`; reads `GEMINI_API_KEY`)
- **Intelligence**: Regional Comparison Module & PDF Export System
- **Data**: typed server-side connectors for Open-Meteo, NASA POWER, WFP/HDX, NBE, World Bank,
  NASA GIBS and geoBoundaries — see `docs/DATA_SYNC.md`

## 🚀 Quick Start Guide

### 1. Prerequisites
- Node.js 20.9 or higher (Next.js 16 requirement)
- npm 10.x or higher
- [Supabase Account](https://supabase.com)
- [Gemini API key](https://aistudio.google.com/apikey) — only for the AI insight feature; every data
  dashboard route works without it, and none of the open-data publishers needs a key.

### 2. Clone & Install
```bash
git clone https://github.com/Newaznezif/nexus-agririse.git
cd nexus-agririse
npm install
```

### 3. Environment Configuration
Copy `.env.example` to `.env.local` and fill in your credentials:
```bash
cp .env.example .env.local
```
**Required variables:**
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `GEMINI_API_KEY` (AI insights only — the code reads this exact name)

**Server-only, never browser-exposed:**
- `SUPABASE_SERVICE_ROLE_KEY` — bypasses RLS; required for the data sync
- `SYNC_SECRET` — bearer token for `POST /api/data/sync`; unset means the endpoint is closed

`NEXT_PUBLIC_*` is inlined into client code at build time, so anything set there is public.
Without the Supabase pair the app renders signed out; the data dashboards still work, because
they read publishers directly.

### 4. Database Setup
The legacy tables the app writes through are `datasets` and `insights`. The newer read-only
data layer uses the `data` schema created by `supabase/migrations/` — **not applied anywhere
yet**; read `supabase/migrations/README.md` and run its pre-flight queries first. Exact column
types for `datasets`/`insights` in production are still unverified from this machine (see
`docs/PRODUCTION_READINESS_AUDIT.md`), so check before relying on them.

### 5. Start Development
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000)

### 6. Verifying the data layer
```bash
npm run lint            # repo-wide ESLint
npm run check:data      # contract check every /api/data/* route (dev server must be running)
npm run sync:data       # trigger a sync run against a configured server (needs SYNC_SECRET)
```

## 🧪 Demo Mode
The platform includes a **Demo Mode** toggle in the dashboard header. Enabling this allows you to present the platform's capabilities using pre-loaded, investor-grade African agribusiness intelligence data, completely bypassing API and database dependencies.

## 🤝 Collaboration Workflow

We follow a strict branch-based workflow to ensure stability:

1. **main**: Production-safe code. Never commit directly.
2. **dev**: Integration branch for new features.
3. **feature/***: Dedicated branches for specific tasks (e.g., `feature/ai-engine`).

**Flow**: `feature/branch` → Pull Request → Review → Merge to `dev` → Final Verification → Merge to `main`.

## 🛠️ Project Structure
- `/app`: Route handlers and pages
- `/components`: Reusable UI components
- `/services`: API and business logic (Gemini, Supabase)
- `/context`: Global state (Auth, Demo Mode)
- `/types`: TypeScript definitions
- `/utils`: Helper functions

## 📜 License
MIT License.
