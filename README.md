# Nexus AgriRise Africa 🌍🚀

AI-powered Agribusiness Intelligence System for Africa. This platform empowers agribusinesses, NGOs, and regional trade organizations with data-driven insights to accelerate agricultural growth and cross-border trade.

## 🏗️ Architecture Summary

- **Framework**: Next.js 14+ (App Router)
- **Styling**: Tailwind CSS
- **Database & Auth**: Supabase
- **AI Engine**: OpenAI (GPT-4o-mini)
- **Intelligence**: Regional Comparison Module & PDF Export System

## 🚀 Quick Start Guide

### 1. Prerequisites
- Node.js 18.x or higher
- npm 9.x or higher
- [Supabase Account](https://supabase.com)
- [OpenAI API Key](https://platform.openai.com)

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
**Required Variables:**
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `OPENAI_API_KEY`

### 4. Database Setup
Ensure your Supabase project has the following tables:
- `datasets`: `id, user_id, name, type, file_url, country, created_at`
- `insights`: `id, user_id, dataset_id, summary, risk_level, trend, created_at`

### 5. Start Development
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000)

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
- `/services`: API and business logic (OpenAI, Supabase)
- `/context`: Global state (Auth, Demo Mode)
- `/types`: TypeScript definitions
- `/utils`: Helper functions

## 📜 License
MIT License.
