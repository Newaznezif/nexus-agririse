import os
import httpx
import asyncio
from supabase import create_client, Client

async def run_checks():
    print("=== Nexus AgriRise Pre-Flight Check ===")
    
    # 1. Environment Variables
    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SERVICE_ROLE")
    google_api_key = os.environ.get("GOOGLE_API_KEY")
    
    print(f"Checking SUPABASE_URL: {'OK' if supabase_url else 'MISSING'}")
    print(f"Checking SUPABASE_KEY: {'OK' if supabase_key else 'MISSING'}")
    print(f"Checking GOOGLE_API_KEY: {'OK' if google_api_key else 'MISSING'}")
    
    if not supabase_url or not supabase_key:
        print("CRITICAL: Supabase credentials missing. Aborting.")
        exit(1)
        
    # Clean URL
    supabase_url = supabase_url.rstrip('/')
        
    # 2. Supabase Connectivity & Schema Validation
    print("\n--- Testing Supabase Connection ---")
    try:
        supabase: Client = create_client(supabase_url, supabase_key)
        
        # Check market_intelligence table
        try:
            res = supabase.table("market_intelligence").select("id").limit(1).execute()
            print("Table 'market_intelligence': ACCESSIBLE")
        except Exception as e:
            print(f"Table 'market_intelligence' ERROR: {e}")
            
        # Check unified_market_intel view
        try:
            res = supabase.table("unified_market_intel").select("*").limit(1).execute()
            print("View 'unified_market_intel': ACCESSIBLE")
            if res.data:
                print("View 'unified_market_intel': CONTAINS DATA")
            else:
                print("View 'unified_market_intel': EMPTY (Awaiting Harvest)")
        except Exception as e:
            print(f"View 'unified_market_intel' ERROR: {e}")
            print("-> Fix: Run setup scripts or recreate_view.sql in Supabase SQL Editor.")
            
    except Exception as e:
        print(f"Supabase Connection FAILED: {e}")
        
    # 3. Gemini API Connectivity
    if google_api_key:
        print("\n--- Testing Gemini API Connection ---")
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash?key={google_api_key}"
        try:
            async with httpx.AsyncClient() as client:
                res = await client.get(url, timeout=10.0)
                if res.status_code == 200:
                    print("Gemini API: CONNECTED (Model exists)")
                else:
                    print(f"Gemini API WARNING: Status {res.status_code} - {res.text}")
        except Exception as e:
            print(f"Gemini API Request FAILED: {e}")
            
    print("=======================================\n")

if __name__ == "__main__":
    asyncio.run(run_checks())
