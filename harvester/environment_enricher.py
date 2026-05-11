import os
import httpx
import asyncio
from datetime import datetime, timedelta
from supabase import create_client, Client

# --- Configuration ---
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.")
    exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Location Mapping (Coordinates)
LOCATIONS = {
    "Addis Ababa": {"lat": 9.03, "lon": 38.74},
    "Bahir Dar": {"lat": 11.59, "lon": 37.39},
    "Kigali": {"lat": -1.94, "lon": 30.06},
    "Bangui": {"lat": 4.36, "lon": 18.55},
}

async def fetch_environmental_data(location_name, lat, lon):
    """Fetches weather and agromet data from Open-Meteo."""
    print(f"Enriching data for {location_name}...")
    
    # Open-Meteo URLs
    # 1. Weather & Agromet API
    url = f"https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": lat,
        "longitude": lon,
        "daily": "precipitation_sum,temperature_2m_max,soil_moisture_0_to_10cm",
        "timezone": "auto",
        "past_days": 14,
        "forecast_days": 7
    }
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(url, params=params, timeout=30.0)
            response.raise_for_status()
            data = response.json()
            
            daily = data.get("daily", {})
            times = daily.get("time", [])
            precip = daily.get("precipitation_sum", [])
            temps = daily.get("temperature_2m_max", [])
            soil_moist = daily.get("soil_moisture_0_to_10cm", [])
            
            enriched_records = []
            
            # Monthly average rainfall placeholder (rough estimate for regional context)
            # In a production system, this would be queried from historical averages.
            MONTHLY_AVG_RAINFALL = 100.0 # mm
            
            for i in range(len(times)):
                rain = precip[i] if i < len(precip) else 0
                moist = soil_moist[i] if i < len(soil_moist) else 0
                temp = temps[i] if i < len(temps) else 0
                
                # Risk Logic
                risk_score = 1
                if moist < 0.25 and rain < (MONTHLY_AVG_RAINFALL * 0.3 / 30): # Daily threshold
                    risk_score = 8
                elif moist < 0.35:
                    risk_score = 5
                
                # NDVI Index (Mocked/Estimated as Open-Meteo doesn't provide direct satellite NDVI)
                # We simulate an index based on soil moisture and historical rainfall
                ndvi = 0.4 + (moist * 0.5) + (rain / 50.0)
                ndvi = min(max(ndvi, 0.1), 0.9) # Clamp between 0.1 and 0.9
                
                enriched_records.append({
                    "location_name": location_name,
                    "date": times[i],
                    "rainfall_mm": rain,
                    "soil_moisture_pct": moist * 100, # Convert to percentage
                    "temp_max": temp,
                    "ndvi_index": round(ndvi, 3),
                    "climate_risk_score": int(risk_score)
                })
            
            return enriched_records
            
    except Exception as e:
        print(f"Error fetching data for {location_name}: {e}")
        return []

async def run_enrichment():
    """Main function to query locations and enrich with environmental data."""
    print("Starting Environmental Enrichment...")
    
    # 1. Query unique locations from market_intelligence
    # Note: For this script, we map the intelligence data to our known coordinates.
    try:
        res = supabase.table("market_intelligence").select("region_market").execute()
        unique_markets = {row['region_market'] for row in res.data}
        print(f"Found unique markets: {unique_markets}")
    except Exception as e:
        print(f"Warning: Could not query market_intelligence: {e}")
        unique_markets = LOCATIONS.keys() # Fallback to core locations

    all_enriched_data = []
    
    for market in unique_markets:
        # Match market name to coordinates (fuzzy matching or direct mapping)
        coords = None
        for loc_name, loc_coords in LOCATIONS.items():
            if loc_name.lower() in market.lower():
                coords = loc_coords
                actual_name = loc_name
                break
        
        if coords:
            data = await fetch_environmental_data(actual_name, coords['lat'], coords['lon'])
            all_enriched_data.extend(data)
    
    if all_enriched_data:
        print(f"Upserting {len(all_enriched_data)} environmental records to Supabase...")
        try:
            supabase.table("environmental_data").upsert(all_enriched_data).execute()
            print("Enrichment complete.")
        except Exception as e:
            print(f"Supabase Upsert Error: {e}")
    else:
        print("No environmental data collected.")

if __name__ == "__main__":
    asyncio.run(run_enrichment())
