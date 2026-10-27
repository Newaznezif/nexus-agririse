-- SQL to create the exchange_rates table and unified_market_intel view
-- Run this in the Supabase SQL Editor

-- 1. Create Exchange Rates Table
CREATE TABLE IF NOT EXISTS exchange_rates (
    currency_code TEXT PRIMARY KEY,
    rate_to_usd DECIMAL(15, 6) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Create the Normalization Engine View
-- This view joins market data, environmental data, and applies currency/unit standardization
CREATE OR REPLACE VIEW unified_market_intel AS
WITH market_standardized AS (
    SELECT 
        m.*,
        er.rate_to_usd,
        CASE 
            WHEN m.source = 'ECX' THEN (m.price / 10) * er.rate_to_usd -- Ethiopia: Quintal to MT (10 Q = 1 MT)
            WHEN m.source = 'NAEB' THEN m.price * 1000 * er.rate_to_usd -- Rwanda/CAR: KG to MT
            ELSE m.price * er.rate_to_usd
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
    -- Arbitrage Calculation: Net Opportunity Value
    -- Subtracting $150/MT "Logistics & Tariff" estimate
    (ms.price_usd_per_mt - 150) AS net_opportunity_value
FROM market_standardized ms
LEFT JOIN environmental_data e ON ms.region_market = e.location_name AND DATE(ms.timestamp) = e.date;

-- Enable RLS (Optional)
ALTER TABLE exchange_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role can manage exchange rates" ON exchange_rates
    FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- DO NOT DELETE THIS BLOCK.
-- `CREATE OR REPLACE VIEW` above keeps the object, its ACL and its reloptions, so on a
-- project where the lockdown has already been applied these two statements are already
-- satisfied. They matter wherever the view is new or has been dropped: a plain view runs as
-- its OWNER, so an unauthenticated caller would read rows that the policies on
-- market_intelligence deny directly, and a project whose default privileges hand SELECT on new
-- public objects to anon and authenticated would give the access straight back (which mechanism
-- applies here is not yet measured). Measured 2026-10-27 on
-- production: 122 rows to the anon key through the view, 0 rows through the table
-- (docs/SECURITY_REVIEW.md H-6).
--
-- Mirrors supabase/migrations/20261027000100_market_intel_view_lockdown.sql.
-- security_invoker requires PostgreSQL 15+; apply only the REVOKE below on an
-- older server. Reversal: see section 4 of that migration.
--
-- CAVEAT: a REVOKE only removes privileges held DIRECTLY by the named roles. If SELECT
-- on this view is granted to the PUBLIC pseudo-role, anon keeps inheriting it after these
-- statements and the anonymous path is not closed — PostgreSQL warns rather than errors, so
-- the script still looks like it succeeded. Check with query P8 in
-- supabase/migrations/README.md (read-only) and resolve a PUBLIC grant by explicit decision.
--
-- Run the two statements below inside an explicit transaction (begin; ... commit;). They are
-- meant to land together, and neither this script nor a dashboard paste has a verified guarantee
-- of that — see note 5e of the migration file.
-- ---------------------------------------------------------------------------
REVOKE SELECT ON public.unified_market_intel FROM anon, authenticated;
ALTER VIEW public.unified_market_intel SET (security_invoker = true);
