// File: app.js

// Add dotenv to load environment variables from .env file
require("dotenv").config();

const express = require("express");
const multer = require("multer");
// Puppeteer removed - PDF export disabled, use browser print instead
const path = require("path");
const fs = require("fs");
const { Pool } = require("pg");
const bodyParser = require("body-parser");
const session = require("express-session");

const app = express();
const port = process.env.PORT || 3000;

// Set up PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL_NO_SSL || process.env.DATABASE_URL,
  max: 1, // Single connection for serverless
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
});

// After creating the pool, add error handling
pool.on("error", (err) => {
  console.error("Unexpected error on idle client", err);
  process.exit(-1);
});

// Add error logging to the pool connection
pool.connect((err, client, done) => {
  if (err) {
    console.error("Error connecting to the database:", err);
  }
});

// Set up EJS as view engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Add session middleware (move this up, before routes)
app.use(
  session({
    secret: "your-secret-key",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }, // Set to false for development
  })
);

// Middleware
app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Set up multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});

// Authentication middleware
const requireLogin = (req, res, next) => {
  if (req.session.loggedIn) {
    next();
  } else {
    res.redirect("/login");
  }
};

// Login routes
app.get("/login", (req, res) => {
  res.render("login", { error: null });
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  const validUsernames = ["hinkan", "naemura", "iwatsuki"];

  if (validUsernames.includes(username) && /^\d{4}$/.test(password)) {
    req.session.loggedIn = true;
    req.session.username = username; // Store username in session

    // Set inspector name based on username
    switch (username) {
      case "naemura":
        req.session.inspectorName = "苗村";
        break;
      case "iwatsuki":
        req.session.inspectorName = "岩月";
        break;
      default:
        req.session.inspectorName = "検査員";
    }

    res.redirect("/");
  } else {
    res.render("login", {
      error: "ユーザー名またはパスワードが正しくありません",
    });
  }
});

// Logout route
app.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Error destroying session:", err);
    }
    res.redirect("/login");
  });
});

