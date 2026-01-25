#!/usr/bin/env python3
"""
Generate Top Items List for Optimized Fetching

This script analyzes trade data to identify the top 25 items from each shop
(Blood Shards and Blood Synthesis Tokens) based on their conversion rates.

Selection Criteria:
- Uses 30-day window for stability and relevance
- Sorts by conversion rate (bags/shard or bags/token) - LOWER IS BETTER
- Secondary sort by volatility (coefficient of variation) - LOWER IS BETTER
- Always includes: Blood diamonds, Bloodchanting stone
"""

import json
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Tuple

# Configuration
ANALYSIS_WINDOW_DAYS = 30  # Use 30-day window for item selection
MIN_TRADES_REQUIRED = 3    # Minimum trades needed to consider an item

# File paths
SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
DATA_DIR = PROJECT_ROOT / "data"
TRADE_CACHE_FILE = DATA_DIR / "trade_cache.json"
SHARD_SHOP_FILE = DATA_DIR / "blood_shard_shop.json"
TOKEN_SHOP_FILE = DATA_DIR / "blood_synthesis_shop.json"
OUTPUT_FILE = DATA_DIR / "top_items.json"


class TopItemsGenerator:
    """Generates optimized top items list based on conversion rates."""

    def __init__(self):
        self.cutoff_date = datetime.now() - timedelta(days=ANALYSIS_WINDOW_DAYS)

    def load_data(self) -> Tuple[pd.DataFrame, Dict, Dict]:
        """Load all required data files."""
        print(f"\n{'='*80}")
        print(f"TOP ITEMS GENERATOR - Conversion Rate Analysis")
        print(f"{'='*80}")
        print(f"Analysis window: Last {ANALYSIS_WINDOW_DAYS} days")
        print(f"Selection criteria: Lowest conversion rate (bags/shard or bags/token)")
        print(f"Secondary criteria: Lowest volatility (coefficient of variation)")
        print(f"{'='*80}\n")

        # Load trade cache
        print("Loading trade data...")
        with open(TRADE_CACHE_FILE, 'r') as f:
            trade_data = json.load(f)

        # Convert to DataFrame
        df = pd.DataFrame(trade_data['trades'])
        df['time'] = pd.to_datetime(df['time'])

        print(f"  Total trades loaded: {len(df):,}")
        print(f"  Date range: {df['time'].min()} to {df['time'].max()}")

        # Load shop data
        print("\nLoading shop configurations...")
        with open(SHARD_SHOP_FILE, 'r') as f:
            shard_shop = json.load(f)
        print(f"  Blood Shard shop items: {len(shard_shop['items'])}")

        with open(TOKEN_SHOP_FILE, 'r') as f:
            token_shop = json.load(f)
        print(f"  Blood Synthesis Token shop items: {len(token_shop['items'])}")

        return df, shard_shop, token_shop

    def calculate_item_metrics(self, item_name: str, shop_cost: float,
                               all_trades: pd.DataFrame) -> Dict:
        """
        Calculate conversion rate and volatility for an item.

        Args:
            item_name: Name of the item
            shop_cost: Cost in shards or tokens
            all_trades: Full trade DataFrame

        Returns:
            Dictionary with metrics or None if insufficient data
        """
        # Filter trades for this item in the 30-day window
        item_trades = all_trades[
            (all_trades['item_name'] == item_name) &
            (all_trades['time'] >= self.cutoff_date)
        ].copy()

        if len(item_trades) < MIN_TRADES_REQUIRED:
            return None

        # Calculate price statistics (in bags)
        prices = item_trades['price'] / item_trades['amount']  # Price per item
        median_price = prices.median()
        mean_price = prices.mean()
        std_price = prices.std()

        # Calculate conversion rate (bags per shard/token)
        # Lower is better - means fewer bags to get each shard/token
        conversion_rate = median_price / shop_cost if shop_cost > 0 else float('inf')

        # Calculate volatility (coefficient of variation)
        # Lower is better - means more stable/predictable prices
        volatility = (std_price / mean_price * 100) if mean_price > 0 else 0

        return {
            'name': item_name,
            'shop_cost': shop_cost,
            'conversion_rate': conversion_rate,
            'volatility': volatility,
            'median_price': median_price,
            'trade_count': len(item_trades),
            'min_price': prices.min(),
            'max_price': prices.max()
        }

    def select_top_items(self, shop_items: List[Dict], shop_name: str,
                        all_trades: pd.DataFrame, top_n: int = 25) -> List[Dict]:
        """
        Select top N items from a shop based on conversion rate.

        Args:
            shop_items: List of shop item configurations
            shop_name: Name of the shop for logging
            all_trades: Full trade DataFrame
            top_n: Number of items to select

        Returns:
            List of top item metrics
        """
        print(f"\nAnalyzing {shop_name}...")
        print(f"  Total shop items: {len(shop_items)}")

        candidates = []

        for item in shop_items:
            item_name = item['item_name']
            shop_cost = item['value']

            metrics = self.calculate_item_metrics(item_name, shop_cost, all_trades)

            if metrics is not None:
                candidates.append(metrics)

        print(f"  Items with sufficient trade data (>={MIN_TRADES_REQUIRED} trades): {len(candidates)}")

        if len(candidates) == 0:
            print(f"  ⚠️  WARNING: No items found with sufficient trade data!")
            return []

        # Sort by conversion rate (ascending - lower is better)
        # Secondary sort by volatility (ascending - lower is better)
        candidates.sort(key=lambda x: (x['conversion_rate'], x['volatility']))

        # Take top N
        top_items = candidates[:top_n]

        print(f"  Top {len(top_items)} items selected:")
        print(f"  {'Rank':<6} {'Item Name':<40} {'Rate':<12} {'Vol%':<8} {'Trades':<8}")
        print(f"  {'-'*78}")

        for i, item in enumerate(top_items[:10], 1):  # Show top 10 in summary
            print(f"  #{i:<5} {item['name']:<40} {item['conversion_rate']:>10.2f}  {item['volatility']:>6.1f}%  {item['trade_count']:>6}")

        if len(top_items) > 10:
            print(f"  ... and {len(top_items) - 10} more items")

        return top_items

    def generate_top_items_list(self) -> Dict:
        """Generate the complete top items list."""
        # Load data
        df, shard_shop, token_shop = self.load_data()

        # Select top items from each shop
        top_shard_items = self.select_top_items(
            shard_shop['items'],
            "Blood Shard Shop",
            df,
            top_n=25
        )

        top_token_items = self.select_top_items(
            token_shop['items'],
            "Blood Synthesis Token Shop",
            df,
            top_n=25
        )

        # Combine item names
        item_names = []

        # Add shard items
        for item in top_shard_items:
            item_names.append(item['name'])

        # Add token items
        for item in top_token_items:
            item_names.append(item['name'])

        # Always include these marketplace-only items
        always_include = ['Blood diamonds', 'Bloodchanting stone']
        for item in always_include:
            if item not in item_names:
                item_names.append(item)

        # Create output structure
        output = {
            "top_items": item_names,
            "count": len(item_names),
            "metadata": {
                "generated_at": datetime.now().isoformat(),
                "analysis_window_days": ANALYSIS_WINDOW_DAYS,
                "selection_criteria": "30d conversion rate (ascending) + volatility (secondary)",
                "blood_shards_items": len(top_shard_items),
                "blood_tokens_items": len(top_token_items),
                "always_included": len(always_include),
                "min_trades_required": MIN_TRADES_REQUIRED,
                "note": "Lower conversion rate = cheaper to acquire shards/tokens = better arbitrage"
            },
            "details": {
                "blood_shards": [
                    {
                        "name": item['name'],
                        "conversion_rate": round(item['conversion_rate'], 2),
                        "volatility": round(item['volatility'], 1),
                        "trades": item['trade_count']
                    }
                    for item in top_shard_items
                ],
                "blood_tokens": [
                    {
                        "name": item['name'],
                        "conversion_rate": round(item['conversion_rate'], 2),
                        "volatility": round(item['volatility'], 1),
                        "trades": item['trade_count']
                    }
                    for item in top_token_items
                ]
            }
        }

        return output

    def save_output(self, data: Dict):
        """Save the top items list to JSON file."""
        OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)

        with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2)

        file_size = OUTPUT_FILE.stat().st_size / 1024

        print(f"\n{'='*80}")
        print(f"TOP ITEMS LIST GENERATED")
        print(f"{'='*80}")
        print(f"Output file: {OUTPUT_FILE.relative_to(PROJECT_ROOT)}")
        print(f"File size: {file_size:.1f} KB")
        print(f"Total items: {data['count']}")
        print(f"  - Blood Shard items: {data['metadata']['blood_shards_items']}")
        print(f"  - Blood Token items: {data['metadata']['blood_tokens_items']}")
        print(f"  - Always included: {data['metadata']['always_included']}")
        print(f"{'='*80}\n")

        print("✅ Top items list successfully generated!")
        print(f"   Use 'python scripts/fetch_top_items.py' to fetch trade data for these items.")


def main():
    """Main execution."""
    try:
        generator = TopItemsGenerator()
        top_items_data = generator.generate_top_items_list()
        generator.save_output(top_items_data)

    except FileNotFoundError as e:
        print(f"❌ Error: Required file not found: {e}")
        print(f"\n   Make sure you have run 'python scripts/fetch_trade_data.py' first")
        print(f"   to generate the full trade cache.")
        return 1

    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        return 1

    return 0


if __name__ == "__main__":
    exit(main())
