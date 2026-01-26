#!/usr/bin/env python3
"""
LOCAL Script 1: Fetch Trade Data with Volatility-Aware Analysis (ROBUST VERSION)

Features:
1. Controlled concurrency (50 concurrent requests)
2. Automatic retry on timeout (exponential backoff)
3. Dynamic 90-day fallback (if 0 trades in 30 days)
4. No data is lost - keeps retrying until success
5. All items included (no exclusions)
"""

import aiohttp
import asyncio
import json
import sys
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Tuple, Optional
import numpy as np

API_URL = "https://hqxg0u8s64.execute-api.ca-central-1.amazonaws.com/Production/tradingpost"
MAX_PAGES_PER_ITEM = 100
MAX_DAYS_HISTORY = 30
EXTENDED_DAYS_HISTORY = 90
MIN_TRADES_THRESHOLD = 5
INITIAL_VOLATILITY_THRESHOLD = 20.0
MAX_RETRIES = 5
INITIAL_TIMEOUT = 60
MAX_CONCURRENT_REQUESTS = 50

SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
DATA_DIR = PROJECT_ROOT / "data"
BLOOD_SHARD_SHOP = DATA_DIR / "blood_shard_shop.json"
BLOOD_SYNTHESIS_SHOP = DATA_DIR / "blood_synthesis_shop.json"
OUTPUT_TOP_ITEMS = DATA_DIR / "top_items.json"


class RobustFetcher:
    """Fetches trade data with retry logic and timeout handling."""
    
    def __init__(self):
        self.retry_stats = {"total_retries": 0, "timeout_retries": 0, "error_retries": 0}
    
    async def fetch_with_retry(self, session: aiohttp.ClientSession, item_name: str,
                               max_days: int) -> List[Dict]:
        """
        Fetch trades with automatic retry on failure.
        Keeps retrying with exponential backoff until success.
        """
        for attempt in range(MAX_RETRIES):
            timeout = INITIAL_TIMEOUT * (2 ** attempt)
            
            try:
                trades = await self._fetch_trades(session, item_name, max_days, timeout)
                return trades
            
            except asyncio.TimeoutError:
                self.retry_stats["timeout_retries"] += 1
                self.retry_stats["total_retries"] += 1
                if attempt < MAX_RETRIES - 1:
                    wait_time = min(2 ** attempt, 10)
                    await asyncio.sleep(wait_time)
                    continue
                else:
                    print(f"    ⚠️  {item_name}: Failed after {MAX_RETRIES} timeout retries")
                    return []
            
            except Exception as e:
                self.retry_stats["error_retries"] += 1
                self.retry_stats["total_retries"] += 1
                if attempt < MAX_RETRIES - 1:
                    wait_time = min(2 ** attempt, 10)
                    await asyncio.sleep(wait_time)
                    continue
                else:
                    print(f"    ⚠️  {item_name}: Failed after {MAX_RETRIES} retries: {type(e).__name__}")
                    return []
        
        return []
    
    async def _fetch_trades(self, session: aiohttp.ClientSession, item_name: str,
                           max_days: int, timeout: int) -> List[Dict]:
        """Internal fetch method."""
        all_trades = []
        page = 1
        cutoff_date = datetime.now() - timedelta(days=max_days)
        
        while page <= MAX_PAGES_PER_ITEM:
            params = {"search_text": item_name, "page": page}
            
            async with session.get(API_URL, params=params,
                                 timeout=aiohttp.ClientTimeout(total=timeout)) as response:
                if response.status != 200:
                    break
                
                data = await response.json()
                
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
                    break
                
                page += 1
        
        return all_trades


