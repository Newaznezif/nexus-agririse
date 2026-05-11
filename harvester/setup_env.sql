-- SQL to create the environmental_data table in Supabase
-- Run this in the Supabase SQL Editor

CREATE TABLE IF NOT EXISTS environmental_data (
    id BIGSERIAL PRIMARY KEY,
    location_name TEXT NOT NULL,
    date DATE NOT NULL,
    rainfall_mm DECIMAL(10, 2),
    soil_moisture_pct DECIMAL(10, 2),
    temp_max DECIMAL(10, 2),
    ndvi_index DECIMAL(10, 3),
    climate_risk_score INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(location_name, date)
);

-- Enable RLS
ALTER TABLE environmental_data ENABLE ROW LEVEL SECURITY;

-- Create policy for service role
CREATE POLICY "Service role can manage environmental data" ON environmental_data
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
