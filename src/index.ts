#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Page } from "playwright";
import { withPage, navigateToTarget, saveSessionCookies } from "./browser.js";
import {
  isLoggedIn,
  loadAuth,
  saveAuth,
  clearCookies,
} from "./session.js";

// ─── Server setup ─────────────────────────────────────────────────────────────

const server = new Server(
  { name: "target", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

// ─── Tool definitions ─────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "status",
      description: "Check Target authentication status and session info",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "login",
      description:
        "Authenticate with Target account using email and password via browser automation",
      inputSchema: {
        type: "object",
        properties: {
          email: { type: "string", description: "Target account email" },
          password: {
            type: "string",
            description: "Target account password",
          },
          headless: {
            type: "boolean",
            description:
              "Run browser in headless mode (default: true). Set false to see browser window.",
          },
        },
        required: ["email", "password"],
      },
    },
    {
      name: "logout",
      description: "Clear Target session and stored cookies",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "search_products",
      description:
        "Search Target products by query with optional filters",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search term" },
          category: {
            type: "string",
            description: "Category filter (e.g., 'electronics', 'clothing')",
          },
          min_price: {
            type: "number",
            description: "Minimum price filter",
          },
          max_price: {
            type: "number",
            description: "Maximum price filter",
          },
          sort_by: {
            type: "string",
            enum: ["relevance", "price_low", "price_high", "newest", "bestselling"],
            description: "Sort order",
          },
          limit: {
            type: "number",
            description: "Maximum number of results (default: 10, max: 24)",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "get_product",
      description: "Get detailed product information including price, description, and availability",
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description:
              "Full Target product URL (e.g., https://www.target.com/p/...)",
          },
          tcin: {
            type: "string",
            description: "Target product TCIN/item ID (alternative to URL)",
          },
        },
      },
    },
    {
      name: "check_store_availability",
      description:
        "Check if a product is available for in-store pickup at nearby Target stores",
      inputSchema: {
        type: "object",
        properties: {
          tcin: { type: "string", description: "Target product TCIN/item ID" },
          url: {
            type: "string",
            description: "Product URL (alternative to TCIN)",
          },
          zip_code: {
            type: "string",
            description: "ZIP code to find nearby stores",
          },
        },
      },
    },
    {
      name: "add_to_cart",
      description: "Add a product to the Target cart for pickup or delivery",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "Target product URL" },
          tcin: { type: "string", description: "Target product TCIN" },
          quantity: {
            type: "number",
            description: "Quantity to add (default: 1)",
          },
          fulfillment: {
            type: "string",
            enum: ["pickup", "shipping", "delivery"],
            description: "Fulfillment method (default: shipping)",
          },
        },
      },
    },
    {
      name: "view_cart",
      description: "View current Target cart contents and totals",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "clear_cart",
      description: "Remove all items from the Target cart",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "checkout",
      description:
        "Preview or place a Target order. Use confirm=false to preview first.",
      inputSchema: {
        type: "object",
        properties: {
          confirm: {
            type: "boolean",
            description:
              "Set true to actually place the order. Default false (preview only).",
          },
        },
        required: [],
      },
    },
    {
      name: "get_orders",
      description: "Get Target order history",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Number of recent orders to return (default: 10)",
          },
        },
      },
    },
    {
      name: "track_order",
      description: "Track a Target order status",
      inputSchema: {
        type: "object",
        properties: {
          order_id: { type: "string", description: "Target order ID" },
        },
        required: ["order_id"],
      },
    },
  ],
}));

