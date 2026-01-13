/**
 * Trade API Client with Rate Limiting
 * Handles fetching trade data from SpawnPK Trade API
 */

const API_URL = 'https://hqxg0u8s64.execute-api.ca-central-1.amazonaws.com/Production/tradingpost';
const RATE_LIMIT_DELAY = 500; // 500ms = 2 requests/second

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
   * Fetch all pages of trades for a specific item
   * @param {string} itemName - Item name to search for
   * @param {number} maxPages - Maximum number of pages to fetch
   * @returns {Promise<Array>} Array of trade records
   */
  async fetchTrades(itemName, maxPages = 10) {
    const allTrades = [];
    let page = 1;

    console.log(`Fetching trades for "${itemName}"...`);

    while (page <= maxPages) {
      await this.throttle();

      try {
        const apiUrl = `${this.baseURL}?search_text=${encodeURIComponent(itemName)}&page=${page}`;
        const url = this.corsProxy ? `${this.corsProxy}${encodeURIComponent(apiUrl)}` : apiUrl;
        const response = await fetch(url);

        if (!response.ok) {
          console.error(`HTTP ${response.status} for ${itemName} page ${page}`);
          break;
        }

        const data = await response.json();

        // Empty array means no more data
        if (!data || data.length === 0) {
          break;
        }

        allTrades.push(...data);
        console.log(`  Page ${page}: ${data.length} trades (total: ${allTrades.length})`);
        page++;

      } catch (error) {
        console.error(`Error fetching ${itemName} page ${page}:`, error);
        break;
      }
    }

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
