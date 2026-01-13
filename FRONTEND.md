# SpawnPK Trade Arbitrage System - Frontend Specification

## System Overview

A client-side web application for calculating optimal arbitrage opportunities between the SpawnPK Trade API and in-game item sink shops (Blood Synthesis Shop and Blood Shard Shop). The system fetches real-time trade data, applies shop conversion rates, displays ranked opportunities based on cost-per-token efficiency, and calculates the optimal cost for crafting Bloodchanting Stones.

---

## Confirmed API Behavior

### API Endpoint
```
https://hqxg0u8s64.execute-api.ca-central-1.amazonaws.com/Production/tradingpost
```

### Request Parameters
- `search_text`: Item name (case-insensitive, title case preferred)
- `page`: Page number (1-indexed)

### Response Structure (Confirmed)
```json
[
  {
    "id": 3226936,
    "time": "2026-01-12 20:55:47.091995",
    "item_id": 19435,
    "item_name": "Guthix halo",
    "amount": 1,
    "price": 120,
    "currency": 1,
    "seller": "selmar12",
    "buyer": "get your bjs"
  }
]
```

### Key Findings
- ✅ **Returns array of trades** (not nested object)
- ✅ **15 trades per page maximum**
- ✅ **Empty search returns `[]`** - must search specific items
- ✅ **item_id field exists** (integer)
- ✅ **item_name field** - Title case (e.g., "Dragon claws")
- ✅ **NO @gre@ prefix** in API responses
- ✅ **currency field**: `0` = GP, `1` = Platinum tokens
- ✅ **Partial matching works** ("twisted bow" matches "Frosty twisted bow")

---

## Shop Configuration Format

### Expected JSON Structure

**File: `blood_shard_shop.json`**
```json
{
  "shop_name": "Blood Shard Shop",
  "currency": "blood_shards",
  "items": [
    {
      "item_name": "Dragon claws",
      "item_id": 14484,
      "value": 150
    }
  ]
}
```

**File: `blood_synthesis_shop.json`**
```json
{
  "shop_name": "Blood Synthesis Shop",
  "currency": "blood_synthesis_tokens",
  "items": [
    {
      "item_name": "Infernal cape",
      "item_id": 23079,
      "value": 200
    }
  ]
}
```

**Important:**
- Item names must be **Title Case** (match API format)
- Item names must be **without @gre@ prefix**
- Include `item_id` for precise matching
- `value` is the number of tokens/shards you receive

---

## Bloodchanting Stone System

### Recipe Requirements
To craft 1 Bloodchanting Stone:
- **10 Blood Diamonds** (market item)
- **250 Blood Shards** (from Blood Shard Shop)
- **500 Blood Synthesis Tokens** (from Blood Synthesis Shop)

### Calculation Strategy

**Goal:** Find the cheapest possible combination of items to craft a Bloodchanting Stone.

**Method:**
1. Fetch market data for Blood Diamonds (same date window as other items)
2. Find the shop item with the lowest GP-per-shard ratio
3. Find the shop item with the lowest GP-per-token ratio
4. Calculate how many of each item to buy
5. Sum the total cost

**Three Price Scenarios:**
- **Best Case (Min):** All items purchased at their minimum observed price
- **Average Case (Avg):** Items purchased at average price
- **Worst Case (Max):** Items purchased at maximum observed price

### Blood Diamond Configuration

**Market Item:** "Blood diamond"
- Fetched from API like any other item
- Subject to same date filtering
- Has min/avg/max prices based on filtered trades

---

## Core Calculation Logic

### Price Conversion Formula

```javascript
function convertToGP(trade) {
  const multiplier = trade.currency === 1 ? 100_000_000 : 1;
  return trade.price * multiplier * trade.amount;
}

function calculateCostPerToken(totalPriceGP, tokensReceived) {
  return totalPriceGP / tokensReceived;
}
```

### Date Filtering Logic

```javascript
function filterTradesByDate(trades, dateFilter) {
  if (dateFilter === 'all') {
    return trades;
  }
  
  const now = new Date();
  const cutoffs = {
    '1h': 1 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000
  };
  
  const cutoffTime = new Date(now.getTime() - cutoffs[dateFilter]);
  
  return trades.filter(trade => {
    const tradeTime = new Date(trade.time);
    return tradeTime >= cutoffTime;
  });
}
```

### Bloodchanting Stone Calculator

