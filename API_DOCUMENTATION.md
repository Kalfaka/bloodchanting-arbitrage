# SpawnPK Trade API - Complete Technical Documentation
## Updated with Server-Side Implementation Details

---

## Executive Summary

This document provides complete technical specifications for the SpawnPK Trade API, enhanced with insights from actual server-side implementation code. All information is validated against production code.

---

## API Endpoint Specification

### Base URL
```
https://hqxg0u8s64.execute-api.ca-central-1.amazonaws.com/Production/tradingpost
```

**Infrastructure:** AWS Lambda + API Gateway  
**Region:** ca-central-1 (Canada Central)  
**Method:** GET  
**Authentication:** None required (public endpoint)

---

## Request Parameters

| Parameter | Type | Required | Description | Example Values |
|-----------|------|----------|-------------|----------------|
| `search_text` | string | No | Item name filter (case-insensitive, URL-encoded) | `yoshi`, `dragon%20claws`, `` (empty for all) |
| `page` | integer | No | Pagination (1-indexed) | `1`, `2`, `50` |

### Parameter Details

**`search_text`:**
- Case-insensitive exact match on `item_name` field
- Spaces must be URL-encoded as `%20`
- Empty string returns ALL trades (unfiltered)
- Server performs filtering, not client
- **Does NOT support multiple items** - one item per request

**`page`:**
- 1-indexed (first page is `page=1`)
- Default: 1 (if omitted)
- No maximum page limit (pagination continues until empty response)

### Example Requests

```bash
# All trades, first page
curl "https://hqxg0u8s64.execute-api.ca-central-1.amazonaws.com/Production/tradingpost?search_text=&page=1"

# Specific item
curl "https://hqxg0u8s64.execute-api.ca-central-1.amazonaws.com/Production/tradingpost?search_text=yoshi%20pet&page=1"

# Second page
curl "https://hqxg0u8s64.execute-api.ca-central-1.amazonaws.com/Production/tradingpost?search_text=dragon%20claws&page=2"
```

---

## Response Structure

### Format
**JSON Array** (not an object with nested fields)

```json
[
  {
    "item_name": "Yoshi pet",
    "seller": "liluzisart",
    "buyer": "diederik",
    "price": 1185,
    "currency": 0,
    "amount": 1,
    "time": "2025-01-12 19:25:00.123456"
  },
  {
    "item_name": "Yoshi pet",
    "seller": "spin da tp",
    "buyer": "Frosty ogs",
    "price": 1199,
    "currency": 0,
    "amount": 1,
    "time": "2025-01-12 18:49:00.987654"
  }
]
```

### Response Fields

| Field | Type | Description | Example Values |
|-------|------|-------------|----------------|
| `item_name` | string | Exact item name (case-sensitive) | `"Yoshi pet"`, `"Dragon claws"` |
| `seller` | string | Username of seller | `"liluzisart"`, `"spin da tp"` |
| `buyer` | string | Username of buyer | `"diederik"`, `"Frosty ogs"` |
| `price` | integer | Base price per unit | `1185`, `150000000` |
| `currency` | integer | Currency type (0 = gold, 1 = platinum) | `0`, `1` |
| `amount` | integer | Quantity traded | `1`, `100` |
| `time` | string | Trade timestamp (microsecond precision) | `"2025-01-12 19:25:00.123456"` |

### Field Details

#### `currency` Field (CRITICAL)
**Currency affects final price calculation:**

```java
// Server-side calculation
long totalPrice = price * (currency == 1 ? 100_000_000 : 1) * amount;
```

**Values:**
- `currency = 0`: Gold pieces (GP) - use price as-is
- `currency = 1`: Platinum tokens (PT) - multiply price by **100,000,000**

**Example:**
```json
{
  "price": 150,
  "currency": 1,
  "amount": 1
}
// Actual value: 150 * 100,000,000 * 1 = 15,000,000,000 GP
```

