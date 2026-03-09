# Horizontal Nozzle Inspection & Stock Management System

A web application for managing CMM measurement data from horizontal nozzle inspections, tracking inventory status, and coordinating orders and import schedules.

---

## Features

### Inspection Management
- **TXT File Upload & Auto-Parsing**: Automatically parses semicolon-delimited CMM output files (CIRCLE / PT-COMP / DISTANCE measurement types)
- **17-Point Dimensional Validation**: Automatically compares labeled checkpoints (A–N, G1–G4) against predefined tolerance ranges
- **Weight Recording**: Log product weights manually per file or via bulk Excel import
- **Summary Report**: View multi-file inspection results in a consolidated table; print or save as PDF
- **Detailed File View**: Inspect all raw measurement values and pass/fail results per file

### Stock Management
- **Order Tracking**: Register orders with quantity and due date; real-time inventory allocation
- **Import Scheduling**: Create an import schedule entry and sequential placeholder records are auto-generated
- **Status Lifecycle**: Track products through a 5-stage status pipeline
- **Priority-Based Allocation**: Inventory is automatically allocated to orders by due date priority

### Excel Integration
- **Bulk Weight Import**: Upload an Excel file (column A = file number, column B = weight) with real-time progress tracking
- **Weight Export**: Download all file numbers and weights as an Excel file
- **Measurement Export**: Export all measurement values and pass/fail flags to Excel

### Authentication
- Session-based login stored in Appwrite; sessions expire after 24 hours
- Weight editing is restricted to authorized users only
- Login history is recorded (username, timestamp, permission level)

---

## Inspection Status Definitions

| Status ID | Label | Description |
|---|---|---|
| `upcoming_import` | Scheduled | Import registered, not yet arrived |
| `imported` | Arrived | Received, awaiting inspection |
| `inspection` | In Inspection | TXT file uploaded, measurements recorded |
| `finished_inspection` | Complete | Weight recorded, ready to ship |
| `shipped` | Shipped | Hidden from main view and inventory |

---

## Validation Checkpoints

| Label | Min (mm) | Max (mm) | Source |
|---|---|---|---|
| A | 8.0 | 8.4 | PT-COMP idx=1, x (absolute) |
| B | 37.2 | 37.8 | CIRCLE idx=9, diameter |
| C | 15.7 | 16.1 | DISTANCE idx=1, y (absolute) |
| D | 23.9 | 24.3 | PT-COMP idx=4, x (absolute) |
| E | 11.2 | 11.4 | CIRCLE idx=8, diameter |
| F | 3.1 | 3.3 | Average diameter of CIRCLE idx=2,4,5,6 |
| G1–G4 | 7.8 | 8.2 | CIRCLE idx=10–13, diameter |
| H | 4.9 | 5.1 | DISTANCE idx=2, y (absolute) |
| I | 29.8 | 30.2 | CIRCLE idx=15, diameter |
| J | 154.9 | 155.9 | CIRCLE idx=7, diameter |
| K | 82.8 | 83.4 | PT-COMP idx=2, x (absolute) |
| L | 121.8 | 122.8 | CIRCLE idx=14, diameter |
| M | — | — | Manual judgment |
| N | — | — | Visual judgment |

> G1–G4 values are averaged on the summary screen and judged as a single G value.

---

## Input File Format

Semicolon-delimited text files exported from a CMM:

```
Lot No. : <lot_number>
<index>;CIRCLE;<count>;<x>;<y>;<z>;<rx>;<ry>;<rz>;;<diameter>;<roundness>
<index>;PT-COMP;<count>;<x>;<y>;<z>
<index>;DISTANCE;;<x>;<y>;<z>;;;;;
```

---

## Tech Stack

| Category | Technology |
|---|---|
| Runtime | Node.js 20.x |
| Web Framework | Express.js 4.x |
| Template Engine | EJS 3.x |
| Database | Appwrite (Cloud or Self-hosted) |
| Appwrite SDK | node-appwrite ^14 |
| File Upload | Multer (memory storage) |
| Excel Processing | xlsx (SheetJS) |
| Cookies | cookie-parser |
| Environment Variables | dotenv |
| Deployment | Vercel (@vercel/node) |
| Dev Tooling | nodemon |

---

## Appwrite Database Schema

| Environment Variable | Collection | Key Fields |
|---|---|---|
| `APPWRITE_COLLECTION_INSPECTIONS_ID` | inspections | `filename`, `lot`, `weight`, `status`, `is_archived`, `import_id`, `measurementA`–`measurementL`, `isValidA`–`isValidL`, `uploaded_at` |
| `APPWRITE_COLLECTION_SESSIONS_ID` | sessions | `session_id`, `username`, `can_edit_weights`, `created_at`, `expires_at` |
| `APPWRITE_COLLECTION_LOGIN_LOGS_ID` | login_logs | `username`, `logged_in_at`, `can_edit_weights` |
| `APPWRITE_COLLECTION_ORDERS_ID` | orders | `quantity`, `due_date`, `status` |
| `APPWRITE_COLLECTION_IMPORTS_ID` | imports | `quantity`, `scheduled_date`, `actual_date`, `status` |