```javascript
class BloodchantingCalculator {
  constructor(bloodShardOpportunities, bloodSynthesisOpportunities, bloodDiamondStats) {
    this.shardOpps = bloodShardOpportunities;
    this.tokenOpps = bloodSynthesisOpportunities;
    this.diamondStats = bloodDiamondStats;
    
    this.RECIPE = {
      blood_diamonds: 10,
      blood_shards: 250,
      blood_synthesis_tokens: 500
    };
  }
  
  calculate() {
    // Filter out items with no trade data
    const validShardItems = this.shardOpps.filter(item => item.min_price_gp !== null);
    const validTokenItems = this.tokenOpps.filter(item => item.min_price_gp !== null);
    
    if (validShardItems.length === 0 || validTokenItems.length === 0) {
      return {
        error: 'Insufficient trade data in selected date range'
      };
    }
    
    // Find cheapest items for each scenario
    const results = {
      min: this.calculateScenario('min', validShardItems, validTokenItems),
      avg: this.calculateScenario('avg', validShardItems, validTokenItems),
      max: this.calculateScenario('max', validShardItems, validTokenItems)
    };
    
    return results;
  }
  
  calculateScenario(scenario, shardItems, tokenItems) {
    // Find item with lowest cost per shard
    const cheapestShardItem = shardItems.reduce((best, item) => {
      const bestCost = best[`cost_per_token_${scenario}`];
      const itemCost = item[`cost_per_token_${scenario}`];
      return itemCost < bestCost ? item : best;
    });
    
    // Find item with lowest cost per token
    const cheapestTokenItem = tokenItems.reduce((best, item) => {
      const bestCost = best[`cost_per_token_${scenario}`];
      const itemCost = item[`cost_per_token_${scenario}`];
      return itemCost < bestCost ? item : best;
    });
    
    // Calculate quantities needed
    const shardsPerItem = cheapestShardItem.tokens_received;
    const tokensPerItem = cheapestTokenItem.tokens_received;
    
    const itemsNeededForShards = Math.ceil(this.RECIPE.blood_shards / shardsPerItem);
    const itemsNeededForTokens = Math.ceil(this.RECIPE.blood_synthesis_tokens / tokensPerItem);
    
    // Calculate costs (in millions)
    const shardCost = cheapestShardItem[`cost_per_token_${scenario}`] * this.RECIPE.blood_shards;
    const tokenCost = cheapestTokenItem[`cost_per_token_${scenario}`] * this.RECIPE.blood_synthesis_tokens;
    const diamondCost = (this.diamondStats[`${scenario}_price_gp`] / 1_000_000) * this.RECIPE.blood_diamonds;
    
    const totalCost = shardCost + tokenCost + diamondCost;
    
    return {
      total_cost_millions: totalCost,
      
      shard_component: {
        item_name: cheapestShardItem.item_name,
        item_id: cheapestShardItem.item_id,
        shards_per_item: shardsPerItem,
        items_to_buy: itemsNeededForShards,
        total_shards_received: itemsNeededForShards * shardsPerItem,
        cost_per_shard: cheapestShardItem[`cost_per_token_${scenario}`],
        total_cost_millions: shardCost
      },
      
      token_component: {
        item_name: cheapestTokenItem.item_name,
        item_id: cheapestTokenItem.item_id,
        tokens_per_item: tokensPerItem,
        items_to_buy: itemsNeededForTokens,
        total_tokens_received: itemsNeededForTokens * tokensPerItem,
        cost_per_token: cheapestTokenItem[`cost_per_token_${scenario}`],
        total_cost_millions: tokenCost
      },
      
      diamond_component: {
        item_name: 'Blood diamond',
        diamonds_to_buy: this.RECIPE.blood_diamonds,
        cost_per_diamond: this.diamondStats[`${scenario}_price_gp`] / 1_000_000,
        total_cost_millions: diamondCost
      }
    };
  }
}
```

---

## Data Model

### TypeScript Interfaces

```typescript
interface TradeRecord {
  id: number;
  time: string;
  item_id: number;
  item_name: string;
  amount: number;
  price: number;
  currency: number;
  seller: string;
  buyer: string;
}

interface ShopItem {
  item_name: string;
  item_id: number;
  value: number;
}

interface ShopConfig {
  shop_name: string;
  currency: string;
  items: ShopItem[];
}

interface TradeStatistics {
  min_price_gp: number;
  avg_price_gp: number;
  max_price_gp: number;
  median_price_gp: number;
  trade_count: number;
  last_trade_time: string;
}

interface ArbitrageOpportunity {
  item_name: string;
  item_id: number;
  shop_name: string;
  shop_currency: string;
  tokens_received: number;
  
  min_price_gp: number | null;
  avg_price_gp: number | null;
  max_price_gp: number | null;
  median_price_gp: number | null;
  
  cost_per_token_min: number | null;
  cost_per_token_avg: number | null;
  cost_per_token_max: number | null;
  
  trade_count: number;
  last_trade_time: string | null;
}

interface BloodchantingComponent {
  item_name: string;
  item_id?: number;
  items_to_buy?: number;
  diamonds_to_buy?: number;
  shards_per_item?: number;
  tokens_per_item?: number;
  total_shards_received?: number;
  total_tokens_received?: number;
  cost_per_shard?: number;
  cost_per_token?: number;
  cost_per_diamond?: number;
  total_cost_millions: number;
}

interface BloodchantingResult {
  total_cost_millions: number;
  shard_component: BloodchantingComponent;
  token_component: BloodchantingComponent;
  diamond_component: BloodchantingComponent;
}

interface BloodchantingCalculation {
  min: BloodchantingResult;
  avg: BloodchantingResult;
  max: BloodchantingResult;
}
```

---

## User Interface Design

### HTML Structure

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SpawnPK Arbitrage Calculator</title>
  <link rel="stylesheet" href="css/styles.css">
