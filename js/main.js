/**
 * SpawnPK Arbitrage Calculator - Main Application
 * Entry point for the application
 */

import { TradeAPI } from './api.js';
import { ArbitrageCalculator, BloodchantingCalculator, formatGP, formatMillions } from './calculator.js';
import { DataCache } from './storage.js';

class ArbitrageApp {
  constructor() {
    // Get CORS proxy mode from global config
    const corsProxyMode = window.CORS_PROXY_MODE || 'allorigins';
    this.api = new TradeAPI(corsProxyMode);
    this.cache = new DataCache();
    this.shopConfigs = [];
    this.tradeData = [];
    this.bloodDiamondTrades = [];
    this.opportunities = [];
    this.bloodchantingCalc = null;
    this.currentDateFilter = '24h';
    this.currentScenario = 'min';
  }

  /**
   * Initialize the application
   */
  async init() {
    console.log('Initializing SpawnPK Arbitrage Calculator...');

    // Load shop configurations
    await this.loadShopConfigs();

    // Load cached data if available
    const cached = this.cache.loadTradeData();
    if (cached) {
      this.showCachedData(cached);
    }

    // Setup event listeners
    this.setupEventListeners();

    // Load user preferences
    this.loadPreferences();

    // Show CORS notice if using proxy
    if (corsProxyMode !== 'none') {
      document.getElementById('cors-notice').classList.remove('hidden');
    }

    console.log('Initialization complete');
  }

  /**
   * Load shop configuration files
   */
  async loadShopConfigs() {
    try {
      const [bloodShard, bloodSynthesis] = await Promise.all([
        fetch('data/blood_shard_shop.json').then(r => r.json()),
        fetch('data/blood_synthesis_shop.json').then(r => r.json())
      ]);

      this.shopConfigs = [bloodShard, bloodSynthesis];
      console.log('Shop configurations loaded:', this.shopConfigs.map(s => s.shop_name));

    } catch (error) {
      console.error('Error loading shop configs:', error);
      this.showError('Failed to load shop configurations. Please refresh the page.');
    }
  }

  /**
   * Fetch all trade data from API
   */
  async fetchAllTradeData() {
    this.showLoading(true);
    this.updateStatus('Fetching trade data...');

    this.tradeData = [];

    try {
      // Get all items from both shops
      const allItems = this.shopConfigs.flatMap(shop => shop.items);
      const totalItems = allItems.length;

      console.log(`Fetching trades for ${totalItems} items...`);

      // Fetch trades for each shop item
      for (let i = 0; i < allItems.length; i++) {
        const item = allItems[i];
        this.updateStatus(`Fetching ${item.item_name} (${i + 1}/${totalItems})`);

        const trades = await this.api.fetchTrades(item.item_name, 10);
        this.tradeData.push(...trades);
      }

      // Fetch blood diamond trades
      this.updateStatus('Fetching Blood diamond data...');
      this.bloodDiamondTrades = await this.api.fetchTrades('Blood diamond', 10);

      console.log(`Total trades fetched: ${this.tradeData.length}`);
      console.log(`Blood diamond trades: ${this.bloodDiamondTrades.length}`);

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
      this.updateStatus(`Loaded ${this.tradeData.length} trades successfully`);

    } catch (error) {
      console.error('Error fetching trade data:', error);
      this.showLoading(false);
      this.showError('Failed to fetch trade data. Please try again.');
    }
  }