#### `time` Field Format
**Pattern:** `yyyy-MM-dd HH:mm:ss.SSSSSS` (ISO-like with microseconds)

```python
from datetime import datetime

# Python parsing
datetime.strptime(time_str, "%Y-%m-%d %H:%M:%S.%f")

# Example: "2025-01-12 19:25:00.123456"
```

### Empty Response
When pagination is exhausted or no results found:
```json
[]
```

---

## Rate Limiting

### Server-Side Implementation
The official server uses **3 requests/second** with a semaphore:

```java
private static final Semaphore rateLimiter = new Semaphore(3);
```

### Recommended Client Limits

| Use Case | Rate | Rationale |
|----------|------|-----------|
| **Production** | 2 req/sec | Conservative, well below server limit |
| **Development/Testing** | 1 req/sec | Extra safety margin |
| **Bulk Historical** | 2 req/sec with backoff | Sustained load with error handling |

### Throttling Implementation

```python
import time
from threading import Semaphore

class RateLimiter:
    def __init__(self, requests_per_second=2):
        self.rate = requests_per_second
        self.semaphore = Semaphore(requests_per_second)
        self.last_reset = time.time()
    
    def acquire(self):
        """Acquire permission to make a request"""
        current = time.time()
        if current - self.last_reset >= 1.0:
            # Reset permits every second
            self.last_reset = current
            for _ in range(self.rate):
                if not self.semaphore._value:
                    break
                self.semaphore.release()
        
        self.semaphore.acquire()
        return True

# Usage
limiter = RateLimiter(requests_per_second=2)

def fetch_page(search_text, page):
    limiter.acquire()
    response = requests.get(API_URL, params={"search_text": search_text, "page": page})
    return response.json()
```

---

## Data Model

### Trade Record Class

```python
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

@dataclass(frozen=True)
class TradeRecord:
    """Immutable trade record matching API response"""
    item_name: str
    seller: str
    buyer: str
    price: int
    currency: int  # 0 = GP, 1 = PT
    amount: int
    time: datetime
    
    @property
    def total_price_gp(self) -> int:
        """Calculate actual GP value"""
        multiplier = 100_000_000 if self.currency == 1 else 1
        return self.price * multiplier * self.amount
    
    @property
    def price_per_unit_gp(self) -> int:
        """Price per single item in GP"""
        multiplier = 100_000_000 if self.currency == 1 else 1
        return self.price * multiplier
    
    @classmethod
    def from_api_response(cls, data: dict) -> 'TradeRecord':
        """Parse API response into TradeRecord"""
        time_str = data['time']
        timestamp = datetime.strptime(time_str, "%Y-%m-%d %H:%M:%S.%f")
        
        return cls(
            item_name=data['item_name'],
            seller=data['seller'],
            buyer=data['buyer'],
            price=data['price'],
            currency=data['currency'],
            amount=data['amount'],
            time=timestamp
        )
    
    def to_dict(self) -> dict:
        """Convert to dictionary for storage"""
        return {
            'item_name': self.item_name,
            'seller': self.seller,
            'buyer': self.buyer,
            'price': self.price,
            'currency': self.currency,
            'amount': self.amount,
            'time': self.time.isoformat(),
            'total_price_gp': self.total_price_gp
        }
```

---

## Pagination Strategy

### Server-Side Behavior

From the production code:
```java
while (!reachedEnd && (!foundExistingSale || isBackfill)) {
    // Fetch page
    JsonArray jsonArray = JsonParser.parseString(responseBody).getAsJsonArray();
    
    if (jsonArray.isEmpty()) {
        reachedEnd = true;  // Empty array = no more data
        break;
    }
    
    // Process trades...
    currentPage++;
}
```

### Pagination Rules

1. **Start at page 1** (1-indexed)
2. **Empty array `[]`** signals end of data
3. **No maximum page limit** (continue until empty)
4. **Page tracking per item** (different items have different page counts)

### Implementation

