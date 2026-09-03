import asyncio
from playwright.async_api import async_playwright
import os

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={'width': 1280, 'height': 800})

        os.makedirs('/home/jules/verification', exist_ok=True)

        # 1. Open index.html
        await page.goto('file:///app/frontend/index.html')
        await page.wait_for_timeout(1000)

        # Screenshot login screen with Smart Market logo
        await page.screenshot(path='/home/jules/verification/smart_market_login.png')
        print("Captured login screenshot")

        # 2. Sign in as admin
        await page.click('button[type="submit"]')
        await page.wait_for_timeout(1000)

        # Screenshot dashboard with Smart Market logo
        await page.screenshot(path='/home/jules/verification/smart_market_dashboard.png')
        print("Captured dashboard screenshot")

        await browser.close()

asyncio.run(run())
