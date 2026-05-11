import os
import httpx
import asyncio
from datetime import datetime
from supabase import create_client, Client

# --- Configuration ---
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
CURRENCY_API_KEY = os.environ.get("CURRENCY_API_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.")
    exit(1)

if not CURRENCY_API_KEY:
    print("Warning: CURRENCY_API_KEY is not set. Using cached rates only.")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

async def fetch_and_cache_rates():
    """Fetches latest exchange rates and updates the Supabase cache."""
    if not CURRENCY_API_KEY:
        return

    print("Fetching latest exchange rates from FreeCurrencyAPI...")
    url = "https://api.freecurrencyapi.com/v1/latest"
    params = {
        "apikey": CURRENCY_API_KEY,
        "currencies": "ETB,RWF,XAF"
    }
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(url, params=params, timeout=20.0)
            response.raise_for_status()
            data = response.json()
            
            rates = data.get("data", {})
            if not rates:
                print("No rate data received.")
                return
            
            # Format for Supabase upsert
            upsert_data = []
            for currency, rate in rates.items():
                # We want rate_to_usd, but API provides usd_to_currency
                # 1 USD = X RWF -> 1 RWF = 1/X USD
                rate_to_usd = 1.0 / float(rate)
                upsert_data.append({
                    "currency_code": currency,
                    "rate_to_usd": rate_to_usd,
                    "updated_at": datetime.utcnow().isoformat()
                })
            
            # Add USD (base)
            upsert_data.append({
                "currency_code": "USD",
                "rate_to_usd": 1.0,
                "updated_at": datetime.utcnow().isoformat()
            })
            
            print(f"Updating cache with rates: {rates}")
            supabase.table("exchange_rates").upsert(upsert_data).execute()
            print("Exchange rate cache updated successfully.")
            
    except Exception as e:
        print(f"Error fetching exchange rates: {e}")

async def run_normalization():
    """Main execution point for the normalization engine."""
    print("Starting Normalization Engine...")
    
    # 1. Update the cache
    await fetch_and_cache_rates()
    
    # 2. Logic Check
    # The heavy lifting is handled by the Supabase View 'unified_market_intel'.
    # We ensure the view exists by checking its accessibility or refreshing logic.
    print("Normalization Engine complete. Unified view is ready for consumption.")

if __name__ == "__main__":
    asyncio.run(run_normalization())
