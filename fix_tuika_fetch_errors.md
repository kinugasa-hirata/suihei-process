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
