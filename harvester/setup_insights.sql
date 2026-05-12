-- SQL to create the ai_insights table in Supabase
-- Run this in the Supabase SQL Editor

CREATE TABLE IF NOT EXISTS insights (
    id BIGSERIAL PRIMARY KEY,
    summary TEXT NOT NULL,
    risk_level TEXT,
    trend TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Enable RLS
ALTER TABLE insights ENABLE ROW LEVEL SECURITY;

-- Create policy for service role
CREATE POLICY "Service role can manage insights" ON insights
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