class VolatilityAwareAnalyzer:
    """Analyzes trade data with volatility-aware price determination."""
    
    def __init__(self, threshold: float = INITIAL_VOLATILITY_THRESHOLD):
        self.threshold = threshold
    
    def calculate_all_windows_at_once(self, trades: List[Dict]) -> Dict:
        """Calculate ALL time window averages in a SINGLE pass."""
        if not trades:
            return {
                '24h': {'price': 0.0, 'trades': 0},
                '7d': {'price': 0.0, 'trades': 0},
                '30d': {'price': 0.0, 'trades': 0}
            }
        
        now = datetime.now()
        cutoff_24h = now - timedelta(days=1)
        cutoff_7d = now - timedelta(days=7)
        
        prices_24h = []
        prices_7d = []
        prices_all = []
        
        for trade in trades:
            try:
                trade_time = datetime.strptime(trade['time'], "%Y-%m-%d %H:%M:%S.%f")
                amount = trade['amount']
                price = trade['price']
                
                if amount <= 0:
                    continue
                
                price_per_unit = price / amount
                
                if trade_time >= cutoff_24h:
                    prices_24h.append(price_per_unit)
                if trade_time >= cutoff_7d:
                    prices_7d.append(price_per_unit)
                prices_all.append(price_per_unit)
            
            except (ValueError, KeyError, ZeroDivisionError):
                continue
        
        avg_24h = float(np.median(prices_24h)) if len(prices_24h) >= MIN_TRADES_THRESHOLD else 0.0
        avg_7d = float(np.median(prices_7d)) if len(prices_7d) >= MIN_TRADES_THRESHOLD else 0.0
        avg_all = float(np.median(prices_all)) if len(prices_all) >= MIN_TRADES_THRESHOLD else 0.0
        
        return {
            '24h': {'price': avg_24h, 'trades': len(prices_24h)},
            '7d': {'price': avg_7d, 'trades': len(prices_7d)},
            '30d': {'price': avg_all, 'trades': len(prices_all)}
        }
    
    def calculate_volatility_aware_price(self, trades: List[Dict], item_name: str) -> Tuple[float, str, Dict]:
        """Determine the best average price using volatility-aware logic."""
        window_stats = self.calculate_all_windows_at_once(trades)
        
        avg_24h = window_stats['24h']['price']
        count_24h = window_stats['24h']['trades']
        avg_7d = window_stats['7d']['price']
        count_7d = window_stats['7d']['trades']
        avg_30d = window_stats['30d']['price']
        count_30d = window_stats['30d']['trades']
        
        if count_24h < MIN_TRADES_THRESHOLD:
            if count_7d < MIN_TRADES_THRESHOLD:
                return avg_30d, '30d (fallback)', window_stats
            else:
                return avg_7d, '7d (no recent)', window_stats
        
        if avg_30d > 0:
            diff_24h_30d = abs(avg_24h - avg_30d) / avg_30d * 100
        else:
            diff_24h_30d = 0
        
        if diff_24h_30d <= self.threshold:
            return avg_30d, '30d (stable)', window_stats
        
        if count_7d < MIN_TRADES_THRESHOLD:
            return avg_24h, '24h (volatile, no 7d)', window_stats
        
        if avg_7d > 0:
            diff_24h_7d = abs(avg_24h - avg_7d) / avg_7d * 100
        else:
            diff_24h_7d = 0
        
        if diff_24h_7d > self.threshold:
            return avg_24h, '24h (volatile spike)', window_stats
        else:
            return avg_7d, '7d (volatile stable)', window_stats


