/**
 * Trade API Client with Rate Limiting
 * Handles fetching trade data from SpawnPK Trade API
 */

const API_URL = 'https://hqxg0u8s64.execute-api.ca-central-1.amazonaws.com/Production/tradingpost';
const RATE_LIMIT_DELAY = 1500; // 1500ms = 0.67 requests/second (CORS proxy safe)

// CORS Proxy options (for GitHub Pages deployment)
const CORS_PROXIES = {
  none: '',
  allorigins: 'https://api.allorigins.win/raw?url=',
  corsproxy: 'https://corsproxy.io/?'
};

export class TradeAPI {
  constructor(useCorsProxy = 'allorigins') {
    this.baseURL = API_URL;
    this.requestDelay = RATE_LIMIT_DELAY;
    this.lastRequestTime = 0;
    this.corsProxy = CORS_PROXIES[useCorsProxy] || CORS_PROXIES.allorigins;

    console.log(`TradeAPI initialized with CORS proxy: ${useCorsProxy}`);
  }

  /**
   * Throttle requests to respect rate limits
   */
  async throttle() {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;

    if (elapsed < this.requestDelay) {
      await new Promise(resolve => setTimeout(resolve, this.requestDelay - elapsed));
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * Fetch all pages of trades for a specific item with retry logic
   * @param {string} itemName - Item name to search for
   * @param {number} maxPages - Maximum number of pages to fetch
   * @returns {Promise<Array>} Array of trade records
   */
  async fetchTrades(itemName, maxPages = 5) {
    const allTrades = [];
    let page = 1;

    console.log(`Fetching trades for "${itemName}"...`);

    while (page <= maxPages) {
      await this.throttle();

      const success = await this.fetchPageWithRetry(itemName, page, allTrades);

      if (!success) {
        // If retry failed, stop fetching more pages for this item
        break;
      }

      // Empty response means no more data
      if (success === 'empty') {
        break;
      }

      page++;
    }

    return allTrades;
  }

  /**
   * Fetch a single page with exponential backoff retry
   * @param {string} itemName - Item name
   * @param {number} page - Page number
   * @param {Array} allTrades - Array to append results to
   * @returns {Promise<boolean|string>} true if success, 'empty' if no data, false if failed
   */
  async fetchPageWithRetry(itemName, page, allTrades, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const apiUrl = `${this.baseURL}?search_text=${encodeURIComponent(itemName)}&page=${page}`;
        const url = this.corsProxy ? `${this.corsProxy}${encodeURIComponent(apiUrl)}` : apiUrl;
        const response = await fetch(url);

        // Handle rate limiting with exponential backoff
        if (response.status === 429) {
          const backoffDelay = Math.min(5000, 1000 * Math.pow(2, attempt));
          console.warn(`  Rate limited on ${itemName} page ${page}, retry ${attempt}/${maxRetries} after ${backoffDelay}ms`);
          await new Promise(resolve => setTimeout(resolve, backoffDelay));
          continue; // Retry
        }

        // Handle other HTTP errors
        if (!response.ok) {
          console.error(`  HTTP ${response.status} for ${itemName} page ${page}`);
          if (attempt < maxRetries) {
            const backoffDelay = 2000 * attempt;
            console.warn(`  Retrying after ${backoffDelay}ms...`);
            await new Promise(resolve => setTimeout(resolve, backoffDelay));
            continue;
          }
          return false;
        }

        const data = await response.json();

        // Empty array means no more data
        if (!data || data.length === 0) {
          return 'empty';
        }

        allTrades.push(...data);
        console.log(`  Page ${page}: ${data.length} trades (total: ${allTrades.length})`);
        return true;

      } catch (error) {
        console.error(`  Error fetching ${itemName} page ${page} (attempt ${attempt}/${maxRetries}):`, error.message);

        if (attempt < maxRetries) {
          const backoffDelay = 2000 * attempt;
          console.warn(`  Retrying after ${backoffDelay}ms...`);
          await new Promise(resolve => setTimeout(resolve, backoffDelay));
        } else {
          return false;
        }
      }
    }

    return false;
  }

  /**
   * Fetch trades for multiple specific items
   * @param {Array<string>} itemNames - Array of item names to fetch
   * @param {number} maxPagesPerItem - Maximum pages per item
   * @param {Function} progressCallback - Optional callback for progress updates
   * @returns {Promise<Array>} Combined array of all trade records
   */
  async fetchMultipleItems(itemNames, maxPagesPerItem = 10, progressCallback = null) {
    const allTrades = [];
    const totalItems = itemNames.length;

    console.log(`Fetching trades for ${totalItems} specific items...`);

    for (let i = 0; i < itemNames.length; i++) {
      const itemName = itemNames[i];

      if (progressCallback) {
        progressCallback(i + 1, totalItems, itemName);
      }

      try {
        const trades = await this.fetchTrades(itemName, maxPagesPerItem);
        allTrades.push(...trades);
        console.log(`  [${i + 1}/${totalItems}] ${itemName}: ${trades.length} trades`);
      } catch (error) {
        console.error(`  [${i + 1}/${totalItems}] Failed to fetch ${itemName}:`, error);
        // Continue with next item even if one fails
      }
    }

    console.log(`Total trades fetched from ${totalItems} items: ${allTrades.length}`);
    return allTrades;
  }

  /**
   * Convert trade price to GP (handles platinum token conversion)
   * @param {Object} trade - Trade record with price, currency, and amount
   * @returns {number} Total price in GP
   */
  convertToGP(trade) {
    const multiplier = trade.currency === 1 ? 100_000_000 : 1;
    return trade.price * multiplier * trade.amount;
  }

  /**
   * Convert per-unit trade price to GP (handles platinum token conversion)
   * @param {Object} trade - Trade record with price and currency
   * @returns {number} Per-unit price in GP
   */
  convertToGPPerUnit(trade) {
    const multiplier = trade.currency === 1 ? 100_000_000 : 1;
    return trade.price * multiplier;
  }

  /**
   * Filter trades by date range
   * @param {Array} trades - Array of trade records
   * @param {string} dateFilter - Date filter ('1h', '24h', '7d', '30d', 'all')
   * @returns {Array} Filtered trades
   */
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