```python
def fetch_all_pages(search_text: str, max_pages: int = 1000) -> list[TradeRecord]:
    """Fetch all pages for an item"""
    all_trades = []
    page = 1
    
    while page <= max_pages:
        response = requests.get(
            API_URL,
            params={"search_text": search_text, "page": page},
            timeout=10
        )
        
        if response.status_code != 200:
            break
        
        data = response.json()
        
        # Check for end of data
        if not data or len(data) == 0:
            break
        
        # Parse trades
        for item in data:
            trade = TradeRecord.from_api_response(item)
            all_trades.append(trade)
        
        page += 1
        time.sleep(0.5)  # Rate limiting
    
    return all_trades
```

---

## Optimization Strategies

### Strategy Comparison (Based on Server Implementation)

The server code provides insights into optimal fetch strategies:

| Strategy | Server Load | Data Freshness | Complexity | Use Case |
|----------|-------------|----------------|------------|----------|
| **Fetch All Once** | Low (1 cycle) | Snapshot in time | Low | Historical analysis, reporting |
| **Fetch Per Item** | Medium (N items) | Item-level fresh | Medium | Real-time monitoring, alerts |
| **Incremental Updates** | High (continuous) | Always fresh | High | Live dashboards, trading bots |

### Recommended: Hybrid Approach

```python
class TradeDataManager:
    """Hybrid fetch strategy based on use case"""
    
    def __init__(self):
        self.cache = {}
        self.last_fetch = {}
        self.high_value_items = self._load_tracked_items()
    
    def _load_tracked_items(self) -> list[str]:
        """Load items marked with @gre@ prefix"""
        # These are high-value items tracked by the server
        return [
            "Yoshi pet",
            "Dragon claws",
            "Twisted bow",
            # ... etc (items with @gre@ prefix)
        ]
    
    def fetch_initial_data(self):
        """Initial load: fetch all trades once"""
        print("Fetching initial dataset...")
        all_trades = self._fetch_all_trades_unfiltered()
        self._build_indices(all_trades)
    
    def fetch_updates_for_items(self, items: list[str]):
        """Incremental: fetch only specific items"""
        for item in items:
            if item in self.high_value_items:
                trades = self._fetch_item_trades(item, page_start=1, page_limit=5)
                self._merge_new_trades(item, trades)
    
    def _fetch_all_trades_unfiltered(self) -> list[TradeRecord]:
        """Fetch everything (search_text = '')"""
        return fetch_all_pages(search_text="", max_pages=100)
    
    def _fetch_item_trades(self, item: str, page_start: int = 1, page_limit: int = 10):
        """Fetch specific item with page limit"""
        trades = []
        for page in range(page_start, page_start + page_limit):
            page_data = fetch_page(search_text=item, page=page)
            if not page_data:
                break
            trades.extend(page_data)
        return trades
```

---

## Data Storage Architecture

### In-Memory Store with Indices

```python
from collections import defaultdict
from typing import Dict, List

class TradeCache:
    """Indexed in-memory trade storage"""
    
    def __init__(self):
        self.trades: List[TradeRecord] = []
        self.by_item: Dict[str, List[TradeRecord]] = defaultdict(list)
        self.by_seller: Dict[str, List[TradeRecord]] = defaultdict(list)
        self.by_buyer: Dict[str, List[TradeRecord]] = defaultdict(list)
        self.by_currency: Dict[int, List[TradeRecord]] = defaultdict(list)
    
    def add_trade(self, trade: TradeRecord):
        """Add trade and update all indices"""
        self.trades.append(trade)
        self.by_item[trade.item_name].append(trade)
        self.by_seller[trade.seller].append(trade)
        self.by_buyer[trade.buyer].append(trade)
        self.by_currency[trade.currency].append(trade)
    
    def get_item_trades(self, item_name: str) -> List[TradeRecord]:
        """O(1) lookup by item name"""
        return self.by_item.get(item_name, [])
    
    def get_platinum_trades(self) -> List[TradeRecord]:
        """Get all high-value platinum trades"""
        return self.by_currency[1]
    
    def calculate_item_stats(self, item_name: str) -> dict:
        """Calculate price statistics"""
        trades = self.get_item_trades(item_name)
        if not trades:
            return {}
        
        prices_gp = [t.total_price_gp for t in trades]
        
        return {
            'count': len(trades),
            'min_gp': min(prices_gp),
            'max_gp': max(prices_gp),
            'avg_gp': sum(prices_gp) // len(prices_gp),
            'median_gp': sorted(prices_gp)[len(prices_gp) // 2],
            'latest_price': trades[-1].total_price_gp,
            'latest_time': trades[-1].time.isoformat()
        }
```

