/**
 * Unified Trade Economics Dashboard
 * Combines bloodchanting calculator with smart recommendations
 */

import { formatGP, formatMillions } from './calculator.js';

class UnifiedDashboard {
  constructor() {
    this.recommendationsData = null;
    this.tradeCacheData = null;
    this.currentWindow = '7d';
    this.currentCurrency = 'Blood Shards';
    this.currentScenario = 'min';
    this.charts = {};
  }

  async init() {
    console.log('Initializing Unified Dashboard...');

    // Setup event listeners
    this.setupEventListeners();

    // Load all data
    await this.loadData();
  }

  setupEventListeners() {
    // Time window tabs
    document.querySelectorAll('.time-tab[data-window]').forEach(tab => {
      tab.addEventListener('click', (e) => {
        document.querySelectorAll('.time-tab[data-window]').forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        this.currentWindow = e.target.dataset.window;

        // Update current window display
        const windowDisplay = document.getElementById('current-window-display');
        if (windowDisplay) {
          windowDisplay.textContent = this.currentWindow;
        }

        this.render();
      });
    });

    // Currency tabs
    document.querySelectorAll('.currency-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        document.querySelectorAll('.currency-tab').forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        this.currentCurrency = e.target.dataset.currency;
        this.render();
      });
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

  async loadData() {
    this.showLoading(true);
    this.updateStatus('Loading market data...');

    try {
      // Load recommendations JSON (has all the analytics)
      const [recResponse, cacheResponse] = await Promise.all([
        fetch('data/trade_recommendations.json'),
        fetch('data/trade_cache.json')
      ]);

      if (!recResponse.ok) throw new Error('Could not load recommendations');
      if (!cacheResponse.ok) throw new Error('Could not load trade cache');

      this.recommendationsData = await recResponse.json();
      this.tradeCacheData = await cacheResponse.json();

      console.log('Data loaded:', {
        recommendations: this.recommendationsData.metadata,
        tradeCache: this.tradeCacheData.metadata
      });

      // Update last updated time
      if (this.recommendationsData.metadata.generated_at) {
        const date = new Date(this.recommendationsData.metadata.generated_at);
        document.getElementById('last-updated').textContent =
          `Data: ${date.toLocaleString()}`;
      }

      // Set initial window display
      const windowDisplay = document.getElementById('current-window-display');
      if (windowDisplay) {
        windowDisplay.textContent = this.currentWindow;
      }

      this.render();
      this.updateStatus(`Loaded ${this.recommendationsData.metadata.active_items} active items`);
      this.showLoading(false);

    } catch (error) {
      console.error('Error loading data:', error);
      this.updateStatus('Error loading data - Please run trade_economics_analysis.py first');
      this.showLoading(false);
    }
  }

  render() {
    if (!this.recommendationsData) return;

    this.renderBloodchanting();
    this.renderRecommendations();
    this.renderCharts();
    this.renderQuickStats();
  }

