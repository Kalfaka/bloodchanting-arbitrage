#!/usr/bin/env python3
"""
Trade Economics Analysis - Volatility-Aware Edition
Aligns with the intelligent window selection from local_fetch scripts.

This script:
1. Reads volatility-aware "best windows" from top_items.json (Script 1)
2. Processes 90-day trade data from trade_cache.json (Script 2)
3. Calculates multi-window stats while highlighting the recommended window
4. Computes bags/shard and bags/token ratios for value normalization
5. Analyzes bloodchanting stone profitability across all time windows
6. Generates frontend-ready JSON with intelligent recommendations
"""

import json
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Tuple, Optional
import numpy as np
from collections import defaultdict

TIME_WINDOWS = ['1h', '7d', '30d', '90d']
MIN_TRADES_THRESHOLD = 5

SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
DATA_DIR = PROJECT_ROOT / "data"
TOP_ITEMS_FILE = DATA_DIR / "top_items.json"
TRADE_CACHE_FILE = DATA_DIR / "trade_cache.json"
BLOOD_SHARD_SHOP = DATA_DIR / "blood_shard_shop.json"
BLOOD_SYNTHESIS_SHOP = DATA_DIR / "blood_synthesis_shop.json"
OUTPUT_FILE = DATA_DIR / "trade_recommendations.json"