// ─── Tool handlers ─────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args ?? {}) as Record<string, unknown>;

  try {
    switch (name) {
      case "status":
        return await handleStatus();
      case "login":
        return await handleLogin(
          a.email as string,
          a.password as string,
          a.headless !== false
        );
      case "logout":
        return await handleLogout();
      case "search_products":
        return await handleSearchProducts(
          a.query as string,
          a.category as string | undefined,
          a.min_price as number | undefined,
          a.max_price as number | undefined,
          a.sort_by as string | undefined,
          Math.min((a.limit as number | undefined) ?? 10, 24)
        );
      case "get_product":
        return await handleGetProduct(
          a.url as string | undefined,
          a.tcin as string | undefined
        );
      case "check_store_availability":
        return await handleCheckStoreAvailability(
          a.tcin as string | undefined,
          a.url as string | undefined,
          a.zip_code as string | undefined
        );
      case "add_to_cart":
        return await handleAddToCart(
          a.url as string | undefined,
          a.tcin as string | undefined,
          (a.quantity as number | undefined) ?? 1,
          (a.fulfillment as string | undefined) ?? "shipping"
        );
      case "view_cart":
        return await handleViewCart();
      case "clear_cart":
        return await handleClearCart();
      case "checkout":
        return await handleCheckout(a.confirm === true);
      case "get_orders":
        return await handleGetOrders(
          (a.limit as number | undefined) ?? 10
        );
      case "track_order":
        return await handleTrackOrder(a.order_id as string);
      default:
        return err(`Unknown tool: ${name}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err(`Tool '${name}' failed: ${msg}`);
  }
});

// ─── Handler implementations ───────────────────────────────────────────────────

async function handleStatus() {
  const loggedIn = isLoggedIn();
  const auth = loadAuth();
  if (!loggedIn) {
    return ok("Not logged in. Use the `login` tool to authenticate with your Target account.");
  }
  return ok(
    `Logged in as: ${auth?.email ?? "unknown"}\n` +
    `Name: ${auth?.name ?? "unknown"}\n` +
    `Session established: ${auth?.loggedInAt ?? "unknown"}`
  );
}

async function handleLogin(email: string, password: string, headless: boolean) {
  if (!email || !password) {
    return err("email and password are required");
  }

  return withPage(async (page: Page) => {
    await navigateToTarget(page, "/");

    // Navigate to sign-in page
    await page.goto("https://www.target.com/account/login", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(2000);

    // Check if already logged in
    const accountLink = await page.$('[data-test="accountNav-link"]');
    if (accountLink) {
      const text = await accountLink.textContent();
      if (text && !text.toLowerCase().includes("sign in")) {
        const name = text.trim();
        saveAuth({ email, loggedInAt: new Date().toISOString(), name });
        return ok(`Already logged in as ${name}`);
      }
    }

    // Fill email
    const emailInput = await page.waitForSelector(
      'input[id="username"], input[name="username"], input[type="email"]',
      { timeout: 15000 }
    );
    await emailInput.click();
    await emailInput.fill(email);

    // Some Target login flows show email + continue, then password
    const continueBtn = await page.$('button[id="login"]');
    if (continueBtn) {
      await continueBtn.click();
      await page.waitForTimeout(1500);
    }

    // Fill password
    const passwordInput = await page.waitForSelector(
      'input[id="password"], input[name="password"], input[type="password"]',
      { timeout: 10000 }
    );
    await passwordInput.click();
    await passwordInput.fill(password);

    // Submit
    const submitBtn = await page.waitForSelector(
      'button[id="login"], button[type="submit"]',
      { timeout: 5000 }
    );
    await submitBtn.click();

    // Wait for navigation
    await page.waitForTimeout(3000);

    // Check for errors
    const errorEl = await page.$('[data-test="errorMessage"], .error-message, [class*="error"]');
    if (errorEl) {
      const errorText = await errorEl.textContent();
      if (errorText && errorText.trim().length > 0) {
        return err(`Login failed: ${errorText.trim()}`);
      }
    }

    // Detect success — URL change or account element
    const currentUrl = page.url();
    if (
      currentUrl.includes("/account/login") ||
      currentUrl.includes("/login")
    ) {
      return err(
        "Login may have failed — still on login page. Check credentials or try with headless=false."
      );
    }

    // Try to get name
    let name: string | undefined;
    try {
      const nameEl = await page.$('[data-test="accountNav-link"], .account-name');
      if (nameEl) name = (await nameEl.textContent())?.trim();
    } catch {}

    await saveSessionCookies();
    saveAuth({ email, loggedInAt: new Date().toISOString(), name });

    return ok(`Successfully logged in as ${name ?? email}`);
  }, headless);
}

async function handleLogout() {
  clearCookies();
  return ok("Logged out. Session cookies cleared.");
}

async function handleSearchProducts(
  query: string,
  category?: string,
  minPrice?: number,
  maxPrice?: number,
  sortBy?: string,
  limit = 10
) {
  return withPage(async (page: Page) => {
    const sortMap: Record<string, string> = {
      relevance: "relevance",
      price_low: "PriceLow",
      price_high: "PriceHigh",
      newest: "newest",
      bestselling: "bestselling",
    };

    const params = new URLSearchParams({ searchTerm: query });
    if (category) params.set("category", category);
    if (sortBy && sortMap[sortBy]) params.set("sortBy", sortMap[sortBy]);

    await page.goto(
      `https://www.target.com/s?${params.toString()}`,
      { waitUntil: "domcontentloaded", timeout: 30000 }
    );
    await page.waitForTimeout(2500);

    // Wait for product grid
    try {
      await page.waitForSelector(
        '[data-test="product-list"], [class*="ProductCard"], [data-test="@web/ProductCard"]',
        { timeout: 15000 }
      );
    } catch {
      return err("No products found or page failed to load");
    }

    const products = await page.evaluate(
      ({ minPrice, maxPrice, limit }) => {
        const cards = Array.from(
          document.querySelectorAll(
            '[data-test="@web/ProductCard"], [data-testid="ProductCard"], article[class*="productCard"]'
          )
        );

        const results: Array<{
          title: string;
          price: string;
          url: string;
          tcin: string;
          image: string;
          rating: string;
          reviews: string;
        }> = [];

        for (const card of cards) {
          if (results.length >= limit) break;

          const titleEl =
            card.querySelector('[data-test="product-title"]') ||
            card.querySelector('a[href*="/p/"]');
          const title = titleEl?.textContent?.trim() ?? "";

          const priceEl =
            card.querySelector('[data-test="current-price"]') ||
            card.querySelector('[class*="Price"]');
          const priceText = priceEl?.textContent?.trim() ?? "";
          const priceNum = parseFloat(priceText.replace(/[^0-9.]/g, ""));

          if (minPrice && priceNum < minPrice) continue;
          if (maxPrice && priceNum > maxPrice) continue;

          const linkEl = card.querySelector('a[href*="/p/"]') as HTMLAnchorElement | null;
          const href = linkEl?.href ?? "";
          const tcinMatch = href.match(/\/-\/A-(\d+)/);
          const tcin = tcinMatch ? tcinMatch[1] : "";

          const imgEl = card.querySelector("img") as HTMLImageElement | null;
          const image = imgEl?.src ?? "";

          const ratingEl = card.querySelector('[class*="rating"], [aria-label*="out of"]');
          const rating = ratingEl?.getAttribute("aria-label") ?? ratingEl?.textContent?.trim() ?? "";

          const reviewEl = card.querySelector('[class*="ratingCount"], [class*="reviews"]');
          const reviews = reviewEl?.textContent?.trim() ?? "";

          if (title) {
            results.push({ title, price: priceText, url: href, tcin, image, rating, reviews });
          }
        }

        return results;
      },
      { minPrice, maxPrice, limit }
    );

    if (products.length === 0) {
      return ok(`No products found for "${query}"`);
    }

    const lines = [`Found ${products.length} products for "${query}":\n`];
    products.forEach((p, i) => {
      lines.push(
        `${i + 1}. ${p.title}\n` +
        `   Price: ${p.price}\n` +
        `   TCIN: ${p.tcin || "N/A"}\n` +
        `   Rating: ${p.rating || "N/A"} (${p.reviews || "no reviews"})\n` +
        `   URL: ${p.url}\n`
      );
    });

    return ok(lines.join("\n"));
  });
}