  renderQuickStats() {
    // Get best shard item
    const shardItems = this.recommendationsData.currencies['Blood Shards'].items
      .filter(item => item.has_trades && item.time_windows[this.currentWindow].has_data);

    let bestShardItem = null;
    let bestShardRate = Infinity;

    for (const item of shardItems) {
      const windowData = item.time_windows[this.currentWindow];
      const rate = windowData.median_price / item.shop_cost;
      if (rate < bestShardRate) {
        bestShardRate = rate;
        bestShardItem = { item, windowData };
      }
    }

    // Get best token item
    const tokenItems = this.recommendationsData.currencies['Blood Synthesis Tokens'].items
      .filter(item => item.has_trades && item.time_windows[this.currentWindow].has_data);

    let bestTokenItem = null;
    let bestTokenRate = Infinity;

    for (const item of tokenItems) {
      const windowData = item.time_windows[this.currentWindow];
      const rate = windowData.median_price / item.shop_cost;
      if (rate < bestTokenRate) {
        bestTokenRate = rate;
        bestTokenItem = { item, windowData };
      }
    }

    // Calculate bloodchanting profitability
    const bloodDiamondTrades = this.filterTradesByTimeWindow(
      this.tradeCacheData.trades.filter(t => t.item_name === 'Blood diamonds'),
      this.currentWindow
    );

    const bloodchantingStoneTrades = this.filterTradesByTimeWindow(
      this.tradeCacheData.trades.filter(t => t.item_name === 'Bloodchanting stone'),
      this.currentWindow
    );

    let profitInfo = { profit: 0, totalCost: 0, stonePrice: 0, canCalculate: false };

    if (bestShardItem && bestTokenItem && bloodDiamondTrades.length > 0 && bloodchantingStoneTrades.length > 0) {
      const diamondPrice = bloodDiamondTrades.map(t => t.price / t.amount).reduce((a, b) => a + b) / bloodDiamondTrades.length;
      const stonePrice = bloodchantingStoneTrades.map(t => t.price / t.amount).reduce((a, b) => a + b) / bloodchantingStoneTrades.length;

      const shardCost = 250 * bestShardRate;
      const tokenCost = 500 * bestTokenRate;
      const diamondCost = 10 * diamondPrice;
      const totalCost = shardCost + tokenCost + diamondCost;
      const profit = stonePrice - totalCost;

      profitInfo = { profit, totalCost, stonePrice, canCalculate: true };
    }

    // Update UI
    if (bestShardItem) {
      document.getElementById('best-shard-name').textContent = bestShardItem.item.name;
      document.getElementById('best-shard-rate').textContent = `${bestShardRate.toFixed(2)} bags/shard`;
      document.getElementById('best-shard-roi').textContent = `${bestShardItem.windowData.roi >= 0 ? '+' : ''}${bestShardItem.windowData.roi.toFixed(1)}% ROI`;
    }

    if (bestTokenItem) {
      document.getElementById('best-token-name').textContent = bestTokenItem.item.name;
      document.getElementById('best-token-rate').textContent = `${bestTokenRate.toFixed(2)} bags/token`;
      document.getElementById('best-token-roi').textContent = `${bestTokenItem.windowData.roi >= 0 ? '+' : ''}${bestTokenItem.windowData.roi.toFixed(1)}% ROI`;
    }

    if (profitInfo.canCalculate) {
      const profitEl = document.getElementById('bloodchanting-profit-amount');
      const detailEl = document.getElementById('bloodchanting-cost-detail');
      const recEl = document.getElementById('bloodchanting-recommendation');

      profitEl.textContent = `${profitInfo.profit >= 0 ? '+' : ''}${this.formatPrice(profitInfo.profit)} bags`;
      profitEl.style.color = profitInfo.profit >= 0 ? '#10b981' : '#ef4444';

      detailEl.textContent = `Cost: ${this.formatPrice(profitInfo.totalCost)} | Market: ${this.formatPrice(profitInfo.stonePrice)} bags`;

      recEl.textContent = profitInfo.profit >= 0 ? '✅ Craft & Sell' : '❌ Buy from Market';
      recEl.style.color = profitInfo.profit >= 0 ? '#10b981' : '#ef4444';
    }
  }

  renderBloodchanting() {
    if (!this.recommendationsData || !this.tradeCacheData) return;

    const display = document.getElementById('bloodchanting-display');

    // Get top performer from each currency for bloodchanting using CURRENT TIME WINDOW
    const shardItems = this.recommendationsData.currencies['Blood Shards'].items
      .filter(i => i.has_trades && i.time_windows[this.currentWindow].has_data)
      .slice(0, 10);

    const tokenItems = this.recommendationsData.currencies['Blood Synthesis Tokens'].items
      .filter(i => i.has_trades && i.time_windows[this.currentWindow].has_data)
      .slice(0, 10);

    if (shardItems.length === 0 || tokenItems.length === 0) {
      display.innerHTML = '<p class="text-osrs-light text-center py-4">Insufficient data for bloodchanting calculator in selected time window</p>';
      return;
    }

    // Get blood diamond prices from trade cache (filter by time window)
    const bloodDiamondTrades = this.filterTradesByTimeWindow(
      this.tradeCacheData.trades.filter(t => t.item_name === 'Blood diamonds'),
      this.currentWindow
    );

    if (bloodDiamondTrades.length === 0) {
      display.innerHTML = `<p class="text-osrs-light text-center py-4">No blood diamond trades in ${this.currentWindow} time window</p>`;
      return;
    }

    // Get bloodchanting stone market prices for comparison
    const bloodchantingStoneTrades = this.filterTradesByTimeWindow(
      this.tradeCacheData.trades.filter(t => t.item_name === 'Bloodchanting stone'),
      this.currentWindow
    );

    // Calculate bloodchanting cost
    const result = this.calculateBloodchanting(shardItems, tokenItems, bloodDiamondTrades, bloodchantingStoneTrades);

    display.innerHTML = this.renderBloodchantingHTML(result);
  }