</head>
<body>
  <div class="container">
    <header>
      <h1>SpawnPK Shop Arbitrage Calculator</h1>
      <button id="refresh-btn">Refresh Data</button>
    </header>
    
    <div id="status-bar">
      <span id="status-text">Loading...</span>
      <span id="last-updated"></span>
    </div>
    
    <div class="controls">
      <div class="shop-filter">
        <label>Shop:</label>
        <select id="shop-select">
          <option value="all">All Shops</option>
          <option value="Blood Shard Shop">Blood Shard Shop</option>
          <option value="Blood Synthesis Shop">Blood Synthesis Shop</option>
        </select>
      </div>
      
      <div class="date-filter">
        <label>Date Range:</label>
        <select id="date-select">
          <option value="1h">Last Hour</option>
          <option value="24h" selected>Last 24 Hours</option>
          <option value="7d">Last 7 Days</option>
          <option value="30d">Last 30 Days</option>
          <option value="all">All Time</option>
        </select>
      </div>
      
      <div class="sort-control">
        <label>Sort By:</label>
        <select id="sort-select">
          <option value="cost_min">Cost/Token (Min Price)</option>
          <option value="cost_avg">Cost/Token (Avg Price)</option>
          <option value="cost_max">Cost/Token (Max Price)</option>
          <option value="name">Item Name</option>
        </select>
      </div>
    </div>
    
    <!-- BLOODCHANTING STONE CALCULATOR -->
    <div class="bloodchanting-calculator">
      <h2>Bloodchanting Stone Calculator</h2>
      <p class="recipe">Recipe: 10 Blood Diamonds + 250 Blood Shards + 500 Blood Synthesis Tokens</p>
      
      <div class="scenario-tabs">
        <button class="scenario-tab active" data-scenario="min">Best Case (Min)</button>
        <button class="scenario-tab" data-scenario="avg">Average Case</button>
        <button class="scenario-tab" data-scenario="max">Worst Case (Max)</button>
      </div>
      
      <div id="bloodchanting-display">
        <!-- Populated by JavaScript -->
      </div>
    </div>
    
    <!-- SHOP ITEMS TABLE -->
    <div class="table-container">
      <h2>Shop Items</h2>
      <table id="arbitrage-table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Shop</th>
            <th>Tokens</th>
            <th>Min Price</th>
            <th>Avg Price</th>
            <th>Max Price</th>
            <th>Cost/Token (Min)</th>
            <th>Cost/Token (Avg)</th>
            <th>Cost/Token (Max)</th>
            <th>Trades</th>
          </tr>
        </thead>
        <tbody id="table-body">
          <!-- Populated by JavaScript -->
        </tbody>
      </table>
    </div>
    
    <div id="loading" class="hidden">
      <p>Loading trade data...</p>
    </div>
  </div>
  
  <script type="module" src="js/main.js"></script>
</body>
</html>
```

### Bloodchanting Display Template

```javascript
function renderBloodchantingCalculation(calculation, scenario) {
  const result = calculation[scenario];
  
  if (!result || result.error) {
    return `
      <div class="error">
        ${result?.error || 'Unable to calculate. Insufficient data.'}
      </div>
    `;
  }
  
  const shard = result.shard_component;
  const token = result.token_component;
  const diamond = result.diamond_component;
  
  return `
    <div class="bloodchanting-result">
      <div class="total-cost">
        <h3>Total Cost: ${formatMillions(result.total_cost_millions)}</h3>
      </div>
      
      <div class="components">
        <div class="component shard-component">
          <h4>Blood Shards (250 needed)</h4>
          <div class="component-details">
            <p><strong>Buy:</strong> ${shard.items_to_buy}x ${shard.item_name}</p>
            <p><strong>Receive:</strong> ${shard.total_shards_received} shards (${shard.shards_per_item} per item)</p>
            <p><strong>Cost per shard:</strong> ${formatMillions(shard.cost_per_shard)}</p>
            <p class="component-total"><strong>Subtotal:</strong> ${formatMillions(shard.total_cost_millions)}</p>
          </div>
        </div>
        
        <div class="component token-component">
          <h4>Blood Synthesis Tokens (500 needed)</h4>
          <div class="component-details">
            <p><strong>Buy:</strong> ${token.items_to_buy}x ${token.item_name}</p>
            <p><strong>Receive:</strong> ${token.total_tokens_received.toLocaleString()} tokens (${token.tokens_per_item.toLocaleString()} per item)</p>
            <p><strong>Cost per token:</strong> ${formatMillions(token.cost_per_token)}</p>
            <p class="component-total"><strong>Subtotal:</strong> ${formatMillions(token.total_cost_millions)}</p>
          </div>
        </div>
        
        <div class="component diamond-component">
          <h4>Blood Diamonds (10 needed)</h4>
          <div class="component-details">
            <p><strong>Buy:</strong> ${diamond.diamonds_to_buy}x Blood diamond</p>
            <p><strong>Cost per diamond:</strong> ${formatMillions(diamond.cost_per_diamond)}</p>
            <p class="component-total"><strong>Subtotal:</strong> ${formatMillions(diamond.total_cost_millions)}</p>
          </div>
        </div>
      </div>
      
      <div class="shopping-list">
        <h4>Shopping List:</h4>
        <ul>
          <li>Buy ${shard.items_to_buy}x ${shard.item_name} (for ${shard.total_shards_received} shards, use 250)</li>
          <li>Buy ${token.items_to_buy}x ${token.item_name} (for ${token.total_tokens_received.toLocaleString()} tokens, use 500)</li>
          <li>Buy ${diamond.diamonds_to_buy}x Blood diamond</li>
        </ul>
      </div>
    </div>
  `;
}