async function handleGetProduct(url?: string, tcin?: string) {
  if (!url && !tcin) {
    return err("Provide either url or tcin");
  }

  return withPage(async (page: Page) => {
    const targetUrl =
      url ?? `https://www.target.com/p/-/A-${tcin}`;

    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(2000);

    try {
      await page.waitForSelector(
        '[data-test="product-title"], h1[class*="Heading"]',
        { timeout: 15000 }
      );
    } catch {
      return err("Product page failed to load");
    }

    const product = await page.evaluate(() => {
      const title =
        document.querySelector('[data-test="product-title"]')?.textContent?.trim() ??
        document.querySelector("h1")?.textContent?.trim() ?? "";

      const price =
        document.querySelector('[data-test="product-price"]')?.textContent?.trim() ??
        document.querySelector('[class*="CurrentPrice"]')?.textContent?.trim() ?? "";

      const description =
        document.querySelector('[data-test="item-details-description"]')?.textContent?.trim() ??
        document.querySelector('[class*="Description"]')?.textContent?.trim()?.slice(0, 500) ?? "";

      const brand =
        document.querySelector('[data-test="product-brand"]')?.textContent?.trim() ?? "";

      const rating =
        document.querySelector('[class*="RatingStars"], [data-test="ratings"]')
          ?.getAttribute("aria-label") ?? "";

      const reviews =
        document.querySelector('[data-test="rating-count"]')?.textContent?.trim() ?? "";

      const availability =
        document.querySelector('[data-test="deliveryAvailability"]')?.textContent?.trim() ??
        document.querySelector('[class*="FulfillmentSection"]')?.textContent?.trim()?.slice(0, 200) ?? "";

      const images = Array.from(
        document.querySelectorAll('[data-test="product-image"] img, [class*="MediaCarousel"] img')
      )
        .map((img) => (img as HTMLImageElement).src)
        .filter((src) => src && !src.includes("data:"))
        .slice(0, 3);

      const urlMatch = window.location.href.match(/\/-\/A-(\d+)/);
      const tcin = urlMatch ? urlMatch[1] : "";

      return { title, price, description, brand, rating, reviews, availability, images, tcin };
    });

    const lines = [
      `**${product.title}**`,
      `Brand: ${product.brand || "N/A"}`,
      `Price: ${product.price || "N/A"}`,
      `TCIN: ${product.tcin || "N/A"}`,
      `Rating: ${product.rating || "N/A"} (${product.reviews || "0 reviews"})`,
      ``,
      `**Description:**`,
      product.description || "N/A",
      ``,
      `**Availability:**`,
      product.availability || "N/A",
      ``,
      `URL: ${page.url()}`,
    ];

    if (product.images.length > 0) {
      lines.push(`\nImages:\n${product.images.join("\n")}`);
    }

    return ok(lines.join("\n"));
  });
}

