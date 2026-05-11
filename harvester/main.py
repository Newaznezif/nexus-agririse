import asyncio
import os
import json
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

async def scrape_ecx(page):
    """Scrapes Ethiopia Commodity Exchange (ECX) market data."""
    print("Navigating to ECX Market Data...")
    try:
        await page.goto("https://www.ecx.com.et/Pages/MarketDataPage.aspx", timeout=60000)
        await page.wait_for_load_state("networkidle")
        
        # ECX often uses complex table structures or iframes. 
        # We target the most likely table container.
        await page.wait_for_selector("table", timeout=30000)
        
        records = []
        # Extract rows from tables that look like data grids
        rows = await page.locator("table tr").all()
        
        for row in rows:
            cells = await row.locator("td").all_inner_texts()
            if len(cells) >= 5:
                # Common ECX Grid: Commodity, Grade, Warehouse, Year, Price, Volume
                records.append({
                    "commodity_name": cells[0].strip(),
                    "grade": cells[1].strip(),
                    "region_market": cells[2].strip(), # Warehouse usually acts as region/market
                    "price": float(cells[4].replace(",", "")) if cells[4].replace(",", "").replace(".", "").isdigit() else 0,
                    "volume": float(cells[5].replace(",", "")) if len(cells) > 5 and cells[5].replace(",", "").replace(".", "").isdigit() else 0,
                    "timestamp": datetime.utcnow().isoformat(),
                    "source": "ECX"
                })
        
        return records
    except Exception as e:
        print(f"ECX Scraping Error: {e}")
        return []

async def scrape_naeb(page):
    """Scrapes Rwanda NAEB price reports."""
    print("Navigating to NAEB Rwanda...")
    try:
        await page.goto("https://www.naeb.gov.rw/", timeout=60000)
        await page.wait_for_load_state("networkidle")
        
        # NAEB often has a "Market Intelligence" or "Reports" section.
        # We look for links containing 'report' or 'price'.
        price_link = await page.get_by_role("link", name=re.compile("Price|Report|Market", re.IGNORECASE)).first()
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
                    "price": float(cells[1].replace(",", "")) if cells[1].replace(",", "").replace(".", "").isdigit() else 0,
                    "volume": float(cells[2].replace(",", "")) if len(cells) > 2 and cells[2].replace(",", "").replace(".", "").isdigit() else 0,
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
    import re
    asyncio.run(run_harvester())
