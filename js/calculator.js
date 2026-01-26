/**
 * Price Formatting Utilities
 * Handles formatting of GP values for display
 */

/**
 * Format raw GP values (needs conversion to millions)
 * @param {number} gpValue - Raw GP value
 * @returns {string} Formatted string with 'M' or 'T' suffix
 */
export function formatGP(gpValue) {
  if (gpValue === null || gpValue === undefined) return '-';
  const millions = gpValue / 1_000_000;
  return formatMillions(millions);
}

/**
 * Format values ALREADY in millions (just add formatting)
 * Uses 100M bags as the primary currency unit (between 100M and 1T)
 * Uses trillions (T) for very large values
 * @param {number} millionsValue - Value already in millions
 * @returns {string} Formatted string with 'M', 'bags', or 'T' suffix
 */
export function formatMillions(millionsValue) {
  if (millionsValue === null || millionsValue === undefined) return '-';

  // Handle NaN and invalid values
  if (isNaN(millionsValue) || !isFinite(millionsValue)) return '-';

  // Use trillions for values >= 1,000,000M (1 trillion GP)
  if (millionsValue >= 1_000_000) {
    const trillions = millionsValue / 1_000_000;
    // For trillions, show 2 decimals if < 10T, 1 decimal if < 100T, none if >= 100T
    if (trillions < 10) {
      return trillions.toFixed(2) + 'T';
    } else if (trillions < 100) {
      return trillions.toFixed(1) + 'T';
    } else {
      return Math.floor(trillions) + 'T';
    }
  }

  // Use 100M bags for values between 100M and 1T (primary currency)
  if (millionsValue >= 100) {
    const bags = millionsValue / 100;
    // Show 2 decimals if < 10 bags, 1 decimal if < 100 bags, none if >= 100 bags
    if (bags < 10) {
      return bags.toFixed(2) + ' bags';
    } else if (bags < 100) {
      return bags.toFixed(1) + ' bags';
    } else {
      return Math.floor(bags) + ' bags';
    }
  }

  // For values < 100M, use M suffix
  // If value is >= 10M, show 1 decimal
  if (millionsValue >= 10) {
    return millionsValue.toFixed(1) + 'M';
  }

  // If value is >= 1M, show 2 decimals
  if (millionsValue >= 1) {
    return millionsValue.toFixed(2) + 'M';
  }

  // For values < 1M, show more precision
  // Show 4 decimals to handle very small values (e.g., 0.0004M = 400 GP)
  if (millionsValue >= 0.0001) {
    const formatted = millionsValue.toFixed(4);
    // Remove trailing zeros
    return parseFloat(formatted).toString() + 'M';
  }

  // For extremely small values (< 100 GP), show in GP
  const gp = Math.round(millionsValue * 1_000_000);
  if (gp > 0) {
    return gp + ' GP';
  }

  // Zero or negative values
  return '0 GP';
}
