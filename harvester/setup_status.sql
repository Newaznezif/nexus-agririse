-- SQL to create the harvester_status table in Supabase
-- Run this in the Supabase SQL Editor to track data pipeline freshness

CREATE TABLE IF NOT EXISTS harvester_status (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Enable Row Level Security (RLS)
ALTER TABLE harvester_status ENABLE ROW LEVEL SECURITY;

-- Allow public read access (so frontend can query the last updated timestamp)
CREATE POLICY "Allow public read access to status" ON harvester_status
    FOR SELECT USING (true);

-- Allow service role (harvester pipeline) full access to manage status
CREATE POLICY "Service role can manage status" ON harvester_status
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