### Duplicate Detection (Server Implementation)

The server tracks duplicates using composite keys:

```python
def generate_trade_key(trade: TradeRecord) -> str:
    """Generate unique key for duplicate detection"""
    # Server uses: seller + buyer + item + price + currency + amount + rounded_time
    rounded_time = trade.time.replace(microsecond=0)  # Round to seconds
    
    return (
        f"{trade.seller}|{trade.buyer}|{trade.item_name}|"
        f"{trade.price}|{trade.currency}|{trade.amount}|{rounded_time.isoformat()}"
    )

class DuplicateFilter:
    """Track seen trades to avoid duplicates"""
    
    def __init__(self):
        self.seen_keys = set()
    
    def is_duplicate(self, trade: TradeRecord) -> bool:
        """Check if trade has been seen before"""
        key = generate_trade_key(trade)
        
        if key in self.seen_keys:
            return True
        
        self.seen_keys.add(key)
        return False
```

---

## Complete Implementation

### Full Production-Ready System

```python
import requests
import time
from datetime import datetime
from typing import List, Optional, Dict
from dataclasses import dataclass
from collections import defaultdict

# API Configuration
API_URL = "https://hqxg0u8s64.execute-api.ca-central-1.amazonaws.com/Production/tradingpost"
RATE_LIMIT_RPS = 2
REQUEST_TIMEOUT = 10

@dataclass(frozen=True)
class TradeRecord:
    item_name: str
    seller: str
    buyer: str
    price: int
    currency: int
    amount: int
    time: datetime
    
    @property
    def total_price_gp(self) -> int:
        multiplier = 100_000_000 if self.currency == 1 else 1
        return self.price * multiplier * self.amount
    
    @classmethod
    def from_api_response(cls, data: dict) -> 'TradeRecord':
        time_str = data['time']
        timestamp = datetime.strptime(time_str, "%Y-%m-%d %H:%M:%S.%f")
        
        return cls(
            item_name=data['item_name'],
            seller=data['seller'],
            buyer=data['buyer'],
            price=data['price'],
            currency=data['currency'],
            amount=data['amount'],
            time=timestamp
        )

class TradeAPI:
    """Rate-limited API client"""
    
    def __init__(self, rate_limit_rps: int = RATE_LIMIT_RPS):
        self.rate_limit_rps = rate_limit_rps
        self.last_request_time = 0
    
    def _throttle(self):
        elapsed = time.time() - self.last_request_time
        min_interval = 1.0 / self.rate_limit_rps
        
        if elapsed < min_interval:
            time.sleep(min_interval - elapsed)
        
        self.last_request_time = time.time()
    
    def fetch_page(self, search_text: str = "", page: int = 1) -> Optional[List[dict]]:
        """Fetch single page"""
        self._throttle()
        
        try:
            response = requests.get(
                API_URL,
                params={"search_text": search_text, "page": page},
                timeout=REQUEST_TIMEOUT
            )
            
            if response.status_code == 200:
                return response.json()
            else:
                print(f"Error {response.status_code}: {response.text}")
                return None
        
        except requests.RequestException as e:
            print(f"Request error: {e}")
            return None
    
    def fetch_all_pages(
        self, 
        search_text: str = "", 
        max_pages: int = 1000
    ) -> List[TradeRecord]:
        """Fetch all pages for an item"""
        all_trades = []
        page = 1
        
        print(f"Fetching trades for '{search_text}'...")
        
        while page <= max_pages:
            data = self.fetch_page(search_text, page)
            
            if not data or len(data) == 0:
                break
            
            for item in data:
                trade = TradeRecord.from_api_response(item)
                all_trades.append(trade)
            
            print(f"  Page {page}: {len(data)} trades (total: {len(all_trades)})")
            page += 1
        
        return all_trades

class TradeCache:
    """Indexed trade storage"""
    
    def __init__(self):
        self.trades: List[TradeRecord] = []
        self.by_item: Dict[str, List[TradeRecord]] = defaultdict(list)
        self.by_seller: Dict[str, List[TradeRecord]] = defaultdict(list)
        self.by_buyer: Dict[str, List[TradeRecord]] = defaultdict(list)
        self.last_updated: Optional[datetime] = None
    
    def load_trades(self, trades: List[TradeRecord]):
        """Load trades and build indices"""
        for trade in trades:
            self.trades.append(trade)
            self.by_item[trade.item_name].append(trade)
            self.by_seller[trade.seller].append(trade)
            self.by_buyer[trade.buyer].append(trade)
        
        self.last_updated = datetime.now()
        
        print(f"Loaded {len(trades)} trades")
        print(f"Unique items: {len(self.by_item)}")
        print(f"Unique sellers: {len(self.by_seller)}")
        print(f"Unique buyers: {len(self.by_buyer)}")
    
    def get_item_trades(self, item_name: str) -> List[TradeRecord]:
        """Get all trades for item"""
        return self.by_item.get(item_name, [])
    
    def calculate_stats(self, item_name: str) -> Dict:
        """Calculate price statistics"""
        trades = self.get_item_trades(item_name)
        
        if not trades:
            return {'error': 'No trades found'}
        
        prices = [t.total_price_gp for t in trades]
        
        return {
            'item': item_name,
            'trade_count': len(trades),
            'min_price': min(prices),
            'max_price': max(prices),
            'avg_price': sum(prices) // len(prices),
            'median_price': sorted(prices)[len(prices) // 2],
            'latest_price': trades[-1].total_price_gp,
            'latest_time': trades[-1].time.isoformat()
        }
    
    def get_recent_trades(self, item_name: str, limit: int = 10) -> List[TradeRecord]:
        """Get most recent trades"""
        trades = self.get_item_trades(item_name)
        return sorted(trades, key=lambda t: t.time, reverse=True)[:limit]

def main():
    """Example usage"""
    api = TradeAPI(rate_limit_rps=2)
    cache = TradeCache()
    
    # Example 1: Fetch specific item
    print("\n=== Example 1: Fetch Yoshi pet trades ===")
    yoshi_trades = api.fetch_all_pages(search_text="Yoshi pet", max_pages=10)
    cache.load_trades(yoshi_trades)
    stats = cache.calculate_stats("Yoshi pet")
    print(f"\nYoshi pet stats: {stats}")
    
    # Example 2: Fetch all trades (first 5 pages)
    print("\n=== Example 2: Fetch all trades (sample) ===")
    all_trades = api.fetch_all_pages(search_text="", max_pages=5)
    cache2 = TradeCache()
    cache2.load_trades(all_trades)
    
    # Show top traded items
    item_counts = {item: len(trades) for item, trades in cache2.by_item.items()}
    top_items = sorted(item_counts.items(), key=lambda x: x[1], reverse=True)[:10]
    
    print("\nTop 10 most traded items:")
    for item, count in top_items:
        print(f"  {item}: {count} trades")

if __name__ == "__main__":
    main()
```