function formatMillions(value) {
  if (value === null || value === undefined) return '-';
  return value.toFixed(2) + 'M';
}
```

---

## Application Architecture

### File Structure

```
spawnpk-arbitrage/
├── index.html              
├── css/
│   └── styles.css         
├── js/
│   ├── api.js             # Trade API client
│   ├── calculator.js      # Arbitrage + Bloodchanting calculations
│   ├── storage.js         # LocalStorage cache
│   └── main.js            # Application entry
├── data/
│   ├── blood_shard_shop.json
│   └── blood_synthesis_shop.json
└── README.md
```

### Core JavaScript Modules

#### api.js - Trade API Client

```javascript
class TradeAPI {
  constructor() {
    this.baseURL = 'https://hqxg0u8s64.execute-api.ca-central-1.amazonaws.com/Production/tradingpost';
    this.requestDelay = 500;
    this.lastRequestTime = 0;
  }
  
  async throttle() {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.requestDelay) {
      await new Promise(resolve => setTimeout(resolve, this.requestDelay - elapsed));
    }
    this.lastRequestTime = Date.now();
  }
  
  async fetchTrades(itemName, maxPages = 10) {
    const allTrades = [];
    let page = 1;
    
    while (page <= maxPages) {
      await this.throttle();
      
      try {
        const url = `${this.baseURL}?search_text=${encodeURIComponent(itemName)}&page=${page}`;
        const response = await fetch(url);
        
        if (!response.ok) {
          console.error(`HTTP ${response.status} for ${itemName}`);
          break;
        }
        
        const data = await response.json();
        
        if (!data || data.length === 0) {
          break;
        }
        
        allTrades.push(...data);
        page++;
      } catch (error) {
        console.error(`Error fetching ${itemName}:`, error);
        break;
      }
    }
    
    return allTrades;
  }
  
  convertToGP(trade) {
    const multiplier = trade.currency === 1 ? 100_000_000 : 1;
    return trade.price * multiplier * trade.amount;
  }
  
  filterByDateRange(trades, dateFilter) {
    if (dateFilter === 'all') {
      return trades;
    }
    
    const now = new Date();
    const cutoffs = {
      '1h': 1 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000
    };
    
    const cutoffTime = new Date(now.getTime() - cutoffs[dateFilter]);
    
    return trades.filter(trade => {
      const tradeTime = new Date(trade.time);
      return tradeTime >= cutoffTime;
    });
  }
}
```

#### calculator.js - All Calculations

```javascript
class ArbitrageCalculator {
  constructor(shopConfigs, tradeData, dateFilter = 'all') {
    this.shopConfigs = shopConfigs;
    this.tradeData = tradeData;
    this.dateFilter = dateFilter;
    this.api = new TradeAPI();
  }
  
  calculateStatistics(trades) {
    if (trades.length === 0) {
      return null;
    }
    
    const pricesGP = trades.map(t => this.api.convertToGP(t));
    const sortedPrices = [...pricesGP].sort((a, b) => a - b);
    
    return {
      min_price_gp: sortedPrices[0],
      max_price_gp: sortedPrices[sortedPrices.length - 1],
      avg_price_gp: pricesGP.reduce((a, b) => a + b, 0) / pricesGP.length,
      median_price_gp: sortedPrices[Math.floor(sortedPrices.length / 2)],
      trade_count: trades.length,
      last_trade_time: trades[trades.length - 1].time
    };
  }
  
