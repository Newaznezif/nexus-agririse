-- SQL to create the market_intelligence table in Supabase
-- Run this in the Supabase SQL Editor

CREATE TABLE IF NOT EXISTS market_intelligence (
    id BIGSERIAL PRIMARY KEY,
    commodity_name TEXT NOT NULL,
    price DECIMAL(15, 2),
    volume DECIMAL(15, 2),
    grade TEXT,
    region_market TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    source TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Enable RLS (Optional, but recommended)
ALTER TABLE market_intelligence ENABLE ROW LEVEL SECURITY;

-- Create policy for service role to manage data
CREATE POLICY "Service role can manage data" ON market_intelligence
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
