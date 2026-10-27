-- SQL to recreate the unified_market_intel view
-- This ensures the view correctly joins market data, environmental data, and exchange rates

DROP VIEW IF EXISTS unified_market_intel;

CREATE OR REPLACE VIEW unified_market_intel AS
WITH market_standardized AS (
    SELECT 
        m.*,
        COALESCE(er.rate_to_usd, 0.001) as rate_to_usd, -- Use a small fallback rate if null
        CASE 
            WHEN m.source = 'ECX' THEN (m.price / 10) * COALESCE(er.rate_to_usd, 0.018) -- Ethiopia: 1 ETB approx 0.018 USD
            WHEN m.source = 'NAEB' THEN m.price * 1000 * COALESCE(er.rate_to_usd, 0.00078) -- Rwanda: 1 RWF approx 0.00078 USD
            ELSE m.price * COALESCE(er.rate_to_usd, 1.0)
        END AS price_usd_per_mt
    FROM market_intelligence m
    LEFT JOIN exchange_rates er ON (
        CASE 
            WHEN m.source = 'ECX' THEN 'ETB'
            WHEN m.source = 'NAEB' THEN 'RWF'
            ELSE 'USD'
        END = er.currency_code
    )
)
SELECT 
    ms.*,
    e.rainfall_mm,
    e.soil_moisture_pct,
    e.temp_max,
    e.ndvi_index,
    e.climate_risk_score,
    -- Arbitrage Calculation
    (ms.price_usd_per_mt - 150) AS net_opportunity_value
FROM market_standardized ms
LEFT JOIN environmental_data e ON (
    ms.region_market = e.location_name 
    AND DATE(ms.timestamp) = e.date
);

-- Note: If environmental_data or market_intelligence don't exist yet, 
-- make sure to run their respective setup scripts first.

-- ---------------------------------------------------------------------------
-- DO NOT DELETE THIS BLOCK.
-- The DROP on line 4 means what gets created above is a NEW object with a fresh ACL and
-- fresh reloptions, so neither half of the lockdown in
-- supabase/migrations/20261027000100_market_intel_view_lockdown.sql survives this script by
-- itself — a project whose default privileges hand SELECT on new public objects to anon and
-- authenticated would give the access straight back, and which mechanism applies here is not
-- yet measured. Running this script without these two statements re-opens the anonymous read
-- path recorded as H-6 in docs/SECURITY_REVIEW.md: an unauthenticated caller was measured on
-- 2026-10-27 reading all 122 scraped rows through this view, while
-- market_intelligence itself returned zero rows to the same key. That is because
-- a plain view runs as its OWNER and skips the row policies below it.
--
-- Mirrors supabase/migrations/20261027000100_market_intel_view_lockdown.sql.
-- security_invoker requires PostgreSQL 15+; on an older server apply only the
-- REVOKE and leave the view owner-rights, since the revoke alone closes the path.
-- Reversal (deliberately re-opens H-6): see section 4 of that migration.
--
-- CAVEAT, and it is the reason the migration carries a guard and this script cannot:
-- a REVOKE only removes privileges held DIRECTLY by the named roles. If SELECT on this
-- view was granted to the PUBLIC pseudo-role, anon still inherits it after these two
-- statements and H-6 is not closed — PostgreSQL answers that REVOKE with a warning, not
-- an error, so this script appears to succeed. Check with query P8 in
-- supabase/migrations/README.md (read-only); if PUBLIC holds SELECT, that entry needs an
-- explicit reviewed decision, not a broader REVOKE here.
--
-- Run the two statements below inside an explicit transaction (begin; ... commit;). They are
-- meant to land together, and neither this script nor a dashboard paste has a verified guarantee
-- of that — see note 5e of the migration file.
-- ---------------------------------------------------------------------------
REVOKE SELECT ON public.unified_market_intel FROM anon, authenticated;
ALTER VIEW public.unified_market_intel SET (security_invoker = true);
