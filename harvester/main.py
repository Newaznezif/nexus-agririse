import asyncio
import os
import sys
import json
import re
from datetime import datetime
from playwright.async_api import async_playwright
# pyrefly: ignore [missing-import]
from playwright_stealth import stealth_async
# pyrefly: ignore [missing-import]
from supabase import create_client, Client

# --- Configuration ---
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.", file=sys.stderr)
    sys.exit(1)

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
        print(f"Supabase Upsert Error: {e}", file=sys.stderr)
        raise e

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
            print(f"ECX Scraping Error (Attempt {attempt + 1}): {e}", file=sys.stderr)
            if attempt == max_retries - 1:
                raise e
            
    return []

async def scrape_naeb(page):
    """Scrapes Rwanda NAEB price reports with retries and robust timeouts."""
    print("Navigating to NAEB Rwanda...")
    max_retries = 3
    for attempt in range(max_retries):
        try:
            if attempt > 0:
                print(f"NAEB Retry {attempt}/{max_retries - 1}. Waiting 10s...")
                await asyncio.sleep(10)
                
            await page.goto("https://www.naeb.gov.rw/", timeout=60000)
            await page.wait_for_load_state("networkidle", timeout=60000)
            
            # NAEB often has a "Market Intelligence" or "Reports" section.
            price_link = page.get_by_role("link", name=re.compile("Price|Report|Market", re.IGNORECASE)).first
            
            if await price_link.count() > 0:
                await price_link.click(timeout=60000)
                await page.wait_for_load_state("networkidle", timeout=60000)
            
            records = []
            # Target table structure
            await page.wait_for_selector("table", timeout=60000)
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
            print(f"NAEB Scraping Error (Attempt {attempt + 1}): {e}", file=sys.stderr)
            if attempt == max_retries - 1:
                raise e
                
    return []

async def run_harvester():
    errors = []
    ecx_data = []
    naeb_data = []
    
    async with async_playwright() as p:
        print("Launching stealth browser...")
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        page = await context.new_page()
        page.set_default_timeout(60000)
        page.set_default_navigation_timeout(60000)
        await stealth_async(page)
        
        # Execute Scraping Tasks
        try:
            ecx_data = await scrape_ecx(page)
        except Exception as e:
            print(f"WARNING: ECX Scraping failed critically but is being skipped gracefully: {e}")
            errors.append(e)
            
        try:
            naeb_data = await scrape_naeb(page)
        except Exception as e:
            print(f"WARNING: NAEB Scraping failed critically but is being skipped gracefully: {e}")
            errors.append(e)
            
        combined_data = ecx_data + naeb_data
        
        if combined_data:
            try:
                await upsert_data(combined_data)
            except Exception as e:
                print(f"Failed to upsert data to database: {e}", file=sys.stderr)
                raise e
        else:
            print("No data collected during this run.")
            if errors:
                raise Exception("Pipeline failed: no data collected due to scraper errors.")
            
        await browser.close()
        
    # Only raise failure if NO data source succeeded (i.e. combined_data is empty and errors occurred)
    # If combined_data is not empty (at least one source succeeded), we exit with 0.
    if not combined_data and errors:
        raise Exception(f"Pipeline failed critically with {len(errors)} error(s) and zero data collected.")
    
    if errors:
        print(f"Pipeline finished with some non-fatal warnings: {len(errors)} error(s) occurred but ignored because other sources succeeded.")
        
    print("Harvester run complete.")

if __name__ == "__main__":
    try:
        asyncio.run(run_harvester())
    except Exception as e:
        print(f"Fatal error in harvester pipeline: {e}", file=sys.stderr)
        sys.exit(1)