async function handleCheckStoreAvailability(
  tcin?: string,
  url?: string,
  zipCode?: string
) {
  if (!tcin && !url) {
    return err("Provide either tcin or url");
  }

  return withPage(async (page: Page) => {
    const targetUrl = url ?? `https://www.target.com/p/-/A-${tcin}`;

    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(2000);

    // If zip code provided, update location
    if (zipCode) {
      try {
        const locationBtn = await page.$(
          '[data-test="zipCodeButton"], [aria-label*="store"], [class*="storeLocation"]'
        );
        if (locationBtn) {
          await locationBtn.click();
          await page.waitForTimeout(1000);

          const zipInput = await page.waitForSelector(
            'input[placeholder*="ZIP"], input[name="zip"]',
            { timeout: 5000 }
          );
          await zipInput.fill(zipCode);
          await zipInput.press("Enter");
          await page.waitForTimeout(2000);
        }
      } catch {
        // Continue without location update
      }
    }

    // Scrape store availability
    const storeInfo = await page.evaluate(() => {
      const pickupSection = document.querySelector(
        '[data-test="fulfillment-cell-in-store-pickup"], [data-test="pickup-availability"]'
      );

      if (!pickupSection) {
        // Try broader selector
        const allFulfillment = document.querySelector(
          '[class*="FulfillmentSection"], [data-test="fulfillment-section"]'
        );
        return {
          available: false,
          details: allFulfillment?.textContent?.trim()?.slice(0, 500) ?? "Unable to determine store availability",
          stores: [],
        };
      }

      const isAvailable = !pickupSection.textContent?.toLowerCase().includes("not available") &&
        !pickupSection.textContent?.toLowerCase().includes("out of stock");

      const storeEls = Array.from(
        document.querySelectorAll('[data-test="store-name"], [class*="StoreName"]')
      );
      const stores = storeEls.map((el) => el.textContent?.trim() ?? "").filter(Boolean).slice(0, 5);

      return {
        available: isAvailable,
        details: pickupSection.textContent?.trim()?.slice(0, 300) ?? "",
        stores,
      };
    });

    const lines = [
      `**In-Store Availability**`,
      `Status: ${storeInfo.available ? "Available for pickup" : "Not available for pickup"}`,
    ];

    if (storeInfo.stores.length > 0) {
      lines.push(`\nNearby stores with stock:`);
      storeInfo.stores.forEach((s) => lines.push(`  - ${s}`));
    }

    if (storeInfo.details) {
      lines.push(`\nDetails: ${storeInfo.details}`);
    }

    return ok(lines.join("\n"));
  });
}

