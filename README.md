# 🌶️ Mom Masale Website

![Deployment](https://img.shields.io/badge/Deployment-Cloudflare%20Pages-orange)
![Backend](https://img.shields.io/badge/Backend-Workers%20%2B%20D1-f38020)
![Responsive](https://img.shields.io/badge/Responsive-Yes-blue)
![Vanilla JS](https://img.shields.io/badge/JavaScript-Vanilla-yellow)
![License](https://img.shields.io/badge/License-All%20Rights%20Reserved-red)

Official website and e-commerce platform for **Mom Masale**, a spice brand by **Sakksham Enterprises** (Shuklaganj, Unnao, Uttar Pradesh).

🔗 **Live Website:** https://mommasale.com

---

## About

This repository contains the full source for the Mom Masale platform: a static, JSON-driven storefront (products, recipes, spice guide/blog) plus a Cloudflare Workers backend handling accounts, cart, checkout, payments, and internal operations (orders, inventory, staff roles, approvals).

---

## Architecture

**Frontend**
- Static HTML/CSS/vanilla JS — no framework, no build step for the pages themselves
- Content-driven: product, recipe, and spice-guide pages are generated from JSON, not hand-written
- Maroon/gold design system with glassmorphism ("liquid glass") styling, dark mode via `[data-theme="dark"]`
- Clean URLs (no `.html` in internal links) across all top-level pages

**Backend**
- **Cloudflare Pages** serves the static site
- **Cloudflare Workers Functions** (`functions/api/**`) power everything dynamic: auth, cart, checkout, orders, admin/staff tooling
- **D1 (SQLite)** is the source of truth for users, sessions, orders, and — as of the product/inventory migration — the full product catalog (`data/products.json` is now a **generated artifact** synced from D1 on every catalog write, not hand-edited)
- **R2** stores uploaded images, served through a caching proxy at `/api/images/*`
- **Razorpay** for payments (UPI, cards, netbanking), with both client-side verification and a server-to-server webhook as backup
- **Resend** for transactional email (OTPs, order confirmations)
- **Google Identity Services** for Google sign-in (ID token verified via Google's `tokeninfo` endpoint)

**Roles & workflow**
- Role-based access (`admin`, `manager`, `warehouser`, `packaging`, `salesperson`, `customer`) enforced server-side on every request — never trusted from a session claim
- An approval queue (`manager/approvals`) gates stock adjustments and catalog changes proposed by non-admin roles before they take effect
- Full audit log (`audit_log` table) for admin actions

**Build pipeline**
- `scripts/build-site.js` — reads `data/products.json`, `data/recipes.json`, `data/blog.json`, cross-links them (e.g. "Recipes Using This" on product pages, "Shop the Ingredients" on recipe pages), and generates static pages + `sitemap.xml`
- `scripts/minify-assets.js` — minifies `css/style.css` → `style.min.css` and `js/main.js` → `main.min.js`, and rewrites references across all HTML/templates
- GitHub Actions (`generate-site.yml`) runs both automatically on every push that touches content or source assets, committing the regenerated output back with `[skip ci]`

---

## Features

- Dynamic product, recipe, and spice-guide catalogue — all driven from JSON, auto-generates individual pages + sitemap
- Full account system: email/password, Google sign-in, OTP-based login and password reset, email verification
- Server-side cart tied to the logged-in account (not localStorage)
- Checkout with server-side repricing and stock validation (client-submitted prices are never trusted)
- Razorpay payments (UPI/cards/netbanking) or Cash on Delivery
- Order history, order status tracking
- Admin dashboard (`/admin`) — orders, stats, customers, product CRUD
- Studio content manager (`/studio`) — registry-driven CRUD for products, recipes, and spice guide entries
- Staff tooling for warehouse, packaging, and sales roles with a manager approval workflow for stock/catalog changes
- Push + Telegram + email notifications for new orders, payments, and pending approvals
- Dark & light theme (persisted, respects OS preference)
- SEO: Schema.org structured data (LocalBusiness, Product, Recipe, Article/FAQPage, BreadcrumbList), clean URLs, auto-generated sitemap
- PWA support (web manifest, icons)
- WhatsApp quick contact & checkout handoff
- Google Maps embed
- Bulk order enquiry form (Google Apps Script → Sheets)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML5, CSS3, Vanilla JavaScript |
| Hosting | Cloudflare Pages |
| Backend | Cloudflare Workers Functions |
| Database | Cloudflare D1 (SQLite) |
| Object storage | Cloudflare R2 |
| Payments | Razorpay |
| Email | Resend |
| Auth | Google Identity Services + custom session auth |
| Build tooling | Node.js, clean-css, terser |
| CI/CD | GitHub Actions |

---

## Project Structure

```text
mom-masale-website/
├── index.html, products.html, recipes.html, spice-guide.html,
│   about.html, contact.html, account.html, checkout.html,
│   order-confirmation.html, admin.html, studio.html, 404.html
├── css/               style.css (source) + style.min.css (generated)
├── js/                main.js (source) + main.min.js (generated), page-specific scripts
├── data/
│   ├── products.json      generated from D1 — do not hand-edit
│   ├── recipes.json
│   ├── blog.json
│   └── settings.json      site-wide commerce/business config
├── products/, recipes/, guide/     generated per-item pages
├── scripts/
│   ├── build-site.js          unified static-page generator
│   ├── minify-assets.js       CSS/JS minification + reference rewriting
│   ├── strip-html-links.js    one-time clean-URL migration (safe to re-run)
│   ├── optimize-images.js     one-time WebP migration
│   └── *-template.html        page templates for products/recipes/blog
├── functions/api/
│   ├── auth/              signup, login, Google auth, OTP flows, sessions
│   ├── admin/              orders, products, stats, customers, roles, notifications
│   ├── manager/            approvals queue, staff login history
│   ├── warehouse/, packaging/, sales/    role-scoped staff endpoints
│   ├── _utils/             shared helpers (session, crypto, github, razorpay, notify, etc.)
│   ├── checkout.js, verify-payment.js, razorpay-webhook.js
│   └── cart.js, orders.js, images/
├── migrations/          D1 schema migrations, in order
├── schema.sql           base schema reference
└── .github/workflows/generate-site.yml
```

---


## Deployment

Cloudflare Pages builds and deploys automatically on every push to `main`. GitHub Actions separately regenerates product/recipe/blog pages, the sitemap, and minified assets whenever their source data or templates change, committing the result back with `[skip ci]` so it doesn't trigger a deployment loop.

---

## License

This repository is maintained by **Sakksham Enterprises**. All branding, product information, images, and content are © Mom Masale. Unauthorized commercial reuse is not permitted.

## Author

**Sakksham Srivastava**
Computer Science Engineering student building practical software solutions for real-world businesses.

- Website: https://mommasale.com
- GitHub: https://github.com/sakksham1
