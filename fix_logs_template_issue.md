# Fix Logs: Template Formatting & Sheet Targeting Issue

## 2026-03-24: Fixed loss of `kensa` sheet formatting and target data location

**Problems Identified:**
1. **Formatting Loss**: The previous library `xlsx` (SheetJS Community Edition) does not support retaining cell styling, formulas, or formatting when exporting Excel files on the front end. When reading the template and exporting it, all beautiful template formats shown in the `kensa` sheet were completely removed.
2. **Sheet Targeting Error**: The older script read the first sheet `workbook.Sheets[workbook.SheetNames[0]]`, which happened to be the `kensa` (format) sheet, and overwrote its visible cells directly with raw values instead of placing data into the hidden repository sheet as expected. 

**Fixes Applied in `views/tuika-process.ejs`:**
- **Swapped Library**: Replaced `xlsx` with `ExcelJS` via frontend CDN (`exceljs.min.js`), which is specifically designed to read Excel template layouts, mutate cell data, and re-export without touching existing graphics or borders.
- **Changed Sheet Access**: Pointed the logic to exclusively read `workbook.getWorksheet('sheet')`. All Lot numbers and distance values are now deposited directly into this blank data sheet column `A` & `B`, keeping the `kensa` presentation sheet untouched and perfectly formatted, so its formulas can just reference the raw data securely. 
