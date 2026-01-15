#!/usr/bin/env python3
"""
SpawnPK Top Items Trade Data Fetcher (Optimized)

Fetches trade data ONLY for top 50 high-value items identified by the analytics.
This is much faster than fetching all items and should be used for frequent updates.
"""

import requests
import time
import json
import sys
from datetime import datetime, timedelta
from pathlib import Path

# Configuration
API_URL = "https://hqxg0u8s64.execute-api.ca-central-1.amazonaws.com/Production/tradingpost"
RATE_LIMIT_DELAY = 0.1  # 100ms = 10 req/sec
MAX_PAGES_PER_ITEM = 100
MAX_DAYS_HISTORY = 90

# File paths
SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
DATA_DIR = PROJECT_ROOT / "data"
TOP_ITEMS_FILE = DATA_DIR / "top_items.json"
OUTPUT_FILE = DATA_DIR / "trade_cache.json"


class OptimizedTradeDataFetcher:
    """Fetches trade data only for high-value items."""

    def __init__(self):
        self.last_request_time = 0
        self.delay = RATE_LIMIT_DELAY

    def throttle(self):
        """Rate limiting - wait between requests."""
        elapsed = time.time() - self.last_request_time
        if elapsed < self.delay:
            time.sleep(self.delay - elapsed)
        self.last_request_time = time.time()

    def fetch_item_trades(self, item_name, max_pages=MAX_PAGES_PER_ITEM, max_days=MAX_DAYS_HISTORY):
        """
        Fetch all trades for a specific item.

        Args:
            item_name: Name of the item to fetch
            max_pages: Maximum number of pages to fetch
            max_days: Maximum age of trades to fetch (in days)

        Returns:
            List of trade records
        """
        all_trades = []
        page = 1
        cutoff_date = datetime.now() - timedelta(days=max_days)

        print(f"  Fetching {item_name}...", end=" ", flush=True)

        while page <= max_pages:
            self.throttle()

            try:
                params = {
                    "search_text": item_name,
                    "page": page
                }

                response = requests.get(API_URL, params=params, timeout=10)

                if response.status_code != 200:
                    print(f"❌ HTTP {response.status_code}")
                    break

                data = response.json()

                if not data or len(data) == 0:
                    break

                page_has_recent_trades = False
                for trade in data:
                    try:
                        trade_time = datetime.strptime(trade['time'], "%Y-%m-%d %H:%M:%S.%f")

                        if trade_time >= cutoff_date:
                            page_has_recent_trades = True
                            all_trades.append(trade)
                    except (ValueError, KeyError):
                        all_trades.append(trade)
                        page_has_recent_trades = True

                if not page_has_recent_trades:
                    print(f"✓ {len(all_trades)} trades (stopped at {max_days}d cutoff)")
                    return all_trades

                page += 1

            except requests.exceptions.RequestException as e:
                print(f"❌ Error: {e}")
                break

        print(f"✓ {len(all_trades)} trades")
        return all_trades

    def load_top_items(self):
        """
        Load top items list from JSON file.

        Returns:
            List of top item names
        """
        if not TOP_ITEMS_FILE.exists():
            print(f"❌ Error: {TOP_ITEMS_FILE} not found!")
            print("   Run trade_economics_analysis.py first to generate the top items list.")
            sys.exit(1)

        with open(TOP_ITEMS_FILE, 'r') as f:
            data = json.load(f)
            return data['top_items']

    def fetch_all_trades(self):
        """
        Fetch trades for top items only.

        Returns:
            Dictionary with metadata and all trade data
        """
        item_names = self.load_top_items()
        total_items = len(item_names)

        print(f"\n{'='*70}")
        print(f"SpawnPK Optimized Trade Data Fetcher")
        print(f"{'='*70}")
        print(f"Fetching TOP {total_items} HIGH-VALUE items only")
        print(f"Rate limit: {1/self.delay:.1f} req/sec")
        print(f"Estimated time: {(total_items * 3 * self.delay / 60):.1f} minutes (avg)")
        print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"{'='*70}\n")

        all_trades = []
        items_fetched = 0
        items_with_trades = 0

        for i, item_name in enumerate(item_names, 1):
            print(f"[{i:3d}/{total_items}]", end=" ")

            trades = self.fetch_item_trades(item_name)
            all_trades.extend(trades)

            items_fetched += 1
            if len(trades) > 0:
                items_with_trades += 1

        print(f"\n{'='*70}")
        print(f"Fetch Complete")
        print(f"{'='*70}")
        print(f"Items processed: {items_fetched}/{total_items}")
        print(f"Items with trades: {items_with_trades}")
        print(f"Total trades fetched: {len(all_trades)}")
        print(f"Completed: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"{'='*70}\n")

        # Create output data structure
        output_data = {
            "metadata": {
                "last_updated": datetime.now().isoformat(),
                "total_trades": len(all_trades),
                "items_processed": items_fetched,
                "items_with_trades": items_with_trades,
                "source": "GitHub Actions (Optimized - Top Items Only)",
                "api_url": API_URL,
                "optimization": f"Fetched top {total_items} items only"
            },
            "trades": all_trades
        }

        return output_data

    def save_to_file(self, data):
        """Save trade data to JSON file."""
        OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)

        with open(OUTPUT_FILE, 'w') as f:
            json.dump(data, f, indent=2)

        file_size = OUTPUT_FILE.stat().st_size / 1024  # KB
        print(f"✓ Saved to {OUTPUT_FILE.relative_to(PROJECT_ROOT)}")
        print(f"  File size: {file_size:.1f} KB\n")


def main():
    """Main entry point."""
    try:
        fetcher = OptimizedTradeDataFetcher()

        # Fetch trade data for top items
        data = fetcher.fetch_all_trades()

        # Save to file
        fetcher.save_to_file(data)

        print("✓ Optimized trade data update complete!")
        sys.exit(0)

    except FileNotFoundError as e:
        print(f"❌ Error: Could not find required file: {e}")
        sys.exit(1)

    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
