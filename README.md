# @striderlabs/mcp-target

MCP (Model Context Protocol) server connector for Target retail shopping. Enables AI assistants to search products, manage carts, and track orders on Target.com via browser automation.

## Installation

```bash
npx @striderlabs/mcp-target
```

Or install globally:

```bash
npm install -g @striderlabs/mcp-target
```

## MCP Configuration

Add to your MCP client config (e.g., Claude Desktop `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "target": {
      "command": "npx",
      "args": ["@striderlabs/mcp-target"]
    }
  }
}
```

## Tools

### `status`
Check Target authentication status and session info.

**Parameters:** none

---

### `login`
Authenticate with your Target account via browser automation.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `email` | string | ✅ | Target account email |
| `password` | string | ✅ | Target account password |
| `headless` | boolean | | Run browser headlessly (default: `true`). Set `false` to see the browser window. |

Credentials are never stored — only session cookies are persisted to `~/.striderlabs/target/`.

---

### `logout`
Clear session cookies and log out.

**Parameters:** none

---

### `search_products`
Search Target products with optional filters and sorting.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `query` | string | ✅ | Search term |
| `category` | string | | Category filter (e.g., `electronics`) |
| `min_price` | number | | Minimum price filter |
| `max_price` | number | | Maximum price filter |
| `sort_by` | string | | Sort order: `relevance`, `price_low`, `price_high`, `newest`, `bestselling` |
| `limit` | number | | Max results (default: 10, max: 24) |

---

### `get_product`
Get detailed product information including price, description, and availability.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `url` | string | | Full Target product URL |
| `tcin` | string | | Target product TCIN/item ID |

_Provide either `url` or `tcin`._

---

### `check_store_availability`
Check if a product is available for in-store pickup at nearby Target stores.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `tcin` | string | | Target product TCIN |
| `url` | string | | Product URL |
| `zip_code` | string | | ZIP code for nearby store search |

_Provide either `url` or `tcin`._

---

### `add_to_cart`
Add a product to your Target cart.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `url` | string | | Target product URL |
| `tcin` | string | | Target product TCIN |
| `quantity` | number | | Quantity (default: 1) |
| `fulfillment` | string | | `pickup`, `shipping`, or `delivery` (default: `shipping`) |

_Requires login._

---

### `view_cart`
View current cart contents and totals.

**Parameters:** none
_Requires login._

---

### `clear_cart`
Remove all items from cart.

**Parameters:** none
_Requires login._

---

### `checkout`
Preview or place a Target order.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `confirm` | boolean | | Set `true` to place the order. Default `false` (preview only). |

_Requires login. Always preview first before confirming._

---

### `get_orders`
Get order history.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `limit` | number | | Number of recent orders (default: 10) |

_Requires login._

---

### `track_order`
Track an order's status and delivery information.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `order_id` | string | ✅ | Target order ID |

_Requires login._

---

## Session Storage

Session cookies are stored at `~/.striderlabs/target/`:
- `cookies.json` — Browser session cookies
- `auth.json` — Account metadata (email, login timestamp)

Credentials (email/password) are **never** persisted.

## Technical Details

- **Transport:** stdio (MCP standard)
- **Browser automation:** Playwright with Chromium + stealth patches
- **Stealth:** Patches `navigator.webdriver`, plugins, permissions, and other bot-detection vectors
- **Cookie persistence:** Survives across sessions; no repeated logins needed

## Notes

- Target.com may prompt for CAPTCHA or additional verification on first login. Use `headless: false` to handle these interactively.
- Store availability and cart operations require geolocation; defaults to Chicago, IL.
- The `checkout` tool with `confirm: true` will place a real order. Always preview first.

## License

MIT — Strider Labs