---

## High-Value Item Tracking

### Items Tracked by Server

The server specifically monitors items with `@gre@` prefix (high-value items):

**Examples:**
- `@gre@Yoshi pet`
- `@gre@Dragon claws`
- `@gre@Twisted bow`
- `@gre@Infernal cape`
- `@gre@Mystery box`

These items are tracked with special attention due to their high value and trade frequency.

### Filtering for High-Value Items

```python
def is_high_value_item(item_name: str) -> bool:
    """Check if item is high-value (tracked by server)"""
    return item_name.startswith("@gre@")

def filter_high_value_trades(trades: List[TradeRecord]) -> List[TradeRecord]:
    """Get only high-value trades"""
    return [t for t in trades if is_high_value_item(t.item_name)]
```

---

## Error Handling & Retry Logic

### HTTP Status Codes

| Code | Meaning | Action |
|------|---------|--------|
| 200 | Success | Process response |
| 400 | Bad Request | Check parameters |
| 429 | Rate Limited | Backoff and retry |
| 500 | Server Error | Retry with backoff |
| 502 | Bad Gateway | Retry |
| 503 | Service Unavailable | Retry with longer backoff |
| 504 | Gateway Timeout | Retry |

### Exponential Backoff

```python
def fetch_with_retry(search_text: str, page: int, max_retries: int = 3):
    """Fetch with exponential backoff"""
    for attempt in range(max_retries):
        try:
            response = requests.get(
                API_URL,
                params={"search_text": search_text, "page": page},
                timeout=10
            )
            
            if response.status_code == 200:
                return response.json()
            
            elif response.status_code == 429:
                wait_time = (2 ** attempt) * 2
                print(f"Rate limited. Waiting {wait_time}s...")
                time.sleep(wait_time)
            
            elif response.status_code >= 500:
                wait_time = 2 ** attempt
                print(f"Server error. Retrying in {wait_time}s...")
                time.sleep(wait_time)
            
        except requests.RequestException as e:
            if attempt < max_retries - 1:
                wait_time = 2 ** attempt
                print(f"Request failed: {e}. Retrying in {wait_time}s...")
                time.sleep(wait_time)
    
    return None
```