  filterTradesByTimeWindow(trades, window) {
    if (window === 'all') return trades;

    if (trades.length === 0) return [];

    // Use the latest trade timestamp as reference instead of current time
    // This prevents all trades from appearing "old" if data isn't current
    const tradeTimes = trades.map(t => new Date(t.time).getTime());
    const latestTradeTime = Math.max(...tradeTimes);

    const windowMs = {
      '1h': 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000
    };

    const cutoff = new Date(latestTradeTime - windowMs[window]);
    return trades.filter(t => new Date(t.time) >= cutoff);
  }

  calculateBloodchanting(shardItems, tokenItems, bloodDiamondTrades, bloodchantingStoneTrades) {
    const scenario = this.currentScenario;
    const window = this.currentWindow;

    // Find best shard item (250 shards needed) - USE CURRENT TIME WINDOW
    let bestShardItem = null;
    let bestShardCostPerShard = Infinity;

    for (const item of shardItems) {
      const shardsReceived = item.shop_cost;
      const windowData = item.time_windows[window];

      if (!windowData.has_data) continue;

      const priceGP = scenario === 'min'
        ? windowData.zones.excellent
        : windowData.median_price;

      if (priceGP === 0) continue;

      const costPerShard = priceGP / shardsReceived;

      if (costPerShard < bestShardCostPerShard) {
        bestShardCostPerShard = costPerShard;
        bestShardItem = {
          name: item.name,
          shardsPerItem: shardsReceived,
          pricePerItem: priceGP,
          costPerShard
        };
      }
    }

    // Find best token item (500 tokens needed) - USE CURRENT TIME WINDOW
    let bestTokenItem = null;
    let bestTokenCostPerToken = Infinity;

    for (const item of tokenItems) {
      const tokensReceived = item.shop_cost;
      const windowData = item.time_windows[window];

      if (!windowData.has_data) continue;

      const priceGP = scenario === 'min'
        ? windowData.zones.excellent
        : windowData.median_price;

      if (priceGP === 0) continue;

      const costPerToken = priceGP / tokensReceived;

      if (costPerToken < bestTokenCostPerToken) {
        bestTokenCostPerToken = costPerToken;
        bestTokenItem = {
          name: item.name,
          tokensPerItem: tokensReceived,
          pricePerItem: priceGP,
          costPerToken
        };
      }
    }

    // Blood diamond price
    const diamondPrices = bloodDiamondTrades.map(t => t.price / t.amount);
    const diamondPrice = scenario === 'min'
      ? Math.min(...diamondPrices)
      : diamondPrices.reduce((a, b) => a + b) / diamondPrices.length;

    if (!bestShardItem || !bestTokenItem) {
      return { error: 'Insufficient data to calculate' };
    }

    // Calculate quantities needed
    const shardsNeeded = 250;
    const tokensNeeded = 500;
    const diamondsNeeded = 10;

    // RATIO-BASED CALCULATION (ignores overflow - extra shards/tokens are free bonus)
    // Cost = needed_amount × (bags per unit ratio)
    const shardCostGP = shardsNeeded * bestShardItem.costPerShard;
    const tokenCostGP = tokensNeeded * bestTokenItem.costPerToken;
    const diamondCostGP = diamondsNeeded * diamondPrice;
    const totalCostGP = shardCostGP + tokenCostGP + diamondCostGP;

    // Also calculate actual items needed (for display purposes)
    const shardItemsNeeded = Math.ceil(shardsNeeded / bestShardItem.shardsPerItem);
    const tokenItemsNeeded = Math.ceil(tokensNeeded / bestTokenItem.tokensPerItem);

    // Calculate market price for bloodchanting stone
    let marketPrice = null;
    let profitMargin = null;
    let recommendation = '';

    if (bloodchantingStoneTrades && bloodchantingStoneTrades.length > 0) {
      const stonePrices = bloodchantingStoneTrades.map(t => t.price / t.amount);
      marketPrice = scenario === 'min'
        ? Math.min(...stonePrices)
        : stonePrices.reduce((a, b) => a + b) / stonePrices.length;

      profitMargin = marketPrice - totalCostGP;
      const profitPct = (profitMargin / totalCostGP * 100);

      if (profitMargin > 0) {
        recommendation = `✅ CRAFT & SELL - Profit ${this.formatPrice(profitMargin)} bags (${profitPct.toFixed(1)}%)`;
      } else {
        recommendation = `⚠️ BUY FROM MARKET - Cheaper by ${this.formatPrice(Math.abs(profitMargin))} bags`;
      }
    } else {
      recommendation = 'No market data for bloodchanting stones';
    }

    return {
      scenario,
      window,
      shardComponent: {
        itemName: bestShardItem.name,
        itemsToBuy: shardItemsNeeded,
        shardsPerItem: bestShardItem.shardsPerItem,
        totalShards: shardItemsNeeded * bestShardItem.shardsPerItem,
        pricePerItem: bestShardItem.pricePerItem,
        costPerShard: bestShardItem.costPerShard,
        totalCostGP: shardCostGP
      },
      tokenComponent: {
        itemName: bestTokenItem.name,
        itemsToBuy: tokenItemsNeeded,
        tokensPerItem: bestTokenItem.tokensPerItem,
        totalTokens: tokenItemsNeeded * bestTokenItem.tokensPerItem,
        pricePerItem: bestTokenItem.pricePerItem,
        costPerToken: bestTokenItem.costPerToken,
        totalCostGP: tokenCostGP
      },
      diamondComponent: {
        diamondsNeeded: diamondsNeeded,
        pricePerDiamond: diamondPrice,
        totalCostGP: diamondCostGP,
        tradeCount: bloodDiamondTrades.length
      },
      totalCostGP: totalCostGP,
      marketPrice: marketPrice,
      profitMargin: profitMargin,
      recommendation: recommendation,
      stoneTradeCount: bloodchantingStoneTrades ? bloodchantingStoneTrades.length : 0
    };
  }