  /**
   * Calculate opportunities and render results
   */
  calculateAndRender() {
    console.log('Calculating opportunities with date filter:', this.currentDateFilter);

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

    console.log(`Blood Shard opportunities: ${shardOpps.length}`);
    console.log(`Blood Synthesis opportunities: ${tokenOpps.length}`);

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

  /**
   * Render bloodchanting calculator results
   */
  renderBloodchanting() {
    const display = document.getElementById('bloodchanting-display');
    display.innerHTML = this.renderBloodchantingCalculation(this.bloodchantingCalc, this.currentScenario);
  }

  /**
   * Render bloodchanting calculation HTML
   */
  renderBloodchantingCalculation(calculation, scenario) {
    if (!calculation) {
      return `<p class="text-osrs-light text-center py-8">No data available</p>`;
    }

    if (calculation.error) {
      return `
        <div class="error-message">
          ${calculation.error}
        </div>
      `;
    }

    const result = calculation[scenario];
    if (!result) {
      return `<p class="text-osrs-light text-center py-8">Unable to calculate</p>`;
    }

    const shard = result.shard_component;
    const token = result.token_component;
    const diamond = result.diamond_component;

    return `
      <div class="space-y-4">
        <!-- Total Cost -->
        <div class="osrs-stat-box text-center">
          <div class="text-sm text-osrs-light">Total Cost to Craft 1 Bloodchanting Stone</div>
          <div class="text-3xl font-bold text-osrs-gold mt-2">${formatMillions(result.total_cost_millions)}</div>
        </div>

        <!-- Components Grid -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <!-- Blood Shards Component -->
          <div class="component-box">
            <h4>Blood Shards (250 needed)</h4>
            <p><strong>Buy:</strong> ${shard.items_to_buy}x ${shard.item_name}</p>
            <p><strong>Receive:</strong> ${shard.total_shards_received} shards (${shard.shards_per_item} per item)</p>
            <p><strong>Cost per shard:</strong> ${formatMillions(shard.cost_per_shard)}</p>
            <p class="component-total"><strong>Subtotal:</strong> ${formatMillions(shard.total_cost_millions)}</p>
          </div>

          <!-- Blood Synthesis Tokens Component -->
          <div class="component-box">
            <h4>Blood Synthesis Tokens (500 needed)</h4>
            <p><strong>Buy:</strong> ${token.items_to_buy}x ${token.item_name}</p>
            <p><strong>Receive:</strong> ${token.total_tokens_received.toLocaleString()} tokens (${token.tokens_per_item.toLocaleString()} per item)</p>
            <p><strong>Cost per token:</strong> ${formatMillions(token.cost_per_token)}</p>
            <p class="component-total"><strong>Subtotal:</strong> ${formatMillions(token.total_cost_millions)}</p>
          </div>

          <!-- Blood Diamonds Component -->
          <div class="component-box">
            <h4>Blood Diamonds (10 needed)</h4>
            <p><strong>Buy:</strong> ${diamond.diamonds_to_buy}x Blood diamond</p>
            <p><strong>Cost per diamond:</strong> ${formatMillions(diamond.cost_per_diamond)}</p>
            <p class="component-total"><strong>Subtotal:</strong> ${formatMillions(diamond.total_cost_millions)}</p>
          </div>
        </div>

        <!-- Shopping List -->
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

  /**
   * Render opportunities table
   */
  renderTable() {
    const tbody = document.getElementById('table-body');
    tbody.innerHTML = '';

    let filtered = this.filterOpportunities();
    filtered = this.sortOpportunities(filtered);

    if (filtered.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="10" class="text-center text-osrs-light py-8">
            No items match the current filters
          </td>
        </tr>
      `;
      return;
    }

    for (const opp of filtered) {
      const row = this.createTableRow(opp);
      tbody.appendChild(row);
    }

    this.updateStatus(`Showing ${filtered.length} items (Date filter: ${this.currentDateFilter})`);
  }

