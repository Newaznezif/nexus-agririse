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