---

## Project Structure

```
suihei-process/
├── app.js                    # Main application (all routes and business logic)
├── package.json
├── vercel.json               # Vercel deployment configuration
├── .env                      # Environment variables (not committed to git)
├── .gitignore
├── public/                   # Static assets
│   ├── favicon.ico
│   ├── android-chrome-*.png
│   └── site.webmanifest
└── views/                    # EJS templates
    ├── index.ejs             # Main dashboard (file list, upload)
    ├── fileData.ejs          # File detail view (all measurement values)
    ├── summary.ejs           # Multi-file inspection summary
    ├── stock-management.ejs  # Stock, order, and import management
    ├── login.ejs             # Login page
    └── error.ejs             # Error page
```

---

## Getting Started

### Prerequisites

- Node.js 20.x
- npm
- [Appwrite](https://appwrite.io) project (Cloud or Self-hosted)
- Vercel account (for deployment)

### Local Development

```bash
# 1. Clone the repository
git clone https://github.com/kinugasa-hirata/suihei-process.git
cd suihei-process

# 2. Install dependencies
npm install

# 3. Create a .env file
```

Required `.env` variables:

```env
PORT=3000
NODE_ENV=development

APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1
APPWRITE_PROJECT_ID=<your_project_id>
APPWRITE_API_KEY=<your_api_key>
APPWRITE_DATABASE_ID=<your_database_id>

APPWRITE_COLLECTION_INSPECTIONS_ID=<collection_id>
APPWRITE_COLLECTION_LOGIN_LOGS_ID=<collection_id>
APPWRITE_COLLECTION_SESSIONS_ID=<collection_id>
APPWRITE_COLLECTION_ORDERS_ID=<collection_id>
APPWRITE_COLLECTION_IMPORTS_ID=<collection_id>

SESSION_SECRET=<random_secret_string>
```

```bash
# 4. Start the development server
npm run dev

# 5. Open in browser
# http://localhost:3000
```

---

## Usage

### 1. Login
Navigate to `/login` and enter your credentials. Weight editing features are only available to authorized accounts.

### 2. Upload TXT Files
Use the upload form on the main dashboard to select one or more `.txt` files. If a matching placeholder exists (from an import schedule), it is automatically filled with measurement data and promoted to `inspection` status.

### 3. Record Weights
Enter weights directly in the file list, or upload an Excel file (column A = file number, column B = weight in grams) via the bulk import feature. Saving a weight automatically advances the status to `finished_inspection`.

### 4. View Summary / Inspection Report
Select files from the list and click "Show Summary" to open a consolidated pass/fail table. Print or save to PDF from the browser.

### 5. Stock & Order Management
Navigate to `/stock-management` to register orders (quantity + due date) and import schedules. The system automatically allocates inventory to orders by due date and shows whether each order can be fully fulfilled with ready stock.

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/` | Main dashboard |
| GET/POST | `/login` | Login |
| GET | `/logout` | Logout |
| POST | `/upload` | Upload TXT file(s) |
| GET | `/files/:fileId` | File detail view |
| GET | `/summary` | Inspection summary |
| POST | `/update-weight` | Update single weight |
| POST | `/update-weights` | Bulk weight update |
| POST | `/import-weights` | Excel weight import |
| GET | `/import-progress` | Import progress (polling) |
| GET | `/export-weights` | Download weight Excel |
| GET | `/export-measurements` | Download measurement Excel |
| POST | `/archive-files` | Archive files (hide) |
| POST | `/unarchive-files` | Restore archived files |
| GET | `/stock-management` | Stock management view |
| POST | `/api/orders` | Create order |
| PUT | `/api/orders/:id` | Update order |
| DELETE | `/api/orders/:id` | Delete order |
| POST | `/api/imports` | Create import schedule |
| PUT | `/api/imports/:id` | Update import (marks arrival, syncs inspection status) |
| DELETE | `/api/imports/:id` | Delete import schedule |
| PUT | `/api/inspections/:id/status` | Update individual inspection status |
| PUT | `/api/inspections/advance-status` | Bulk status advance |
| GET | `/health` | Health check |

---

## Deployment

```bash
# Push to GitHub, then connect the repository to Vercel.
# Add all .env variables in Vercel Project Settings → Environment Variables.
# Vercel will deploy automatically on each push to main.
```

---

## Scripts

| Command | Description |
|---|---|
| `npm start` | Start production server |
| `npm run dev` | Start development server with auto-reload (nodemon) |

---

## Security Notes

- Session IDs are generated with `crypto.randomBytes(32)` and stored in Appwrite
- Sessions expire after 24 hours; expired sessions are deleted on access
- Cookies are set with `httpOnly: true` and `secure: true` in production
- Weight write operations are protected by a dedicated auth middleware
- Uploaded files are processed entirely in memory — nothing is written to disk

---

## Contributors

- **Kinugasa Hirata** — Repository owner
- Built for quality control inspection workflows in manufacturing

---

> This system is specifically designed for horizontal nozzle inspection processes.  
> Database migrated from PostgreSQL to **Appwrite** as of v2.1.0.