  renderBloodchantingHTML(result) {
    if (result.error) {
      return `<p class="text-osrs-light text-center py-4">${result.error}</p>`;
    }

    const { shardComponent: shard, tokenComponent: token, diamondComponent: diamond, totalCostGP } = result;

    // Market comparison section
    let marketComparisonHTML = '';
    if (result.marketPrice) {
      const isProfitable = result.profitMargin > 0;
      const bgColor = isProfitable ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)';
      const borderColor = isProfitable ? '#10b981' : '#ef4444';
      const textColor = isProfitable ? '#10b981' : '#ef4444';

      marketComparisonHTML = `
        <div class="osrs-stat-box" style="background: ${bgColor}; border: 2px solid ${borderColor};">
          <div class="text-center">
            <div class="text-sm text-osrs-light">Market Price (${result.scenario === 'min' ? 'Min' : 'Avg'})</div>
            <div class="text-2xl font-bold text-osrs-gold mt-1">${this.formatPrice(result.marketPrice)} bags</div>
            <div class="text-lg font-bold mt-2" style="color: ${textColor}">
              ${result.recommendation}
            </div>
            <div class="text-xs text-osrs-light mt-1">${result.stoneTradeCount} stone trades in ${result.window}</div>
          </div>
        </div>
      `;
    }

