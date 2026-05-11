import os
import json
import asyncio
from datetime import datetime
import google.generativeai as genai
from supabase import create_client, Client

# --- Configuration ---
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY")

if not SUPABASE_URL or not SUPABASE_KEY or not GOOGLE_API_KEY:
    print("Error: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and GOOGLE_API_KEY must be set.")
    exit(1)

# Initialize Supabase
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Initialize Gemini
genai.configure(api_key=GOOGLE_API_KEY)
model = genai.GenerativeModel(
    model_name="gemini-1.5-flash",
    system_instruction="You are a Senior African Agribusiness Analyst. Your goal is to identify arbitrage windows and supply chain risks across Ethiopia, Rwanda, and the Central African Republic. Provide actionable, high-level intelligence for traders and investors."
)

async def generate_market_intelligence():
    print("Generating AI Market Intelligence...")
    
    # 1. Query the latest data from the unified_market_intel view
    try:
        # Fetch the most recent records from the view
        res = supabase.table("unified_market_intel").select("*").limit(20).execute()
        market_data = res.data
        if not market_data:
            print("No market data found for analysis.")
            return
            
        # 2. Assemble Context
        data_summary = json.dumps(market_data, indent=2)
        current_date = datetime.now().strftime("%B %Y")
        
        prompt = f"""
        Current Date: {current_date}
        Context: The year is 2026. AfCFTA is progressing, but fuel costs remain high across East and Central Africa.
        
        Data Table (Unified Market Intelligence):
        {data_summary}
        
        Task: Analyze the data above for arbitrage opportunities and climate-related supply risks.
        
        Requirements:
        1. Identify price gaps between regions for the same commodity.
        2. Evaluate the impact of Climate Risk Scores and NDVI health on future pricing.
        3. Output a strict JSON object for EACH unique commodity found in the data.
        
        JSON Format:
        [
          {{
            "commodity_name": "string",
            "summary": "A 2-sentence market overview.",
            "arbitrage_alert": "Specific profit gap between two countries in $/MT.",
            "risk_factor": "Analysis of the Climate Risk Score vs. Price Trend.",
            "recommendation": "Buy/Sell/Hold style action with brief reasoning."
          }}
        ]
        """
        
        # 3. Call Gemini 1.5 Flash
        response = model.generate_content(prompt)
        
        # Clean response text (remove markdown code blocks if present)
        response_text = response.text.replace("```json", "").replace("```", "").strip()
        
        try:
            insights = json.loads(response_text)
            print(f"Generated {len(insights)} AI insights.")
            
            # 4. Upsert to ai_insights table
            upsert_payload = []
            for item in insights:
                upsert_payload.append({
                    "commodity_name": item.get("commodity_name"),
                    "summary": item.get("summary"),
                    "recommendation": item.get("recommendation"),
                    "insight_json": item,
                    "generated_at": datetime.utcnow().isoformat()
                })
            
            if upsert_payload:
                supabase.table("ai_insights").upsert(upsert_payload).execute()
                print("AI Intelligence successfully stored in Supabase.")
                
        except json.JSONDecodeError as je:
            print(f"Error parsing AI response: {je}")
            print(f"Raw response: {response_text}")

    except Exception as e:
        print(f"Error in AI Intelligence Generation: {e}")

if __name__ == "__main__":
    asyncio.run(generate_market_intelligence())
