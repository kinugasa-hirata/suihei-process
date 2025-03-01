// File: app.js

// Add dotenv to load environment variables from .env file
require("dotenv").config();

const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { Pool } = require("pg");
const bodyParser = require("body-parser");

const app = express();
const port = process.env.PORT || 3000;

// Set up PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

// Set up EJS as view engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

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
app.get("/", async (req, res) => {
  let client;
  try {
    client = await pool.connect();
    // Get files with their weights (if available)
    const result = await client.query(`
      SELECT f.id, f.filename, f.uploaded_at, fw.weight
      FROM files f
      LEFT JOIN file_weights fw ON f.id = fw.file_id
      ORDER BY f.uploaded_at DESC
    `);

    res.render("index", { files: result.rows });
  } catch (err) {
    console.error("Error in home route:", err);
    res.render("index", {
      files: [],
      error: "Error fetching files. Please try again later.",
    });
  } finally {
    if (client) client.release();
  }
});

// Updated upload route with overwrite option
app.post("/upload", upload.array("files"), async (req, res) => {
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
    console.log(`Updating weight for file ID ${fileId} to ${weight}`);

    // Format weight to have one digit after comma
    const formattedWeight = parseFloat(weight).toFixed(1);

    client = await pool.connect();

    // Upsert the weight (insert if not exists, update if exists)
    await client.query(
      `
      INSERT INTO file_weights (file_id, weight)
      VALUES ($1, $2)
      ON CONFLICT (file_id)
      DO UPDATE SET weight = $2
    `,
      [fileId, formattedWeight]
    );

    res.redirect("/");
  } catch (err) {
    console.error("Error updating weight:", err);
    res.status(500).send("Error updating weight: " + err.message);
  } finally {
    if (client) client.release();
  }
});

app.post("/delete-file", async (req, res) => {
  let client;
  try {
    const { fileId } = req.body;

    if (!fileId) {
      return res.status(400).send("File ID is required");
    }

    client = await pool.connect();

    // Start a transaction to ensure data consistency
    await client.query("BEGIN");

    // Get file info before deletion (for confirmation message)
    const fileResult = await client.query(
      "SELECT filename FROM files WHERE id = $1",
      [fileId]
    );

    if (fileResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).send("File not found");
    }

    const fileName = fileResult.rows[0].filename;

    // Delete file weights (if any)
    await client.query("DELETE FROM file_weights WHERE file_id = $1", [fileId]);

    // Delete file data
    await client.query("DELETE FROM file_data WHERE file_id = $1", [fileId]);

    // Delete file record
    await client.query("DELETE FROM files WHERE id = $1", [fileId]);

    // Commit the transaction
    await client.query("COMMIT");

    // Redirect back to index with success message
    res.redirect(
      "/?message=File '" + fileName + "' has been deleted successfully"
    );
  } catch (err) {
    if (client) {
      await client.query("ROLLBACK");
    }
    console.error("Error deleting file:", err);
    res.status(500).send("Error deleting file: " + err.message);
  } finally {
    if (client) client.release();
  }
});

// Summary page with file data
// Enhanced Summary page route that fetches highlighted data points
app.get("/summary", async (req, res) => {
  let client;
  try {
    client = await pool.connect();

    // Get files with their weights
    // Order by numeric part of filename (descending)
    const filesResult = await client.query(`
      SELECT 
        f.id, 
        f.filename, 
        fw.weight
      FROM files f
      LEFT JOIN file_weights fw ON f.id = fw.file_id
      ORDER BY 
        CASE 
          WHEN f.filename ~ '^[0-9]+' THEN 
            CAST(substring(f.filename from '^[0-9]+') AS INTEGER)
          ELSE 0
        END DESC
    `);

    // Define the coordinates of highlighted cells we want to extract
    // Format: [data_type, approximate_value, description]
    const highlightedDataPoints = [
      {
        type: "PT-COMP",
        coord: "y",
        approxValue: -8.19,
        description: "Y Value (-8.19x)",
      },
      {
        type: "PT-COMP",
        coord: "y",
        approxValue: -83.15,
        description: "Y Value (-83.1xx)",
      },
      {
        type: "DISTANCE",
        coord: "y",
        approxValue: -5.01,
        description: "Y Value (-5.01x)",
      },
      {
        type: "PT-COMP",
        coord: "x",
        approxValue: -24.06,
        description: "X Value (-24.06x)",
      },
      {
        type: "PT-COMP",
        coord: "z",
        approxValue: 15.91,
        description: "Z Value (15.91x)",
      },
      {
        type: "CIRCLE",
        coord: "tolerance",
        approxValue: 155.2,
        description: "Tolerance (155.2xx)",
      },
      {
        type: "CIRCLE",
        coord: "tolerance",
        approxValue: 37.5,
        description: "Tolerance (37.5xx)",
      },
      {
        type: "CIRCLE",
        coord: "tolerance",
        approxValue: 8.0,
        description: "Tolerance (8.00x)",
      },
    ];

    // Extract column labels for the table headers
    const columnLabels = highlightedDataPoints.map(
      (point) => point.description
    );

    // Create a data structure to hold the highlighted values for each file
    const fileData = {};

    // For each file, fetch the highlighted data points
    for (const file of filesResult.rows) {
      fileData[file.id] = {};

      // For each highlighted data point, try to find a matching value in the database
      for (const dataPoint of highlightedDataPoints) {
        // Query to find the closest match to the approximate value
        const query = `
          SELECT ${dataPoint.coord}, data_type
          FROM file_data
          WHERE 
            file_id = $1 AND
            data_type = $2 AND
            ${dataPoint.coord} IS NOT NULL AND
            ${dataPoint.coord} BETWEEN $3 AND $4
          ORDER BY ABS(${dataPoint.coord} - $5)
          LIMIT 1
        `;

        // Calculate a reasonable range around the approximate value (±1% or ±0.05, whichever is larger)
        const tolerance = Math.max(
          Math.abs(dataPoint.approxValue) * 0.01,
          0.05
        );
        const minValue = dataPoint.approxValue - tolerance;
        const maxValue = dataPoint.approxValue + tolerance;

        try {
          const result = await client.query(query, [
            file.id,
            dataPoint.type,
            minValue,
            maxValue,
            dataPoint.approxValue,
          ]);

          if (result.rows.length > 0) {
            // Store the actual value found
            fileData[file.id][dataPoint.description] = parseFloat(
              result.rows[0][dataPoint.coord]
            ).toFixed(3);
          } else {
            // No matching data point found
            fileData[file.id][dataPoint.description] = "N/A";
          }
        } catch (err) {
          console.error(`Error fetching data point for file ${file.id}:`, err);
          fileData[file.id][dataPoint.description] = "Error";
        }
      }
    }

    res.render("summary", {
      files: filesResult.rows,
      fileData: fileData,
      columnLabels: columnLabels,
      dataColumns: columnLabels,
      message: req.query.message,
      error: req.query.error,
    });
  } catch (err) {
    console.error("Error fetching summary data:", err);
    res.render("summary", {
      files: [],
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

module.exports = app;
