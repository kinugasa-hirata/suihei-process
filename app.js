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
    // Check if pool is initialized
    if (!pool) {
      console.error("Database pool not initialized");
      return false;
    }

    // Test connection
    client = await pool.connect();
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

// Enhanced file upload route with better error handling and data extraction
app.post("/upload", upload.array("files"), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).send("No files were uploaded.");
  }

  let client;
  try {
    client = await pool.connect();
    let processedFiles = 0;
    let totalLines = 0;
    let processedLines = 0;
    let skippedLines = 0;

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

      totalLines += lines.length;

      // Insert file into database
      const fileResult = await client.query(
        "INSERT INTO files (filename) VALUES ($1) RETURNING id",
        [fileName]
      );
      const fileId = fileResult.rows[0].id;

      // Process and insert each line
      for (const line of lines) {
        try {
          const parts = line.split(";");

          // Skip lines that don't have enough data
          if (parts.length < 3) {
            console.log(`Skipping line with insufficient parts: ${line}`);
            skippedLines++;
            continue;
          }

          const index = parseInt(parts[0], 10) || 0;
          // Clean up data type more thoroughly - remove any non-alphanumeric/dash chars
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

          processedLines++;
        } catch (lineErr) {
          console.error(`Error processing line: ${line}`, lineErr);
          skippedLines++;
        }
      }

      processedFiles++;
    }

    console.log(
      `Processing summary: ${processedFiles} files, ${processedLines}/${totalLines} lines processed, ${skippedLines} lines skipped`
    );
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

// Debug route to check txt file parsing
app.post("/debug-upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).send("No file was uploaded.");
  }

  try {
    // Get the file content
    const content = req.file.buffer.toString("utf8");
    const lines = content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    // Parse each line
    const parsedLines = lines.map((line) => {
      const parts = line.split(";");
      const parsedData = {
        raw: line,
        parts: parts,
        parsed: {
          index: parts.length > 0 ? parseInt(parts[0], 10) : null,
          dataType: parts.length > 1 ? parts[1].trim() : null,
          x: parts.length > 2 ? parseFloat(parts[2]) : null,
          y: parts.length > 3 ? parseFloat(parts[3]) : null,
          z: parts.length > 4 ? parseFloat(parts[4]) : null,
        },
      };

      return parsedData;
    });

    // Send the parsed results back to the user
    res.send(`
      <h1>File Parsing Debug</h1>
      <h2>Filename: ${req.file.originalname}</h2>
      <p>Total lines: ${lines.length}</p>
      <pre>${JSON.stringify(parsedLines, null, 2)}</pre>
    `);
  } catch (err) {
    console.error("Error debugging file:", err);
    res.status(500).send("Error debugging file: " + err.message);
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

// Template route with mock data for testing
app.get("/template", (req, res) => {
  try {
    // Mock data for testing the template
    const mockFile = {
      id: 1,
      filename: "水平ノズル_1_15",
      uploaded_at: new Date(),
      weight: 10.5,
    };

    const mockData = [
      {
        id: 1,
        index: 1,
        data_type: "CIRCLE",
        x: 10.123,
        y: 20.456,
        z: 30.789,
        rot_x: 0,
        rot_y: 0,
        rot_z: 0,
        diameter: 15.5,
        tolerance: 0.1,
        note: "Test note 1",
      },
      {
        id: 2,
        index: 2,
        data_type: "PLANE",
        x: 15.123,
        y: 25.456,
        z: 35.789,
        rot_x: 0,
        rot_y: 0,
        rot_z: 0,
        diameter: null,
        tolerance: 0.2,
        note: "Test note 2",
      },
      {
        id: 3,
        index: 3,
        data_type: "DISTANCE",
        x: 20.123,
        y: 30.456,
        z: 40.789,
        rot_x: 0,
        rot_y: 0,
        rot_z: 0,
        diameter: 25.7,
        tolerance: null,
        note: "Test note 3",
      },
      {
        id: 4,
        index: 4,
        data_type: "PT-COMP",
        x: 22.123,
        y: 32.456,
        z: 42.789,
        rot_x: 0,
        rot_y: 0,
        rot_z: 0,
        diameter: null,
        tolerance: null,
        note: "Test note 4",
      },
    ];

    // Render the template with mock data
    res.render("template", {
      file: mockFile,
      data: mockData,
    });
  } catch (err) {
    console.error("Error rendering template:", err);
    res.status(500).send("Error rendering template: " + err.message);
  }
});

// Template route with real data
app.get("/template/:id", async (req, res) => {
  let client;
  try {
    const fileId = req.params.id;
    console.log(`Fetching template for file ID: ${fileId}`);

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

    // Add weight to file object
    const fileWithWeight = {
      ...file,
      weight: weight,
    };

    // Render template with data
    res.render("template", {
      file: fileWithWeight,
      data: dataResult.rows,
    });
  } catch (err) {
    console.error("Error fetching template data:", err);
    res.status(500).send("Error generating report template: " + err.message);
  } finally {
    if (client) client.release();
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
