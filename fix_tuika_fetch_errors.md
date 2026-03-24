# Fix Logs

## 2026-03-24: Fixed tuika-process Excel File Fetching and CDN Errors

**Issues Fixed:**
1. **Excel Library Loading Error**: The browser was failing to load `xlsx.min.js` from `cdnjs.cloudflare.com` due to a MIME type mismatch (which usually means the CDN was returning an error page instead of the JavaScript file).
2. **Template Not Found Error**: The frontend could not fetch `LOT_template.xlsx` from `/templates/LOT_template.xlsx` because Express wasn't accurately mapping the `public` directory when running in certain environments (like Vercel).

**Files Modified:**
- `views/tuika-process.ejs`:
  - Updated the CDN link from `https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.min.js` to `https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js`.

- `app.js`:
  - Updated the static file serving middleware from `app.use(express.static("public"));` to `app.use(express.static(path.join(__dirname, "public")));` to use an absolute path, ensuring the `public` folder is correctly resolved regardless of the current working directory.

## 2026-03-24: Fixed loss of `kensa` sheet formatting and target data location

**Problems Identified:**
1. **Formatting Loss**: The previous library `xlsx` (SheetJS Community Edition) does not support retaining cell styling, formulas, or formatting when exporting Excel files on the front end. When reading the template and exporting it, all beautiful template formats shown in the `kensa` sheet were completely removed.
2. **Sheet Targeting Error**: The older script read the first sheet `workbook.Sheets[workbook.SheetNames[0]]`, which happened to be the `kensa` (format) sheet, and overwrote its visible cells directly with raw values instead of placing data into the hidden repository sheet as expected. 

**Fixes Applied in `views/tuika-process.ejs`:**
- **Swapped Library**: Replaced `xlsx` with `ExcelJS` via frontend CDN (`https://cdn.jsdelivr.net/npm/exceljs@4.3.0/dist/exceljs.min.js`), which is specifically designed to read Excel template layouts, mutate cell data, and re-export without touching existing graphics or borders.
- **Changed Sheet Access**: Pointed the logic to exclusively read `workbook.getWorksheet('sheet')`. All Lot numbers and distance values are now deposited directly into this blank data sheet column `A`, keeping the `kensa` presentation sheet untouched and perfectly formatted, so its formulas can just reference the raw data securely. 

## 2026-03-24: Fixed extracted LOT prefix in data sheet (`B3`)

**Fixes Applied in `views/tuika-process.ejs`:**
- **LOT Number Extraction**: The `extractLotPrefix()` regex originally required manual input of letters (e.g. `LOT`) to correctly extract the prefix code and drop it into cell `B3`. We expanded the matching logic to gracefully handle inputs that start with digits (like `2026(266-268)`), automatically prepending the `LOT` text so it accurately generates `LOT2026` inside the exported `B3` cell, satisfying the `kensa` template's lookup references.
