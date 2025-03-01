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
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS files (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) NOT NULL,
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
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

    console.log("Database initialized successfully");
  } catch (err) {
    console.error("Error initializing database:", err);
  }
};

// Home route
app.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM files ORDER BY uploaded_at DESC"
    );
    res.render("index", { files: result.rows });
  } catch (err) {
    console.error("Error fetching files:", err);
    res.render("index", { files: [], error: "Error fetching files" });
  }
});

// Upload file route
app.post("/upload", upload.array("files"), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).send("No files were uploaded.");
  }

  try {
    for (const file of req.files) {
      // Extract filename without extension
      const fileNameWithExt = path.basename(file.originalname);
      const fileName = path.basename(
        fileNameWithExt,
        path.extname(fileNameWithExt)
      );

      // Parse the file content
      const content = file.buffer.toString("utf8");
      const lines = content
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      // Insert file into database
      const fileResult = await pool.query(
        "INSERT INTO files (filename) VALUES ($1) RETURNING id",
        [fileName]
      );
      const fileId = fileResult.rows[0].id;

      // Process and insert each line
      for (const line of lines) {
        const parts = line.split(";");

        // Skip lines that don't have enough data or aren't properly formatted
        if (parts.length < 3) continue;

        const index = parseInt(parts[0], 10);
        // Clean up data type (remove any extra characters like & in CIRCLE&)
        const dataType = parts[1].trim().replace(/[^A-Z-]/g, "");

        // For different data types, process differently
        if (dataType === "CIRCLE" || dataType === "PLANE") {
          // For CIRCLE and PLANE, we expect more values
          if (parts.length < 10) continue;

          // Clean values
          const cleanValue = (val) => {
            const trimmed = val.trim();
            return trimmed === "" ? null : parseFloat(trimmed);
          };

          // Extract values for specific columns
          const x = cleanValue(parts[2]);
          const y = cleanValue(parts[3]);
          const z = cleanValue(parts[4]);
          const rotX = cleanValue(parts[5]);
          const rotY = cleanValue(parts[6]);
          const rotZ = cleanValue(parts[7]);
          const note = parts[8].trim();
          const diameter = cleanValue(parts[9]);
          const tolerance = parts.length > 10 ? cleanValue(parts[10]) : null;

          // Insert the data - fixed to use note instead of rotZ twice
          await pool.query(
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
        } else if (dataType === "PT-COMP") {
          // For PT-COMP, different format
          const x = parseFloat(parts[2].trim());
          const y = parseFloat(parts[3].trim());
          const z = parseFloat(parts[4].trim());

          await pool.query(
            `INSERT INTO file_data 
             (file_id, data_type, index, x, y, z) 
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [fileId, dataType, index, x, y, z]
          );
        } else if (dataType === "DISTANCE") {
          // For DISTANCE
          const x = parseFloat(parts[2].trim());
          const y = parseFloat(parts[3].trim());
          const z = parseFloat(parts[4].trim());
          const diameter = parseFloat(parts[8].trim());

          await pool.query(
            `INSERT INTO file_data 
             (file_id, data_type, index, x, y, z, diameter) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [fileId, dataType, index, x, y, z, diameter]
          );
        }
      }
    }

    res.redirect("/");
  } catch (err) {
    console.error("Error processing files:", err);
    res.status(500).send("Error processing files: " + err.message);
  }
});

// View file data route with enhanced error handling
app.get("/files/:id", async (req, res) => {
  try {
    const fileId = req.params.id;
    console.log(`Fetching file data for file ID: ${fileId}`);

    // Get file info
    const fileResult = await pool.query("SELECT * FROM files WHERE id = $1", [
      fileId,
    ]);

    console.log(`File query result: ${JSON.stringify(fileResult.rows)}`);

    if (fileResult.rows.length === 0) {
      return res.status(404).send("File not found");
    }

    // Get file data
    const dataResult = await pool.query(
      "SELECT * FROM file_data WHERE file_id = $1 ORDER BY index",
      [fileId]
    );

    console.log(`Data query result count: ${dataResult.rows.length} rows`);

    // Check if there's any data to display
    if (dataResult.rows.length === 0) {
      return res.render("fileData", {
        file: fileResult.rows[0],
        data: [],
        message: "No data found for this file.",
      });
    }

    // Log a sample row to debug
    if (dataResult.rows.length > 0) {
      console.log(`Sample data row: ${JSON.stringify(dataResult.rows[0])}`);
    }

    res.render("fileData", {
      file: fileResult.rows[0],
      data: dataResult.rows,
    });
  } catch (err) {
    console.error("Error fetching file data:", err);
    res
      .status(500)
      .send(`Error fetching file data: ${err.message}\n\n${err.stack}`);
  }
});

// Debug route to initialize the database
app.get("/init-db", async (req, res) => {
  try {
    await initializeDatabase();
    res.send("Database initialized successfully");
  } catch (err) {
    console.error("Error initializing database:", err);
    res.status(500).send("Error initializing database: " + err.message);
  }
});

// Start server with immediate database initialization
(async () => {
  try {
    console.log("Initializing database...");
    await initializeDatabase();
    console.log("Database initialized successfully");

    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });
  } catch (err) {
    console.error("Failed to initialize database:", err);
  }
})();

module.exports = app;