// Create tables if they don't exist
const initializeDatabase = async () => {
  let client;
  try {
    client = await pool.connect();

    await client.query(`
      CREATE TABLE IF NOT EXISTS files (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) NOT NULL,
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS file_data (
        id SERIAL PRIMARY KEY,
        file_id INTEGER REFERENCES files(id) ON DELETE CASCADE,
        data_type VARCHAR(50),
        index INTEGER,
        x DECIMAL,
        y DECIMAL,
        z DECIMAL,
        rot_x DECIMAL,
        rot_y DECIMAL,
        rot_z DECIMAL,
        note TEXT,
        diameter DECIMAL,
        tolerance DECIMAL
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS file_weights (
        id SERIAL PRIMARY KEY,
        file_id INTEGER REFERENCES files(id) ON DELETE CASCADE,
        weight DECIMAL(10, 1) NOT NULL,
        UNIQUE(file_id)
      )
    `);

    // Create login_logs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS login_logs (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) NOT NULL,
        login_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ip_address VARCHAR(45),
        user_agent TEXT,
        status VARCHAR(50),
        location VARCHAR(255)
      )
    `);

    console.log("Database initialized successfully");
    return true;
  } catch (err) {
    console.error("Error initializing database:", err);
    return false;
  } finally {
    if (client) client.release();
  }
};

// Home route
app.get("/", requireLogin, async (req, res) => {
  let client;
  try {
    client = await pool.connect();
    const viewFileId = req.query.view;
    const result = await client.query(`
      SELECT f.id, f.filename, f.uploaded_at, fw.weight
      FROM files f
      LEFT JOIN file_weights fw ON f.id = fw.file_id
      ORDER BY f.uploaded_at DESC
    `);

    // Convert weights from kg to g for display
    const files = result.rows.map((file) => ({
      ...file,
      weight: file.weight ? parseFloat(file.weight).toFixed(1) : null,
    }));

    res.render("index", {
      files: files,
      error: null,
      viewFileId: viewFileId,
    });
  } catch (err) {
    console.error("Error in home route:", err);
    res.status(500).render("index", {
      files: [],
      error: "Database connection error. Please try again later.",
      viewFileId: null,
    });
  } finally {
    if (client) client.release();
  }
});

// Updated upload route with overwrite option
app.post("/upload", requireLogin, upload.array("files"), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).send("No files were uploaded.");
  }

  let client;
  try {
    client = await pool.connect();

    // Process each uploaded file
    for (const file of req.files) {
      // Extract filename without extension
      const fileNameWithExt = path.basename(file.originalname);
      const fileName = path.basename(
        fileNameWithExt,
        path.extname(fileNameWithExt)
      );

      // Check if file already exists
      const fileCheckResult = await client.query(
        "SELECT id FROM files WHERE filename = $1",
        [fileName]
      );

      const fileExists = fileCheckResult.rows.length > 0;
      const existingFileId = fileExists ? fileCheckResult.rows[0].id : null;

      // Default overwrite action
      let overwriteAction = req.body.overwriteAction || "skip";

      // If file exists and action is to skip, continue to next file
      if (fileExists && overwriteAction === "skip") {
        continue;
      }

      let fileId;
      if (fileExists && overwriteAction === "overwrite") {
        // Delete existing file data
        await client.query("DELETE FROM file_data WHERE file_id = $1", [
          existingFileId,
        ]);

        // Keep the existing file record and its ID
        fileId = existingFileId;
      } else {
        // Insert new file record
        const fileResult = await client.query(
          "INSERT INTO files (filename) VALUES ($1) RETURNING id",
          [fileName]
        );
        fileId = fileResult.rows[0].id;
      }

      // Parse the file content
      const content = file.buffer.toString("utf8");
      const lines = content
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      // Process and insert each line
      for (const line of lines) {
        try {
          const parts = line.split(";");

          // Skip lines that don't have enough data
          if (parts.length < 3) continue;

          const index = parseInt(parts[0], 10) || 0;
          // Clean up data type (remove any extra characters like & in CIRCLE&)
          const rawDataType = parts[1].trim();
          const dataType = rawDataType.replace(/[^A-Z0-9-]/g, "");

          // Clean values helper function
          const cleanValue = (val, defaultVal = null) => {
            if (val === undefined || val === null) return defaultVal;
            const trimmed = val.toString().trim();
            return trimmed === "" ? defaultVal : parseFloat(trimmed);
          };

          // Common fields for all data types
          let x = null,
            y = null,
            z = null;
          let rotX = null,
            rotY = null,
            rotZ = null;
          let note = "";
          let diameter = null;
          let tolerance = null;

          // Process based on data type and available parts
          if (parts.length >= 5) {
            x = cleanValue(parts[2]);
            y = cleanValue(parts[3]);
            z = cleanValue(parts[4]);
          }

          // For data types that include rotation values
          if (
            (dataType === "CIRCLE" || dataType === "PLANE") &&
            parts.length >= 8
          ) {
            rotX = cleanValue(parts[5]);
            rotY = cleanValue(parts[6]);
            rotZ = cleanValue(parts[7]);
          }

          // For data types that include notes
          if (
            (dataType === "CIRCLE" || dataType === "PLANE") &&
            parts.length >= 9
          ) {
            note = parts[8].trim();
          }

          // For data types that include diameter
          if (
            (dataType === "CIRCLE" || dataType === "PLANE") &&
            parts.length >= 10
          ) {
            diameter = cleanValue(parts[9]);
          }

          // For data types that include tolerance
          if (
            (dataType === "CIRCLE" || dataType === "PLANE") &&
            parts.length >= 11
          ) {
            tolerance = cleanValue(parts[10]);
          }

          // Special case for DISTANCE type (may have diameter in a different position)
          if (dataType === "DISTANCE" && parts.length >= 9) {
            diameter = cleanValue(parts[8]);
          }

          // Insert into database with all available fields
          await client.query(
            `INSERT INTO file_data 
             (file_id, data_type, index, x, y, z, rot_x, rot_y, rot_z, note, diameter, tolerance) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [
              fileId,
              dataType,
              index,
              x,
              y,
              z,
              rotX,
              rotY,
              rotZ,
              note,
              diameter,
              tolerance,
            ]
          );
        } catch (lineErr) {
          console.error(`Error processing line: ${line}`, lineErr);
        }
      }
    }

    res.redirect("/");
  } catch (err) {
    console.error("Error processing files:", err);
    res.status(500).send("Error processing files: " + err.message);
  } finally {
    if (client) client.release();
  }
});

