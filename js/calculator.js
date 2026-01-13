/**
 * Arbitrage and Bloodchanting Calculators
 * Handles all price calculations and trade statistics
 */

import { TradeAPI } from './api.js';

/**
 * CRITICAL BUG FIX:
 * Two separate functions for formatting different value types
 */

/**
 * Format raw GP values (needs conversion to millions)
 * @param {number} gpValue - Raw GP value
 * @returns {string} Formatted string with 'M' suffix
 */
export function formatGP(gpValue) {
  if (gpValue === null || gpValue === undefined) return '-';
  return (gpValue / 1_000_000).toFixed(2) + 'M';
}

/**
 * Format values ALREADY in millions (just add formatting)
 * @param {number} millionsValue - Value already in millions
 * @returns {string} Formatted string with 'M' suffix
 */
export function formatMillions(millionsValue) {
  if (millionsValue === null || millionsValue === undefined) return '-';
  return millionsValue.toFixed(2) + 'M';
}

/**
 * Arbitrage Calculator
 * Calculates cost-per-token for all shop items
 */
export class ArbitrageCalculator {
  constructor(shopConfigs, tradeData, dateFilter = 'all') {
    this.shopConfigs = shopConfigs;
    this.tradeData = tradeData;
    this.dateFilter = dateFilter;
    this.api = new TradeAPI();
  }

  /**
   * Calculate trade statistics (min/avg/max prices)
   * @param {Array} trades - Trade records for an item
   * @returns {Object|null} Statistics object or null if no trades
   */
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

  /**
   * Calculate arbitrage opportunities for all shop items
   * @returns {Array} Array of opportunity objects sorted by cost-per-token
   */
  calculateOpportunities() {
    const opportunities = [];

    for (const shop of this.shopConfigs) {
      for (const shopItem of shop.items) {
        // Find trades for this item (match by item_id or name)
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

        // Calculate cost per token (in millions) - ALREADY IN MILLIONS
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

          // These are ALREADY in millions (GP / 1M / tokens)
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

/**
 * Bloodchanting Stone Calculator
 * Calculates optimal cost for crafting Bloodchanting Stones
 */
export class BloodchantingCalculator {
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

  /**
   * Calculate blood diamond price statistics
   * @param {Array} trades - Blood diamond trades
   * @returns {Object|null} Statistics or null if no trades
   */
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

  /**
   * Calculate bloodchanting stone costs for all scenarios
   * @returns {Object} Results for min/avg/max scenarios
   */
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

  /**
   * Calculate a specific scenario (min/avg/max)
   * @param {string} scenario - 'min', 'avg', or 'max'
   * @param {Array} shardItems - Blood shard shop items
   * @param {Array} tokenItems - Blood synthesis shop items
   * @returns {Object} Calculation result
   */
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

    // Calculate costs (already in millions from cost_per_token calculation)
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
        item_name: 'Blood diamonds',
        diamonds_to_buy: this.RECIPE.blood_diamonds,
        cost_per_diamond: this.diamondStats[`${scenario}_price_gp`] / 1_000_000,
        total_cost_millions: diamondCost
      }
    };
  }
}