class VoLatilityAwareAnalyzer:
    """Analyzes trade data with volatility-aware window recommendations."""
    
    def __init__(self):
        self.now = datetime.now()
        self.top_items_data = None
        self.trade_cache = None
        self.shard_shop = None
        self.token_shop = None
        self.shop_mappings = {}
        
    def load_data(self):
        """Load all required data files."""
        print("="*80)
        print("LOADING DATA FILES")
        print("="*80)
        
        with open(TOP_ITEMS_FILE, 'r') as f:
            self.top_items_data = json.load(f)
        print(f"✓ Top items: {self.top_items_data['count']} items")
        
        with open(TRADE_CACHE_FILE, 'r') as f:
            self.trade_cache = json.load(f)
        print(f"✓ Trade cache: {self.trade_cache['metadata']['total_trades']:,} trades")
        
        with open(BLOOD_SHARD_SHOP, 'r') as f:
            self.shard_shop = json.load(f)
        print(f"✓ Blood Shard Shop: {len(self.shard_shop['items'])} items")
        
        with open(BLOOD_SYNTHESIS_SHOP, 'r') as f:
            self.token_shop = json.load(f)
        print(f"✓ Blood Synthesis Shop: {len(self.token_shop['items'])} items")
        
        self._build_shop_mappings()
        print(f"\n✓ Shop mappings created")
        print("="*80 + "\n")
    
    def _build_shop_mappings(self):
        """Build mappings of item_name -> shop currency and cost."""
        self.shop_mappings = {}
        
        for item in self.shard_shop['items']:
            name = item['item_name']
            if name not in self.shop_mappings:
                self.shop_mappings[name] = {}
            self.shop_mappings[name]['Blood Shards'] = {
                'cost': item['value'],
                'item_id': item['item_id']
            }
        
        for item in self.token_shop['items']:
            name = item['item_name']
            if name not in self.shop_mappings:
                self.shop_mappings[name] = {}
            self.shop_mappings[name]['Blood Synthesis Tokens'] = {
                'cost': item['value'],
                'item_id': item['item_id']
            }
    
    def filter_trades_by_window(self, trades: List[Dict], window: str) -> List[Dict]:
        """Filter trades to those within the specified time window."""
        if window == '90d':
            return trades
        
        window_deltas = {
            '1h': timedelta(hours=1),
            '7d': timedelta(days=7),
            '30d': timedelta(days=30)
        }
        
        cutoff = self.now - window_deltas[window]
        filtered = []
        
        for trade in trades:
            try:
                trade_time = datetime.strptime(trade['time'], "%Y-%m-%d %H:%M:%S.%f")
                if trade_time >= cutoff:
                    filtered.append(trade)
            except (ValueError, KeyError):
                continue
        
        return filtered
    
    def calculate_window_stats(self, trades: List[Dict]) -> Dict:
        """Calculate statistics for a set of trades with outlier filtering."""
        if not trades or len(trades) < MIN_TRADES_THRESHOLD:
            return {
                'has_data': False,
                'trades': len(trades),
                'median_price': 0.0,
                'mean_price': 0.0,
                'min_price': 0.0,
                'max_price': 0.0,
                'std_dev': 0.0,
                'cv': 0.0
            }

        prices = []
        for trade in trades:
            try:
                price = trade['price']
                currency = trade.get('currency', 1)  # Default to bags if missing

                # Convert price to bags if needed
                # currency: 0 = GP, 1 = Bags (1 bag = 100M GP)
                # NOTE: price is per-unit, not total!
                if currency == 0:
                    price_in_bags = price / 100_000_000  # Convert GP to bags
                else:
                    price_in_bags = price  # Already in bags

                prices.append(price_in_bags)
            except (KeyError, ZeroDivisionError):
                continue

        if len(prices) < MIN_TRADES_THRESHOLD:
            return {
                'has_data': False,
                'trades': len(trades),
                'median_price': 0.0,
                'mean_price': 0.0,
                'min_price': 0.0,
                'max_price': 0.0,
                'std_dev': 0.0,
                'cv': 0.0
            }

        # Apply aggressive outlier filtering for data with extreme outliers
        prices_array = np.array(prices)

        # Use percentile-based filtering: remove bottom 10% and top 10%
        # This handles cases where fake/error trades cluster at extremes
        p10 = np.percentile(prices_array, 10)
        p90 = np.percentile(prices_array, 90)

        # Filter to middle 80% of data
        filtered_prices = prices_array[(prices_array >= p10) & (prices_array <= p90)]

        # If filtering removed too many data points, fall back to less aggressive filtering
        if len(filtered_prices) < MIN_TRADES_THRESHOLD:
            # Try 25th-75th percentile (middle 50%)
            p25 = np.percentile(prices_array, 25)
            p75 = np.percentile(prices_array, 75)
            filtered_prices = prices_array[(prices_array >= p25) & (prices_array <= p75)]

            # If still not enough, use all data
            if len(filtered_prices) < MIN_TRADES_THRESHOLD:
                filtered_prices = prices_array

        median = float(np.median(filtered_prices))
        mean = float(np.mean(filtered_prices))
        std = float(np.std(filtered_prices))
        cv = (std / mean * 100) if mean > 0 else 0.0
        
        return {
            'has_data': True,
            'trades': len(trades),
            'median_price': round(median, 4),
            'mean_price': round(mean, 4),
            'min_price': round(float(np.min(filtered_prices)), 4),
            'max_price': round(float(np.max(filtered_prices)), 4),
            'std_dev': round(std, 4),
            'cv': round(cv, 2)
        }
    
    def calculate_confidence_score(self, stats: Dict, window: str) -> float:
        """
        Calculate confidence score (0-100) based on trade volume and stability.
        
        Factors:
        - Trade count (more trades = higher confidence)
        - Price stability (lower CV = higher confidence)
        - Window size (longer windows generally more reliable)
        """
        if not stats['has_data']:
            return 0.0
        
        trade_count = stats['trades']
        cv = stats['cv']
        
        trade_score = min(trade_count / 50 * 40, 40)
        
        stability_score = max(0, 30 - (cv / 5))
        
        window_weights = {'1h': 0.7, '7d': 1.0, '30d': 0.95, '90d': 0.9}
        window_score = window_weights.get(window, 1.0) * 30
        
        total_score = trade_score + stability_score + window_score
        return round(min(total_score, 100), 1)
    
    def analyze_item_all_windows(self, item_name: str, best_window: str) -> Dict:
        """Analyze an item across all time windows."""
        item_trades = [t for t in self.trade_cache['trades'] if t['item_name'] == item_name]
        
        window_data = {}
        for window in TIME_WINDOWS:
            filtered_trades = self.filter_trades_by_window(item_trades, window)
            stats = self.calculate_window_stats(filtered_trades)
            confidence = self.calculate_confidence_score(stats, window)
            
            window_data[window] = {
                'has_data': stats['has_data'],
                'trades': stats['trades'],
                'median_price': stats['median_price'],
                'mean_price': stats['mean_price'],
                'min_price': stats['min_price'],
                'max_price': stats['max_price'],
                'std_dev': stats['std_dev'],
                'coefficient_of_variation': stats['cv'],
                'confidence': confidence,
                'is_recommended': (window == best_window)
            }
        
        return window_data
    
    def calculate_bags_per_unit_ratios(self, item_name: str, window_data: Dict) -> Dict:
        """Calculate bags/shard and bags/token ratios for each window."""
        ratios = {
            'Blood Shards': {},
            'Blood Synthesis Tokens': {}
        }
        
        shop_data = self.shop_mappings.get(item_name, {})
        
        for currency in ['Blood Shards', 'Blood Synthesis Tokens']:
            if currency not in shop_data:
                for window in TIME_WINDOWS:
                    ratios[currency][window] = {
                        'available': False,
                        'shop_cost': 0,
                        'bags_per_unit': 0.0,
                        'total_cost_per_unit': 0.0
                    }
                continue
            
            shop_cost = shop_data[currency]['cost']
            
            for window in TIME_WINDOWS:
                window_stats = window_data[window]
                
                if window_stats['has_data'] and window_stats['median_price'] > 0:
                    bags_per_unit = window_stats['median_price'] / shop_cost
                    
                    ratios[currency][window] = {
                        'available': True,
                        'shop_cost': shop_cost,
                        'bags_per_unit': round(bags_per_unit, 6),
                        'total_cost_per_unit': round(window_stats['median_price'], 4)
                    }
                else:
                    ratios[currency][window] = {
                        'available': False,
                        'shop_cost': shop_cost,
                        'bags_per_unit': 0.0,
                        'total_cost_per_unit': 0.0
                    }
        
        return ratios
    
    def analyze_all_items(self) -> Dict:
        """Analyze all items from top_items.json across all windows."""
        print("="*80)
        print("ANALYZING ITEMS ACROSS ALL TIME WINDOWS")
        print("="*80)
        
        analyzed_items = {}
        
        for detail in self.top_items_data['details']['blood_shards']:
            item_name = detail['name']
            best_window = detail['window_used'].split()[0]
            
            print(f"  Analyzing: {item_name} (recommended: {best_window})")
            
            window_data = self.analyze_item_all_windows(item_name, best_window)
            ratios = self.calculate_bags_per_unit_ratios(item_name, window_data)
            
            analyzed_items[item_name] = {
                'recommended_window': best_window,
                'window_data': window_data,
                'ratios': ratios
            }
        
        for detail in self.top_items_data['details']['blood_tokens']:
            item_name = detail['name']
            best_window = detail['window_used'].split()[0]
            
            if item_name in analyzed_items:
                continue
            
            print(f"  Analyzing: {item_name} (recommended: {best_window})")
            
            window_data = self.analyze_item_all_windows(item_name, best_window)
            ratios = self.calculate_bags_per_unit_ratios(item_name, window_data)
            
            analyzed_items[item_name] = {
                'recommended_window': best_window,
                'window_data': window_data,
                'ratios': ratios
            }
        
        for special_item in ['Blood diamonds', 'Bloodchanting stone']:
            if special_item not in analyzed_items:
                print(f"  Analyzing: {special_item} (special item)")
                window_data = self.analyze_item_all_windows(special_item, '7d')
                ratios = self.calculate_bags_per_unit_ratios(special_item, window_data)
                
                analyzed_items[special_item] = {
                    'recommended_window': '7d',
                    'window_data': window_data,
                    'ratios': ratios
                }
        
        print(f"\n✓ Analyzed {len(analyzed_items)} items")
        print("="*80 + "\n")
        
        return analyzed_items
    
    def calculate_bloodchanting_profitability(self, analyzed_items: Dict) -> Dict:
        """
        Calculate bloodchanting stone profitability for each time window.
        
        Recipe: 250 Blood Shards + 500 Blood Tokens + 10 Blood Diamonds = 1 Bloodchanting Stone
        """
        print("="*80)
        print("CALCULATING BLOODCHANTING STONE PROFITABILITY")
        print("="*80)
        
        profitability = {}
        
        for window in TIME_WINDOWS:
            print(f"\n  Analyzing {window} window...")
            
            best_shard_item = None
            best_shard_ratio = float('inf')
            
            best_token_item = None
            best_token_ratio = float('inf')
            
            for item_name, data in analyzed_items.items():
                shard_ratio = data['ratios']['Blood Shards'][window]
                if shard_ratio['available'] and shard_ratio['bags_per_unit'] > 0:
                    if shard_ratio['bags_per_unit'] < best_shard_ratio:
                        best_shard_ratio = shard_ratio['bags_per_unit']
                        best_shard_item = {
                            'name': item_name,
                            'bags_per_shard': shard_ratio['bags_per_unit'],
                            'shop_cost': shard_ratio['shop_cost'],
                            'confidence': data['window_data'][window]['confidence']
                        }
                
                token_ratio = data['ratios']['Blood Synthesis Tokens'][window]
                if token_ratio['available'] and token_ratio['bags_per_unit'] > 0:
                    if token_ratio['bags_per_unit'] < best_token_ratio:
                        best_token_ratio = token_ratio['bags_per_unit']
                        best_token_item = {
                            'name': item_name,
                            'bags_per_token': token_ratio['bags_per_unit'],
                            'shop_cost': token_ratio['shop_cost'],
                            'confidence': data['window_data'][window]['confidence']
                        }
            
            diamond_data = analyzed_items.get('Blood diamonds')
            stone_data = analyzed_items.get('Bloodchanting stone')
            
            if not diamond_data or not stone_data:
                profitability[window] = {
                    'can_calculate': False,
                    'reason': 'Missing blood diamonds or bloodchanting stone data'
                }
                print(f"    ⚠️  Cannot calculate - missing special items")
                continue
            
            diamond_price = diamond_data['window_data'][window]['median_price']
            stone_price = stone_data['window_data'][window]['median_price']
            
            if not best_shard_item or not best_token_item:
                profitability[window] = {
                    'can_calculate': False,
                    'reason': 'No items available for shard/token conversion'
                }
                print(f"    ⚠️  Cannot calculate - missing conversion items")
                continue
            
            if diamond_price <= 0 or stone_price <= 0:
                profitability[window] = {
                    'can_calculate': False,
                    'reason': 'Insufficient trade data for diamonds or stones'
                }
                print(f"    ⚠️  Cannot calculate - insufficient trade data")
                continue
            
            shard_cost = 250 * best_shard_item['bags_per_shard']
            token_cost = 500 * best_token_item['bags_per_token']
            diamond_cost = 10 * diamond_price
            total_cost = shard_cost + token_cost + diamond_cost
            profit = stone_price - total_cost
            roi_pct = (profit / total_cost * 100) if total_cost > 0 else 0
            
            profitability[window] = {
                'can_calculate': True,
                'best_shard_source': best_shard_item,
                'best_token_source': best_token_item,
                'costs': {
                    'shards': round(shard_cost, 2),
                    'tokens': round(token_cost, 2),
                    'diamonds': round(diamond_cost, 2),
                    'total': round(total_cost, 2)
                },
                'stone_market_price': round(stone_price, 2),
                'profit': round(profit, 2),
                'roi_percent': round(roi_pct, 2),
                'profitable': profit > 0,
                'recommendation': 'Craft & Sell' if profit > 0 else 'Buy from Market'
            }
            
            print(f"    Best Shard Source: {best_shard_item['name']} ({best_shard_item['bags_per_shard']:.4f} bags/shard)")
            print(f"    Best Token Source: {best_token_item['name']} ({best_token_item['bags_per_token']:.4f} bags/token)")
            print(f"    Total Cost: {total_cost:.2f} bags")
            print(f"    Stone Price: {stone_price:.2f} bags")
            print(f"    Profit: {profit:+.2f} bags ({roi_pct:+.1f}%)")
            print(f"    {'✅ PROFITABLE' if profit > 0 else '❌ NOT PROFITABLE'}")
        
        print("\n" + "="*80 + "\n")
        return profitability
    
    def calculate_roi_rankings(self, analyzed_items: Dict) -> Dict:
        """Calculate ROI rankings for each currency and window."""
        rankings = {
            'Blood Shards': {},
            'Blood Synthesis Tokens': {}
        }
        
        for window in TIME_WINDOWS:
            for currency in ['Blood Shards', 'Blood Synthesis Tokens']:
                ratios = []
                for item_name, data in analyzed_items.items():
                    ratio_data = data['ratios'][currency][window]
                    if ratio_data['available'] and ratio_data['bags_per_unit'] > 0:
                        ratios.append({
                            'name': item_name,
                            'bags_per_unit': ratio_data['bags_per_unit'],
                            'confidence': data['window_data'][window]['confidence']
                        })
                
                if len(ratios) > 0:
                    ratios_values = [r['bags_per_unit'] for r in ratios]
                    median_ratio = np.median(ratios_values)
                    
                    for ratio in ratios:
                        ratio['roi'] = round((median_ratio - ratio['bags_per_unit']) / median_ratio * 100, 2)
                    
                    ratios.sort(key=lambda x: x['bags_per_unit'])
                    
                    rankings[currency][window] = {
                        'median_bags_per_unit': round(median_ratio, 6),
                        'items': ratios
                    }
                else:
                    rankings[currency][window] = {
                        'median_bags_per_unit': 0,
                        'items': []
                    }
        
        return rankings
    
    def generate_frontend_json(self, analyzed_items: Dict, 
                               bloodchanting_data: Dict,
                               rankings: Dict):
        """Generate the final frontend JSON file."""
        print("="*80)
        print("GENERATING FRONTEND JSON")
        print("="*80)
        
        output_data = {
            'metadata': {
                'generated_at': datetime.now().isoformat(),
                'source': 'Volatility-Aware Analysis (Scripts 1+2+3)',
                'total_items': len(analyzed_items),
                'time_windows': TIME_WINDOWS,
                'min_trades_threshold': MIN_TRADES_THRESHOLD
            },
            'items': {},
            'bloodchanting': bloodchanting_data,
            'rankings': rankings
        }
        
        for item_name, data in analyzed_items.items():
            output_data['items'][item_name] = {
                'recommended_window': data['recommended_window'],
                'windows': data['window_data'],
                'ratios': data['ratios']
            }
        
        with open(OUTPUT_FILE, 'w') as f:
            json.dump(output_data, f, indent=2)
        
        file_size = OUTPUT_FILE.stat().st_size / 1024
        print(f"✓ Frontend JSON: {OUTPUT_FILE.relative_to(PROJECT_ROOT)}")
        print(f"  Size: {file_size:.2f} KB")
        print(f"  Items: {len(analyzed_items)}")
        print(f"  Windows per item: {len(TIME_WINDOWS)}")
        print("="*80 + "\n")


