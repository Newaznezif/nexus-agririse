import asyncio
import os
import json
import re
from datetime import datetime
from playwright.async_api import async_playwright
from playwright_stealth import stealth_async
from supabase import create_client, Client

# --- Configuration ---
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.")
    exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

async def upsert_data(data_list):
    """Upserts a list of dictionaries into the market_intelligence table."""
    if not data_list:
        return
    
    print(f"Upserting {len(data_list)} records to Supabase...")
    try:
        response = supabase.table("market_intelligence").upsert(data_list).execute()
        print("Upsert successful.")
    except Exception as e:
        print(f"Supabase Upsert Error: {e}")

def safe_float(value):
    try:
        # Remove commas, currency symbols, and other non-numeric chars except period
        clean_value = "".join(c for c in value if c.isdigit() or c == '.')
        return float(clean_value) if clean_value else 0.0
    except:
        return 0.0

async def scrape_ecx(page):
    """Scrapes Ethiopia Commodity Exchange (ECX) market data."""
    print("Navigating to ECX Market Data...")
    
    max_retries = 2
    for attempt in range(max_retries):
        try:
            if attempt > 0:
                print(f"ECX Retry {attempt}/{max_retries - 1}. Increasing viewport and waiting 30s...")
                await asyncio.sleep(30)
                await page.set_viewport_size({"width": 1920, "height": 1080})
                
            # Increased timeout to 120s for slow government portal
            await page.goto("https://www.ecx.com.et/Pages/MarketDataPage.aspx", timeout=120000)
            await page.wait_for_load_state("networkidle")
            
            # ECX often uses complex table structures or iframes. 
            await page.wait_for_selector("table", timeout=60000)
            
            records = []
            rows = await page.locator("table tr").all()
            
            for row in rows:
                cells = await row.locator("td").all_inner_texts()
                if len(cells) >= 5:
                    records.append({
                        "commodity_name": cells[0].strip(),
                        "grade": cells[1].strip(),
                        "region_market": cells[2].strip(),
                        "price": safe_float(cells[4]),
                        "volume": safe_float(cells[5]) if len(cells) > 5 else 0.0,
                        "timestamp": datetime.utcnow().isoformat(),
                        "source": "ECX"
                    })
            
            if records:
                return records
            else:
                print(f"ECX table found but no records parsed on attempt {attempt + 1}.")
                
        except Exception as e:
            print(f"ECX Scraping Error (Attempt {attempt + 1}): {e}")
            
    return []

async def scrape_naeb(page):
    """Scrapes Rwanda NAEB price reports."""
    print("Navigating to NAEB Rwanda...")
    try:
        await page.goto("https://www.naeb.gov.rw/", timeout=120000)
        await page.wait_for_load_state("networkidle")
        
        # NAEB often has a "Market Intelligence" or "Reports" section.
        # Fixed: Removed await from locator creation and .first is a property in Python Playwright.
        price_link = page.get_by_role("link", name=re.compile("Price|Report|Market", re.IGNORECASE)).first
        
        if await price_link.count() > 0:
            await price_link.click()
            await page.wait_for_load_state("networkidle")
        
        records = []
        # Target table structure
        await page.wait_for_selector("table", timeout=20000)
        rows = await page.locator("table tr").all()
        
        for row in rows:
            cells = await row.locator("td").all_inner_texts()
            if len(cells) >= 3:
                records.append({
                    "commodity_name": cells[0].strip(),
                    "price": safe_float(cells[1]),
                    "volume": safe_float(cells[2]),
                    "grade": cells[3].strip() if len(cells) > 3 else "Standard",
                    "region_market": "Rwanda National",
                    "timestamp": datetime.utcnow().isoformat(),
                    "source": "NAEB"
                })
        
        return records
    except Exception as e:
        print(f"NAEB Scraping Error: {e}")
        return []

async def run_harvester():
    async with async_playwright() as p:
        print("Launching stealth browser...")
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        page = await context.new_page()
        await stealth_async(page)
        
        # Execute Scraping Tasks
        ecx_data = await scrape_ecx(page)
        naeb_data = await scrape_naeb(page)
        
        combined_data = ecx_data + naeb_data
        
        if combined_data:
            await upsert_data(combined_data)
        else:
            print("No data collected during this run.")
            
        await browser.close()
        print("Harvester run complete.")

if __name__ == "__main__":
    asyncio.run(run_harvester())
