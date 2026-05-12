import os
import json
import asyncio
from datetime import datetime
from google import genai
from google.genai import types
from supabase import create_client, Client

# --- Configuration ---
# Clean the URL to avoid double slashes and 404s
raw_url = os.environ.get("SUPABASE_URL")
SUPABASE_URL = raw_url.rstrip('/') if raw_url else None

# Handle potential naming variations for the service role key
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SERVICE_ROLE")
GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY")

if not SUPABASE_URL or not SUPABASE_KEY or not GOOGLE_API_KEY:
    print(f"Error: Missing environment variables. URL: {bool(SUPABASE_URL)}, KEY: {bool(SUPABASE_KEY)}, GOOGLE: {bool(GOOGLE_API_KEY)}")
    exit(1)

# Initialize Supabase
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Initialize Gemini with the new google-genai SDK
client = genai.Client(api_key=GOOGLE_API_KEY)
MODEL_ID = "gemini-1.5-flash"

async def generate_market_intelligence():
    print(f"Generating AI Market Intelligence (Modernized)... Model: {MODEL_ID}")
    
    try:
        # 1. Query the latest data from the unified_market_intel view
        print("Checking for data in 'unified_market_intel' view...")
        try:
            res = supabase.table("unified_market_intel").select("*").limit(20).execute()
            market_data = res.data
        except Exception as view_err:
            print(f"CRITICAL ERROR: Could not find or read 'unified_market_intel' view. (Error: {view_err})")
            print("Action Required: Please run 'harvester/recreate_view.sql' in your Supabase SQL Editor.")
            return

        if not market_data:
            print("Status: Unified view exists but is currently empty. No analysis to perform.")
            return
            
        # 2. Assemble Context
        data_summary = json.dumps(market_data, indent=2)
        current_date = datetime.now().strftime("%B %Y")
        
        prompt = f"""
        Current Date: {current_date}
        Context: The year is 2026. AfCFTA is progressing, but fuel costs remain high across East and Central Africa.
        
        Data Table (Unified Market Intelligence):
        {data_summary}
        
        Task: Analyze the data for arbitrage windows and climate-related supply risks.
        
        Requirements:
        1. Identify price gaps between regions.
        2. Evaluate Climate Risk Scores and NDVI health.
        3. Output a strict JSON object for EACH unique commodity found.
        
        JSON Format (Required Keys):
        [
          {{
            "commodity_name": "string",
            "summary": "2-sentence market overview.",
            "risk_level": "Low, Medium, or High based on data.",
            "trend": "Bullish, Bearish, or Neutral based on arbitrage and risk."
          }}
        ]
        """
        
        # 3. Call Gemini using the new SDK
        print("Calling Gemini 1.5 Flash...")
        config = types.GenerateContentConfig(
            system_instruction="You are a Senior African Agribusiness Analyst. Identify arbitrage windows and supply chain risks."
        )
        
        response = client.models.generate_content(
            model=MODEL_ID,
            contents=prompt,
            config=config
        )
        
        # Logging the raw response for debugging
        print(f"Gemini Response: {response.text}")
        
        # Clean response text
        response_text = response.text.replace("```json", "").replace("```", "").strip()
        
        try:
            insights = json.loads(response_text)
            print(f"Generated {len(insights)} AI insights.")
            
            # 4. Insert to insights table
            insert_payload = []
            for item in insights:
                insert_payload.append({
                    "summary": item.get("summary"),
                    "risk_level": item.get("risk_level"),
                    "trend": item.get("trend"),
                    "created_at": datetime.utcnow().isoformat()
                })
            
            if insert_payload:
                print(f"Inserting into 'insights' table...")
                try:
                    # Target the 'insights' table as requested
                    result = supabase.table("insights").insert(insert_payload).execute()
                    print("AI Intelligence successfully stored in insights table.")
                except Exception as db_err:
                    print(f"Supabase Insertion Error: {db_err}")
                    # Log more details if possible
                    if hasattr(db_err, 'message'):
                        print(f"Message: {db_err.message}")
                
        except json.JSONDecodeError as je:
            print(f"Error parsing AI response: {je}")

    except Exception as e:
        print(f"Error in AI Intelligence Generation: {e}")

if __name__ == "__main__":
    asyncio.run(generate_market_intelligence())