// View file data route
app.get("/files/:id", async (req, res) => {
  let client;
  try {
    const fileId = req.params.id;
    console.log(`Fetching file data for file ID: ${fileId}`);

    client = await pool.connect();

    // Get file info
    const fileResult = await client.query("SELECT * FROM files WHERE id = $1", [
      fileId,
    ]);

    if (fileResult.rows.length === 0) {
      return res.status(404).send("File not found");
    }

    const file = fileResult.rows[0];

    // Get file weight if available
    const weightResult = await client.query(
      "SELECT weight FROM file_weights WHERE file_id = $1",
      [fileId]
    );

    const weight =
      weightResult.rows.length > 0 ? weightResult.rows[0].weight : null;

    // Get file data
    const dataResult = await client.query(
      "SELECT * FROM file_data WHERE file_id = $1 ORDER BY index",
      [fileId]
    );

    console.log(
      `Retrieved ${dataResult.rows.length} data rows for file ID: ${fileId}`
    );

    // Add weight to file object without modifying the original database record
    const fileWithWeight = {
      ...file,
      weight: weight,
    };

    // Render template with data
    res.render("fileData", {
      file: fileWithWeight,
      data: dataResult.rows,
      username: req.session.username,
    });
  } catch (err) {
    console.error("Error fetching file data:", err);
    res.status(500).send("Error fetching file data: " + err.message);
  } finally {
    if (client) client.release();
  }
});

// Update file weight
app.post("/update-weight", async (req, res) => {
  let client;
  try {
    const { fileId, weight } = req.body;
    console.log(`Updating weight for file ID ${fileId} to ${weight}g`);

    // Convert grams to kilograms for storage
    const weightInKg = parseFloat(weight) / 1000;

    client = await pool.connect();

    // Upsert the weight (insert if not exists, update if exists)
    await client.query(
      `
      INSERT INTO file_weights (file_id, weight)
      VALUES ($1, $2)
      ON CONFLICT (file_id)
      DO UPDATE SET weight = $2
    `,
      [fileId, weightInKg]
    );

    res.redirect("/");
  } catch (err) {
    console.error("Error updating weight:", err);
    res.status(500).send("Error updating weight: " + err.message);
  } finally {
    if (client) client.release();
  }
});

