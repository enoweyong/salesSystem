import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={"width": 1280, "height": 900})

        # Open local index.html
        await page.goto("file:///app/frontend/index.html")

        # Fill in Admin credentials and sign in
        await page.fill("#usernameInput", "admin")
        await page.fill("#passwordInput", "password")
        await page.click("#loginForm button[type='submit']")

        # Wait for app active view
        await page.wait_for_selector("#app.active")

        # Click on Products tab
        await page.click("[data-view='products']")
        await page.wait_for_timeout(1000)

        # Capture screenshot of products grid
        await page.screenshot(path="/home/jules/verification/smart_market_products.png", full_page=True)
        print("Captured /home/jules/verification/smart_market_products.png successfully.")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