  calculateOpportunities() {
    const opportunities = [];
    
    for (const shop of this.shopConfigs) {
      for (const shopItem of shop.items) {
        // Find trades for this item
        let itemTrades = this.tradeData.filter(trade => 
          trade.item_id === shopItem.item_id || 
          trade.item_name.toLowerCase() === shopItem.item_name.toLowerCase()
        );
        
        // Apply date filter
        itemTrades = this.api.filterByDateRange(itemTrades, this.dateFilter);
        
        // Calculate statistics
        const stats = this.calculateStatistics(itemTrades);
        
        if (!stats) {
          // No trade data in this date range
          opportunities.push({
            item_name: shopItem.item_name,
            item_id: shopItem.item_id,
            shop_name: shop.shop_name,
            shop_currency: shop.currency,
            tokens_received: shopItem.value,
            
            min_price_gp: null,
            avg_price_gp: null,
            max_price_gp: null,
            median_price_gp: null,
            
            cost_per_token_min: null,
            cost_per_token_avg: null,
            cost_per_token_max: null,
            
            trade_count: 0,
            last_trade_time: null
          });
          continue;
        }
        
        // Calculate cost per token (in millions)
        const opportunity = {
          item_name: shopItem.item_name,
          item_id: shopItem.item_id,
          shop_name: shop.shop_name,
          shop_currency: shop.currency,
          tokens_received: shopItem.value,
          
          min_price_gp: stats.min_price_gp,
          avg_price_gp: stats.avg_price_gp,
          max_price_gp: stats.max_price_gp,
          median_price_gp: stats.median_price_gp,
          
          cost_per_token_min: (stats.min_price_gp / 1_000_000) / shopItem.value,
          cost_per_token_avg: (stats.avg_price_gp / 1_000_000) / shopItem.value,
          cost_per_token_max: (stats.max_price_gp / 1_000_000) / shopItem.value,
          
          trade_count: stats.trade_count,
          last_trade_time: stats.last_trade_time
        };
        
        opportunities.push(opportunity);
      }
    }
    
    return opportunities;
  }
}

class BloodchantingCalculator {
  constructor(bloodShardOpportunities, bloodSynthesisOpportunities, bloodDiamondTrades, dateFilter = 'all') {
    this.shardOpps = bloodShardOpportunities;
    this.tokenOpps = bloodSynthesisOpportunities;
    this.dateFilter = dateFilter;
    
    this.RECIPE = {
      blood_diamonds: 10,
      blood_shards: 250,
      blood_synthesis_tokens: 500
    };
    
    this.api = new TradeAPI();
    
    // Calculate blood diamond statistics
    const filteredDiamondTrades = this.api.filterByDateRange(bloodDiamondTrades, dateFilter);
    this.diamondStats = this.calculateDiamondStats(filteredDiamondTrades);
  }
  
  calculateDiamondStats(trades) {
    if (trades.length === 0) {
      return null;
    }
    
    const pricesGP = trades.map(t => this.api.convertToGP(t));
    const sortedPrices = [...pricesGP].sort((a, b) => a - b);
    
    return {
      min_price_gp: sortedPrices[0],
      avg_price_gp: pricesGP.reduce((a, b) => a + b, 0) / pricesGP.length,
      max_price_gp: sortedPrices[sortedPrices.length - 1],
      trade_count: trades.length
    };
  }
  
  calculate() {
    // Check if we have diamond data
    if (!this.diamondStats) {
      return {
        error: 'No Blood Diamond trade data in selected date range'
      };
    }
    
    // Filter out items with no trade data
    const validShardItems = this.shardOpps.filter(item => item.min_price_gp !== null);
    const validTokenItems = this.tokenOpps.filter(item => item.min_price_gp !== null);
    
    if (validShardItems.length === 0 || validTokenItems.length === 0) {
      return {
        error: 'Insufficient trade data in selected date range'
      };
    }
    
    // Calculate for each scenario
    const results = {
      min: this.calculateScenario('min', validShardItems, validTokenItems),
      avg: this.calculateScenario('avg', validShardItems, validTokenItems),
      max: this.calculateScenario('max', validShardItems, validTokenItems)
    };
    
    return results;
  }
  
  calculateScenario(scenario, shardItems, tokenItems) {
    // Find item with lowest cost per shard
    const cheapestShardItem = shardItems.reduce((best, item) => {
      const bestCost = best[`cost_per_token_${scenario}`];
      const itemCost = item[`cost_per_token_${scenario}`];
      return itemCost < bestCost ? item : best;
    });
    
    // Find item with lowest cost per token
    const cheapestTokenItem = tokenItems.reduce((best, item) => {
      const bestCost = best[`cost_per_token_${scenario}`];
      const itemCost = item[`cost_per_token_${scenario}`];
      return itemCost < bestCost ? item : best;
    });
    
    // Calculate quantities needed
    const shardsPerItem = cheapestShardItem.tokens_received;
    const tokensPerItem = cheapestTokenItem.tokens_received;
    
    const itemsNeededForShards = Math.ceil(this.RECIPE.blood_shards / shardsPerItem);
    const itemsNeededForTokens = Math.ceil(this.RECIPE.blood_synthesis_tokens / tokensPerItem);
    
    // Calculate costs (in millions)
    const shardCost = cheapestShardItem[`cost_per_token_${scenario}`] * this.RECIPE.blood_shards;
    const tokenCost = cheapestTokenItem[`cost_per_token_${scenario}`] * this.RECIPE.blood_synthesis_tokens;
    const diamondCost = (this.diamondStats[`${scenario}_price_gp`] / 1_000_000) * this.RECIPE.blood_diamonds;
    
    const totalCost = shardCost + tokenCost + diamondCost;
    
    return {
      total_cost_millions: totalCost,
      
      shard_component: {
        item_name: cheapestShardItem.item_name,
        item_id: cheapestShardItem.item_id,
        shards_per_item: shardsPerItem,
        items_to_buy: itemsNeededForShards,
        total_shards_received: itemsNeededForShards * shardsPerItem,
        cost_per_shard: cheapestShardItem[`cost_per_token_${scenario}`],
        total_cost_millions: shardCost
      },
      
      token_component: {
        item_name: cheapestTokenItem.item_name,
        item_id: cheapestTokenItem.item_id,
        tokens_per_item: tokensPerItem,
        items_to_buy: itemsNeededForTokens,
        total_tokens_received: itemsNeededForTokens * tokensPerItem,
        cost_per_token: cheapestTokenItem[`cost_per_token_${scenario}`],
        total_cost_millions: tokenCost
      },
      
      diamond_component: {
        item_name: 'Blood diamond',
        diamonds_to_buy: this.RECIPE.blood_diamonds,
        cost_per_diamond: this.diamondStats[`${scenario}_price_gp`] / 1_000_000,
        total_cost_millions: diamondCost
      }
    };
  }
}
```

#### main.js - Application Entry Point

```javascript
import { TradeAPI } from './api.js';
import { ArbitrageCalculator, BloodchantingCalculator } from './calculator.js';
import { DataCache } from './storage.js';