def main():
    """Main execution."""
    print("\n" + "*"*80)
    print("TRADE ECONOMICS ANALYSIS - VOLATILITY-AWARE EDITION")
    print("*"*80 + "\n")
    
    try:
        analyzer = VoLatilityAwareAnalyzer()
        
        analyzer.load_data()
        
        analyzed_items = analyzer.analyze_all_items()
        
        bloodchanting_data = analyzer.calculate_bloodchanting_profitability(analyzed_items)
        
        rankings = analyzer.calculate_roi_rankings(analyzed_items)
        
        analyzer.generate_frontend_json(analyzed_items, bloodchanting_data, rankings)
        
        print("="*80)
        print("✅ ANALYSIS COMPLETE")
        print("="*80)
        print("\nNext Steps:")
        print("1. Review data/trade_recommendations.json")
        print("2. Upload to GitHub:")
        print("   • data/top_items.json")
        print("   • data/trade_cache.json")
        print("   • data/trade_recommendations.json")
        print("3. GitHub Pages will automatically display the updated data")
        print("="*80 + "\n")
        
        return 0
    
    except FileNotFoundError as e:
        print(f"❌ Error: Required file not found: {e}")
        print("   Make sure you have run:")
        print("   1. local_fetch_30d_analysis.py")
        print("   2. local_fetch_90d_final.py")
        return 1
    
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
