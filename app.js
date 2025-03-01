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

// Set up PostgreSQL connection with more robust error handling
let pool;
try {
  pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: {
      rejectUnauthorized: false,
    },
    // Add connection timeout and retry settings
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    max: 20, // Maximum number of clients in the pool
  });

  // Test connection immediately
  pool.on("error", (err) => {
    console.error("Unexpected error on idle client", err);
    process.exit(-1);
  });

  console.log("PostgreSQL connection pool initialized");
} catch (err) {
  console.error("Error initializing PostgreSQL pool:", err);
}

// Set up EJS as view engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Middleware
app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Global error handler caught:", err);
  res.status(500).render("error", {
    error: "An internal server error occurred",
    details: process.env.NODE_ENV === "development" ? err.stack : null,
  });
});

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
    // Check if pool is initialized
    if (!pool) {
      console.error("Database pool not initialized");
      return false;
    }

    // Test connection
    const client = await pool.connect();
    try {
      console.log("Database connection successful");

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

      console.log("Database tables created successfully");
      return true;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Error initializing database:", err);
    return false;
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

// Upload file route
app.post("/upload", upload.array("files"), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).send("No files were uploaded.");
  }

  let client;
  try {
    client = await pool.connect();

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
      const fileResult = await client.query(
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
        } else if (dataType === "PT-COMP") {
          // For PT-COMP, different format
          const x = parseFloat(parts[2].trim());
          const y = parseFloat(parts[3].trim());
          const z = parseFloat(parts[4].trim());

          await client.query(
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

          await client.query(
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
  } finally {
    if (client) client.release();
  }
});

// View file data route with enhanced error handling
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

    console.log(`File query result: ${JSON.stringify(fileResult.rows)}`);

    if (fileResult.rows.length === 0) {
      return res.status(404).render("error", {
        error: "File not found",
        details: `The requested file (ID: ${fileId}) does not exist.`,
      });
    }

    const file = fileResult.rows[0];

    // Get file weight if available
    const weightResult = await client.query(
      "SELECT weight FROM file_weights WHERE file_id = $1",
      [fileId]
    );

    const weight =
      weightResult.rows.length > 0 ? weightResult.rows[0].weight : null;
    console.log(`Weight for file ID ${fileId}: ${weight}`);

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
    res.status(500).render("error", {
      error: "Error fetching file data",
      details:
        process.env.NODE_ENV === "development"
          ? err.stack
          : "An internal server error occurred. Please try again later.",
    });
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

// Summary page with file data
app.get("/summary", async (req, res) => {
  let client;
  try {
    client = await pool.connect();

    // Get files with their weights and a specific value from each file
    const result = await client.query(`
      SELECT 
        f.id, 
        f.filename, 
        fw.weight,
        (
          SELECT x 
          FROM file_data 
          WHERE file_id = f.id AND data_type = 'DISTANCE' AND index = 1
          LIMIT 1
        ) AS distance_value
      FROM files f
      LEFT JOIN file_weights fw ON f.id = fw.file_id
      ORDER BY f.uploaded_at DESC
    `);

    res.render("summary", { files: result.rows });
  } catch (err) {
    console.error("Error fetching summary data:", err);
    res.render("summary", { files: [], error: "Error fetching summary data" });
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

// Error page template route
app.get("/error", (req, res) => {
  res.render("error", {
    error: "Test error page",
    details:
      "This is a test error page to ensure the error template is working correctly.",
  });
});

// Catch-all route for 404 errors
app.use((req, res) => {
  res.status(404).render("error", {
    error: "Page Not Found",
    details: `The requested URL ${req.path} was not found on this server.`,
  });
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