class ArbitrageApp {
  constructor() {
    this.api = new TradeAPI();
    this.cache = new DataCache();
    this.shopConfigs = [];
    this.tradeData = [];
    this.bloodDiamondTrades = [];
    this.opportunities = [];
    this.bloodchantingCalc = null;
    this.currentDateFilter = '24h';
    this.currentScenario = 'min';
  }
  
  async init() {
    await this.loadShopConfigs();
    
    const cached = this.cache.loadTradeData();
    if (cached) {
      this.showCachedData(cached);
    }
    
    this.setupEventListeners();
    this.loadPreferences();
  }
  
  async loadShopConfigs() {
    try {
      const [bloodShard, bloodSynthesis] = await Promise.all([
        fetch('data/blood_shard_shop.json').then(r => r.json()),
        fetch('data/blood_synthesis_shop.json').then(r => r.json())
      ]);
      
      this.shopConfigs = [bloodShard, bloodSynthesis];
    } catch (error) {
      console.error('Error loading shop configs:', error);
      alert('Error loading shop configurations');
    }
  }
  
  async fetchAllTradeData() {
    this.showLoading(true);
    this.updateStatus('Fetching trade data...');
    
    this.tradeData = [];
    
    // Get all items from both shops
    const allItems = this.shopConfigs.flatMap(shop => shop.items);
    
    // Fetch trades for each shop item
    for (let i = 0; i < allItems.length; i++) {
      const item = allItems[i];
      this.updateStatus(`Fetching ${item.item_name} (${i + 1}/${allItems.length})`);
      
      const trades = await this.api.fetchTrades(item.item_name, 10);
      this.tradeData.push(...trades);
    }
    
    // Fetch blood diamond trades
    this.updateStatus('Fetching Blood diamond data...');
    this.bloodDiamondTrades = await this.api.fetchTrades('Blood diamond', 10);
    
    // Cache the data
    this.cache.saveTradeData({
      trades: this.tradeData,
      bloodDiamonds: this.bloodDiamondTrades,
      timestamp: Date.now()
    });
    
    // Calculate and render
    this.calculateAndRender();
    this.showLoading(false);
    this.updateLastUpdated();
  }
  
  calculateAndRender() {
    // Calculate opportunities with current date filter
    const calculator = new ArbitrageCalculator(
      this.shopConfigs, 
      this.tradeData,
      this.currentDateFilter
    );
    this.opportunities = calculator.calculateOpportunities();
    
    // Separate by shop
    const shardOpps = this.opportunities.filter(o => o.shop_name === 'Blood Shard Shop');
    const tokenOpps = this.opportunities.filter(o => o.shop_name === 'Blood Synthesis Shop');
    
    // Calculate bloodchanting stone cost
    const bloodchantingCalc = new BloodchantingCalculator(
      shardOpps,
      tokenOpps,
      this.bloodDiamondTrades,
      this.currentDateFilter
    );
    this.bloodchantingCalc = bloodchantingCalc.calculate();
    
    // Render everything
    this.renderBloodchanting();
    this.renderTable();
  }
  
  renderBloodchanting() {
    const display = document.getElementById('bloodchanting-display');
    display.innerHTML = renderBloodchantingCalculation(this.bloodchantingCalc, this.currentScenario);
  }
  
  renderTable() {
    const tbody = document.getElementById('table-body');
    tbody.innerHTML = '';
    
    let filtered = this.filterOpportunities();
    filtered = this.sortOpportunities(filtered);
    
    for (const opp of filtered) {
      const row = createTableRow(opp);
      tbody.appendChild(row);
    }
    
    this.updateStatus(`Showing ${filtered.length} items (Date filter: ${this.currentDateFilter})`);
  }
  
  filterOpportunities() {
    const selectedShop = document.getElementById('shop-select').value;
    
    if (selectedShop === 'all') {
      return this.opportunities;
    }
    
    return this.opportunities.filter(opp => opp.shop_name === selectedShop);
  }
  
