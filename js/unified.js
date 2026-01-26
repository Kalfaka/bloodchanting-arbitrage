/**
 * Unified Trade Economics Dashboard - Volatility-Aware Edition
 * Aligned with the intelligent window selection from Scripts 1, 2, and 3
 */

import { formatGP, formatMillions } from './calculator.js';

class UnifiedDashboard {
  constructor() {
    this.recommendationsData = null;
    this.tradeCacheData = null;
    this.currentWindow = 'recommended';
    this.currentCurrency = 'Blood Shards';
    this.currentScenario = 'recommended';
    this.charts = {};
  }

  async init() {
    console.log('Initializing Volatility-Aware Dashboard...');

    this.setupEventListeners();
    await this.loadData();
  }

  setupEventListeners() {
    document.querySelectorAll('.time-tab[data-window]').forEach(tab => {
      tab.addEventListener('click', (e) => {
        document.querySelectorAll('.time-tab[data-window]').forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        this.currentWindow = e.target.dataset.window;

        const windowDisplay = document.getElementById('current-window-display');
        if (windowDisplay) {
          windowDisplay.textContent = this.currentWindow === 'recommended' ? 'recommended' : this.currentWindow;
        }

        this.render();
      });
    });

    document.querySelectorAll('.currency-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        document.querySelectorAll('.currency-tab').forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        this.currentCurrency = e.target.dataset.currency;
        this.render();
      });
    });

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

      if (this.recommendationsData.metadata.generated_at) {
        const date = new Date(this.recommendationsData.metadata.generated_at);
        document.getElementById('last-updated').textContent =
          `Data: ${date.toLocaleString()}`;
      }

      const windowDisplay = document.getElementById('current-window-display');
      if (windowDisplay) {
        windowDisplay.textContent = 'recommended';
      }

      this.render();
      this.updateStatus(`Loaded ${this.recommendationsData.metadata.total_items} items`);
      this.showLoading(false);

    } catch (error) {
      console.error('Error loading data:', error);
      this.updateStatus('Error loading data - Please run the analysis pipeline');
      this.showLoading(false);
    }
  }

  getWindowForItem(itemName, requestedWindow = null) {
    const item = this.recommendationsData.items[itemName];
    if (!item) return null;

    if (requestedWindow === 'recommended' || !requestedWindow) {
      return item.recommended_window;
    }

    return requestedWindow;
  }

  getItemWindowData(itemName, window = null) {
    const item = this.recommendationsData.items[itemName];
    if (!item) return null;

    const actualWindow = this.getWindowForItem(itemName, window);
    return item.windows[actualWindow];
  }

  render() {
    if (!this.recommendationsData) return;

    this.renderBloodchanting();
    this.renderRecommendations();
    this.renderCharts();
    this.renderQuickStats();
  }

  renderQuickStats() {
    const activeWindow = this.currentWindow === 'recommended' ? null : this.currentWindow;
    
    const shardRankings = this.recommendationsData.rankings['Blood Shards'];
    const tokenRankings = this.recommendationsData.rankings['Blood Synthesis Tokens'];

    let bestShardItem = null;
    let bestShardWindow = null;

    if (activeWindow && activeWindow !== 'recommended') {
      const rankings = shardRankings[activeWindow];
      if (rankings && rankings.items.length > 0) {
        bestShardItem = rankings.items[0];
        bestShardWindow = activeWindow;
      }
    } else {
      for (const itemName in this.recommendationsData.items) {
        const item = this.recommendationsData.items[itemName];
        const recWindow = item.recommended_window;
        const ratios = item.ratios['Blood Shards'][recWindow];
        
        if (ratios.available) {
          if (!bestShardItem || ratios.bags_per_unit < bestShardItem.bags_per_unit) {
            bestShardItem = {
              name: itemName,
              bags_per_unit: ratios.bags_per_unit,
              confidence: item.windows[recWindow].confidence,
              roi: 0
            };
            bestShardWindow = recWindow;
          }
        }
      }
      
      if (bestShardItem && bestShardWindow) {
        const windowRankings = shardRankings[bestShardWindow];
        if (windowRankings) {
          const itemInRanking = windowRankings.items.find(i => i.name === bestShardItem.name);
          if (itemInRanking) {
            bestShardItem.roi = itemInRanking.roi;
          }
        }
      }
    }

    let bestTokenItem = null;
    let bestTokenWindow = null;

    if (activeWindow && activeWindow !== 'recommended') {
      const rankings = tokenRankings[activeWindow];
      if (rankings && rankings.items.length > 0) {
        bestTokenItem = rankings.items[0];
        bestTokenWindow = activeWindow;
      }
    } else {
      for (const itemName in this.recommendationsData.items) {
        const item = this.recommendationsData.items[itemName];
        const recWindow = item.recommended_window;
        const ratios = item.ratios['Blood Synthesis Tokens'][recWindow];
        
        if (ratios.available) {
          if (!bestTokenItem || ratios.bags_per_unit < bestTokenItem.bags_per_unit) {
            bestTokenItem = {
              name: itemName,
              bags_per_unit: ratios.bags_per_unit,
              confidence: item.windows[recWindow].confidence,
              roi: 0
            };
            bestTokenWindow = recWindow;
          }
        }
      }
      
      if (bestTokenItem && bestTokenWindow) {
        const windowRankings = tokenRankings[bestTokenWindow];
        if (windowRankings) {
          const itemInRanking = windowRankings.items.find(i => i.name === bestTokenItem.name);
          if (itemInRanking) {
            bestTokenItem.roi = itemInRanking.roi;
          }
        }
      }
    }

    const bloodchantingWindow = activeWindow === 'recommended' ? '7d' : activeWindow;
    const bloodchantingData = this.recommendationsData.bloodchanting[bloodchantingWindow];

    if (bestShardItem) {
      document.getElementById('best-shard-name').textContent = bestShardItem.name;
      document.getElementById('best-shard-rate').textContent = 
        `${bestShardItem.bags_per_unit.toFixed(4)} bags/shard`;
      document.getElementById('best-shard-roi').textContent = 
        `${bestShardItem.roi >= 0 ? '+' : ''}${bestShardItem.roi.toFixed(1)}% ROI`;
    }

    if (bestTokenItem) {
      document.getElementById('best-token-name').textContent = bestTokenItem.name;
      document.getElementById('best-token-rate').textContent = 
        `${bestTokenItem.bags_per_unit.toFixed(4)} bags/token`;
      document.getElementById('best-token-roi').textContent = 
        `${bestTokenItem.roi >= 0 ? '+' : ''}${bestTokenItem.roi.toFixed(1)}% ROI`;
    }

    if (bloodchantingData && bloodchantingData.can_calculate) {
      const profitEl = document.getElementById('bloodchanting-profit-amount');
      const detailEl = document.getElementById('bloodchanting-cost-detail');
      const recEl = document.getElementById('bloodchanting-recommendation');

      profitEl.textContent = `${bloodchantingData.profit >= 0 ? '+' : ''}${this.formatPrice(bloodchantingData.profit)} bags`;
      profitEl.style.color = bloodchantingData.profitable ? '#10b981' : '#ef4444';

      detailEl.textContent = 
        `Cost: ${this.formatPrice(bloodchantingData.costs.total)} | Market: ${this.formatPrice(bloodchantingData.stone_market_price)} bags`;

      recEl.textContent = bloodchantingData.recommendation;
      recEl.style.color = bloodchantingData.profitable ? '#10b981' : '#ef4444';
    }
  }

  renderBloodchanting() {
    if (!this.recommendationsData) return;

    const display = document.getElementById('bloodchanting-display');

    const actualWindow = this.currentScenario === 'recommended' ? '7d' : 
                        (this.currentWindow === 'recommended' ? '7d' : this.currentWindow);

    const bloodchantingData = this.recommendationsData.bloodchanting[actualWindow];

    if (!bloodchantingData || !bloodchantingData.can_calculate) {
      display.innerHTML = `
        <p class="text-osrs-light text-center py-4">
          Insufficient data for bloodchanting calculator in ${actualWindow} window
        </p>
      `;
      return;
    }

    const { best_shard_source, best_token_source, costs, stone_market_price, profit, roi_percent, profitable } = bloodchantingData;

    const scenarioLabel = this.currentScenario === 'recommended' 
      ? `Recommended (${actualWindow})` 
      : actualWindow;

    display.innerHTML = `
      <div class="space-y-4">
        <!-- Scenario Info -->
        <div class="p-3 rounded" style="background: rgba(212, 175, 55, 0.15); border: 2px solid #8b7355;">
          <p class="text-sm text-osrs-gold">
            <strong>Using:</strong> ${scenarioLabel} window prices
            ${this.currentScenario === 'recommended' ? ' (Most reliable based on volatility analysis)' : ''}
          </p>
        </div>

        <!-- Recipe Requirements -->
        <div class="grid md:grid-cols-3 gap-3">
          <!-- Blood Shards -->
          <div class="osrs-stat-box p-4">
            <div class="text-xs text-osrs-light mb-1">250 Blood Shards</div>
            <div class="font-bold text-osrs-gold mb-2">${best_shard_source.name}</div>
            <div class="text-sm space-y-1">
              <div class="flex justify-between">
                <span class="text-osrs-light">Rate:</span>
                <span class="text-osrs-orange">${best_shard_source.bags_per_shard.toFixed(4)} bags/shard</span>
              </div>
              <div class="flex justify-between">
                <span class="text-osrs-light">Cost:</span>
                <span class="text-osrs-gold">${this.formatPrice(costs.shards)} bags</span>
              </div>
              <div class="flex justify-between">
                <span class="text-osrs-light">Confidence:</span>
                <span class="${this.getConfidenceClass(best_shard_source.confidence)}">${best_shard_source.confidence.toFixed(0)}%</span>
              </div>
            </div>
          </div>

          <!-- Blood Tokens -->
          <div class="osrs-stat-box p-4">
            <div class="text-xs text-osrs-light mb-1">500 Blood Tokens</div>
            <div class="font-bold text-osrs-gold mb-2">${best_token_source.name}</div>
            <div class="text-sm space-y-1">
              <div class="flex justify-between">
                <span class="text-osrs-light">Rate:</span>
                <span class="text-osrs-orange">${best_token_source.bags_per_token.toFixed(4)} bags/token</span>
              </div>
              <div class="flex justify-between">
                <span class="text-osrs-light">Cost:</span>
                <span class="text-osrs-gold">${this.formatPrice(costs.tokens)} bags</span>
              </div>
              <div class="flex justify-between">
                <span class="text-osrs-light">Confidence:</span>
                <span class="${this.getConfidenceClass(best_token_source.confidence)}">${best_token_source.confidence.toFixed(0)}%</span>
              </div>
            </div>
          </div>

          <!-- Blood Diamonds -->
          <div class="osrs-stat-box p-4">
            <div class="text-xs text-osrs-light mb-1">10 Blood Diamonds</div>
            <div class="font-bold text-osrs-gold mb-2">Trade Post</div>
            <div class="text-sm space-y-1">
              <div class="flex justify-between">
                <span class="text-osrs-light">Each:</span>
                <span class="text-osrs-orange">${this.formatPrice(costs.diamonds / 10)} bags</span>
              </div>
              <div class="flex justify-between">
                <span class="text-osrs-light">Total:</span>
                <span class="text-osrs-gold">${this.formatPrice(costs.diamonds)} bags</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Profitability Analysis -->
        <div class="osrs-stat-box p-4" style="border: 3px solid ${profitable ? '#10b981' : '#ef4444'};">
          <div class="grid md:grid-cols-2 gap-4 mb-3">
            <div>
              <div class="text-sm text-osrs-light mb-1">Total Crafting Cost</div>
              <div class="text-2xl font-bold text-osrs-gold">${this.formatPrice(costs.total)} bags</div>
              <div class="text-xs text-osrs-light mt-1">
                Shards: ${this.formatPrice(costs.shards)} + 
                Tokens: ${this.formatPrice(costs.tokens)} + 
                Diamonds: ${this.formatPrice(costs.diamonds)}
              </div>
            </div>
            <div>
              <div class="text-sm text-osrs-light mb-1">Market Sale Price</div>
              <div class="text-2xl font-bold text-osrs-gold">${this.formatPrice(stone_market_price)} bags</div>
              <div class="text-xs text-osrs-light mt-1">
                Current ${actualWindow} median
              </div>
            </div>
          </div>

          <div class="p-3 rounded text-center" style="background: ${profitable ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)'};">
            <div class="text-3xl font-bold mb-1" style="color: ${profitable ? '#10b981' : '#ef4444'};">
              ${profit >= 0 ? '+' : ''}${this.formatPrice(profit)} bags
            </div>
            <div class="text-sm" style="color: ${profitable ? '#10b981' : '#ef4444'};">
              ${profitable ? '✅' : '❌'} ${roi_percent >= 0 ? '+' : ''}${roi_percent.toFixed(1)}% ROI
            </div>
            <div class="text-sm font-bold mt-2 text-osrs-gold">
              ${bloodchantingData.recommendation}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  renderRecommendations() {
    const container = document.getElementById('recommendations-list');
    const activeWindow = this.currentWindow === 'recommended' ? null : this.currentWindow;
    
    const rankings = this.recommendationsData.rankings[this.currentCurrency];
    
    let items = [];

    if (activeWindow) {
      const windowRankings = rankings[activeWindow];
      if (windowRankings && windowRankings.items) {
        items = windowRankings.items.slice(0, 20);
      }
    } else {
      const itemSet = new Set();
      for (const itemName in this.recommendationsData.items) {
        const item = this.recommendationsData.items[itemName];
        const recWindow = item.recommended_window;
        const ratios = item.ratios[this.currentCurrency][recWindow];
        
        if (ratios.available) {
          itemSet.add(itemName);
        }
      }

      items = Array.from(itemSet).map(itemName => {
        const item = this.recommendationsData.items[itemName];
        const recWindow = item.recommended_window;
        const ratios = item.ratios[this.currentCurrency][recWindow];
        const windowData = item.windows[recWindow];
        
        return {
          name: itemName,
          bags_per_unit: ratios.bags_per_unit,
          confidence: windowData.confidence,
          recommended_window: recWindow,
          roi: 0
        };
      });

      items.sort((a, b) => a.bags_per_unit - b.bags_per_unit);
      
      const median = this.calculateMedian(items.map(i => i.bags_per_unit));
      items.forEach(item => {
        item.roi = ((median - item.bags_per_unit) / median * 100);
      });

      items = items.slice(0, 20);
    }

    document.getElementById('showing-count').textContent = `Showing top ${items.length}`;

    if (items.length === 0) {
      container.innerHTML = '<div class="text-center text-osrs-light py-8">No data available for this selection</div>';
      return;
    }

    container.innerHTML = items.map((item, index) => {
      const itemData = this.recommendationsData.items[item.name];
      const window = activeWindow || itemData.recommended_window;
      const windowData = itemData.windows[window];
      const ratios = itemData.ratios[this.currentCurrency][window];

      return this.renderRecommendationCard(item.name, window, windowData, ratios, item.roi, index + 1);
    }).join('');
  }

  renderRecommendationCard(itemName, window, windowData, ratios, roi, rank) {
    const isRecommended = windowData.is_recommended;
    const confidence = windowData.confidence;
    const confidenceClass = this.getConfidenceClass(confidence);

    const bloodchantingWindow = this.currentWindow === 'recommended' ? '7d' : 
                                (this.currentWindow || '7d');
    const bloodchantingData = this.recommendationsData.bloodchanting[bloodchantingWindow];
    
    let bloodchantingInfo = { profitable: null, message: '' };
    
    if (bloodchantingData && bloodchantingData.can_calculate) {
      const isBestShard = bloodchantingData.best_shard_source.name === itemName;
      const isBestToken = bloodchantingData.best_token_source.name === itemName;
      
      if (isBestShard || isBestToken) {
        bloodchantingInfo.profitable = bloodchantingData.profitable;
        bloodchantingInfo.message = `Best ${isBestShard ? 'Shard' : 'Token'} source (${this.formatPrice(bloodchantingData.profit)} profit)`;
      }
    }

    const roiColor = roi >= 50 ? '#10b981' : roi >= 0 ? '#fbbf24' : '#ef4444';

    return `
      <div class="recommendation-card rounded-lg p-4">
        <div class="flex items-start justify-between mb-3">
          <div class="flex-1">
            <div class="flex items-center gap-2 mb-1">
              <span class="text-2xl font-bold text-osrs-light">#{rank}</span>
              <h3 class="text-lg font-bold text-osrs-gold">${itemName}</h3>
              ${isRecommended ? '<span class="text-xs px-2 py-1 rounded" style="background: #10b981; color: white;">★ RECOMMENDED</span>' : ''}
            </div>
            <div class="flex items-center gap-3 text-sm">
              <span class="text-osrs-light">Window: <span class="text-osrs-orange">${window}</span></span>
              <span class="confidence-badge ${confidenceClass}">
                ${confidence.toFixed(0)}% Confidence
              </span>
            </div>
          </div>
          <div class="text-right">
            <div class="text-2xl font-bold" style="color: ${roiColor};">
              ${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%
            </div>
            <div class="text-xs text-osrs-light">ROI</div>
          </div>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
          <div>
            <p class="text-osrs-light">Shop Cost</p>
            <p class="font-bold text-osrs-gold">${ratios.shop_cost} ${this.currentCurrency === 'Blood Shards' ? 'shards' : 'tokens'}</p>
          </div>
          <div>
            <p class="text-osrs-light">Bags/Unit</p>
            <p class="font-bold text-osrs-orange">${ratios.bags_per_unit.toFixed(4)}</p>
          </div>
          <div>
            <p class="text-osrs-light">Price</p>
            <p class="font-bold text-osrs-gold">${this.formatPrice(windowData.median_price)} bags</p>
          </div>
          <div>
            <p class="text-osrs-light">Trades</p>
            <p class="font-bold text-osrs-gold">${windowData.trades}</p>
          </div>
          <div>
            <p class="text-osrs-light">Volatility</p>
            <p class="font-bold ${windowData.coefficient_of_variation < 10 ? 'text-green-400' : windowData.coefficient_of_variation < 20 ? 'text-yellow-400' : 'text-red-400'}">
              ${windowData.coefficient_of_variation.toFixed(1)}%
            </p>
          </div>
        </div>

        ${bloodchantingInfo.profitable !== null ? `
          <div class="mt-3 p-2 rounded text-center" style="background: ${bloodchantingInfo.profitable ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)'}; border: 1px solid ${bloodchantingInfo.profitable ? '#10b981' : '#ef4444'};">
            <p class="text-xs font-bold" style="color: ${bloodchantingInfo.profitable ? '#10b981' : '#ef4444'}">
              ${bloodchantingInfo.profitable ? '✅' : '❌'} ${bloodchantingInfo.message}
            </p>
          </div>
        ` : ''}
      </div>
    `;
  }

  renderCharts() {
    const activeWindow = this.currentWindow === 'recommended' ? '7d' : this.currentWindow;
    const rankings = this.recommendationsData.rankings[this.currentCurrency][activeWindow];

    if (!rankings || !rankings.items || rankings.items.length === 0) {
      return;
    }

    this.renderROIChart(rankings.items);
    this.renderConfidenceChart(rankings.items);
  }

  renderROIChart(items) {
    const ctx = document.getElementById('roi-chart');

    if (this.charts.roi) {
      this.charts.roi.destroy();
    }

    const topItems = items.slice(0, 15).map(item => ({
      name: item.name.length > 18 ? item.name.substring(0, 18) + '...' : item.name,
      roi: item.roi
    }));

    this.charts.roi = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: topItems.map(i => i.name),
        datasets: [{
          label: 'ROI %',
          data: topItems.map(i => i.roi),
          backgroundColor: topItems.map(i =>
            i.roi > 50 ? 'rgba(16, 185, 129, 0.8)' :
            i.roi > 0 ? 'rgba(251, 191, 36, 0.8)' :
            'rgba(239, 68, 68, 0.8)'
          ),
          borderColor: topItems.map(i =>
            i.roi > 50 ? 'rgb(16, 185, 129)' :
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

    const scatterData = items.slice(0, 50).map(item => ({
      x: item.confidence,
      y: item.roi,
      name: item.name
    }));

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

  calculateMedian(values) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  getConfidenceClass(confidence) {
    if (confidence >= 70) return 'confidence-high';
    if (confidence >= 40) return 'confidence-medium';
    return 'confidence-low';
  }

  formatPrice(price) {
    if (price >= 1000000) {
      return `${(price / 1000000).toFixed(2)}M`;
    } else if (price >= 1000) {
      return `${(price / 1000).toFixed(1)}K`;
    } else {
      return price.toFixed(2);
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

document.addEventListener('DOMContentLoaded', () => {
  const dashboard = new UnifiedDashboard();
  dashboard.init();
});
