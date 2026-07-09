
# 🌶️ Mom Masale Website

![GitHub Pages](https://img.shields.io/badge/Deployment-GitHub%20Pages-success)
![Responsive](https://img.shields.io/badge/Responsive-Yes-blue)
![Vanilla JS](https://img.shields.io/badge/JavaScript-Vanilla-yellow)
![License](https://img.shields.io/badge/License-All%20Rights%20Reserved-red)

Official website for **Mom Masale**, a spice brand by **Sakksham Enterprises**.

🔗 **Live Website:** https://mommasale.com

---

## About

This repository contains the source code for the official Mom Masale website.

The website showcases the company's range of authentic Indian spices and blended masalas while providing customers with information about products, bulk orders, and contact details.

---

## Features

- Responsive design for desktop, tablet and mobile
- Dynamic product catalogue powered by JSON
- Automatic product page generation via Node.js script
- Self-triggering deployment structure ensuring pages stay up-to-date with json
- Single-source of Truth structure, all data depends on Json: High maintainability
- Product search and category filtering
- Dark & Light theme (localStorage & user-preference)
- SEO optimized pages
- Structured data (Schema.org)
- XML Sitemap & Robots.txt
- Progressive Web App (PWA) support
- Bulk enquiry form - Google Scripts integration: Feeds data directly into Google Sheets
- Google Maps Embedded
- WhatsApp quick contact & Checkout: Auto generated / action-aware typed messages
- GitHub Pages deployment

---

## Tech Stack

- HTML5
- CSS3
- Vanilla JavaScript
- Node.js
- JSON
- GitHub Pages
- Github Actions

---

## Project Structure

## 📁 Project Structure

```text

└── sakksham1-mom-masale-website/
    ├── README.md
    ├── 404.html
    ├── about.html
    ├── bulk-orders.html
    ├── CNAME
    ├── contact.html
    ├── index.html
    ├── products.html
    ├── recipes.html
    ├── robots.txt
    ├── site.webmanifest
    ├── sitemap.xml
    ├── data/
    │   ├── .lastmod-cache.json
    |   ├── products.json
    |   ├── recipes.json
    ├── products/...
    │   
    ├── recipes/...
    │   
    ├── scripts/
    │   ├── build-site.js
    │   ├── product-template.html
    │   └── recipe-template.html
    └── .github/
        └── workflows/
            └── generate-site.yml

```

---

## Deployment

The website is automatically deployed using **GitHub Pages**.

Every push to the main branch triggers a new deployment.

---

## License

This repository is maintained by **Sakksham Enterprises**.

All branding, product information, images and content are © Mom Masale. Unauthorized commercial reuse is not permitted.

## Author

**Sakksham Srivastava**

Computer Science Engineering student with an interest in web development, Android customization, and building practical software solutions for real-world businesses.

- Website: https://mommasale.com
- GitHub: https://github.com/sakksham1