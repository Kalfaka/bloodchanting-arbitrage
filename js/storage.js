/**
 * Data Cache Manager
 * Handles localStorage caching for trade data and user preferences
 */

const CACHE_KEY_TRADES = 'spawnpk_trade_data';
const CACHE_KEY_PREFERENCES = 'spawnpk_preferences';
const CACHE_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

export class DataCache {
  constructor() {
    this.storage = window.localStorage;
  }

  /**
   * Save trade data to cache
   * @param {Object} data - Object with trades, bloodDiamonds, and timestamp
   */
  saveTradeData(data) {
    try {
      const cacheData = {
        ...data,
        timestamp: data.timestamp || Date.now()
      };
      this.storage.setItem(CACHE_KEY_TRADES, JSON.stringify(cacheData));
      console.log('Trade data cached successfully');
    } catch (error) {
      console.error('Failed to cache trade data:', error);
    }
  }

  /**
   * Load trade data from cache
   * @returns {Object|null} Cached data or null if not found/expired
   */
  loadTradeData() {
    try {
      const cached = this.storage.getItem(CACHE_KEY_TRADES);
      if (!cached) {
        return null;
      }

      const data = JSON.parse(cached);

      // Check if cache is expired
      const age = Date.now() - data.timestamp;
      if (age > CACHE_EXPIRY_MS) {
        console.log('Cache expired, will fetch fresh data');
        this.clearTradeData();
        return null;
      }

      console.log(`Loaded cached data (age: ${Math.floor(age / 60000)} minutes)`);
      return data;

    } catch (error) {
      console.error('Failed to load cached trade data:', error);
      return null;
    }
  }

  /**
   * Clear cached trade data
   */
  clearTradeData() {
    try {
      this.storage.removeItem(CACHE_KEY_TRADES);
      console.log('Trade data cache cleared');
    } catch (error) {
      console.error('Failed to clear cache:', error);
    }
  }

  /**
   * Save user preferences
   * @param {Object} preferences - User preferences object
   */
  savePreferences(preferences) {
    try {
      this.storage.setItem(CACHE_KEY_PREFERENCES, JSON.stringify(preferences));
    } catch (error) {
      console.error('Failed to save preferences:', error);
    }
  }

  /**
   * Load user preferences
   * @returns {Object} Preferences object with defaults
   */
  loadPreferences() {
    try {
      const cached = this.storage.getItem(CACHE_KEY_PREFERENCES);
      if (!cached) {
        return this.getDefaultPreferences();
      }

      return { ...this.getDefaultPreferences(), ...JSON.parse(cached) };

    } catch (error) {
      console.error('Failed to load preferences:', error);
      return this.getDefaultPreferences();
    }
  }

  /**
   * Get default preferences
   * @returns {Object} Default preferences
   */
  getDefaultPreferences() {
    return {
      sortBy: 'cost_min',
      selectedShop: 'all',
      dateFilter: '24h'
    };
  }

  /**
   * Check if cache exists and is valid
   * @returns {boolean} True if cache is valid
   */
  hasFreshCache() {
    const cached = this.loadTradeData();
    return cached !== null;
  }

  /**
   * Get cache age in milliseconds
   * @returns {number|null} Age in ms or null if no cache
   */
  getCacheAge() {
    try {
      const cached = this.storage.getItem(CACHE_KEY_TRADES);
      if (!cached) {
        return null;
      }

      const data = JSON.parse(cached);
      return Date.now() - data.timestamp;

    } catch (error) {
      return null;
    }
  }
}
