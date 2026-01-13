# Scripts Directory

## fetch_trade_data.py

Python script that fetches trade data from the SpawnPK API and saves it to `data/trade_cache.json`.

### What it does:

1. Reads item names from `data/blood_shard_shop.json` and `data/blood_synthesis_shop.json`
2. Fetches trade history for each item from the SpawnPK API
3. Combines all trades into a single JSON file
4. Adds metadata (timestamp, trade count, etc.)
5. Saves to `data/trade_cache.json`

### Usage:

```bash
# Install dependencies
pip install -r requirements.txt

# Run the script
python scripts/fetch_trade_data.py
```

### Configuration:

- **Rate limit:** 0.1s delay (10 req/sec) - tested safe for direct API access
- **Max pages per item:** 5 pages (75 trades max per item)
- **Output file:** `data/trade_cache.json`

### Performance:

- **Items fetched:** ~217 unique items
- **Execution time:** ~2-3 minutes
- **Output size:** ~500KB - 1MB

### Output Format:

```json
{
  "metadata": {
    "last_updated": "2026-01-13T01:30:00.000000",
    "total_trades": 5000,
    "items_processed": 217,
    "items_with_trades": 150,
    "source": "GitHub Actions",
    "api_url": "https://..."
  },
  "trades": [
    {
      "item_name": "Dragon claws",
      "seller": "player1",
      "buyer": "player2",
      "price": 1000,
      "currency": 0,
      "amount": 1,
      "time": "2026-01-13 01:25:00.123456"
    }
  ]
}
```