// Delete file route
app.post("/delete-file", requireLogin, async (req, res) => {
  let client;
  try {
    const { fileId } = req.body;
    client = await pool.connect();

    // Start transaction
    await client.query("BEGIN");

    // Delete file data first (due to foreign key constraint)
    await client.query("DELETE FROM file_data WHERE file_id = $1", [fileId]);

    // Delete file weight
    await client.query("DELETE FROM file_weights WHERE file_id = $1", [fileId]);

    // Delete the file record
    await client.query("DELETE FROM files WHERE id = $1", [fileId]);

    // Commit transaction
    await client.query("COMMIT");

    // Change this to return JSON instead of redirect
    res.json({ success: true });
  } catch (err) {
    if (client) await client.query("ROLLBACK");
    console.error("Error deleting file:", err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    if (client) client.release();
  }
});

// Add this before the summary route
app.post("/set-selected-files", requireLogin, async (req, res) => {
  const { selectedFiles } = req.body;
  req.session.selectedFiles = selectedFiles;
  res.redirect("/summary");
});

// Modify the summary route
app.get("/summary", requireLogin, async (req, res) => {
  let client;
  try {
    client = await pool.connect();
    let query;
    let params;

    // First check if we have a file range selection
    const minFileNumber = req.query.minFile
      ? parseInt(req.query.minFile, 10)
      : null;
    const maxFileNumber = req.query.maxFile
      ? parseInt(req.query.maxFile, 10)
      : null;

    if (minFileNumber !== null && maxFileNumber !== null) {
      // Use the file number range query
      query = `
        SELECT f.id, f.filename, fw.weight, f.uploaded_at
        FROM files f
        LEFT JOIN file_weights fw ON f.id = fw.file_id
        WHERE 
          CASE 
            WHEN f.filename ~ '^[0-9]+' THEN 
              CAST(substring(f.filename from '^[0-9]+') AS INTEGER)
            ELSE 0
          END BETWEEN $1 AND $2
        ORDER BY 
          CASE 
            WHEN f.filename ~ '^[0-9]+' THEN 
              CAST(substring(f.filename from '^[0-9]+') AS INTEGER)
            ELSE 0
          END ASC
      `;
      params = [minFileNumber, maxFileNumber];
    } else if (req.query.selectedFiles) {
      // Handle individually selected files
      const selectedFiles = req.query.selectedFiles
        .split(",")
        .filter((id) => id);
      if (selectedFiles.length > 0) {
        const placeholders = selectedFiles
          .map((_, index) => `$${index + 1}`)
          .join(",");
        query = `
          SELECT f.id, f.filename, fw.weight, f.uploaded_at
          FROM files f
          LEFT JOIN file_weights fw ON f.id = fw.file_id
          WHERE f.id IN (${placeholders})
          ORDER BY 
            CASE 
              WHEN f.filename ~ '^[0-9]+' THEN 
                CAST(substring(f.filename from '^[0-9]+') AS INTEGER)
              ELSE 0
            END ASC
        `;
        params = selectedFiles;
      } else {
        // No files selected, return empty result
        return res.render("summary", {
          files: [],
          fileData: {},
          minFile: "",
          maxFile: "",
        });
      }
    } else {
      // No selection criteria provided, return empty result
      return res.render("summary", {
        files: [],
        fileData: {},
        minFile: "",
        maxFile: "",
      });
    }

    console.log("Query:", query); // Debug log
    console.log("Params:", params); // Debug log

    const filesResult = await client.query(query, params);
    console.log("Found files:", filesResult.rows.length); // Debug log

    if (filesResult.rows.length === 0) {
      // No files found, render with empty data
      return res.render("summary", {
        files: [],
        fileData: {},
        minFile: req.query.minFile || "",
        maxFile: req.query.maxFile || "",
      });
    }

    // Define the highlighted cells with UPDATED coordinates
    const cellCoordinates = [
      // First 4 numbers
      { row: 2, col: 4, label: "A" },
      { row: 19, col: 11, label: "B" },
      { row: 14, col: 5, label: "C" },
      { row: 10, col: 4, label: "D" },
      // Two blanks
      { row: null, col: null, label: "E" },
      { row: null, col: null, label: "F" },
      // G values - now checking four locations
      { row: 20, col: 11, label: "G1" },
      { row: 21, col: 11, label: "G2" },
      { row: 22, col: 11, label: "G3" },
      { row: 23, col: 11, label: "G4" },
      // remaining values
      { row: 6, col: 4, label: "H" },
      { row: 25, col: 11, label: "I" },
      { row: 15, col: 11, label: "J" },
      { row: 5, col: 4, label: "K" },
      { row: 24, col: 11, label: "L" },
      // Two final blanks
      { row: null, col: null, label: "M" },
      { row: null, col: null, label: "N" },
    ];

    // Update validation ranges to handle G1-G4
    const validationRanges = {
      A: { min: 8.0, max: 8.4 }, // 8.21 is within range
      B: { min: 37.2, max: 37.8 }, // 37.98 is OUT of range!
      C: { min: 15.7, max: 16.1 }, // 15.91 is within range
      D: { min: 23.9, max: 24.3 }, // 24.09 is within range
      E: { min: 11.2, max: 11.4 }, // Φ11.2 +0.2/0
      F: { min: 3.1, max: 3.3 }, // Φ3.2 ±0.1
      G1: { min: 7.8, max: 8.2 }, // Φ8.0 ±0.2
      G2: { min: 7.8, max: 8.2 }, // Φ8.0 ±0.2
      G3: { min: 7.8, max: 8.2 }, // Φ8.0 ±0.2
      G4: { min: 7.8, max: 8.2 }, // Φ8.0 ±0.2
      H: { min: 4.9, max: 5.1 }, // 5.0 ±0.1
      I: { min: 29.8, max: 30.2 }, // 30 ±0.2
      J: { min: 154.9, max: 155.9 }, // 125.89 is OUT of range!
      K: { min: 82.8, max: 83.4 }, // 83.23 is within range
      L: { min: 121.8, max: 122.8 }, // 122.35 is within range
    };

    // Add this function to check if a value is within range
    function isValueValid(label, value) {
      if (!validationRanges[label]) return true; // No validation range defined
      if (value === null || value === undefined || isNaN(value)) return false;

      const range = validationRanges[label];
      const numValue = parseFloat(value);
      return numValue >= range.min && numValue <= range.max;
    }

    // Create the fileData structure
    const fileData = {};

    // Process each file
    for (const file of filesResult.rows) {
      const fileId = file.id;
      fileData[fileId] = {};

      try {
        // Get all data for this file
        const dataResult = await client.query(
          `SELECT * FROM file_data WHERE file_id = $1 ORDER BY index, id`,
          [fileId]
        );

        // Extract values for each coordinate
        for (const coord of cellCoordinates) {
          const label = coord.label;

          // Handle empty coordinates
          if (coord.row === null || coord.col === null) {
            fileData[fileId][label] = "-";
            continue;
          }

          const rowIdx = coord.row;
          const colIdx = coord.col;

          // Skip if row doesn't exist
          if (rowIdx >= dataResult.rows.length) {
            fileData[fileId][label] = "N/A";
            continue;
          }

          // Get the data row
          const dataRow = dataResult.rows[rowIdx];
          if (!dataRow) {
            fileData[fileId][label] = "N/A";
            continue;
          }

          // Extract and format the value
          let value;
          if (colIdx === 3) {
            value = dataRow.x !== null ? Math.abs(parseFloat(dataRow.x)) : null;
          } else if (colIdx === 4) {
            value = dataRow.y !== null ? Math.abs(parseFloat(dataRow.y)) : null;
          } else if (colIdx === 5) {
            value = dataRow.z !== null ? Math.abs(parseFloat(dataRow.z)) : null;
          } else if (colIdx === 11) {
            value =
              dataRow.tolerance !== null ? parseFloat(dataRow.tolerance) : null;
          } else {
            value = null;
          }

          // Format and validate the value
          if (value !== null && !isNaN(value)) {
            const formattedValue = value.toFixed(2);
            // Add validation status to the data
            fileData[fileId][label] = {
              value: formattedValue,
              isValid: isValueValid(label, value),
            };
          } else {
            fileData[fileId][label] = {
              value: "N/A",
              isValid: false,
            };
          }
        }
      } catch (err) {
        console.error(`Error processing file ${fileId}:`, err);
        // Set all labels to N/A for this file
        for (const coord of cellCoordinates) {
          fileData[fileId][coord.label] = "Error";
        }
      }
    }

    // Render the summary template
    res.render("summary", {
      files: filesResult.rows,
      fileData: fileData,
      minFile: req.query.minFile || "",
      maxFile: req.query.maxFile || "",
      inspectorName: req.session.inspectorName,
      username: req.session.username,
      validationRanges: validationRanges,
    });
  } catch (err) {
    console.error("Error fetching summary data:", err);
    res.status(500).render("summary", {
      files: [],
      fileData: {},
      error: "Error fetching summary data: " + err.message,
    });
  } finally {
    if (client) client.release();
  }
});

// Debug route to initialize the database
app.get("/init-db", async (req, res) => {
  try {
    const success = await initializeDatabase();
    if (success) {
      res.send("Database initialized successfully");
    } else {
      res.status(500).send("Failed to initialize database");
    }
  } catch (err) {
    console.error("Error initializing database:", err);
    res.status(500).send("Error initializing database: " + err.message);
  }
});

// Start server with immediate database initialization
(async () => {
  try {
    console.log("Initializing database...");
    const success = await initializeDatabase();
    if (success) {
      console.log("Database initialized successfully");
    } else {
      console.warn(
        "Database initialization failed, but continuing server startup"
      );
    }

    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
  }
})();

// Add this near the end of app.js, before module.exports
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render("error", {
    message: "Something broke!",
    error: process.env.NODE_ENV === "development" ? err : {},
  });
});