  sortOpportunities(opportunities) {
    const sortBy = document.getElementById('sort-select').value;
    
    const sorters = {
      'cost_min': (a, b) => {
        if (a.cost_per_token_min === null) return 1;
        if (b.cost_per_token_min === null) return -1;
        return a.cost_per_token_min - b.cost_per_token_min;
      },
      'cost_avg': (a, b) => {
        if (a.cost_per_token_avg === null) return 1;
        if (b.cost_per_token_avg === null) return -1;
        return a.cost_per_token_avg - b.cost_per_token_avg;
      },
      'cost_max': (a, b) => {
        if (a.cost_per_token_max === null) return 1;
        if (b.cost_per_token_max === null) return -1;
        return a.cost_per_token_max - b.cost_per_token_max;
      },
      'name': (a, b) => a.item_name.localeCompare(b.item_name)
    };
    
    return [...opportunities].sort(sorters[sortBy]);
  }
  
  setupEventListeners() {
    // Refresh button
    document.getElementById('refresh-btn').addEventListener('click', () => {
      this.fetchAllTradeData();
    });
    
    // Date filter - CRITICAL for bloodchanting calculation
    document.getElementById('date-select').addEventListener('change', (e) => {
      this.currentDateFilter = e.target.value;
      this.calculateAndRender(); // Recalculate with new date filter
      this.savePreferences();
    });
    
    // Shop filter
    document.getElementById('shop-select').addEventListener('change', () => {
      this.renderTable();
      this.savePreferences();
    });
    
    // Sort select
    document.getElementById('sort-select').addEventListener('change', () => {
      this.renderTable();
      this.savePreferences();
    });
    
    // Scenario tabs
    document.querySelectorAll('.scenario-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        document.querySelectorAll('.scenario-tab').forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        this.currentScenario = e.target.dataset.scenario;
        this.renderBloodchanting();
      });
    });
  }
  
  savePreferences() {
    const prefs = {
      sortBy: document.getElementById('sort-select').value,
      selectedShop: document.getElementById('shop-select').value,
      dateFilter: this.currentDateFilter
    };
    this.cache.savePreferences(prefs);
  }
  
  loadPreferences() {
    const prefs = this.cache.loadPreferences();
    document.getElementById('sort-select').value = prefs.sortBy;
    document.getElementById('shop-select').value = prefs.selectedShop;
    document.getElementById('date-select').value = prefs.dateFilter;
    this.currentDateFilter = prefs.dateFilter;
  }
  
  showCachedData(cached) {
    this.tradeData = cached.trades;
    this.bloodDiamondTrades = cached.bloodDiamonds || [];
    this.calculateAndRender();
    
    const age = Date.now() - cached.timestamp;
    const minutes = Math.floor(age / 60000);
    this.updateStatus(`Using cached data (${minutes} min old)`);
  }
  
  showLoading(show) {
    document.getElementById('loading').classList.toggle('hidden', !show);
  }
  
  updateStatus(message) {
    document.getElementById('status-text').textContent = message;
  }
  
  updateLastUpdated() {
    const now = new Date().toLocaleString();
    document.getElementById('last-updated').textContent = `Last updated: ${now}`;
  }
}

// Helper functions
function createTableRow(opportunity) {
  const row = document.createElement('tr');
  const hasData = opportunity.min_price_gp !== null;
  
  row.innerHTML = `
    <td>${opportunity.item_name}</td>
    <td>${opportunity.shop_name}</td>
    <td>${opportunity.tokens_received.toLocaleString()}</td>
    <td>${hasData ? formatMillions(opportunity.min_price_gp) : 'No data'}</td>
    <td>${hasData ? formatMillions(opportunity.avg_price_gp) : 'No data'}</td>
    <td>${hasData ? formatMillions(opportunity.max_price_gp) : 'No data'}</td>
    <td>${hasData ? formatMillions(opportunity.cost_per_token_min) + '/token' : '-'}</td>
    <td>${hasData ? formatMillions(opportunity.cost_per_token_avg) + '/token' : '-'}</td>
    <td>${hasData ? formatMillions(opportunity.cost_per_token_max) + '/token' : '-'}</td>
    <td>${opportunity.trade_count}</td>
  `;
  
  return row;
}