class TopItemsAnalyzer:
    """Main analyzer with controlled concurrency and 90-day fallback."""
    
    def __init__(self):
        self.analyzer = VolatilityAwareAnalyzer()
        self.fetcher = RobustFetcher()
    
    def load_shop_items(self) -> Tuple[List[Dict], List[Dict]]:
        """Load shop configurations."""
        print(f"\n{'='*80}")
        print(f"LOADING SHOP CONFIGURATIONS")
        print(f"{'='*80}")
        
        with open(BLOOD_SHARD_SHOP, 'r') as f:
            shard_shop = json.load(f)
        print(f"✓ Blood Shard Shop: {len(shard_shop['items'])} items")
        
        with open(BLOOD_SYNTHESIS_SHOP, 'r') as f:
            token_shop = json.load(f)
        print(f"✓ Blood Synthesis Token Shop: {len(token_shop['items'])} items")
        
        return shard_shop['items'], token_shop['items']
    
    async def fetch_item_with_fallback(self, session: aiohttp.ClientSession, 
                                      item_name: str, semaphore: asyncio.Semaphore) -> Tuple[str, List[Dict], str]:
        """
        Fetch item with automatic 90-day fallback if 30-day returns 0 trades.
        Uses semaphore for controlled concurrency.
        """
        async with semaphore:
            trades_30d = await self.fetcher.fetch_with_retry(session, item_name, MAX_DAYS_HISTORY)
            
            if len(trades_30d) == 0:
                print(f"  📊 {item_name}: 0 trades in 30d, extending to 90d...")
                trades_90d = await self.fetcher.fetch_with_retry(session, item_name, EXTENDED_DAYS_HISTORY)
                
                if len(trades_90d) > 0:
                    return item_name, trades_90d, '90d'
                else:
                    return item_name, [], '90d (no data)'
            
            return item_name, trades_30d, '30d'
    
    async def fetch_all_items(self, shard_items: List[Dict], token_items: List[Dict]) -> Dict:
        """Fetch trade data with controlled concurrency and 90-day fallback."""
        all_items = {}
        
        for item in shard_items:
            all_items[item['item_name']] = {
                'name': item['item_name'],
                'item_id': item['item_id'],
                'shops': ['blood_shards'],
                'shard_cost': item['value']
            }
        
        for item in token_items:
            if item['item_name'] in all_items:
                all_items[item['item_name']]['shops'].append('blood_tokens')
                all_items[item['item_name']]['token_cost'] = item['value']
            else:
                all_items[item['item_name']] = {
                    'name': item['item_name'],
                    'item_id': item['item_id'],
                    'shops': ['blood_tokens'],
                    'token_cost': item['value']
                }
        
        special_items = [
            {'name': 'Blood diamonds', 'item_id': 6643},
            {'name': 'Bloodchanting stone', 'item_id': 22108}
        ]
        
        for special in special_items:
            if special['name'] not in all_items:
                all_items[special['name']] = {
                    'name': special['name'],
                    'item_id': special['item_id'],
                    'shops': ['special']
                }
        
        total_items = len(all_items)
        print(f"\n{'='*80}")
        print(f"FETCHING TRADE DATA (ROBUST MODE)")
        print(f"{'='*80}")
        print(f"Total unique items: {total_items}")
        print(f"Concurrent requests: {MAX_CONCURRENT_REQUESTS} at a time")
        print(f"Auto-retry on timeout: YES (up to {MAX_RETRIES} attempts)")
        print(f"90-day fallback: AUTOMATIC (if 0 trades in 30d)")
        print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"{'='*80}\n")
        
        semaphore = asyncio.Semaphore(MAX_CONCURRENT_REQUESTS)
        
        async with aiohttp.ClientSession() as session:
            tasks = []
            
            for item_name, item_data in all_items.items():
                task = self.fetch_item_with_fallback(session, item_name, semaphore)
                tasks.append((item_data, task))
            
            print(f"  Launching {total_items} requests ({MAX_CONCURRENT_REQUESTS} concurrent)...\n")
            results = await asyncio.gather(*[task for _, task in tasks])
            
            all_trades = []
            fetch_results = {}
            fallback_90d = 0
            
            for (item_data, _), (item_name, trades, window) in zip(tasks, results):
                all_trades.extend(trades)
                fetch_results[item_name] = {
                    'item_data': item_data,
                    'trades': trades,
                    'trade_count': len(trades),
                    'fetch_window': window
                }
                
                if window == '90d':
                    fallback_90d += 1
                    print(f"  📊 {item_name}: {len(trades)} trades (90-day window)")
                elif window == '90d (no data)':
                    print(f"  ⚠️  {item_name}: 0 trades (even in 90 days)")
                else:
                    print(f"  ✓ {item_name}: {len(trades)} trades")
        
        print(f"\n{'='*80}")
        print(f"FETCH COMPLETE")
        print(f"{'='*80}")
        print(f"Items fetched: {total_items}")
        print(f"Items with trades: {sum(1 for r in fetch_results.values() if r['trade_count'] > 0)}")
        print(f"Items using 90-day window: {fallback_90d}")
        print(f"Total trades: {len(all_trades):,}")
        print(f"Total retries: {self.fetcher.retry_stats['total_retries']}")
        print(f"  - Timeout retries: {self.fetcher.retry_stats['timeout_retries']}")
        print(f"  - Error retries: {self.fetcher.retry_stats['error_retries']}")
        print(f"Completed: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"{'='*80}\n")
        
        return fetch_results, all_trades
    
    def calibrate_volatility_threshold(self, fetch_results: Dict) -> float:
        """Auto-calibrate volatility threshold based on data distribution."""
        print(f"\n{'='*80}")
        print(f"CALIBRATING VOLATILITY THRESHOLD")
        print(f"{'='*80}")
        
        differences = []
        
        for item_name, result in fetch_results.items():
            trades = result['trades']
            if len(trades) < MIN_TRADES_THRESHOLD:
                continue
            
            window_stats = self.analyzer.calculate_all_windows_at_once(trades)
            avg_24h = window_stats['24h']['price']
            count_24h = window_stats['24h']['trades']
            avg_30d = window_stats['30d']['price']
            
            if count_24h >= MIN_TRADES_THRESHOLD and avg_30d > 0:
                diff_pct = abs(avg_24h - avg_30d) / avg_30d * 100
                differences.append(diff_pct)
        
        if not differences:
            print("  ⚠️  Insufficient data for calibration, using default threshold")
            return INITIAL_VOLATILITY_THRESHOLD
        
        differences = np.array(differences)
        p25 = np.percentile(differences, 25)
        p50 = np.percentile(differences, 50)
        p75 = np.percentile(differences, 75)
        p90 = np.percentile(differences, 90)
        
        print(f"  Price difference distribution (24h vs 30d):")
        print(f"    25th percentile: {p25:.1f}%")
        print(f"    50th percentile: {p50:.1f}%")
        print(f"    75th percentile: {p75:.1f}%")
        print(f"    90th percentile: {p90:.1f}%")
        
        calibrated_threshold = (p75 + p90) / 2
        calibrated_threshold = max(15.0, min(30.0, calibrated_threshold))
        
        print(f"\n  ✓ Calibrated threshold: {calibrated_threshold:.1f}%")
        print(f"  Items above this threshold will use 24h/7d averages")
        print(f"  Items below this threshold will use 30d averages")
        print(f"{'='*80}\n")
        
        return calibrated_threshold
    
    def analyze_and_select_top_items(self, fetch_results: Dict) -> Tuple[List[Dict], List[Dict], Dict]:
        """Apply volatility-aware averaging and select top items."""
        print(f"\n{'='*80}")
        print(f"VOLATILITY-AWARE PRICE ANALYSIS")
        print(f"{'='*80}")
        print(f"Threshold: {self.analyzer.threshold:.1f}%")
        print(f"Minimum trades per window: {MIN_TRADES_THRESHOLD}")
        print(f"{'='*80}\n")
        
        shard_items = []
        token_items = []
        
        window_usage = {'24h': 0, '7d': 0, '30d': 0}
        items_analyzed = 0
        items_insufficient = 0
        
        for item_name, result in fetch_results.items():
            item_data = result['item_data']
            trades = result['trades']
            
            if len(trades) < MIN_TRADES_THRESHOLD:
                items_insufficient += 1
                continue
            
            items_analyzed += 1
            
            best_price, window_used, window_stats = self.analyzer.calculate_volatility_aware_price(trades, item_name)
            
            if '24h' in window_used:
                window_usage['24h'] += 1
            elif '7d' in window_used:
                window_usage['7d'] += 1
            else:
                window_usage['30d'] += 1
            
            item_result = {
                'name': item_name,
                'best_price': best_price,
                'window_used': window_used,
                'trade_count': len(trades),
                'fetch_window': result['fetch_window']
            }
            
            if 'blood_shards' in item_data.get('shops', []):
                shard_cost = item_data['shard_cost']
                conversion_rate = best_price / shard_cost if best_price > 0 else float('inf')
                item_result['conversion_rate'] = conversion_rate
                shard_items.append(item_result)
            
            if 'blood_tokens' in item_data.get('shops', []):
                token_cost = item_data['token_cost']
                conversion_rate = best_price / token_cost if best_price > 0 else float('inf')
                item_result['conversion_rate'] = conversion_rate
                token_items.append(item_result)
        
        shard_items.sort(key=lambda x: x['conversion_rate'])
        token_items.sort(key=lambda x: x['conversion_rate'])
        
        top_shard = shard_items[:25]
        top_token = token_items[:25]
        
        analysis_stats = {
            'total_analyzed': items_analyzed,
            'insufficient_data': items_insufficient,
            'window_usage': window_usage
        }
        
        print(f"Analysis Summary:")
        print(f"  Items analyzed: {items_analyzed}")
        print(f"  Items with insufficient data: {items_insufficient}")
        print(f"\n  Window Usage:")
        print(f"    24h window: {window_usage['24h']} items ({window_usage['24h']/max(1,items_analyzed)*100:.1f}%)")
        print(f"    7d window: {window_usage['7d']} items ({window_usage['7d']/max(1,items_analyzed)*100:.1f}%)")
        print(f"    30d window: {window_usage['30d']} items ({window_usage['30d']/max(1,items_analyzed)*100:.1f}%)")
        
        print(f"\n  Top Blood Shard Items (lowest conversion rate):")
        print(f"    {'Rank':<6} {'Item Name':<40} {'Rate':<12} {'Window':<20}")
        print(f"    {'-'*80}")
        for i, item in enumerate(top_shard[:10], 1):
            print(f"    #{i:<5} {item['name']:<40} {item['conversion_rate']:>10.4f}  {item['window_used']:<20}")
        if len(top_shard) > 10:
            print(f"    ... and {len(top_shard) - 10} more items")
        
        print(f"\n  Top Blood Token Items (lowest conversion rate):")
        print(f"    {'Rank':<6} {'Item Name':<40} {'Rate':<12} {'Window':<20}")
        print(f"    {'-'*80}")
        for i, item in enumerate(top_token[:10], 1):
            print(f"    #{i:<5} {item['name']:<40} {item['conversion_rate']:>10.4f}  {item['window_used']:<20}")
        if len(top_token) > 10:
            print(f"    ... and {len(top_token) - 10} more items")
        
        print(f"{'='*80}\n")
        
        return top_shard, top_token, analysis_stats
    
    def save_results(self, fetch_results: Dict, all_trades: List[Dict],
                    top_shard: List[Dict], top_token: List[Dict], analysis_stats: Dict):
        """Save top_items.json file."""
        print(f"\n{'='*80}")
        print(f"SAVING RESULTS")
        print(f"{'='*80}")

        item_names = []
        for item in top_shard:
            item_names.append(item['name'])
        for item in top_token:
            item_names.append(item['name'])
        
        for special in ['Blood diamonds', 'Bloodchanting stone']:
            if special not in item_names:
                item_names.append(special)
        
        top_items_data = {
            "top_items": item_names,
            "count": len(item_names),
            "metadata": {
                "generated_at": datetime.now().isoformat(),
                "analysis_window_days": MAX_DAYS_HISTORY,
                "fallback_window_days": EXTENDED_DAYS_HISTORY,
                "selection_criteria": "Volatility-aware conversion rate (ascending)",
                "volatility_threshold_pct": self.analyzer.threshold,
                "min_trades_required": MIN_TRADES_THRESHOLD,
                "blood_shards_items": len(top_shard),
                "blood_tokens_items": len(top_token),
                "always_included": 2,
                "note": "Lower conversion rate = cheaper to acquire shards/tokens = better arbitrage"
            },
            "details": {
                "blood_shards": [
                    {
                        "name": item['name'],
                        "conversion_rate": round(item['conversion_rate'], 4),
                        "window_used": item['window_used'],
                        "trades": item['trade_count'],
                        "best_price": round(item['best_price'], 2),
                        "fetch_window": item['fetch_window']
                    }
                    for item in top_shard
                ],
                "blood_tokens": [
                    {
                        "name": item['name'],
                        "conversion_rate": round(item['conversion_rate'], 4),
                        "window_used": item['window_used'],
                        "trades": item['trade_count'],
                        "best_price": round(item['best_price'], 2),
                        "fetch_window": item['fetch_window']
                    }
                    for item in top_token
                ]
            },
            "analysis_stats": analysis_stats
        }
        
        with open(OUTPUT_TOP_ITEMS, 'w') as f:
            json.dump(top_items_data, f, indent=2)
        
        top_items_size = OUTPUT_TOP_ITEMS.stat().st_size / 1024
        print(f"✓ Top items list: {OUTPUT_TOP_ITEMS.relative_to(PROJECT_ROOT)}")
        print(f"  Size: {top_items_size:.2f} KB")
        print(f"  Items: {len(item_names)}")
        print(f"  Blood Shard items: {len(top_shard)}")
        print(f"  Blood Token items: {len(top_token)}")
        print(f"{'='*80}\n")


async def main_async():
    """Main execution (async)."""
    print(f"\n{'*'*80}")
    print(f"LOCAL SCRIPT 1: ROBUST TRADE ANALYSIS")
    print(f"{'*'*80}\n")
    
    analyzer = TopItemsAnalyzer()
    
    shard_items, token_items = analyzer.load_shop_items()
    
    fetch_results, all_trades = await analyzer.fetch_all_items(shard_items, token_items)
    
    calibrated_threshold = analyzer.calibrate_volatility_threshold(fetch_results)
    analyzer.analyzer.threshold = calibrated_threshold
    
    top_shard, top_token, analysis_stats = analyzer.analyze_and_select_top_items(fetch_results)
    
    analyzer.save_results(fetch_results, all_trades, top_shard, top_token, analysis_stats)
    
    print("✅ Script complete! All data fetched successfully.")


def main():
    """Main execution."""
    try:
        asyncio.run(main_async())
        return 0
    
    except FileNotFoundError as e:
        print(f"❌ Error: Required file not found: {e}")
        print(f"   Make sure data/blood_shard_shop.json and data/blood_synthesis_shop.json exist")
        return 1
    
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
