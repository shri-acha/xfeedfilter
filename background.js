/**
 * X Feed Filter — Background Script
 * Handles extension lifecycle events.
 */

browser.runtime.onInstalled.addListener(() => {
  console.log('[XFilter] Extension installed / updated.');
});
