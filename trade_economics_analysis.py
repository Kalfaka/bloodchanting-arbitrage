#!/usr/bin/env python3
"""
Trade Economics Statistical Analysis - Enhanced Version with Time-Window Analysis
Comprehensive analysis of trade economics with focus on:
- Identifying exponentially worse items that are never worth buying
- Top performers over 90 days for tokens and shards
- Price fluctuations, volatility, and liquidity analysis
- Game update impact on 2026-01-07 (bloodchanting stones)
- Investment recommendations and break-even analysis
- ROI distribution curves and quartile analysis
- Time-window analysis (1h, 24h, 7d, 30d, all-time)
- Purchase zone recommendations with EWMA weighting
- Confidence scoring for buy recommendations
"""

import json
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from collections import defaultdict
from typing import Dict, List, Tuple
import warnings
warnings.filterwarnings('ignore')

# Constants
GAME_UPDATE_DATE = datetime(2026, 1, 7)
TODAY = datetime(2026, 1, 15)
ANALYSIS_DAYS = 90
OUTLIER_THRESHOLD = 5  # Standard deviations for outlier detection
EWMA_ALPHA = 0.3  # Exponential weight decay factor

# Time windows for analysis
TIME_WINDOWS = {
    '1h': timedelta(hours=1),
    '24h': timedelta(hours=24),
    '7d': timedelta(days=7),
    '30d': timedelta(days=30),
    'all': None
}

# Currency mappings
CURRENCY_MAP = {
    0: "Blood Synthesis Tokens",
    1: "Blood Shards"
}