async function handleAddToCart(
  url?: string,
  tcin?: string,
  quantity = 1,
  fulfillment = "shipping"
) {
  if (!isLoggedIn()) {
    return err("Not logged in. Use the `login` tool first.");
  }
  if (!url && !tcin) {
    return err("Provide either url or tcin");
  }

  return withPage(async (page: Page) => {
    const targetUrl = url ?? `https://www.target.com/p/-/A-${tcin}`;

    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(2000);

    // Adjust quantity if > 1
    if (quantity > 1) {
      try {
        const qtyInput = await page.$(
          '[data-test="quantity-input"], input[aria-label*="Quantity"], select[name="quantity"]'
        );
        if (qtyInput) {
          await qtyInput.fill(String(quantity));
        }
      } catch {
        // Ignore quantity adjustment errors
      }
    }

    // Select fulfillment method
    if (fulfillment === "pickup") {
      try {
        const pickupBtn = await page.$(
          '[data-test="fulfillment-option-pickup"], [aria-label*="pickup"]'
        );
        if (pickupBtn) await pickupBtn.click();
        await page.waitForTimeout(500);
      } catch {
        // Ignore
      }
    }

    // Click Add to Cart
    const addBtn = await page.waitForSelector(
      '[data-test="shoppingCartButton"], [aria-label*="Add to cart"], button[class*="AddToCart"]',
      { timeout: 10000 }
    );

    const btnText = await addBtn.textContent();
    if (btnText?.toLowerCase().includes("out of stock") || btnText?.toLowerCase().includes("unavailable")) {
      return err("Item is out of stock or unavailable");
    }

    await addBtn.click();
    await page.waitForTimeout(3000);

    // Confirm added — look for cart confirmation modal or count change
    const confirmation = await page.$(
      '[data-test="cart-count-bubble"], [aria-label*="items in cart"], [class*="CartCount"]'
    );
    const count = confirmation ? await confirmation.textContent() : null;

    return ok(
      `Successfully added to cart (${fulfillment}).\n` +
      `Quantity: ${quantity}\n` +
      `Cart count: ${count ?? "updated"}\n` +
      `Product URL: ${targetUrl}`
    );
  });
}

