# Nexus Agririse

A modern Next.js web application for Nexus Agririse, designed to provide a clean, secure UI for agricultural management and analytics.

## Project overview

This repository includes a TypeScript-based Next.js app with:
- App Router structure under `app/`
- Shared UI components in `components/`
- Custom hooks in `hooks/`
- Utility helpers in `lib/`
- API integration in `services/api.ts`
- Strong typing support in `types/`

## Quick start

Install dependencies and run the local dev server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Available scripts

- `npm run dev` - start development server
- `npm run build` - build production assets
- `npm run start` - run production server
- `npm run lint` - lint codebase

## Recommended workflow

1. Create a feature branch for each change.
2. Keep UI and logic modular under `components/` and `services/`.
3. Use `hooks/` for shared application behavior.
4. Add type definitions to `types/` for new data models.

## Repository structure

- `app/` - Next.js pages and routing
- `components/` - reusable UI components
- `hooks/` - custom React hooks
- `lib/` - helper utilities
- `public/` - static assets
- `services/` - API request logic
- `types/` - TypeScript types and interfaces

## Contributing

Contributions are welcome. Open a pull request with a clear description of your change and include any relevant testing details.

## License

This project is licensed under the MIT License.
