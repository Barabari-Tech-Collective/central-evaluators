// src/evaluators/visual/browserPool.js
/**
 * Browser Pool Manager
 * 
 * Instead of launching a new browser for each evaluation,
 * reuse a pool of browsers. This saves memory and startup time.
 * 
 * BEFORE: New browser per job = 2-3 sec startup × 200 jobs = 400+ seconds
 * AFTER: Pool of 3 browsers reused = Initial 10 sec + concurrent usage
 */

import { chromium } from 'playwright';
import logger from '../../config/logger.js';

class BrowserPool {
  constructor(poolSize = 3) {
    this.poolSize = poolSize;
    this.browsers = [];
    this.available = [];
    this.isInitialized = false;
    this.currentlyUsing = new Set();
  }

  /**
   * Initialize browser pool
   * Should be called once at worker startup
   */
  async initialize() {
    if (this.isInitialized) {
      logger.warn('Browser pool already initialized');
      return;
    }

    try {
      logger.info(`🌐 Initializing browser pool (size: ${this.poolSize})...`);

      for (let i = 0; i < this.poolSize; i++) {
        const browser = await chromium.launch({
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',  // Prevent memory issues
            '--single-process'           // Reduce memory overhead
          ]
        });

        this.browsers.push(browser);
        this.available.push(browser);

        logger.info(`✅ Browser ${i + 1}/${this.poolSize} started`);
      }

      this.isInitialized = true;
      logger.info('✅ Browser pool initialized successfully');

    } catch (err) {
      logger.error('Failed to initialize browser pool:', err);
      throw err;
    }
  }

  /**
   * Borrow a browser from the pool
   * Waits if none available
   */
  async borrow(timeout = 60000) {
    if (!this.isInitialized) {
      throw new Error('Browser pool not initialized');
    }

    const startTime = Date.now();

    // Wait for available browser
    while (this.available.length === 0) {
      if (Date.now() - startTime > timeout) {
        throw new Error(`Timeout waiting for available browser (${timeout}ms)`);
      }

      // Small wait before checking again
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    const browser = this.available.pop();
    this.currentlyUsing.add(browser);

    logger.debug(`Browser borrowed. Available: ${this.available.length}/${this.poolSize}`);

    return browser;
  }

  /**
   * Return browser to pool
   */
  return(browser) {
    if (this.currentlyUsing.has(browser)) {
      this.currentlyUsing.delete(browser);
      this.available.push(browser);
      logger.debug(`Browser returned. Available: ${this.available.length}/${this.poolSize}`);
    }
  }

  /**
   * Get current pool stats
   */
  getStats() {
    return {
      poolSize: this.poolSize,
      available: this.available.length,
      inUse: this.currentlyUsing.size,
      total: this.browsers.length
    };
  }

  /**
   * Close all browsers (cleanup)
   */
  async close() {
    try {
      logger.info('🌐 Closing browser pool...');

      for (const browser of this.browsers) {
        try {
          await browser.close();
        } catch (err) {
          logger.warn('Error closing browser:', err.message);
        }
      }

      this.browsers = [];
      this.available = [];
      this.currentlyUsing.clear();
      this.isInitialized = false;

      logger.info('✅ Browser pool closed');

    } catch (err) {
      logger.error('Error closing browser pool:', err);
    }
  }

  /**
   * Health check - verify browsers are working
   */
  async healthCheck() {
    try {
      const testBrowser = await this.borrow();
      const page = await testBrowser.newPage();
      await page.goto('about:blank');
      await page.close();
      this.return(testBrowser);

      return { healthy: true };

    } catch (err) {
      logger.error('Browser pool health check failed:', err);
      return { healthy: false, error: err.message };
    }
  }
}

// Create singleton
let browserPoolInstance = null;

export async function getBrowserPool(poolSize = 3) {
  if (!browserPoolInstance) {
    browserPoolInstance = new BrowserPool(poolSize);
    await browserPoolInstance.initialize();
  }
  return browserPoolInstance;
}

export { BrowserPool };