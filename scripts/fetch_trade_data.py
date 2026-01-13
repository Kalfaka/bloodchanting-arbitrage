#!/usr/bin/env python3
"""
SpawnPK Trade Data Fetcher for GitHub Actions

Fetches trade data for all items in the shop JSON files and saves to a static
cache file. Designed to run on GitHub Actions hourly to keep data fresh.
"""

import requests
import time
import json
import sys
from datetime import datetime
from pathlib import Path

# Configuration
API_URL = "https://hqxg0u8s64.execute-api.ca-central-1.amazonaws.com/Production/tradingpost"
RATE_LIMIT_DELAY = 0.1  # 100ms = 10 req/sec (tested safe for direct API access)
MAX_PAGES_PER_ITEM = 5  # Maximum pages to fetch per item

# File paths
SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
DATA_DIR = PROJECT_ROOT / "data"
BLOOD_SHARD_SHOP = DATA_DIR / "blood_shard_shop.json"
BLOOD_SYNTHESIS_SHOP = DATA_DIR / "blood_synthesis_shop.json"
OUTPUT_FILE = DATA_DIR / "trade_cache.json"


class TradeDataFetcher:
    """Fetches trade data from SpawnPK API."""

    def __init__(self):
        self.last_request_time = 0
        self.delay = RATE_LIMIT_DELAY

    def throttle(self):
        """Rate limiting - wait between requests."""
        elapsed = time.time() - self.last_request_time
        if elapsed < self.delay:
            time.sleep(self.delay - elapsed)
        self.last_request_time = time.time()

    def fetch_item_trades(self, item_name, max_pages=MAX_PAGES_PER_ITEM):
        """
        Fetch all trades for a specific item.

        Args:
            item_name: Name of the item to fetch
            max_pages: Maximum number of pages to fetch

        Returns:
            List of trade records
        """
        all_trades = []
        page = 1

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

                # Empty array means no more data
                if not data or len(data) == 0:
                    break

                all_trades.extend(data)
                page += 1

            except requests.exceptions.RequestException as e:
                print(f"❌ Error: {e}")
                break

        print(f"✓ {len(all_trades)} trades")
        return all_trades

    def load_shop_items(self):
        """
        Load all item names from shop configuration files.

        Returns:
            Set of unique item names
        """
        item_names = set()

        # Load Blood Shard Shop
        with open(BLOOD_SHARD_SHOP, 'r') as f:
            blood_shard_data = json.load(f)
            for item in blood_shard_data['items']:
                item_names.add(item['item_name'])

        # Load Blood Synthesis Shop
        with open(BLOOD_SYNTHESIS_SHOP, 'r') as f:
            blood_synthesis_data = json.load(f)
            for item in blood_synthesis_data['items']:
                item_names.add(item['item_name'])

        # Add Blood diamonds (special item, ID: 6643) - plural form matches API
        item_names.add('Blood diamonds')

        return sorted(item_names)

    def fetch_all_trades(self):
        """
        Fetch trades for all shop items.

        Returns:
            Dictionary with metadata and all trade data
        """
        item_names = self.load_shop_items()
        total_items = len(item_names)

        print(f"\n{'='*70}")
        print(f"SpawnPK Trade Data Fetcher")
        print(f"{'='*70}")
        print(f"Items to fetch: {total_items}")
        print(f"Rate limit: {1/self.delay:.1f} req/sec")
        print(f"Estimated time: {(total_items * MAX_PAGES_PER_ITEM * self.delay / 60):.1f} minutes (max)")
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
                "source": "GitHub Actions",
                "api_url": API_URL
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
        fetcher = TradeDataFetcher()

        # Fetch all trade data
        data = fetcher.fetch_all_trades()

        # Save to file
        fetcher.save_to_file(data)

        print("✓ Trade data update complete!")
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