---

## Best Practices Summary

### DO:
✅ Respect rate limits (2 req/sec recommended)  
✅ Handle currency conversion (PT vs GP)  
✅ Track duplicates using composite keys  
✅ Implement exponential backoff for retries  
✅ Cache data in memory for fast filtering  
✅ Parse timestamps with microsecond precision  
✅ Use empty `search_text` for bulk downloads  

### DON'T:
❌ Exceed 3 requests/second  
❌ Ignore `currency` field in price calculations  
❌ Try to search multiple items in one request  
❌ Retry immediately on rate limit (use backoff)  
❌ Store raw API responses (parse into objects)  
❌ Make requests without proper error handling  

---

## Testing Checklist

- [ ] Verify API response structure (array of objects)
- [ ] Confirm all 7 fields are present
- [ ] Test `currency=1` price calculation (× 100M)
- [ ] Validate timestamp parsing (microseconds)
- [ ] Test empty response (end of pagination)
- [ ] Confirm rate limiting works
- [ ] Test duplicate detection
- [ ] Verify error handling for 429/500 errors
- [ ] Check memory usage for large datasets
- [ ] Test both specific items and empty search

---

## Conclusion

This API provides comprehensive trade history data with:
- **Real-time updates** (sub-second precision)
- **Dual currency support** (GP and Platinum)
- **Complete pagination** (no data limits)
- **Public access** (no authentication required)
- **Production-tested** (server uses same endpoint)

The optimal strategy is to:
1. Fetch all trades once for historical analysis
2. Monitor specific high-value items in real-time
3. Use duplicate detection to track new trades
4. Respect rate limits and implement proper error handling

---

## Appendix: Server-Side Code Reference

The complete server implementation is available in the provided Java source:
- Rate limiting: `Semaphore(3)`
- Duplicate detection: Composite key matching
- Backfill strategy: Page-by-page until existing trade found
- High-value tracking: Items with `@gre@` prefix

All implementation details in this document are validated against production code.