function renderBloodchantingCalculation(calculation, scenario) {
  const result = calculation[scenario];
  
  if (!result || calculation.error) {
    return `
      <div class="error">
        ${calculation.error || 'Unable to calculate. Insufficient data.'}
      </div>
    `;
  }
  
  const shard = result.shard_component;
  const token = result.token_component;
  const diamond = result.diamond_component;
  
  return `
    <div class="bloodchanting-result">
      <div class="total-cost">
        <h3>Total Cost: ${formatMillions(result.total_cost_millions)}</h3>
      </div>
      
      <div class="components">
        <div class="component shard-component">
          <h4>Blood Shards (250 needed)</h4>
          <div class="component-details">
            <p><strong>Buy:</strong> ${shard.items_to_buy}x ${shard.item_name}</p>
            <p><strong>Receive:</strong> ${shard.total_shards_received} shards (${shard.shards_per_item} per item)</p>
            <p><strong>Cost per shard:</strong> ${formatMillions(shard.cost_per_shard)}</p>
            <p class="component-total"><strong>Subtotal:</strong> ${formatMillions(shard.total_cost_millions)}</p>
          </div>
        </div>
        
        <div class="component token-component">
          <h4>Blood Synthesis Tokens (500 needed)</h4>
          <div class="component-details">
            <p><strong>Buy:</strong> ${token.items_to_buy}x ${token.item_name}</p>
            <p><strong>Receive:</strong> ${token.total_tokens_received.toLocaleString()} tokens (${token.tokens_per_item.toLocaleString()} per item)</p>
            <p><strong>Cost per token:</strong> ${formatMillions(token.cost_per_token)}</p>
            <p class="component-total"><strong>Subtotal:</strong> ${formatMillions(token.total_cost_millions)}</p>
          </div>
        </div>
        
        <div class="component diamond-component">
          <h4>Blood Diamonds (10 needed)</h4>
          <div class="component-details">
            <p><strong>Buy:</strong> ${diamond.diamonds_to_buy}x Blood diamond</p>
            <p><strong>Cost per diamond:</strong> ${formatMillions(diamond.cost_per_diamond)}</p>
            <p class="component-total"><strong>Subtotal:</strong> ${formatMillions(diamond.total_cost_millions)}</p>
          </div>
        </div>
      </div>
      
      <div class="shopping-list">
        <h4>Shopping List:</h4>
        <ul>
          <li>Buy ${shard.items_to_buy}x ${shard.item_name} (get ${shard.total_shards_received} shards, use 250)</li>
          <li>Buy ${token.items_to_buy}x ${token.item_name} (get ${token.total_tokens_received.toLocaleString()} tokens, use 500)</li>
          <li>Buy ${diamond.diamonds_to_buy}x Blood diamond</li>
        </ul>
      </div>
    </div>
  `;
}

function formatMillions(value) {
  if (value === null || value === undefined) return '-';
  return (value / 1_000_000).toFixed(2) + 'M';
}

// Initialize app
const app = new ArbitrageApp();
app.init();
```

---

## Key Implementation Notes

### Date Filtering

**Critical Behavior:**
- Date filter applies to ALL calculations
- When filter changes, ALL data is recalculated
- Items without trades in date range show "No data"
- Bloodchanting calculator only uses items with valid data in the selected window

**Example:**
- User selects "Last 24 Hours"
- Only trades from last 24 hours are considered
- Dragon Claws may have no trades → excluded from bloodchanting calculation
- Blood Diamonds may have no trades → error displayed

### Real-Time Updates

**What updates live:**
- Date filter change → Recalculate everything
- Shop filter change → Refilter table only
- Sort change → Resort table only
- Scenario tab change → Re-render bloodchanting display only

### Data Availability

**Handling missing data:**
- Items without trades show "No data" in table
- Items without trades excluded from bloodchanting calculation
- If blood diamonds have no trades → error message
- If no shard items have trades → error message
- If no token items have trades → error message

---

## Mobile Responsiveness

### Responsive CSS (Basic Structure)

```css
/* Desktop */
@media (min-width: 768px) {
  .table-container {
    overflow-x: auto;
  }
  
  .components {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1rem;
  }
}

/* Mobile */
@media (max-width: 767px) {
  table {
    font-size: 0.9rem;
  }
  
  .components {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  
  .scenario-tabs {
    display: flex;
    flex-direction: column;
  }
}
```

---

## GitHub Pages Deployment

### Repository Setup

```bash
git init
git add .
git commit -m "Initial commit - Bloodchanting calculator"
git branch -M main
git remote add origin https://github.com/yourusername/spawnpk-arbitrage.git
git push -u origin main
```

### Enable GitHub Pages

1. Go to repository Settings
2. Navigate to Pages
3. Source: main branch, / (root)
4. Save

Live at: `https://yourusername.github.io/spawnpk-arbitrage/`

---

## Testing Checklist

- [ ] Blood diamond API fetching works
- [ ] Date filter updates all calculations
- [ ] Bloodchanting calculator handles missing data
- [ ] Scenario tabs switch correctly
- [ ] Shopping list shows correct quantities
- [ ] Cost calculations accurate across all scenarios
- [ ] Items without trades show "No data"
- [ ] Mobile responsive layout works
- [ ] Preferences persist across sessions
- [ ] Cache works correctly

---

## Summary

### Core Features

1. ✅ **Shop item arbitrage** - Find cheapest GP-per-token items
2. ✅ **Bloodchanting stone calculator** - Optimal crafting cost
3. ✅ **Date filtering** - Historical analysis or current prices
4. ✅ **Three scenarios** - Min/Avg/Max price calculations
5. ✅ **Real-time updates** - All calculations update with filter changes
6. ✅ **Blood diamond market** - Fetched from API like shop items
7. ✅ **Shopping list** - Exact items and quantities to buy
8. ✅ **Mobile responsive** - Works on all devices
9. ✅ **GitHub Pages ready** - Static hosting, no backend needed
10. ✅ **Local caching** - Fast repeat visits

The system now provides complete bloodchanting stone cost analysis with dynamic date filtering! 🎯