// Add new route to handle multiple weight updates
app.post("/update-weights", async (req, res) => {
  // Check if user is hinkan - prevent weight updates
  if (req.session.username === "hinkan") {
    return res.status(403).json({
      success: false,
      error: "権限がありません",
    });
  }

  let client;
  try {
    const { weights } = req.body;
    console.log("Received weights update request:", weights);

    client = await pool.connect();
    await client.query("BEGIN");

    for (const { fileId, weight } of weights) {
      if (!fileId || !weight || isNaN(weight)) {
        throw new Error(`Invalid data: fileId=${fileId}, weight=${weight}`);
      }

      // Format weight to one decimal place
      const formattedWeight = parseFloat(weight).toFixed(1);

      console.log(`Updating weight for file ${fileId}: ${formattedWeight}g`);

      await client.query(
        `
        INSERT INTO file_weights (file_id, weight)
        VALUES ($1, $2)
        ON CONFLICT (file_id)
        DO UPDATE SET weight = $2
        `,
        [fileId, formattedWeight]
      );
    }

    await client.query("COMMIT");
    console.log("Weight update successful");
    res.json({ success: true });
  } catch (err) {
    if (client) await client.query("ROLLBACK");
    console.error("Error updating weights:", err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    if (client) client.release();
  }
});

// Update weight route
app.post("/files/:id/update-weight", async (req, res) => {
  let client;
  try {
    // Check if user is hinkan - prevent weight updates
    if (req.session.username === "hinkan") {
      return res.status(403).send("権限がありません");
    }

    const fileId = req.params.id;
    let weight = req.body.weight;

    // Convert to number and format to one decimal place
    weight = Number(weight).toFixed(1);

    client = await pool.connect();

    // Update the weight in file_weights table
    await client.query(
      `
      INSERT INTO file_weights (file_id, weight)
      VALUES ($1, $2)
      ON CONFLICT (file_id) 
      DO UPDATE SET weight = $2
      RETURNING weight
      `,
      [fileId, weight]
    );

    // Redirect back to the file page to show the updated value
    res.redirect(`/files/${fileId}`);
  } catch (error) {
    console.error("Error updating weight:", error);
    res.status(500).send("Error updating weight");
  } finally {
    if (client) {
      client.release();
    }
  }
});
// Export weights as JSON
app.get("/export-weights", async (req, res) => {
  let client;
  try {
    client = await pool.connect();

    // Get all files with their weights
    const result = await client.query(`
      SELECT f.filename, fw.weight
      FROM files f
      LEFT JOIN file_weights fw ON f.id = fw.file_id
      ORDER BY 
        CASE 
          WHEN f.filename ~ '^[0-9]+' THEN 
            CAST(substring(f.filename from '^[0-9]+') AS INTEGER)
          ELSE 0
        END ASC
    `);

    // Process the results to match the required format
    const weightData = result.rows.map((row) => {
      // Extract file number if present
      let fileName = row.filename;
      const match = row.filename.match(/^(\d+)/);
      if (match) {
        fileName = match[1];
      }

      return {
        fileName: fileName,
        weight: row.weight ? parseFloat(row.weight).toFixed(1) : null,
      };
    });

    // Filter out entries with null weights
    const filteredData = weightData.filter((item) => item.weight !== null);

    res.json(filteredData);
  } catch (err) {
    console.error("Error exporting weights:", err);
    res.status(500).json({
      success: false,
      error: "Error exporting weights: " + err.message,
    });
  } finally {
    if (client) client.release();
  }
});

// Add this route to app.js, near the other routes before the module.exports line

// Import weights from JSON
app.post("/import-weights", async (req, res) => {
  // Check if user is hinkan - prevent weight updates
  if (req.session.username === "hinkan") {
    return res.status(403).json({
      success: false,
      error: "権限がありません",
    });
  }

  let client;
  try {
    const { weightData } = req.body;

    if (!Array.isArray(weightData) || weightData.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid data format",
      });
    }

    client = await pool.connect();
    await client.query("BEGIN");

    let updatedCount = 0;
    let skippedCount = 0;
    let notFoundCount = 0;

    for (const item of weightData) {
      if (!item.fileName || !item.weight || isNaN(parseFloat(item.weight))) {
        continue;
      }

      // First, find the file by matching the filename pattern
      const fileNamePattern = `^${item.fileName}`;
      const fileResult = await client.query(
        `SELECT id FROM files WHERE filename ~ $1 LIMIT 1`,
        [fileNamePattern]
      );

      if (fileResult.rows.length === 0) {
        notFoundCount++;
        continue;
      }

      const fileId = fileResult.rows[0].id;

      // Check if weight already exists
      const weightResult = await client.query(
        `SELECT weight FROM file_weights WHERE file_id = $1`,
        [fileId]
      );

      const weight = parseFloat(item.weight).toFixed(1);

      if (weightResult.rows.length > 0) {
        // Weight exists, check if it's the same
        const existingWeight = parseFloat(weightResult.rows[0].weight).toFixed(
          1
        );
        if (existingWeight === weight) {
          skippedCount++;
          continue;
        }
      }

      // Insert or update weight
      await client.query(
        `INSERT INTO file_weights (file_id, weight)
         VALUES ($1, $2)
         ON CONFLICT (file_id) 
         DO UPDATE SET weight = $2`,
        [fileId, weight]
      );

      updatedCount++;
    }

    await client.query("COMMIT");

    res.json({
      success: true,
      message: `${updatedCount} weights updated, ${skippedCount} skipped (unchanged), ${notFoundCount} files not found.`,
    });
  } catch (err) {
    if (client) await client.query("ROLLBACK");
    console.error("Error importing weights:", err);
    res.status(500).json({
      success: false,
      error: "Error importing weights: " + err.message,
    });
  } finally {
    if (client) client.release();
  }
});

// PDF Export route - Simplified (Puppeteer removed)
// Users should use browser's "Print to PDF" feature instead
app.get('/export-pdf', async (req, res) => {
  res.status(200).json({
    message: "サーバー側PDF生成は無効になっています。",
    instruction: "ブラウザの印刷機能を使用してPDFに保存してください。",
    steps: [
      "1. 「集計表を表示」ボタンをクリック",
      "2. ブラウザの印刷機能を使用 (Ctrl+P または Cmd+P)",
      "3. プリンターで「PDFに保存」を選択",
      "4. 保存"
    ]
  });
});
module.exports = app;