async function handleViewCart() {
  if (!isLoggedIn()) {
    return err("Not logged in. Use the `login` tool first.");
  }

  return withPage(async (page: Page) => {
    await page.goto("https://www.target.com/cart", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(2000);

    const cart = await page.evaluate(() => {
      const emptyMsg = document.querySelector(
        '[data-test="empty-cart-message"], [class*="EmptyCart"]'
      );
      if (emptyMsg) return { empty: true, items: [], subtotal: "" };

      const itemEls = Array.from(
        document.querySelectorAll(
          '[data-test="cart-item"], [class*="CartItem"]'
        )
      );

      const items = itemEls.map((item) => {
        const title =
          item.querySelector('[data-test="product-title"], [class*="ProductTitle"]')
            ?.textContent?.trim() ?? "";
        const price =
          item.querySelector('[data-test="cart-item-price"], [class*="Price"]')
            ?.textContent?.trim() ?? "";
        const qty =
          item.querySelector('[data-test="quantity-input"], [class*="Quantity"]')
            ?.textContent?.trim() ?? "1";
        return { title, price, qty };
      });

      const subtotalEl =
        document.querySelector('[data-test="cart-subtotal"], [class*="Subtotal"]');
      const subtotal = subtotalEl?.textContent?.trim() ?? "";

      return { empty: false, items, subtotal };
    });

    if (cart.empty) {
      return ok("Cart is empty.");
    }

    const lines = [`**Cart (${cart.items.length} item${cart.items.length !== 1 ? "s" : ""})**\n`];
    cart.items.forEach((item, i) => {
      lines.push(`${i + 1}. ${item.title}\n   Price: ${item.price}  Qty: ${item.qty}`);
    });
    if (cart.subtotal) lines.push(`\nSubtotal: ${cart.subtotal}`);

    return ok(lines.join("\n"));
  });
}

async function handleClearCart() {
  if (!isLoggedIn()) {
    return err("Not logged in. Use the `login` tool first.");
  }

  return withPage(async (page: Page) => {
    await page.goto("https://www.target.com/cart", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(2000);

    let removed = 0;

    // Remove items one by one
    while (true) {
      const removeBtn = await page.$(
        '[data-test="cart-item-delete"], [aria-label*="Remove"], button[class*="Remove"]'
      );
      if (!removeBtn) break;

      await removeBtn.click();
      await page.waitForTimeout(1500);

      // Confirm removal modal if present
      const confirmBtn = await page.$('[data-test="modal-confirm"], [aria-label*="Confirm"]');
      if (confirmBtn) {
        await confirmBtn.click();
        await page.waitForTimeout(1000);
      }

      removed++;
      if (removed > 50) break; // safety guard
    }

    if (removed === 0) {
      return ok("Cart was already empty.");
    }

    return ok(`Removed ${removed} item${removed !== 1 ? "s" : ""} from cart.`);
  });
}

async function handleCheckout(confirm: boolean) {
  if (!isLoggedIn()) {
    return err("Not logged in. Use the `login` tool first.");
  }

  return withPage(async (page: Page) => {
    // First view cart
    await page.goto("https://www.target.com/cart", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(2000);

    const cartSummary = await page.evaluate(() => {
      const items = Array.from(
        document.querySelectorAll('[data-test="cart-item"], [class*="CartItem"]')
      ).map((item) => {
        const title =
          item.querySelector('[data-test="product-title"]')?.textContent?.trim() ?? "";
        const price =
          item.querySelector('[data-test="cart-item-price"]')?.textContent?.trim() ?? "";
        return `${title} — ${price}`;
      });

      const subtotal =
        document.querySelector('[data-test="cart-subtotal"]')?.textContent?.trim() ?? "";
      const tax =
        document.querySelector('[data-test="cart-tax"]')?.textContent?.trim() ?? "";
      const total =
        document.querySelector('[data-test="cart-total"]')?.textContent?.trim() ?? "";

      return { items, subtotal, tax, total };
    });

    if (cartSummary.items.length === 0) {
      return err("Cart is empty. Add items before checking out.");
    }

    const summary = [
      `**Order Summary (${cartSummary.items.length} item${cartSummary.items.length !== 1 ? "s" : ""})**\n`,
      ...cartSummary.items.map((item, i) => `${i + 1}. ${item}`),
      "",
      cartSummary.subtotal ? `Subtotal: ${cartSummary.subtotal}` : "",
      cartSummary.tax ? `Tax: ${cartSummary.tax}` : "",
      cartSummary.total ? `Total: ${cartSummary.total}` : "",
    ].filter(Boolean);

    if (!confirm) {
      return ok(
        summary.join("\n") +
        "\n\n⚠️  This is a preview. Call `checkout` with `confirm: true` to place the order."
      );
    }

    // Proceed to checkout
    const checkoutBtn = await page.waitForSelector(
      '[data-test="checkout-button"], button[class*="Checkout"]',
      { timeout: 10000 }
    );
    await checkoutBtn.click();
    await page.waitForTimeout(3000);

    const currentUrl = page.url();
    if (!currentUrl.includes("/checkout")) {
      return err(
        "Failed to navigate to checkout. May require additional verification."
      );
    }

    // At checkout page — try to place order
    const placeOrderBtn = await page.$(
      '[data-test="place-order-button"], button[class*="PlaceOrder"]'
    );
    if (!placeOrderBtn) {
      return ok(
        summary.join("\n") +
        "\n\n⚠️  Reached checkout page but could not auto-submit. Please complete manually at: " +
        currentUrl
      );
    }

    await placeOrderBtn.click();
    await page.waitForTimeout(5000);

    const confirmationUrl = page.url();
    const orderConfirmation = await page.evaluate(() => {
      const orderNum = document.querySelector(
        '[data-test="order-number"], [class*="OrderNumber"]'
      )?.textContent?.trim();
      return { orderNum };
    });

    return ok(
      summary.join("\n") +
      "\n\n✅ Order placed successfully!\n" +
      (orderConfirmation.orderNum ? `Order #: ${orderConfirmation.orderNum}\n` : "") +
      `Confirmation URL: ${confirmationUrl}`
    );
  });
}

async function handleGetOrders(limit: number) {
  if (!isLoggedIn()) {
    return err("Not logged in. Use the `login` tool first.");
  }

  return withPage(async (page: Page) => {
    await page.goto("https://www.target.com/account/orders", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(2500);

    try {
      await page.waitForSelector(
        '[data-test="order-summary"], [class*="OrderCard"], [class*="OrderHistory"]',
        { timeout: 15000 }
      );
    } catch {
      return err("Failed to load orders page. Make sure you are logged in.");
    }

    const orders = await page.evaluate((limit: number) => {
      const orderEls = Array.from(
        document.querySelectorAll(
          '[data-test="order-summary"], [class*="OrderCard"], [class*="order-card"]'
        )
      ).slice(0, limit);

      return orderEls.map((el) => {
        const orderId =
          el.querySelector('[data-test="order-number"], [class*="OrderNumber"]')
            ?.textContent?.trim() ?? "";
        const date =
          el.querySelector('[data-test="order-date"], [class*="OrderDate"]')
            ?.textContent?.trim() ?? "";
        const total =
          el.querySelector('[data-test="order-total"], [class*="OrderTotal"]')
            ?.textContent?.trim() ?? "";
        const status =
          el.querySelector('[data-test="order-status"], [class*="OrderStatus"]')
            ?.textContent?.trim() ?? "";
        const itemCount =
          el.querySelector('[data-test="order-item-count"]')
            ?.textContent?.trim() ?? "";

        return { orderId, date, total, status, itemCount };
      });
    }, limit);

    if (orders.length === 0) {
      return ok("No orders found.");
    }

    const lines = [`**Order History (${orders.length} orders)**\n`];
    orders.forEach((order, i) => {
      lines.push(
        `${i + 1}. Order ${order.orderId || "N/A"}\n` +
        `   Date: ${order.date || "N/A"}\n` +
        `   Total: ${order.total || "N/A"}\n` +
        `   Status: ${order.status || "N/A"}\n` +
        (order.itemCount ? `   Items: ${order.itemCount}\n` : "")
      );
    });

    return ok(lines.join("\n"));
  });
}

async function handleTrackOrder(orderId: string) {
  if (!isLoggedIn()) {
    return err("Not logged in. Use the `login` tool first.");
  }

  return withPage(async (page: Page) => {
    await page.goto(`https://www.target.com/account/orders/${orderId}`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(2000);

    // Try order detail page
    const tracking = await page.evaluate(() => {
      const statusEl =
        document.querySelector('[data-test="order-status"], [class*="TrackingStatus"]');
      const status = statusEl?.textContent?.trim() ?? "";

      const trackingNumEl =
        document.querySelector('[data-test="tracking-number"], [class*="TrackingNumber"]');
      const trackingNum = trackingNumEl?.textContent?.trim() ?? "";

      const estimatedDeliveryEl =
        document.querySelector('[data-test="estimated-delivery"], [class*="EstimatedDelivery"]');
      const estimatedDelivery = estimatedDeliveryEl?.textContent?.trim() ?? "";

      const carrierEl =
        document.querySelector('[data-test="carrier-name"], [class*="Carrier"]');
      const carrier = carrierEl?.textContent?.trim() ?? "";

      const itemEls = Array.from(
        document.querySelectorAll('[data-test="order-item"], [class*="OrderItem"]')
      ).map((el) => el.querySelector("img, [class*='title']")?.textContent?.trim() ?? "").filter(Boolean);

      return { status, trackingNum, estimatedDelivery, carrier, items: itemEls };
    });

    const lines = [`**Order Tracking — #${orderId}**\n`];
    lines.push(`Status: ${tracking.status || "N/A"}`);
    if (tracking.carrier) lines.push(`Carrier: ${tracking.carrier}`);
    if (tracking.trackingNum) lines.push(`Tracking #: ${tracking.trackingNum}`);
    if (tracking.estimatedDelivery)
      lines.push(`Estimated Delivery: ${tracking.estimatedDelivery}`);
    if (tracking.items.length > 0) {
      lines.push(`\nItems:`);
      tracking.items.forEach((item) => lines.push(`  - ${item}`));
    }
    lines.push(`\nURL: ${page.url()}`);

    return ok(lines.join("\n"));
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function err(text: string) {
  return { content: [{ type: "text" as const, text: `Error: ${text}` }], isError: true };
}

// ─── Start server ─────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("Target MCP server running on stdio\n");
}

main().catch((e) => {
  process.stderr.write(`Fatal: ${e}\n`);
  process.exit(1);
});
