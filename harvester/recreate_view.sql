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
