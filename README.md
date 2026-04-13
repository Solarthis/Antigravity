# Project Antigravity 🚀 (Copart Edition)
**Enterprise Auction Sourcing & Alert Pipeline**

**Developed by:** MAT Solutions  
**Client:** VIP / Best Buy Enterprise  

---

## 📖 Overview

Project Antigravity is a bespoke, high-performance automation engine designed to track auction listings on **Copart.com**. Specifically tuned for the Guyana import market, the system monitors high-value vehicles (e.g., Toyota Tacoma 2012-2015) and filters for specific variants like the **Access Cab**. 

The system uses a stealth-optimized headless browser to bypass anti-bot protections, ensuring the client receives real-time WhatsApp/SMS alerts via Twilio the moment a "promising" listing hits the auction block.

---

## 🏗 System Architecture

* **Backend Environment:** Node.js + Express
* **Browser Automation:** Playwright (Headless)
* **Stealth Layer:** playwright-extra + playwright-extra-plugin-stealth
* **Database:** PostgreSQL (Stores Lot IDs, Hunt Lists, and Alert History)
* **Notifications:** Twilio API
* **Task Scheduling:** Node-Cron (Optimized for business hour clusters)

---

## ⚙️ Prerequisites

* **Node.js** (v18.0.0+)
* **PostgreSQL**
* **VPS Requirements:** Minimum 2GB RAM (Required to run Headless Chrome)
* **Twilio Account** for API keys

---

## 🚀 Getting Started

### 1. Initialize Folders
```bash
mkdir project-antigravity
cd project-antigravity
mkdir backend frontend