  /**
   * Create a table row for an opportunity
   */
  createTableRow(opportunity) {
    const row = document.createElement('tr');
    const hasData = opportunity.min_price_gp !== null;

    if (!hasData) {
      row.classList.add('no-data');
    }

    row.innerHTML = `
      <td class="font-bold text-osrs-gold">${opportunity.item_name}</td>
      <td class="text-osrs-light">${opportunity.shop_name}</td>
      <td class="text-right text-osrs-gold">${opportunity.tokens_received.toLocaleString()}</td>
      <td class="text-right font-mono text-osrs-gold">${hasData ? formatGP(opportunity.min_price_gp) : 'No data'}</td>
      <td class="text-right font-mono text-osrs-gold">${hasData ? formatGP(opportunity.avg_price_gp) : 'No data'}</td>
      <td class="text-right font-mono text-osrs-gold">${hasData ? formatGP(opportunity.max_price_gp) : 'No data'}</td>
      <td class="text-right font-mono font-bold text-osrs-gold">${hasData ? formatMillions(opportunity.cost_per_token_min) : '-'}</td>
      <td class="text-right font-mono font-bold text-osrs-gold">${hasData ? formatMillions(opportunity.cost_per_token_avg) : '-'}</td>
      <td class="text-right font-mono font-bold text-osrs-gold">${hasData ? formatMillions(opportunity.cost_per_token_max) : '-'}</td>
      <td class="text-center text-osrs-light">${opportunity.trade_count}</td>
    `;

    return row;
  }

  /**
   * Filter opportunities by selected shop
   */
  filterOpportunities() {
    const selectedShop = document.getElementById('shop-select').value;

    if (selectedShop === 'all') {
      return this.opportunities;
    }

    return this.opportunities.filter(opp => opp.shop_name === selectedShop);
  }

  /**
   * Sort opportunities by selected criteria
   */
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

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Refresh button
    document.getElementById('refresh-btn').addEventListener('click', () => {
      this.fetchAllTradeData();
    });

    // Date filter - triggers recalculation
    document.getElementById('date-select').addEventListener('change', (e) => {
      this.currentDateFilter = e.target.value;
      if (this.tradeData.length > 0) {
        this.calculateAndRender();
      }
      this.savePreferences();
    });

    // Shop filter - only affects table display
    document.getElementById('shop-select').addEventListener('change', () => {
      if (this.opportunities.length > 0) {
        this.renderTable();
      }
      this.savePreferences();
    });

    // Sort select - only affects table display
    document.getElementById('sort-select').addEventListener('change', () => {
      if (this.opportunities.length > 0) {
        this.renderTable();
      }
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

  /**
   * Save user preferences to localStorage
   */
  savePreferences() {
    const prefs = {
      sortBy: document.getElementById('sort-select').value,
      selectedShop: document.getElementById('shop-select').value,
      dateFilter: this.currentDateFilter
    };
    this.cache.savePreferences(prefs);
  }

  /**
   * Load user preferences from localStorage
   */
  loadPreferences() {
    const prefs = this.cache.loadPreferences();
    document.getElementById('sort-select').value = prefs.sortBy;
    document.getElementById('shop-select').value = prefs.selectedShop;
    document.getElementById('date-select').value = prefs.dateFilter;
    this.currentDateFilter = prefs.dateFilter;
  }

  /**
   * Display cached data
   */
  showCachedData(cached) {
    this.tradeData = cached.trades;
    this.bloodDiamondTrades = cached.bloodDiamonds || [];
    this.calculateAndRender();

    const age = Date.now() - cached.timestamp;
    const minutes = Math.floor(age / 60000);
    this.updateStatus(`Using cached data (${minutes} min old)`);
    this.updateLastUpdated(new Date(cached.timestamp));
  }

  /**
   * Show/hide loading indicator
   */
  showLoading(show) {
    const loading = document.getElementById('loading');
    if (show) {
      loading.classList.remove('hidden');
    } else {
      loading.classList.add('hidden');
    }
  }

  /**
   * Update status text
   */
  updateStatus(message) {
    document.getElementById('status-text').textContent = message;
  }

  /**
   * Update last updated timestamp
   */
  updateLastUpdated(date = new Date()) {
    const formatted = date.toLocaleString();
    document.getElementById('last-updated').textContent = `Last updated: ${formatted}`;
  }

  /**
   * Show error message
   */
  showError(message) {
    this.updateStatus(`Error: ${message}`);
    console.error(message);
  }
}

// Initialize the app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const app = new ArbitrageApp();
  app.init();
});