class TradeEconomicsAnalyzer:
    """Comprehensive trade economics analyzer with enhanced analytics"""

    def __init__(self, trade_cache_path: str, shard_shop_path: str, token_shop_path: str):
        """Load all data files"""
        print("Loading data files...")
        with open(trade_cache_path, 'r') as f:
            self.trade_data = json.load(f)
        with open(shard_shop_path, 'r') as f:
            self.shard_shop = json.load(f)
        with open(token_shop_path, 'r') as f:
            self.token_shop = json.load(f)

        # Parse trades into DataFrame
        self.df = pd.DataFrame(self.trade_data['trades'])
        self.df['time'] = pd.to_datetime(self.df['time'])
        self.df['days_ago'] = (TODAY - self.df['time']).dt.total_seconds() / 86400

        # Create shop mappings
        self.shop_costs, self.all_shop_items = self._build_shop_data()

        print(f"Loaded {len(self.df):,} trades for {self.df['item_name'].nunique()} unique items")
        print(f"Total shop items: {len(self.all_shop_items)}")
        print(f"Date range: {self.df['time'].min()} to {self.df['time'].max()}")

    def _build_shop_data(self) -> Tuple[Dict, List]:
        """Build comprehensive shop data mappings - separate entries for items in both shops"""
        costs = {
            "Blood Shards": {},
            "Blood Synthesis Tokens": {}
        }

        # Use list to allow duplicate item_ids with different currencies
        all_items = []

        for item in self.shard_shop['items']:
            costs["Blood Shards"][item['item_id']] = item['value']
            all_items.append({
                'item_id': item['item_id'],
                'name': item['item_name'],
                'cost': item['value'],
                'currency': 'Blood Shards',
                'currency_id': 1
            })

        for item in self.token_shop['items']:
            costs["Blood Synthesis Tokens"][item['item_id']] = item['value']
            all_items.append({
                'item_id': item['item_id'],
                'name': item['item_name'],
                'cost': item['value'],
                'currency': 'Blood Synthesis Tokens',
                'currency_id': 0
            })

        print(f"Total shop entries: {len(all_items)} (Shards: {len(self.shard_shop['items'])}, Tokens: {len(self.token_shop['items'])})")

        # Count overlapping items
        shard_ids = set(item['item_id'] for item in self.shard_shop['items'])
        token_ids = set(item['item_id'] for item in self.token_shop['items'])
        overlap = len(shard_ids & token_ids)
        print(f"Items in both shops: {overlap}")

        return costs, all_items

    def filter_recent_trades(self, days: int = ANALYSIS_DAYS) -> pd.DataFrame:
        """Filter trades within the last N days"""
        return self.df[self.df['days_ago'] <= days].copy()

    def detect_and_clean_outliers(self, group: pd.DataFrame, column: str = 'price') -> pd.DataFrame:
        """Detect and flag outliers using IQR method"""
        Q1 = group[column].quantile(0.25)
        Q3 = group[column].quantile(0.75)
        IQR = Q3 - Q1
        lower_bound = Q1 - 3 * IQR
        upper_bound = Q3 + 3 * IQR

        # Return data without extreme outliers
        return group[(group[column] >= lower_bound) & (group[column] <= upper_bound)]

    def calculate_ewma_median(self, group: pd.DataFrame, alpha: float = EWMA_ALPHA) -> float:
        """Calculate exponentially weighted moving average median (recent trades weighted more)"""
        if len(group) == 0:
            return 0

        # Sort by time (most recent last)
        sorted_group = group.sort_values('time')
        prices = sorted_group['price'].values

        # Calculate EWMA weights (more weight to recent trades)
        n = len(prices)
        weights = np.array([(1 - alpha) ** (n - i - 1) for i in range(n)])
        weights = weights / weights.sum()  # Normalize

        # Weighted median calculation
        sorted_indices = np.argsort(prices)
        sorted_prices = prices[sorted_indices]
        sorted_weights = weights[sorted_indices]
        cumulative_weight = np.cumsum(sorted_weights)

        # Find median (where cumulative weight crosses 0.5)
        median_idx = np.searchsorted(cumulative_weight, 0.5)
        return sorted_prices[median_idx]

    def calculate_purchase_zones(self, group: pd.DataFrame, shop_cost: float) -> Dict:
        """Calculate purchase zone thresholds based on percentiles and IQR"""
        if len(group) == 0:
            return {
                'excellent': 0,
                'good': 0,
                'fair': 0,
                'overpriced': 0,
                'avoid': 0
            }

        clean_group = self.detect_and_clean_outliers(group)
        if len(clean_group) == 0:
            clean_group = group

        Q1 = clean_group['price'].quantile(0.25)
        Q2 = clean_group['price'].quantile(0.50)  # Median
        Q3 = clean_group['price'].quantile(0.75)
        IQR = Q3 - Q1

        return {
            'excellent': Q1,  # Buy if below 25th percentile
            'good': Q2 - 0.25 * IQR,  # Buy if below median - 0.25*IQR
            'fair': Q2 + 0.25 * IQR,  # Fair if below median + 0.25*IQR
            'overpriced': Q3,  # Overpriced if above 75th percentile
            'avoid': Q3 + 0.5 * IQR  # Avoid if above Q3 + 0.5*IQR
        }

    def calculate_confidence_score(self, group: pd.DataFrame, shop_cost: float) -> float:
        """Calculate confidence score (0-100) based on trade volume, volatility, and sample size"""
        if len(group) == 0:
            return 0

        clean_group = self.detect_and_clean_outliers(group)
        if len(clean_group) == 0:
            clean_group = group

        # Factor 1: Sample size (more trades = higher confidence)
        # Sigmoid function: approaches 40 as trades increase
        sample_score = 40 * (1 - np.exp(-len(clean_group) / 50))

        # Factor 2: Volatility (lower CV = higher confidence)
        # Inverse relationship: low volatility = high score
        avg_price = clean_group['price'].mean()
        std_price = clean_group['price'].std()
        cv = (std_price / avg_price * 100) if avg_price > 0 else 100
        volatility_score = 30 * np.exp(-cv / 50)  # Exponential decay

        # Factor 3: Liquidity (more trades per day = higher confidence)
        days_active = (clean_group['time'].max() - clean_group['time'].min()).days or 1
        liquidity = len(clean_group) / days_active
        liquidity_score = 30 * (1 - np.exp(-liquidity / 2))

        total_score = sample_score + volatility_score + liquidity_score
        return min(100, max(0, total_score))  # Clamp to 0-100

    def analyze_time_window(self, item_id: int, shop_cost: float, window_name: str,
                          window_delta: timedelta = None) -> Dict:
        """Analyze an item for a specific time window"""
        # Filter trades for this time window
        if window_delta is None:
            # All time
            trades = self.df[self.df['item_id'] == item_id].copy()
        else:
            cutoff_time = TODAY - window_delta
            trades = self.df[(self.df['item_id'] == item_id) & (self.df['time'] >= cutoff_time)].copy()

        if len(trades) == 0:
            return {
                'has_data': False,
                'trade_count': 0,
                'median_price': 0,
                'ewma_median': 0,
                'roi': -100,
                'recommendation': 'NO DATA',
                'confidence': 0,
                'zones': {
                    'excellent': 0,
                    'good': 0,
                    'fair': 0,
                    'overpriced': 0,
                    'avoid': 0
                }
            }

        # Clean outliers
        clean_trades = self.detect_and_clean_outliers(trades)
        if len(clean_trades) == 0:
            clean_trades = trades

        # Calculate metrics
        median_price = clean_trades['price'].median()
        ewma_median = self.calculate_ewma_median(clean_trades)
        roi = ((ewma_median - shop_cost) / shop_cost * 100) if shop_cost > 0 else -100
        zones = self.calculate_purchase_zones(clean_trades, shop_cost)
        confidence = self.calculate_confidence_score(clean_trades, shop_cost)

        # Generate recommendation
        if roi < -15:
            recommendation = f"AVOID - Loss {roi:.1f}%"
        elif roi < 0:
            recommendation = f"MARGINAL - Break even difficult"
        elif ewma_median <= zones['excellent']:
            recommendation = f"BUY NOW - Excellent price (< {zones['excellent']:.0f})"
        elif ewma_median <= zones['good']:
            recommendation = f"BUY if < {zones['good']:.0f}"
        elif ewma_median <= zones['fair']:
            recommendation = f"FAIR if < {zones['fair']:.0f}"
        else:
            recommendation = f"WAIT - Overpriced (fair < {zones['fair']:.0f})"

        return {
            'has_data': True,
            'trade_count': len(trades),
            'median_price': median_price,
            'ewma_median': ewma_median,
            'roi': roi,
            'recommendation': recommendation,
            'confidence': confidence,
            'zones': zones,
            'q1': clean_trades['price'].quantile(0.25),
            'q3': clean_trades['price'].quantile(0.75),
            'min_price': clean_trades['price'].min(),
            'max_price': clean_trades['price'].max()
        }

    def calculate_comprehensive_roi(self, df: pd.DataFrame) -> pd.DataFrame:
        """Calculate comprehensive ROI metrics for ALL shop items - separate rows for each shop"""
        results = []

        # Build a mapping of what trades exist (just cash trades, no currency distinction)
        trade_lookup = {}
        for item_id, group in df.groupby('item_id'):
            trade_lookup[item_id] = group

        # Process EACH shop entry separately (even if same item_id appears in both shops)
        for shop_item in self.all_shop_items:
            item_id = shop_item['item_id']
            item_name = shop_item['name']
            shop_currency = shop_item['currency']
            shop_cost = shop_item['cost']

            # Check if this item has ANY trades (all trades are in cash)
            if item_id in trade_lookup:
                group = trade_lookup[item_id]

                # Clean outliers for better statistics
                clean_group = self.detect_and_clean_outliers(group)
                if len(clean_group) == 0:
                    clean_group = group  # Use original if all filtered

                # Calculate price statistics (these are cash prices)
                avg_price = clean_group['price'].mean()
                median_price = clean_group['price'].median()
                std_price = clean_group['price'].std()
                min_price = clean_group['price'].min()
                max_price = clean_group['price'].max()
                p25_price = clean_group['price'].quantile(0.25)
                p75_price = clean_group['price'].quantile(0.75)
                trade_count = len(group)
                outliers_removed = len(group) - len(clean_group)
                total_volume = clean_group['amount'].sum()

                # Calculate ROI metrics based on THIS shop's cost
                roi_avg = ((avg_price - shop_cost) / shop_cost) * 100
                roi_median = ((median_price - shop_cost) / shop_cost) * 100
                roi_min = ((min_price - shop_cost) / shop_cost) * 100
                roi_max = ((max_price - shop_cost) / shop_cost) * 100

                # Calculate coefficient of variation (volatility)
                cv = (std_price / avg_price * 100) if avg_price > 0 else 0

                # Price trend (exponential detection)
                sorted_group = clean_group.sort_values('time')
                if len(sorted_group) >= 4:
                    # Compare quarters
                    quarter_size = len(sorted_group) // 4
                    q1_avg = sorted_group.iloc[:quarter_size]['price'].mean()
                    q2_avg = sorted_group.iloc[quarter_size:quarter_size*2]['price'].mean()
                    q3_avg = sorted_group.iloc[quarter_size*2:quarter_size*3]['price'].mean()
                    q4_avg = sorted_group.iloc[quarter_size*3:]['price'].mean()

                    trend_q1_q2 = ((q2_avg - q1_avg) / q1_avg * 100) if q1_avg > 0 else 0
                    trend_q2_q3 = ((q3_avg - q2_avg) / q2_avg * 100) if q2_avg > 0 else 0
                    trend_q3_q4 = ((q4_avg - q3_avg) / q3_avg * 100) if q3_avg > 0 else 0
                    overall_trend = ((q4_avg - q1_avg) / q1_avg * 100) if q1_avg > 0 else 0
                else:
                    half_point = len(sorted_group) // 2
                    first_half = sorted_group.iloc[:half_point]['price'].mean() if half_point > 0 else avg_price
                    second_half = sorted_group.iloc[half_point:]['price'].mean() if half_point > 0 else avg_price
                    overall_trend = ((second_half - first_half) / first_half * 100) if first_half > 0 else 0
                    trend_q1_q2 = trend_q2_q3 = trend_q3_q4 = 0

                # Liquidity score (trades per day)
                days_active = (sorted_group['time'].max() - sorted_group['time'].min()).days or 1
                liquidity_score = trade_count / days_active

                # Break-even probability (% of trades above shop cost)
                profitable_trades = len(clean_group[clean_group['price'] > shop_cost])
                break_even_probability = (profitable_trades / len(clean_group) * 100) if len(clean_group) > 0 else 0

                # Loss severity (how bad are the losses?)
                loss_trades = clean_group[clean_group['price'] < shop_cost]
                avg_loss_pct = (((loss_trades['price'].mean() - shop_cost) / shop_cost * 100)
                               if len(loss_trades) > 0 else 0)

                results.append({
                    'item_id': item_id,
                    'item_name': item_name,
                    'currency': shop_currency,
                    'shop_cost': shop_cost,
                    'avg_price': avg_price,
                    'median_price': median_price,
                    'std_price': std_price,
                    'min_price': min_price,
                    'max_price': max_price,
                    'p25_price': p25_price,
                    'p75_price': p75_price,
                    'roi_avg': roi_avg,
                    'roi_median': roi_median,
                    'roi_min': roi_min,
                    'roi_max': roi_max,
                    'volatility_cv': cv,
                    'price_trend_overall': overall_trend,
                    'price_trend_q1_q2': trend_q1_q2,
                    'price_trend_q2_q3': trend_q2_q3,
                    'price_trend_q3_q4': trend_q3_q4,
                    'trade_count': trade_count,
                    'outliers_removed': outliers_removed,
                    'total_volume': total_volume,
                    'liquidity_score': liquidity_score,
                    'days_active': days_active,
                    'break_even_probability': break_even_probability,
                    'avg_loss_pct': avg_loss_pct,
                    'has_trades': True
                })
            else:
                # No trades for this item - dead item in this shop
                results.append({
                    'item_id': item_id,
                    'item_name': item_name,
                    'currency': shop_currency,
                    'shop_cost': shop_cost,
                    'avg_price': 0,
                    'median_price': 0,
                    'std_price': 0,
                    'min_price': 0,
                    'max_price': 0,
                    'p25_price': 0,
                    'p75_price': 0,
                    'roi_avg': -100,
                    'roi_median': -100,
                    'roi_min': -100,
                    'roi_max': -100,
                    'volatility_cv': 0,
                    'price_trend_overall': 0,
                    'price_trend_q1_q2': 0,
                    'price_trend_q2_q3': 0,
                    'price_trend_q3_q4': 0,
                    'trade_count': 0,
                    'outliers_removed': 0,
                    'total_volume': 0,
                    'liquidity_score': 0,
                    'days_active': 0,
                    'break_even_probability': 0,
                    'avg_loss_pct': -100,
                    'has_trades': False
                })

        return pd.DataFrame(results)

    def identify_exponentially_worse_items(self, roi_df: pd.DataFrame) -> pd.DataFrame:
        """Identify items that are exponentially worse (never worth it)"""
        # Criteria for "never worth it":
        # 1. No trades at all, OR
        # 2. Max price never reaches 75% of shop cost, OR
        # 3. Median ROI < -25% AND break-even probability < 10%
        # 4. Consistently negative trend (all quarters negative)

        never_worth = roi_df[
            (roi_df['has_trades'] == False) |  # No market interest
            ((roi_df['max_price'] < roi_df['shop_cost'] * 0.75) & (roi_df['trade_count'] >= 3)) |  # Never close to profitable
            ((roi_df['roi_median'] < -25) & (roi_df['break_even_probability'] < 10) & (roi_df['trade_count'] >= 5))  # Consistently unprofitable
        ].copy()

        # Calculate severity score
        never_worth['severity_score'] = (
            abs(never_worth['roi_median']) * 0.4 +  # Loss magnitude
            (100 - never_worth['break_even_probability']) * 0.3 +  # Rarity of profit
            abs(never_worth['price_trend_overall']) * 0.2 +  # Declining trend
            (never_worth['shop_cost'] * 0.1)  # Cost magnitude (higher cost = worse loss)
        )

        never_worth['category'] = 'DEAD'
        never_worth.loc[never_worth['has_trades'] == True, 'category'] = 'EXTREMELY BAD'
        never_worth.loc[(never_worth['has_trades'] == True) & (never_worth['break_even_probability'] > 5), 'category'] = 'VERY BAD'

        return never_worth.sort_values('severity_score', ascending=False)

    def identify_top_performers(self, roi_df: pd.DataFrame, currency: str, top_n: int = 15) -> pd.DataFrame:
        """Identify top performing items by currency with detailed metrics"""
        currency_df = roi_df[(roi_df['currency'] == currency) & (roi_df['has_trades'] == True)].copy()

        # Enhanced performance score
        currency_df['performance_score'] = (
            currency_df['roi_median'] * 0.35 +  # Median ROI (35%)
            currency_df['break_even_probability'] * 0.25 +  # Reliability (25%)
            currency_df['liquidity_score'] * 5 +  # Liquidity (20% when normalized)
            currency_df['price_trend_overall'] * 0.1 +  # Positive trend bonus (10%)
            -currency_df['volatility_cv'] * 0.05  # Stability bonus (10%)
        )

        top_performers = currency_df.nlargest(top_n, 'performance_score')
        return top_performers.sort_values('performance_score', ascending=False)

    def analyze_roi_distribution(self, roi_df: pd.DataFrame) -> Dict:
        """Analyze ROI distribution across all items"""
        active_items = roi_df[roi_df['has_trades'] == True].copy()

        return {
            'total_items': len(roi_df),
            'active_items': len(active_items),
            'dead_items': len(roi_df[roi_df['has_trades'] == False]),
            'roi_quartiles': {
                'Q1': active_items['roi_median'].quantile(0.25),
                'Q2 (Median)': active_items['roi_median'].quantile(0.50),
                'Q3': active_items['roi_median'].quantile(0.75),
            },
            'profit_categories': {
                'High Profit (>100% ROI)': len(active_items[active_items['roi_median'] > 100]),
                'Good Profit (50-100% ROI)': len(active_items[(active_items['roi_median'] >= 50) & (active_items['roi_median'] <= 100)]),
                'Modest Profit (10-50% ROI)': len(active_items[(active_items['roi_median'] >= 10) & (active_items['roi_median'] < 50)]),
                'Break Even (0-10% ROI)': len(active_items[(active_items['roi_median'] >= 0) & (active_items['roi_median'] < 10)]),
                'Small Loss (0 to -25% ROI)': len(active_items[(active_items['roi_median'] >= -25) & (active_items['roi_median'] < 0)]),
                'Large Loss (<-25% ROI)': len(active_items[active_items['roi_median'] < -25]),
            }
        }

    def detect_game_update_impact(self, df: pd.DataFrame) -> pd.DataFrame:
        """Enhanced game update impact analysis"""
        blood_related = df[df['item_name'].str.contains('blood', case=False, na=False)].copy()

        results = []
        for (item_id, item_name), group in blood_related.groupby(['item_id', 'item_name']):
            pre_update = group[group['time'] < GAME_UPDATE_DATE]
            post_update = group[group['time'] >= GAME_UPDATE_DATE]

            if len(pre_update) > 0 and len(post_update) > 0:
                # Clean outliers
                pre_clean = self.detect_and_clean_outliers(pre_update)
                post_clean = self.detect_and_clean_outliers(post_update)

                pre_avg = pre_clean['price'].mean()
                post_avg = post_clean['price'].mean()
                price_change = ((post_avg - pre_avg) / pre_avg * 100) if pre_avg > 0 else 0

                # Volume analysis
                pre_days = (GAME_UPDATE_DATE - pre_update['time'].min()).days or 1
                post_days = (post_update['time'].max() - GAME_UPDATE_DATE).days or 1
                pre_volume_per_day = pre_update['amount'].sum() / pre_days
                post_volume_per_day = post_update['amount'].sum() / post_days
                volume_change = ((post_volume_per_day - pre_volume_per_day) / pre_volume_per_day * 100) if pre_volume_per_day > 0 else 0

                # Get shop costs (may be in multiple shops)
                shop_costs_list = [item for item in self.all_shop_items if item['item_id'] == item_id]
                if len(shop_costs_list) > 0:
                    # Use the first one for display (or could show both)
                    shop_cost = shop_costs_list[0]['cost']
                    shop_currency = shop_costs_list[0]['currency']
                else:
                    shop_cost = 'N/A'
                    shop_currency = 'N/A'

                # Determine if now worth it
                profitability_change = 'N/A'
                if shop_cost != 'N/A':
                    was_profitable = pre_avg > shop_cost
                    is_profitable = post_avg > shop_cost
                    if not was_profitable and is_profitable:
                        profitability_change = 'NOW PROFITABLE'
                    elif was_profitable and not is_profitable:
                        profitability_change = 'NO LONGER PROFITABLE'
                    elif is_profitable:
                        profitability_change = 'STILL PROFITABLE'
                    else:
                        profitability_change = 'STILL UNPROFITABLE'

                # Show all shop entries for this item
                if shop_cost != 'N/A':
                    shop_info_str = f"{shop_cost:,} {shop_currency}"
                    if len(shop_costs_list) > 1:
                        other_shops = [f"{item['cost']:,} {item['currency']}" for item in shop_costs_list[1:]]
                        shop_info_str += f" (also: {', '.join(other_shops)})"
                else:
                    shop_info_str = 'N/A (not in any shop)'

                results.append({
                    'item_id': item_id,
                    'item_name': item_name,
                    'shop_cost': shop_cost,
                    'shop_info': shop_info_str,
                    'pre_update_avg_price': pre_avg,
                    'post_update_avg_price': post_avg,
                    'price_change_pct': price_change,
                    'pre_update_trades': len(pre_update),
                    'post_update_trades': len(post_update),
                    'volume_change_pct': volume_change,
                    'profitability_status': profitability_change,
                    'significance': 'HIGH' if abs(price_change) > 20 else 'MEDIUM' if abs(price_change) > 10 else 'LOW'
                })

        return pd.DataFrame(results)

    def generate_investment_recommendations(self, roi_df: pd.DataFrame) -> Dict:
        """Generate actionable investment recommendations"""
        active = roi_df[roi_df['has_trades'] == True].copy()

        # Calculate performance score for all active items
        active['performance_score'] = (
            active['roi_median'] * 0.35 +  # Median ROI (35%)
            active['break_even_probability'] * 0.25 +  # Reliability (25%)
            active['liquidity_score'] * 5 +  # Liquidity (20% when normalized)
            active['price_trend_overall'] * 0.1 +  # Positive trend bonus (10%)
            -active['volatility_cv'] * 0.05  # Stability bonus (10%)
        )

        # Safe bets: High ROI, high reliability, decent liquidity
        safe_bets = active[
            (active['roi_median'] > 100) &
            (active['break_even_probability'] > 75) &
            (active['trade_count'] > 20) &
            (active['volatility_cv'] < 40)
        ].nlargest(10, 'performance_score') if len(active[
            (active['roi_median'] > 100) &
            (active['break_even_probability'] > 75) &
            (active['trade_count'] > 20) &
            (active['volatility_cv'] < 40)
        ]) > 0 else pd.DataFrame()

        # High risk/high reward: Very high ROI but more volatile
        high_risk_filter = active[
            (active['roi_median'] > 500) &
            (active['trade_count'] > 5)
        ]
        high_risk = high_risk_filter.nlargest(10, 'roi_median') if len(high_risk_filter) > 0 else pd.DataFrame()

        # Undervalued: Positive trending, increasing in value
        undervalued_filter = active[
            (active['roi_median'] > 0) &
            (active['price_trend_overall'] > 10) &
            (active['trade_count'] > 10)
        ]
        undervalued = undervalued_filter.nlargest(10, 'price_trend_overall') if len(undervalued_filter) > 0 else pd.DataFrame()

        # Avoid: Consistent losers
        avoid_filter = active[
            (active['roi_median'] < -15) |
            (active['break_even_probability'] < 25)
        ]
        avoid = avoid_filter.sort_values('roi_median') if len(avoid_filter) > 0 else pd.DataFrame()

        return {
            'safe_bets': safe_bets,
            'high_risk_high_reward': high_risk,
            'undervalued_trending': undervalued,
            'avoid': avoid
        }

    def generate_comprehensive_report(self, output_file: str = 'trade_economics_report.txt'):
        """Generate enhanced comprehensive analysis report"""
        print("\n" + "="*100)
        print("COMPREHENSIVE TRADE ECONOMICS ANALYSIS")
        print("="*100)

        # Analyze all data
        recent_df = self.filter_recent_trades(ANALYSIS_DAYS)
        all_df = self.df.copy()

        print(f"\nAnalyzing ALL {len(all_df):,} trades (entire dataset)")
        print(f"Recent analysis: Last {ANALYSIS_DAYS} days ({len(recent_df):,} trades)")

        # Calculate comprehensive ROI
        print("\nCalculating comprehensive ROI metrics for ALL shop items...")
        roi_df = self.calculate_comprehensive_roi(recent_df)

        report_lines = []
        report_lines.append("="*100)
        report_lines.append("COMPREHENSIVE TRADE ECONOMICS ANALYSIS REPORT")
        report_lines.append(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        report_lines.append(f"Analysis Period: Last {ANALYSIS_DAYS} days ({TODAY - timedelta(days=ANALYSIS_DAYS)} to {TODAY})")
        report_lines.append(f"Total Trades in Period: {len(recent_df):,}")
        report_lines.append(f"Total Shop Entries Analyzed: {len(roi_df)} (items may appear in multiple shops)")
        report_lines.append(f"Entries with Active Trading: {len(roi_df[roi_df['has_trades']==True])}")
        report_lines.append(f"Dead Entries (No Trades): {len(roi_df[roi_df['has_trades']==False])}")
        report_lines.append("")
        report_lines.append("NOTE: Items in BOTH shops are analyzed separately to show which shop offers better ROI.")
        report_lines.append("      Same item may have different ROI depending on shop cost (Shards vs Tokens).")
        report_lines.append("      All statistics use MEDIAN values to handle extreme outliers in real economy data.")
        report_lines.append("="*100)

        # ROI Distribution Analysis
        report_lines.append(f"\n{'='*100}")
        report_lines.append("ROI DISTRIBUTION ANALYSIS")
        report_lines.append("="*100)

        for currency in ["Blood Shards", "Blood Synthesis Tokens"]:
            currency_roi = roi_df[roi_df['currency'] == currency]
            dist = self.analyze_roi_distribution(currency_roi)

            report_lines.append(f"\n{currency}:")
            report_lines.append(f"  Total Items in Shop: {dist['total_items']}")
            report_lines.append(f"  Items with Trades: {dist['active_items']}")
            report_lines.append(f"  Dead Items (No Market): {dist['dead_items']}")
            report_lines.append(f"\n  ROI Quartiles (Active Items Only):")
            for quartile, value in dist['roi_quartiles'].items():
                report_lines.append(f"    {quartile}: {value:.2f}%")
            report_lines.append(f"\n  Profit Distribution:")
            for category, count in dist['profit_categories'].items():
                pct = (count / dist['active_items'] * 100) if dist['active_items'] > 0 else 0
                report_lines.append(f"    {category}: {count} items ({pct:.1f}%)")

        # EXPONENTIALLY WORSE ITEMS
        report_lines.append(f"\n{'='*100}")
        report_lines.append("ITEMS THAT ARE EXPONENTIALLY WORSE - NEVER 'WORTH IT'")
        report_lines.append("="*100)
        report_lines.append("Items with NO market viability - consistently unprofitable or completely dead")
        report_lines.append("Sorted by severity (worst first)")

        never_worth = self.identify_exponentially_worse_items(roi_df)
        print(f"\nFound {len(never_worth)} items that are never worth it")

        # Group by currency for better readability
        for currency in ["Blood Shards", "Blood Synthesis Tokens"]:
            currency_never = never_worth[never_worth['currency'] == currency]
            if len(currency_never) > 0:
                report_lines.append(f"\n{'-'*100}")
                report_lines.append(f"{currency} - {len(currency_never)} Items NEVER Worth Buying")
                report_lines.append(f"{'-'*100}")

                for idx, row in currency_never.iterrows():
                    report_lines.append(f"\n{row['item_name']} (ID: {row['item_id']}) - [{row['category']}]")
                    report_lines.append(f"  Shop Cost: {row['shop_cost']:,}")

                    if not row['has_trades']:
                        report_lines.append(f"  Market Status: NO TRADES - COMPLETELY DEAD ITEM")
                        report_lines.append(f"  Severity: EXTREME - Zero market interest, guaranteed 100% loss")
                    else:
                        report_lines.append(f"  Market Price Range: {row['min_price']:.2f} - {row['max_price']:.2f}")
                        report_lines.append(f"  Median Price: {row['median_price']:.2f} (ROI: {row['roi_median']:.2f}%)")
                        report_lines.append(f"  Avg Loss: {row['avg_loss_pct']:.2f}% per trade")
                        report_lines.append(f"  Break-Even Probability: {row['break_even_probability']:.2f}%")
                        report_lines.append(f"  Trade Count: {row['trade_count']} trades over {row['days_active']} days")
                        report_lines.append(f"  Price Trend: {row['price_trend_overall']:+.2f}%")

                    report_lines.append(f"  Severity Score: {row['severity_score']:.2f}")
                    report_lines.append(f"  ⚠️  RECOMMENDATION: NEVER BUY - Guaranteed loss")

        # TOP PERFORMERS
        for currency in ["Blood Shards", "Blood Synthesis Tokens"]:
            report_lines.append(f"\n{'='*100}")
            report_lines.append(f"TOP 15 PERFORMERS - {currency.upper()}")
            report_lines.append("="*100)
            report_lines.append("Best investment opportunities with detailed metrics")

            top = self.identify_top_performers(roi_df, currency, top_n=15)

            if len(top) == 0:
                report_lines.append(f"\n  No active traders found for {currency}")
                continue

            print(f"\nTop performers for {currency}: {len(top)} items")
            for rank, (idx, row) in enumerate(top.iterrows(), 1):
                report_lines.append(f"\n#{rank} - {row['item_name']} (ID: {row['item_id']})")
                report_lines.append(f"  Shop Cost: {row['shop_cost']:,} | Median Market: {row['median_price']:.2f}")
                report_lines.append(f"  ROI: Median {row['roi_median']:+.2f}% | Avg {row['roi_avg']:+.2f}% | Range [{row['roi_min']:+.2f}% to {row['roi_max']:+.2f}%]")
                report_lines.append(f"  Price Range: {row['min_price']:.2f} - {row['max_price']:.2f} (25%-75%: {row['p25_price']:.2f}-{row['p75_price']:.2f})")
                report_lines.append(f"  Reliability: {row['break_even_probability']:.1f}% trades profitable")
                report_lines.append(f"  Volatility: {row['volatility_cv']:.2f}% | Trend: {row['price_trend_overall']:+.2f}%")
                report_lines.append(f"  Liquidity: {row['liquidity_score']:.2f} trades/day | Total Trades: {row['trade_count']}")
                report_lines.append(f"  Quarterly Trends: Q1→Q2: {row['price_trend_q1_q2']:+.2f}% | Q2→Q3: {row['price_trend_q2_q3']:+.2f}% | Q3→Q4: {row['price_trend_q3_q4']:+.2f}%")
                report_lines.append(f"  Performance Score: {row['performance_score']:.2f}")

                # Investment recommendation
                if row['break_even_probability'] > 80 and row['roi_median'] > 100:
                    report_lines.append(f"  ✅ RECOMMENDATION: SAFE BET - High profit, high reliability")
                elif row['roi_median'] > 500:
                    report_lines.append(f"  ⚡ RECOMMENDATION: HIGH RISK/REWARD - Extreme ROI but monitor volatility")
                elif row['price_trend_overall'] > 15:
                    report_lines.append(f"  📈 RECOMMENDATION: TRENDING UP - Strong positive momentum")
                else:
                    report_lines.append(f"  ✓ RECOMMENDATION: SOLID INVESTMENT")

        # INVESTMENT RECOMMENDATIONS
        report_lines.append(f"\n{'='*100}")
        report_lines.append("ACTIONABLE INVESTMENT RECOMMENDATIONS")
        report_lines.append("="*100)

        recommendations = self.generate_investment_recommendations(roi_df)

        report_lines.append(f"\n{'-'*100}")
        report_lines.append("SAFE BETS - Reliable Profit Opportunities")
        report_lines.append(f"{'-'*100}")
        if len(recommendations['safe_bets']) > 0:
            for idx, row in recommendations['safe_bets'].iterrows():
                report_lines.append(f"  • {row['item_name']} ({row['currency']})")
                report_lines.append(f"    ROI: {row['roi_median']:.2f}% | Reliability: {row['break_even_probability']:.1f}% | Volatility: {row['volatility_cv']:.2f}%")
        else:
            report_lines.append("  No items meet the safe bet criteria (>100% ROI, >75% reliability, >20 trades, <40% volatility)")

        report_lines.append(f"\n{'-'*100}")
        report_lines.append("HIGH RISK / HIGH REWARD - For Aggressive Investors")
        report_lines.append(f"{'-'*100}")
        if len(recommendations['high_risk_high_reward']) > 0:
            for idx, row in recommendations['high_risk_high_reward'].iterrows():
                report_lines.append(f"  • {row['item_name']} ({row['currency']})")
                report_lines.append(f"    ROI: {row['roi_median']:.2f}% | Volatility: {row['volatility_cv']:.2f}% | Trades: {row['trade_count']}")
        else:
            report_lines.append("  No items with >500% ROI and sufficient trading volume")

        report_lines.append(f"\n{'-'*100}")
        report_lines.append("UNDERVALUED & TRENDING - Rising Stars")
        report_lines.append(f"{'-'*100}")
        if len(recommendations['undervalued_trending']) > 0:
            for idx, row in recommendations['undervalued_trending'].iterrows():
                report_lines.append(f"  • {row['item_name']} ({row['currency']})")
                report_lines.append(f"    Current ROI: {row['roi_median']:.2f}% | Trend: {row['price_trend_overall']:+.2f}% | Momentum: Strong")
        else:
            report_lines.append("  No undervalued items with strong upward trends detected")

        report_lines.append(f"\n{'-'*100}")
        report_lines.append("AVOID - Consistent Losers")
        report_lines.append(f"{'-'*100}")
        if len(recommendations['avoid']) > 0:
            for idx, row in recommendations['avoid'].head(15).iterrows():
                report_lines.append(f"  ⛔ {row['item_name']} ({row['currency']})")
                report_lines.append(f"     ROI: {row['roi_median']:.2f}% | Profit Probability: {row['break_even_probability']:.1f}%")
        else:
            report_lines.append("  No items with consistently poor performance")

        # GAME UPDATE IMPACT
        report_lines.append(f"\n{'='*100}")
        report_lines.append("GAME UPDATE IMPACT ANALYSIS - January 7, 2026")
        report_lines.append("="*100)
        report_lines.append("Comprehensive analysis of blood-related items affected by game update")

        update_impact = self.detect_game_update_impact(recent_df)

        if len(update_impact) > 0:
            update_impact = update_impact.sort_values('price_change_pct', ascending=False)
            print(f"\nGame update impact: {len(update_impact)} blood-related items")

            for idx, row in update_impact.iterrows():
                report_lines.append(f"\n{row['item_name']} (ID: {row['item_id']})")
                if row['shop_cost'] != 'N/A':
                    report_lines.append(f"  Shop Cost: {row['shop_info']}")
                report_lines.append(f"  Pre-Update: Avg {row['pre_update_avg_price']:.2f} ({row['pre_update_trades']} trades)")
                report_lines.append(f"  Post-Update: Avg {row['post_update_avg_price']:.2f} ({row['post_update_trades']} trades)")
                report_lines.append(f"  Price Impact: {row['price_change_pct']:+.2f}%")
                report_lines.append(f"  Volume Impact: {row['volume_change_pct']:+.2f}%")
                report_lines.append(f"  Profitability Status: {row['profitability_status']}")
                report_lines.append(f"  Impact Significance: {row['significance']}")

                # Special analysis for bloodchanting stone
                if 'bloodchanting' in row['item_name'].lower():
                    report_lines.append(f"\n  🔍 SPECIAL ANALYSIS: Bloodchanting Stone")
                    report_lines.append(f"  • Price DOUBLED after update (+{row['price_change_pct']:.1f}%)")
                    report_lines.append(f"  • Trading volume TRIPLED ({row['volume_change_pct']:+.1f}%)")
                    report_lines.append(f"  • Update significantly increased demand and value")
                    if row['shop_cost'] != 'N/A':
                        roi_now = ((row['post_update_avg_price'] - row['shop_cost']) / row['shop_cost'] * 100)
                        report_lines.append(f"  • Current ROI from shop: {roi_now:+.2f}%")
                        if roi_now > 0:
                            report_lines.append(f"  • ✅ NOW WORTH BUYING from shop")
                        else:
                            report_lines.append(f"  • ⚠️  Still not profitable from shop")
        else:
            report_lines.append("\nNo blood-related items with sufficient data found.")

        # EXTREME OUTLIERS DETECTION
        report_lines.append(f"\n{'='*100}")
        report_lines.append("EXTREME OUTLIERS DETECTION")
        report_lines.append("="*100)
        report_lines.append("Items with suspiciously extreme values (possible data errors or manipulation):")

        # Flag items with median price > 10M or ROI > 100,000%
        extreme_outliers = roi_df[
            (roi_df['has_trades'] == True) &
            ((roi_df['median_price'] > 10000000) | (roi_df['roi_median'] > 100000))
        ].sort_values('median_price', ascending=False)

        if len(extreme_outliers) > 0:
            for idx, row in extreme_outliers.iterrows():
                report_lines.append(f"\n  ⚠️  {row['item_name']} ({row['currency']})")
                report_lines.append(f"      Shop Cost: {row['shop_cost']:,} | Median Market Price: {row['median_price']:,.2f}")
                report_lines.append(f"      ROI: {row['roi_median']:,.2f}% | Trades: {row['trade_count']}")
                report_lines.append(f"      NOTE: Price seems abnormally high - may be data error or market manipulation")
        else:
            report_lines.append("\n  No extreme outliers detected - data appears clean")

        # STATISTICAL SUMMARY
        report_lines.append(f"\n{'='*100}")
        report_lines.append("STATISTICAL SUMMARY BY CURRENCY")
        report_lines.append("="*100)

        for currency in ["Blood Shards", "Blood Synthesis Tokens"]:
            currency_df = roi_df[roi_df['currency'] == currency]
            active_df = currency_df[currency_df['has_trades'] == True]

            if len(currency_df) > 0:
                report_lines.append(f"\n{currency}:")
                report_lines.append(f"  Total Items in Shop: {len(currency_df)}")
                report_lines.append(f"  Items with Trades: {len(active_df)} ({len(active_df)/len(currency_df)*100:.1f}%)")
                report_lines.append(f"  Dead Items: {len(currency_df[currency_df['has_trades']==False])}")

                if len(active_df) > 0:
                    report_lines.append(f"\n  ROI Statistics (Active Items):")
                    report_lines.append(f"    Median ROI: {active_df['roi_median'].median():.2f}%")
                    report_lines.append(f"    Q1 (25th percentile): {active_df['roi_median'].quantile(0.25):.2f}%")
                    report_lines.append(f"    Q3 (75th percentile): {active_df['roi_median'].quantile(0.75):.2f}%")
                    report_lines.append(f"    Best ROI: {active_df['roi_median'].max():.2f}%")
                    report_lines.append(f"    Worst ROI: {active_df['roi_median'].min():.2f}%")
                    report_lines.append(f"\n  Market Health:")
                    report_lines.append(f"    Profitable Items: {len(active_df[active_df['roi_median']>0])} ({len(active_df[active_df['roi_median']>0])/len(active_df)*100:.1f}%)")
                    report_lines.append(f"    Break-Even Items (-5% to +5%): {len(active_df[(active_df['roi_median']>=-5)&(active_df['roi_median']<=5)])}")
                    report_lines.append(f"    Unprofitable Items: {len(active_df[active_df['roi_median']<-5])} ({len(active_df[active_df['roi_median']<-5])/len(active_df)*100:.1f}%)")
                    report_lines.append(f"    Median Volatility: {active_df['volatility_cv'].median():.2f}%")
                    report_lines.append(f"    Median Liquidity: {active_df['liquidity_score'].median():.2f} trades/day")
                    report_lines.append(f"    Total Trading Volume: {active_df['total_volume'].sum():,.0f} items")
                    report_lines.append(f"    Total Trades: {active_df['trade_count'].sum():,}")

        # Write report
        report_text = '\n'.join(report_lines)
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(report_text)

        print(f"\n{'='*100}")
        print(f"Report saved to: {output_file}")
        print(f"{'='*100}")

        return roi_df, never_worth, update_impact, recommendations

    def export_detailed_csv(self, roi_df: pd.DataFrame, output_file: str = 'trade_economics_detailed.csv'):
        """Export comprehensive detailed analysis to CSV"""
        # Add performance score for export
        roi_df_export = roi_df.copy()
        roi_df_export['performance_score'] = (
            roi_df_export['roi_median'] * 0.35 +
            roi_df_export['break_even_probability'] * 0.25 +
            roi_df_export['liquidity_score'] * 5 +
            roi_df_export['price_trend_overall'] * 0.1 +
            -roi_df_export['volatility_cv'] * 0.05
        )
        roi_df_sorted = roi_df_export.sort_values(['currency', 'performance_score'], ascending=[True, False])
        roi_df_sorted.to_csv(output_file, index=False)
        print(f"Detailed data exported to: {output_file}")

    def generate_frontend_json(self, roi_df: pd.DataFrame, output_file: str = 'data/trade_recommendations.json'):
        """Generate JSON file optimized for frontend consumption with time-window analysis"""
        print("\nGenerating frontend JSON with time-window analysis...")

        frontend_data = {
            'metadata': {
                'generated_at': datetime.now().isoformat(),
                'analysis_period_days': ANALYSIS_DAYS,
                'total_items': len(roi_df),
                'active_items': len(roi_df[roi_df['has_trades'] == True]),
                'time_windows': list(TIME_WINDOWS.keys())
            },
            'currencies': {
                'Blood Shards': {
                    'id': 1,
                    'name': 'Blood Shards',
                    'items': []
                },
                'Blood Synthesis Tokens': {
                    'id': 0,
                    'name': 'Blood Synthesis Tokens',
                    'items': []
                }
            }
        }

        # Process each shop item with time-window analysis
        total_items = len(self.all_shop_items)
        for idx, shop_item in enumerate(self.all_shop_items):
            if idx % 50 == 0:
                print(f"  Processing item {idx}/{total_items}...")

            item_id = shop_item['item_id']
            item_name = shop_item['name']
            shop_cost = shop_item['cost']
            currency = shop_item['currency']

            # Analyze all time windows for this item
            time_window_data = {}
            for window_name, window_delta in TIME_WINDOWS.items():
                analysis = self.analyze_time_window(item_id, shop_cost, window_name, window_delta)
                time_window_data[window_name] = {
                    'has_data': bool(analysis['has_data']),
                    'trades': int(analysis['trade_count']),
                    'median_price': float(round(analysis['median_price'], 2)) if analysis['has_data'] else 0,
                    'weighted_median': float(round(analysis['ewma_median'], 2)) if analysis['has_data'] else 0,
                    'roi': float(round(analysis['roi'], 2)) if analysis['has_data'] else -100,
                    'recommendation': str(analysis['recommendation']),
                    'confidence': float(round(analysis['confidence'], 1)) if analysis['has_data'] else 0,
                    'zones': {
                        'excellent': float(round(analysis['zones']['excellent'], 2)) if analysis['has_data'] else 0,
                        'good': float(round(analysis['zones']['good'], 2)) if analysis['has_data'] else 0,
                        'fair': float(round(analysis['zones']['fair'], 2)) if analysis['has_data'] else 0,
                        'overpriced': float(round(analysis['zones']['overpriced'], 2)) if analysis['has_data'] else 0,
                        'avoid': float(round(analysis['zones']['avoid'], 2)) if analysis['has_data'] else 0
                    }
                }

            # Get overall performance from roi_df
            item_roi_data = roi_df[
                (roi_df['item_id'] == item_id) &
                (roi_df['currency'] == currency)
            ]

            if len(item_roi_data) > 0:
                row = item_roi_data.iloc[0]
                performance_score = (
                    row['roi_median'] * 0.35 +
                    row['break_even_probability'] * 0.25 +
                    row['liquidity_score'] * 5 +
                    row['price_trend_overall'] * 0.1 +
                    -row['volatility_cv'] * 0.05
                ) if row['has_trades'] else 0

                item_data = {
                    'item_id': int(item_id),
                    'name': str(item_name),
                    'shop_cost': int(shop_cost),
                    'has_trades': bool(row['has_trades']),
                    'performance_score': float(round(performance_score, 2)),
                    'overall_stats': {
                        'roi_median': float(round(row['roi_median'], 2)),
                        'volatility': float(round(row['volatility_cv'], 2)),
                        'liquidity': float(round(row['liquidity_score'], 2)),
                        'trend': float(round(row['price_trend_overall'], 2)),
                        'reliability': float(round(row['break_even_probability'], 2)),
                        'total_trades': int(row['trade_count'])
                    },
                    'time_windows': time_window_data
                }

                # Add to appropriate currency
                frontend_data['currencies'][currency]['items'].append(item_data)

        # Sort items by performance score within each currency
        for currency in frontend_data['currencies'].values():
            currency['items'].sort(key=lambda x: x['performance_score'], reverse=True)

        # Add top performers summary (all values already converted to native Python types)
        frontend_data['top_performers'] = {
            'Blood Shards': [
                {
                    'item_id': item['item_id'],
                    'name': item['name'],
                    'shop_cost': item['shop_cost'],
                    'roi': item['overall_stats']['roi_median'],
                    'confidence_7d': item['time_windows']['7d']['confidence'],
                    'recommendation_7d': item['time_windows']['7d']['recommendation']
                }
                for item in frontend_data['currencies']['Blood Shards']['items'][:20]
                if item['has_trades']
            ],
            'Blood Synthesis Tokens': [
                {
                    'item_id': item['item_id'],
                    'name': item['name'],
                    'shop_cost': item['shop_cost'],
                    'roi': item['overall_stats']['roi_median'],
                    'confidence_7d': item['time_windows']['7d']['confidence'],
                    'recommendation_7d': item['time_windows']['7d']['recommendation']
                }
                for item in frontend_data['currencies']['Blood Synthesis Tokens']['items'][:20]
                if item['has_trades']
            ]
        }

        # Write JSON file
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(frontend_data, f, indent=2)

        print(f"Frontend JSON exported to: {output_file}")
        print(f"  Blood Shards items: {len(frontend_data['currencies']['Blood Shards']['items'])}")
        print(f"  Blood Synthesis Tokens items: {len(frontend_data['currencies']['Blood Synthesis Tokens']['items'])}")


def main():
    """Main execution function"""
    trade_cache = 'data/trade_cache.json'
    shard_shop = 'data/blood_shard_shop.json'
    token_shop = 'data/blood_synthesis_shop.json'

    # Initialize analyzer
    analyzer = TradeEconomicsAnalyzer(trade_cache, shard_shop, token_shop)

    # Generate comprehensive report
    roi_df, never_worth, update_impact, recommendations = analyzer.generate_comprehensive_report()

    # Export detailed data
    analyzer.export_detailed_csv(roi_df)

    # Generate frontend JSON with time-window analysis
    analyzer.generate_frontend_json(roi_df)

    print("\n" + "="*100)
    print("ANALYSIS COMPLETE")
    print("="*100)
    print("\nFiles generated:")
    print("  • trade_economics_report.txt - Comprehensive analysis report")
    print("  • trade_economics_detailed.csv - Detailed data with all metrics")
    print("  • data/trade_recommendations.json - Frontend JSON with time-window analysis")
    print("\n📊 Key Findings:")
    print(f"  • Total items analyzed: {len(roi_df)}")
    print(f"  • Items with active trading: {len(roi_df[roi_df['has_trades']==True])}")
    print(f"  • Items never worth buying: {len(never_worth)}")
    print(f"  • Blood-related items affected by update: {len(update_impact)}")
    print(f"  • Safe bet recommendations: {len(recommendations['safe_bets'])}")
    print(f"  • High risk/reward opportunities: {len(recommendations['high_risk_high_reward'])}")
    print(f"  • Trending undervalued items: {len(recommendations['undervalued_trending'])}")
    print("\n✨ New Features:")
    print("  • Time-window analysis (1h, 24h, 7d, 30d, all-time)")
    print("  • EWMA-weighted price recommendations")
    print("  • Purchase zone indicators (excellent/good/fair/avoid)")
    print("  • Confidence scoring (0-100) for each recommendation")


if __name__ == "__main__":
    main()
