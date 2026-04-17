import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  page.on('response', response => {
    if (response.status() >= 400) {
      console.log(`>> Status ${response.status()}: ${response.url()}`);
    }
  });

  page.on('console', msg => {
    if (msg.text().includes('API Error')) {
      console.log(`BROWSER CONSOLE ERROR: ${msg.text()}`);
    }
  });

  console.log('Navigating to http://localhost:3000/coins/bitcoin...');
  try {
    await page.goto('http://localhost:3000/coins/bitcoin', { waitUntil: 'networkidle' });
    
    console.log('Looking for "Max" button...');
    const maxButton = page.locator('button').filter({ hasText: /^Max$/i });
    if (await maxButton.isVisible()) {
      console.log('Clicking "Max" button...');
      await maxButton.click();
      await page.waitForTimeout(5000); 
      console.log('Observation period finished.');
    } else {
      console.error('Max button not found specifically.');
    }
  } catch (error) {
    console.error('Error during test:', error);
  } finally {
    await browser.close();
  }
})();
