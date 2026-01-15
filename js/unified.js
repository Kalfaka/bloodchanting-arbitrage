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
  }

  renderBloodchanting() {
    if (!this.recommendationsData || !this.tradeCacheData) return;

    const display = document.getElementById('bloodchanting-display');

    // Get top performer from each currency for bloodchanting
    const shardItems = this.recommendationsData.currencies['Blood Shards'].items
      .filter(i => i.has_trades)
      .slice(0, 5);

    const tokenItems = this.recommendationsData.currencies['Blood Synthesis Tokens'].items
      .filter(i => i.has_trades)
      .slice(0, 5);

    if (shardItems.length === 0 || tokenItems.length === 0) {
      display.innerHTML = '<p class="text-osrs-light text-center py-4">Insufficient data for bloodchanting calculator</p>';
      return;
    }

    // Get blood diamond prices from trade cache
    const bloodDiamondTrades = this.tradeCacheData.trades.filter(t =>
      t.item_name.toLowerCase() === 'blood diamonds'
    );

    if (bloodDiamondTrades.length === 0) {
      display.innerHTML = '<p class="text-osrs-light text-center py-4">No blood diamond data available</p>';
      return;
    }

    // Calculate bloodchanting cost
    const result = this.calculateBloodchanting(shardItems, tokenItems, bloodDiamondTrades);

    display.innerHTML = this.renderBloodchantingHTML(result);
  }

  calculateBloodchanting(shardItems, tokenItems, bloodDiamondTrades) {
    const scenario = this.currentScenario;

    // Find best shard item (250 shards needed)
    let bestShardItem = null;
    let bestShardCostPerShard = Infinity;

    for (const item of shardItems) {
      const shardsReceived = item.shop_cost;
      const priceGP = scenario === 'min'
        ? item.time_windows.all.zones.excellent
        : item.time_windows.all.median_price;

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

    // Find best token item (500 tokens needed)
    let bestTokenItem = null;
    let bestTokenCostPerToken = Infinity;

    for (const item of tokenItems) {
      const tokensReceived = item.shop_cost;
      const priceGP = scenario === 'min'
        ? item.time_windows.all.zones.excellent
        : item.time_windows.all.median_price;

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

    const shardItemsNeeded = Math.ceil(shardsNeeded / bestShardItem.shardsPerItem);
    const tokenItemsNeeded = Math.ceil(tokensNeeded / bestTokenItem.tokensPerItem);

    const shardCost = shardItemsNeeded * bestShardItem.pricePerItem / 1_000_000;
    const tokenCost = tokenItemsNeeded * bestTokenItem.pricePerItem / 1_000_000;
    const diamondCost = diamondsNeeded * diamondPrice / 1_000_000;

    return {
      scenario,
      shardComponent: {
        itemName: bestShardItem.name,
        itemsToBuy: shardItemsNeeded,
        shardsPerItem: bestShardItem.shardsPerItem,
        totalShards: shardItemsNeeded * bestShardItem.shardsPerItem,
        pricePerItem: bestShardItem.pricePerItem,
        costPerShard: bestShardItem.costPerShard,
        totalCostM: shardCost
      },
      tokenComponent: {
        itemName: bestTokenItem.name,
        itemsToBuy: tokenItemsNeeded,
        tokensPerItem: bestTokenItem.tokensPerItem,
        totalTokens: tokenItemsNeeded * bestTokenItem.tokensPerItem,
        pricePerItem: bestTokenItem.pricePerItem,
        costPerToken: bestTokenItem.costPerToken,
        totalCostM: tokenCost
      },
      diamondComponent: {
        diamondsNeeded: diamondsNeeded,
        pricePerDiamond: diamondPrice,
        totalCostM: diamondCost
      },
      totalCostM: shardCost + tokenCost + diamondCost
    };
  }

  renderBloodchantingHTML(result) {
    if (result.error) {
      return `<p class="text-osrs-light text-center py-4">${result.error}</p>`;
    }

    const { shardComponent: shard, tokenComponent: token, diamondComponent: diamond, totalCostM } = result;

    return `
      <div class="space-y-4">
        <!-- Total Cost -->
        <div class="osrs-stat-box text-center">
          <div class="text-sm text-osrs-light">${result.scenario === 'min' ? 'Best' : 'Average'} cost to craft 1 bloodchanting stone</div>
          <div class="text-3xl font-bold text-osrs-gold mt-2">${formatMillions(totalCostM)}</div>
        </div>

        <!-- Components Grid -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <!-- Shards -->
          <div class="component-box">
            <h4 class="text-osrs-gold font-bold mb-2">Blood Shards (250 needed)</h4>
            <p class="text-sm"><strong>Buy:</strong> ${shard.itemsToBuy}x ${shard.itemName}</p>
            <p class="text-sm"><strong>Receive:</strong> ${shard.totalShards} shards (${shard.shardsPerItem} each)</p>
            <p class="text-sm"><strong>Price:</strong> ${formatMillions(shard.pricePerItem / 1_000_000)}/item</p>
            <p class="text-sm component-total"><strong>Cost:</strong> ${formatMillions(shard.totalCostM)}</p>
          </div>

          <!-- Tokens -->
          <div class="component-box">
            <h4 class="text-osrs-gold font-bold mb-2">Tokens (500 needed)</h4>
            <p class="text-sm"><strong>Buy:</strong> ${token.itemsToBuy}x ${token.itemName}</p>
            <p class="text-sm"><strong>Receive:</strong> ${token.totalTokens} tokens (${token.tokensPerItem} each)</p>
            <p class="text-sm"><strong>Price:</strong> ${formatMillions(token.pricePerItem / 1_000_000)}/item</p>
            <p class="text-sm component-total"><strong>Cost:</strong> ${formatMillions(token.totalCostM)}</p>
          </div>

          <!-- Diamonds -->
          <div class="component-box">
            <h4 class="text-osrs-gold font-bold mb-2">Blood Diamonds (10 needed)</h4>
            <p class="text-sm"><strong>Buy:</strong> ${diamond.diamondsNeeded}x Blood diamonds</p>
            <p class="text-sm"><strong>Price:</strong> ${formatMillions(diamond.pricePerDiamond / 1_000_000)}/diamond</p>
            <p class="text-sm component-total"><strong>Cost:</strong> ${formatMillions(diamond.totalCostM)}</p>
          </div>
        </div>
      </div>
    `;
  }

  renderRecommendations() {
    const container = document.getElementById('recommendations-list');
    const items = this.recommendationsData.currencies[this.currentCurrency].items
      .filter(item => item.has_trades)
      .slice(0, 20);

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
                <p class="text-xs text-osrs-light">Shop: ${item.shop_cost.toLocaleString()}</p>

                <!-- Purchase Zone -->
                <div class="mt-2">
                  <div class="zone-indicator">
                    <div class="zone-marker" style="left: ${markerPosition}%"></div>
                  </div>
                  <div class="flex justify-between text-xs text-osrs-light -mt-1">
                    <span>🟢</span>
                    <span>🟡</span>
                    <span>🟠</span>
                    <span>🔴</span>
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
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs sm:w-80">
            <div>
              <p class="text-osrs-light">ROI</p>
              <p class="font-bold" style="color: ${roiColor}">${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%</p>
            </div>
            <div>
              <p class="text-osrs-light">Confidence</p>
              <p><span class="confidence-badge ${confidenceClass}">${confidence.toFixed(0)}</span></p>
            </div>
            <div>
              <p class="text-osrs-light">Price</p>
              <p class="font-bold text-osrs-gold">${this.formatPrice(windowData.weighted_median)}</p>
            </div>
            <div>
              <p class="text-osrs-light">Buy Below</p>
              <p class="font-bold text-green-400">${this.formatPrice(zones.good)}</p>
            </div>
            <div>
              <p class="text-osrs-light">Avoid Above</p>
              <p class="font-bold text-red-400">${this.formatPrice(zones.avoid)}</p>
            </div>
            <div>
              <p class="text-osrs-light">Trades</p>
              <p class="font-bold text-osrs-gold">${windowData.trades}</p>
            </div>
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