    return `
      <div class="space-y-4">
        <!-- Total Cost and Market Comparison -->
        <div class="grid grid-cols-1 ${result.marketPrice ? 'md:grid-cols-2' : ''} gap-4">
          <div class="osrs-stat-box text-center">
            <div class="text-sm text-osrs-light tooltip-trigger" data-tooltip="Total cost in bags to buy items and craft one bloodchanting stone using ${result.scenario === 'min' ? 'minimum' : 'average'} prices from ${result.window} time window">
              ${result.scenario === 'min' ? 'Best' : 'Average'} cost to craft (${result.window})
            </div>
            <div class="text-3xl font-bold text-osrs-gold mt-2">${this.formatPrice(totalCostGP)} bags</div>
          </div>
          ${marketComparisonHTML}
        </div>

        <!-- Components Grid -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <!-- Shards -->
          <div class="component-box">
            <h4 class="text-osrs-gold font-bold mb-2">Blood Shards (250 needed)</h4>
            <p class="text-sm"><strong>Best Item:</strong> ${shard.itemName}</p>
            <p class="text-sm"><strong>Gives:</strong> ${shard.shardsPerItem} shards @ ${this.formatPrice(shard.pricePerItem)} bags</p>
            <p class="text-sm text-osrs-orange"><strong>Ratio:</strong> ${this.formatPrice(shard.costPerShard)} bags/shard</p>
            <p class="text-xs text-osrs-light mt-1">(Buy ${shard.itemsToBuy}x to get ${shard.totalShards} shards)</p>
            <p class="text-sm component-total mt-2"><strong>Cost for 250:</strong> ${this.formatPrice(shard.totalCostGP)} bags</p>
          </div>

          <!-- Tokens -->
          <div class="component-box">
            <h4 class="text-osrs-gold font-bold mb-2">Tokens (500 needed)</h4>
            <p class="text-sm"><strong>Best Item:</strong> ${token.itemName}</p>
            <p class="text-sm"><strong>Gives:</strong> ${token.tokensPerItem} tokens @ ${this.formatPrice(token.pricePerItem)} bags</p>
            <p class="text-sm text-osrs-orange"><strong>Ratio:</strong> ${this.formatPrice(token.costPerToken)} bags/token</p>
            <p class="text-xs text-osrs-light mt-1">(Buy ${token.itemsToBuy}x to get ${token.totalTokens} tokens)</p>
            <p class="text-sm component-total mt-2"><strong>Cost for 500:</strong> ${this.formatPrice(token.totalCostGP)} bags</p>
          </div>

          <!-- Diamonds -->
          <div class="component-box">
            <h4 class="text-osrs-gold font-bold mb-2">Blood Diamonds (10 needed)</h4>
            <p class="text-sm"><strong>Buy:</strong> ${diamond.diamondsNeeded}x Blood diamonds</p>
            <p class="text-sm"><strong>Price:</strong> ${this.formatPrice(diamond.pricePerDiamond)} bags/diamond</p>
            <p class="text-sm"><strong>Data:</strong> ${diamond.tradeCount} trades in ${result.window}</p>
            <p class="text-sm component-total"><strong>Cost:</strong> ${this.formatPrice(diamond.totalCostGP)} bags</p>
          </div>
        </div>
      </div>
    `;
  }

  calculateItemBloodchantingProfit(item, windowData) {
    // Get bloodchanting stone market price
    const bloodchantingStoneTrades = this.filterTradesByTimeWindow(
      this.tradeCacheData.trades.filter(t => t.item_name === 'Bloodchanting stone'),
      this.currentWindow
    );

    if (bloodchantingStoneTrades.length === 0) {
      return { profitable: null, profit: 0, message: 'No stone data' };
    }

    const stonePrices = bloodchantingStoneTrades.map(t => t.price / t.amount);
    const stoneMarketPrice = stonePrices.reduce((a, b) => a + b) / stonePrices.length;

    // Get best conversion rates for opposite currency
    const oppositeData = this.currentCurrency === 'Blood Shards'
      ? this.recommendationsData.currencies['Blood Synthesis Tokens']
      : this.recommendationsData.currencies['Blood Shards'];

    const oppositeItems = oppositeData.items.filter(i => i.has_trades);
    if (oppositeItems.length === 0) {
      return { profitable: null, profit: 0, message: 'No opposite currency data' };
    }

    // Find cheapest opposite currency rate
    let bestOppositeBagsPerUnit = Infinity;
    for (const oppItem of oppositeItems) {
      const oppWindow = oppItem.time_windows[this.currentWindow];
      if (oppWindow.has_data && oppItem.shop_cost > 0) {
        const oppBagsPerUnit = oppWindow.median_price / oppItem.shop_cost;
        if (oppBagsPerUnit < bestOppositeBagsPerUnit) {
          bestOppositeBagsPerUnit = oppBagsPerUnit;
        }
      }
    }

    // Get blood diamond price
    const bloodDiamondTrades = this.filterTradesByTimeWindow(
      this.tradeCacheData.trades.filter(t => t.item_name === 'Blood diamonds'),
      this.currentWindow
    );

    const diamondPrice = bloodDiamondTrades.length > 0
      ? bloodDiamondTrades.map(t => t.price / t.amount).reduce((a, b) => a + b) / bloodDiamondTrades.length
      : 0;

    // Calculate cost using ratio-based method
    const thisBagsPerUnit = windowData.median_price / item.shop_cost;
    let shardCost, tokenCost;

    if (this.currentCurrency === 'Blood Shards') {
      shardCost = 250 * thisBagsPerUnit;
      tokenCost = 500 * bestOppositeBagsPerUnit;
    } else {
      shardCost = 250 * bestOppositeBagsPerUnit;
      tokenCost = 500 * thisBagsPerUnit;
    }

    const diamondCost = 10 * diamondPrice;
    const totalCost = shardCost + tokenCost + diamondCost;
    const profit = stoneMarketPrice - totalCost;
    const profitable = profit > 0;

    return {
      profitable: profitable,
      profit: profit,
      totalCost: totalCost,
      stonePrice: stoneMarketPrice,
      message: profitable
        ? `+${this.formatPrice(profit)} bags profit`
        : `${this.formatPrice(profit)} bags loss`
    };
  }

  renderRecommendations() {
    const container = document.getElementById('recommendations-list');
    const allItems = this.recommendationsData.currencies[this.currentCurrency].items
      .filter(item => item.has_trades);

    // Dynamically sort items by ROI for the selected time window
    // Items with no data in the current window should appear at the bottom
    const sortedItems = allItems.sort((a, b) => {
      const aData = a.time_windows[this.currentWindow];
      const bData = b.time_windows[this.currentWindow];

      // Items without data go to the bottom
      if (!aData.has_data && !bData.has_data) return 0;
      if (!aData.has_data) return 1;
      if (!bData.has_data) return -1;

      // Sort by ROI (descending - higher ROI is better)
      return bData.roi - aData.roi;
    });

    const items = sortedItems.slice(0, 20);

    if (items.length === 0) {
      container.innerHTML = '<div class="text-center text-osrs-light py-8">No data available</div>';
      return;
    }

    container.innerHTML = items.map((item, index) => {
      const windowData = item.time_windows[this.currentWindow];

      if (!windowData.has_data) {
        return this.renderNoDataCard(item, index);
      }

      return this.renderRecommendationCard(item, windowData, index);
    }).join('');

    document.getElementById('showing-count').textContent =
      `Showing top ${items.length} items (${this.currentWindow} window)`;
  }

  renderNoDataCard(item, index) {
    return `
      <div class="recommendation-card rounded-lg p-3 opacity-60">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="text-lg font-bold text-gray-600">#${index + 1}</span>
            <div>
              <h3 class="text-sm font-bold text-osrs-gold">${item.name}</h3>
              <p class="text-xs text-osrs-light">Shop: ${item.shop_cost.toLocaleString()}</p>
            </div>
          </div>
          <p class="text-xs text-gray-500">No trades in ${this.currentWindow}</p>
        </div>
      </div>
    `;
  }

  renderRecommendationCard(item, windowData, index) {
    const confidence = windowData.confidence;
    const confidenceClass = confidence >= 70 ? 'confidence-high' :
                           confidence >= 40 ? 'confidence-medium' : 'confidence-low';

    const roi = windowData.roi;
    const roiColor = roi > 100 ? '#10b981' : roi > 0 ? '#fbbf24' : '#ef4444';

    // Calculate bags per unit (conversion rate)
    const bagsPerUnit = windowData.median_price / item.shop_cost;
    const currencyUnit = this.currentCurrency === 'Blood Shards' ? 'shard' : 'token';

    // Calculate bloodchanting profitability for this item
    const bloodchantingInfo = this.calculateItemBloodchantingProfit(item, windowData);

    // Calculate zone marker position
    const currentPrice = windowData.weighted_median;
    const zones = windowData.zones;
    let markerPosition = 50;

    if (currentPrice <= zones.excellent) markerPosition = 12.5;
    else if (currentPrice <= zones.good) markerPosition = 37.5;
    else if (currentPrice <= zones.fair) markerPosition = 62.5;
    else if (currentPrice <= zones.overpriced) markerPosition = 87.5;
    else markerPosition = 95;

    return `
      <div class="recommendation-card rounded-lg p-3">
        <div class="flex flex-col sm:flex-row gap-3">
          <!-- Left: Item Info -->
          <div class="flex-1">
            <div class="flex items-start gap-2 mb-2">
              <span class="text-xl font-bold text-osrs-gold">#${index + 1}</span>
              <div class="flex-1">
                <h3 class="text-base font-bold text-osrs-gold leading-tight">${item.name}</h3>
                <p class="text-xs text-osrs-light">Shop: ${item.shop_cost.toLocaleString()} ${currencyUnit}s</p>

                <!-- Purchase Zone -->
                <div class="mt-2">
                  <div class="zone-indicator tooltip-trigger" data-tooltip="Price zone indicator: Green=Excellent deal, Yellow=Good, Orange=Fair, Red=Overpriced. White marker shows current price position.">
                    <div class="zone-marker" style="left: ${markerPosition}%"></div>
                  </div>
                  <div class="flex justify-between text-xs text-osrs-light -mt-1">
                    <span title="Excellent - Buy immediately!">🟢</span>
                    <span title="Good - Recommended buy">🟡</span>
                    <span title="Fair - Okay if needed">🟠</span>
                    <span title="Overpriced - Avoid!">🔴</span>
                  </div>
                </div>

                <!-- Recommendation -->
                <div class="mt-2 text-xs font-bold ${roi > 0 ? 'text-green-400' : 'text-red-400'}">
                  ${windowData.recommendation}
                </div>
              </div>
            </div>
          </div>

          <!-- Right: Stats -->
          <div class="flex flex-col gap-3 sm:w-96">
            <!-- Conversion Rate (Most Important!) -->
            <div class="text-center p-3 rounded" style="background: rgba(212, 175, 55, 0.15); border: 2px solid #d4af37;">
              <p class="text-xs text-osrs-light tooltip-trigger" data-tooltip="Cost to acquire each ${currencyUnit} by buying this item from trade post and turning it into the shop. LOWER IS BETTER!">Conversion Rate</p>
              <p class="text-2xl font-bold text-osrs-orange">${bagsPerUnit.toFixed(2)} <span class="text-sm">bags/${currencyUnit}</span></p>
              <p class="text-xs ${roi > 0 ? 'text-green-400' : 'text-red-400'}">${roi > 0 ? '↓ Cheaper than median!' : '↑ More expensive than median'}</p>
            </div>

            <!-- Stats Grid -->
            <div class="grid grid-cols-3 gap-2 text-xs">
              <div>
                <p class="text-osrs-light tooltip-trigger" data-tooltip="Return on Investment: How much cheaper this item's bags-per-${currencyUnit} is vs median. Positive = better deal!">ROI</p>
                <p class="font-bold" style="color: ${roiColor}">${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%</p>
              </div>
              <div>
                <p class="text-osrs-light tooltip-trigger" data-tooltip="Confidence score (0-100) based on trade volume, price stability, and data quality">Confidence</p>
                <p><span class="confidence-badge ${confidenceClass}">${confidence.toFixed(0)}</span></p>
              </div>
              <div>
                <p class="text-osrs-light tooltip-trigger" data-tooltip="Current weighted median price in bags (1 bag = 100m GP)">Price</p>
                <p class="font-bold text-osrs-gold">${this.formatPrice(windowData.weighted_median)} bags</p>
              </div>
              <div>
                <p class="text-osrs-light tooltip-trigger" data-tooltip="Recommended max purchase price for a good deal">Buy Below</p>
                <p class="font-bold text-green-400">${this.formatPrice(zones.good)} bags</p>
              </div>
              <div>
                <p class="text-osrs-light tooltip-trigger" data-tooltip="Price threshold - avoid buying above this">Avoid Above</p>
                <p class="font-bold text-red-400">${this.formatPrice(zones.avoid)} bags</p>
              </div>
              <div>
                <p class="text-osrs-light tooltip-trigger" data-tooltip="Number of trades in ${this.currentWindow} window">Trades</p>
                <p class="font-bold text-osrs-gold">${windowData.trades}</p>
              </div>
            </div>

            <!-- Bloodchanting Profitability -->
            ${bloodchantingInfo.profitable !== null ? `
              <div class="p-2 rounded text-center" style="background: ${bloodchantingInfo.profitable ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)'}; border: 1px solid ${bloodchantingInfo.profitable ? '#10b981' : '#ef4444'};">
                <p class="text-xs font-bold" style="color: ${bloodchantingInfo.profitable ? '#10b981' : '#ef4444'}">
                  ${bloodchantingInfo.profitable ? '✅' : '❌'} Bloodchanting: ${bloodchantingInfo.message}
                </p>
                <p class="text-xs text-osrs-light mt-1">
                  ${bloodchantingInfo.profitable ? 'Use for crafting stones!' : 'Not ideal for bloodchanting'}
                </p>
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }

  renderCharts() {
    const items = this.recommendationsData.currencies[this.currentCurrency].items
      .filter(item => item.has_trades);

    this.renderROIChart(items);
    this.renderConfidenceChart(items);
  }

  renderROIChart(items) {
    const ctx = document.getElementById('roi-chart');

    if (this.charts.roi) {
      this.charts.roi.destroy();
    }

    const itemsWithROI = items
      .map(item => ({
        name: item.name.length > 18 ? item.name.substring(0, 18) + '...' : item.name,
        roi: item.time_windows[this.currentWindow].roi
      }))
      .filter(item => item.roi !== -100)
      .sort((a, b) => b.roi - a.roi)
      .slice(0, 15);

    this.charts.roi = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: itemsWithROI.map(i => i.name),
        datasets: [{
          label: 'ROI %',
          data: itemsWithROI.map(i => i.roi),
          backgroundColor: itemsWithROI.map(i =>
            i.roi > 100 ? 'rgba(16, 185, 129, 0.8)' :
            i.roi > 0 ? 'rgba(251, 191, 36, 0.8)' :
            'rgba(239, 68, 68, 0.8)'
          ),
          borderColor: itemsWithROI.map(i =>
            i.roi > 100 ? 'rgb(16, 185, 129)' :
            i.roi > 0 ? 'rgb(251, 191, 36)' :
            'rgb(239, 68, 68)'
          ),
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => `ROI: ${context.parsed.y.toFixed(1)}%`
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              color: '#d4af37',
              callback: (value) => value + '%',
              font: { size: 10 }
            },
            grid: { color: 'rgba(212, 175, 55, 0.1)' }
          },
          x: {
            ticks: {
              color: '#d4af37',
              maxRotation: 45,
              minRotation: 45,
              font: { size: 9 }
            },
            grid: { display: false }
          }
        }
      }
    });
  }

  renderConfidenceChart(items) {
    const ctx = document.getElementById('confidence-chart');

    if (this.charts.confidence) {
      this.charts.confidence.destroy();
    }

    const scatterData = items
      .map(item => {
        const windowData = item.time_windows[this.currentWindow];
        if (!windowData.has_data) return null;
        return {
          x: windowData.confidence,
          y: windowData.roi,
          name: item.name
        };
      })
      .filter(item => item !== null && item.y !== -100)
      .slice(0, 50);

    this.charts.confidence = new Chart(ctx, {
      type: 'scatter',
      data: {
        datasets: [{
          label: 'Items',
          data: scatterData,
          backgroundColor: 'rgba(212, 175, 55, 0.6)',
          borderColor: 'rgba(212, 175, 55, 1)',
          borderWidth: 2,
          pointRadius: 5,
          pointHoverRadius: 7
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => {
                const item = context.raw;
                return `${item.name}: ROI ${item.y.toFixed(1)}%, Conf ${item.x.toFixed(0)}`;
              }
            }
          }
        },
        scales: {
          y: {
            title: {
              display: true,
              text: 'ROI %',
              color: '#d4af37',
              font: { size: 11 }
            },
            ticks: {
              color: '#d4af37',
              callback: (value) => value + '%',
              font: { size: 10 }
            },
            grid: { color: 'rgba(212, 175, 55, 0.1)' }
          },
          x: {
            title: {
              display: true,
              text: 'Confidence',
              color: '#d4af37',
              font: { size: 11 }
            },
            min: 0,
            max: 100,
            ticks: {
              color: '#d4af37',
              font: { size: 10 }
            },
            grid: { color: 'rgba(212, 175, 55, 0.1)' }
          }
        }
      }
    });
  }

  formatPrice(price) {
    if (price >= 1000000) {
      return `${(price / 1000000).toFixed(2)}M`;
    } else if (price >= 1000) {
      return `${(price / 1000).toFixed(1)}K`;
    } else {
      return price.toFixed(0);
    }
  }

  showLoading(show) {
    const loading = document.getElementById('loading');
    if (show) {
      loading.classList.remove('hidden');
    } else {
      loading.classList.add('hidden');
    }
  }

  updateStatus(message) {
    document.getElementById('status-text').textContent = message;
  }
}

// Initialize dashboard when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const dashboard = new UnifiedDashboard();
  dashboard.init();
});
