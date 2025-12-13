// app.js - FINAL VERSION with all fixes
// 水平ノズル検査成績書システム with Appwrite Backend

const express = require("express");
const multer = require("multer");
const path = require("path");
const bodyParser = require("body-parser");
const fs = require("fs");
require("dotenv").config();

// Appwrite SDK
const { Client, Databases, Query, ID } = require("node-appwrite");

const app = express();
const PORT = process.env.PORT || 3000;

// ======================
// MEASUREMENT CONFIGURATION
// ======================

// Validation ranges for measurements A-N
const validationRanges = {
  'A': { min: 8.0, max: 8.4 },        // 8.2 ±0.2
  'B': { min: 37.2, max: 37.8 },      // 37.5 ±0.3
  'C': { min: 15.7, max: 16.1 },      // 15.9 ±0.2
  'D': { min: 23.9, max: 24.3 },      // 24.1 ±0.2
  'E': { min: 11.2, max: 11.4 },      // Φ11.2 +0.2/0
  'F': { min: 3.1, max: 3.3 },        // Φ3.2 ±0.1
  'G1': { min: 7.8, max: 8.2 },       // Φ8.0 ±0.2
  'G2': { min: 7.8, max: 8.2 },
  'G3': { min: 7.8, max: 8.2 },
  'G4': { min: 7.8, max: 8.2 },
  'H': { min: 4.9, max: 5.1 },        // 深さ5.0 ±0.1
  'I': { min: 29.8, max: 30.2 },      // P.C.D 30 ±0.2
  'J': { min: 154.9, max: 155.9 },    // Φ155.4 ±0.5
  'K': { min: 82.8, max: 83.4 },      // 83.1 ±0.3
  'L': { min: 121.8, max: 122.8 },    // Φ122.3 ±0.5
  'M': null,                           // 嵌め合い - Pass/Fail
  'N': null                            // 目視点検 - Pass/Fail
};

// Measurement mapping - defines which data point goes to which column
const measurementMapping = {
  'A': { index: 1, type: 'PT-COMP', field: 'x', absolute: true },
  'B': { index: 9, type: 'CIRCLE', field: 'diameter', absolute: false },
  'C': { index: 1, type: 'DISTANCE', field: 'y', absolute: true },
  'D': { index: 4, type: 'PT-COMP', field: 'x', absolute: true },
  'E': { index: 8, type: 'CIRCLE', field: 'diameter', absolute: false },
  'F': { 
    type: 'AVERAGE', 
    indices: [
      { index: 2, type: 'CIRCLE', field: 'diameter' },
      { index: 4, type: 'CIRCLE', field: 'diameter' },
      { index: 5, type: 'CIRCLE', field: 'diameter' },
      { index: 6, type: 'CIRCLE', field: 'diameter' }
    ],
    absolute: false
  },
  'G1': { index: 10, type: 'CIRCLE', field: 'diameter', absolute: false },
  'G2': { index: 11, type: 'CIRCLE', field: 'diameter', absolute: false },
  'G3': { index: 12, type: 'CIRCLE', field: 'diameter', absolute: false },
  'G4': { index: 13, type: 'CIRCLE', field: 'diameter', absolute: false },
  'H': { index: 2, type: 'DISTANCE', field: 'y', absolute: true },
  'I': { index: 15, type: 'CIRCLE', field: 'diameter', absolute: false },
  'J': { index: 7, type: 'CIRCLE', field: 'diameter', absolute: false },
  'K': { index: 2, type: 'PT-COMP', field: 'y', absolute: true },
  'L': { index: 14, type: 'CIRCLE', field: 'diameter', absolute: false },
  'M': { type: 'MANUAL', field: 'PassFail' },  // Manual input
  'N': { type: 'VISUAL', field: 'PassFail' }   // Visual inspection
};

// ======================
// APPWRITE CONFIGURATION
// ======================

const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT || "https://cloud.appwrite.io/v1")
  .setProject(process.env.APPWRITE_PROJECT_ID)
  .setKey(process.env.APPWRITE_API_KEY);

const databases = new Databases(client);

// Environment variables for collections
const DATABASE_ID = process.env.APPWRITE_DATABASE_ID;
const COLLECTION_FILES = process.env.APPWRITE_COLLECTION_FILES_ID;
const COLLECTION_FILE_DATA = process.env.APPWRITE_COLLECTION_FILE_DATA_ID;
const COLLECTION_LOGIN_LOGS = process.env.APPWRITE_COLLECTION_LOGIN_LOGS_ID;

// ======================
// MIDDLEWARE
// ======================

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static("public"));

// Default username for all requests (no auth)
const DEFAULT_USERNAME = "test-user";

// Multer configuration for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() === ".txt") {
      cb(null, true);
    } else {
      cb(new Error("Only .txt files are allowed"));
    }
  },
});

// ======================
// MEASUREMENT PROCESSING FUNCTIONS
// ======================

/**
 * Get value from data array based on index, type, and field
 */
function getValue(dataPoints, index, type, field) {
  const point = dataPoints.find(p => p.index === index && p.data_type === type);
  if (!point) return null;
  
  const value = point[field];
  if (value === null || value === undefined || value === '-') return null;
  
  return parseFloat(value);
}

/**
 * Extract a single measurement value
 */
function extractValue(dataPoints, mapping) {
  if (mapping.type === 'AVERAGE') {
    // Calculate average
    const values = [];
    for (const config of mapping.indices) {
      const value = getValue(dataPoints, config.index, config.type, config.field);
      if (value !== null) {
        values.push(value);
      }
    }
    if (values.length === 0) return null;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }
  
  if (mapping.type === 'MANUAL' || mapping.type === 'VISUAL') {
    return null; // These are filled manually
  }
  
  let value = getValue(dataPoints, mapping.index, mapping.type, mapping.field);
  if (value === null) return null;
  
  // Apply absolute value if specified
  if (mapping.absolute) {
    value = Math.abs(value);
  }
  
  return value;
}

/**
 * Process file data to extract measurements A-N
 * Returns object with structure: { A: {value, isValid}, B: {value, isValid}, ... }
 */
function processFileDataForMeasurements(dataPoints) {
  const result = {};
  
  Object.keys(measurementMapping).forEach(key => {
    const mapping = measurementMapping[key];
    const value = extractValue(dataPoints, mapping);
    const range = validationRanges[key];
    
    let isValid = true;
    if (range && value !== null) {
      isValid = value >= range.min && value <= range.max;
    } else if (value === null) {
      isValid = true; // Null values are considered "valid" (just not filled)
    }
    
    result[key] = {
      value: value !== null ? value.toFixed(3) : '-',
      isValid: isValid
    };
  });
  
  return result;
}

/**
 * Check G1-G4 values and return display value
 * If all valid, return G1 value
 * If any invalid, return which ones are invalid (e.g., "G2,G4")
 */
function processGValues(measurements) {
  const gKeys = ['G1', 'G2', 'G3', 'G4'];
  const invalid = [];
  
  for (const key of gKeys) {
    if (measurements[key] && !measurements[key].isValid && measurements[key].value !== '-') {
      invalid.push(key);
    }
  }
  
  if (invalid.length > 0) {
    return {
      value: invalid.join(','),
      isValid: false
    };
  }
  
  // All valid, return G1 value
  return measurements['G1'];
}

/**
 * Get highlighting information for fileData view
 */
function getHighlightMapping() {
  const highlights = [];
  
  Object.entries(measurementMapping).forEach(([key, mapping]) => {
    if (mapping.type === 'AVERAGE') {
      // For average, highlight all constituent cells
      mapping.indices.forEach(config => {
        highlights.push({
          key: key,
          index: config.index,
          type: config.type,
          field: capitalizeField(config.field),
          isAverage: true
        });
      });
    } else if (mapping.type !== 'MANUAL' && mapping.type !== 'VISUAL') {
      highlights.push({
        key: key,
        index: mapping.index,
        type: mapping.type,
        field: capitalizeField(mapping.field),
        isAverage: false
      });
    }
  });
  
  return highlights;
}

/**
 * Helper to capitalize field names for display
 */
function capitalizeField(field) {
  const fieldMap = {
    'x': 'X',
    'y': 'Y',
    'z': 'Z',
    'rot_x': 'Rot X',
    'rot_y': 'Rot Y',
    'rot_z': 'Rot Z',
    'diameter': 'Diameter',
    'tolerance': 'Tolerance',
    'note': 'Note'
  };
  return fieldMap[field] || field;
}

/**
 * Extract filename without extension
 */
function getFilenameWithoutExtension(filename) {
  return filename.replace(/\.txt$/i, '');
}

// ======================
// HELPER FUNCTIONS
// ======================

// Parse TXT file content
function parseTxtFile(content) {
  const lines = content.split("\n").filter((line) => line.trim() !== "");
  const dataPoints = [];

  lines.forEach((line) => {
    const parts = line.split(";");
    if (parts.length < 3) return;

    const index = parseInt(parts[0]);
    const dataType = parts[1].trim();
    const spaces = parts[2].trim();

    let dataPoint = {
      index: index,
      data_type: dataType,
      x: null,
      y: null,
      z: null,
      rot_x: null,
      rot_y: null,
      rot_z: null,
      note: "",
      diameter: null,
      tolerance: null,
    };

    // Parse based on data type
    if (dataType.includes("CIRCLE") || dataType === "PLANE") {
      dataPoint.x = parseFloat(parts[3]) || null;
      dataPoint.y = parseFloat(parts[4]) || null;
      dataPoint.z = parseFloat(parts[5]) || null;
      dataPoint.rot_x = parseFloat(parts[6]) || null;
      dataPoint.rot_y = parseFloat(parts[7]) || null;
      dataPoint.rot_z = parseFloat(parts[8]) || null;
      dataPoint.note = parts[9] || "";
      dataPoint.diameter = parseFloat(parts[10]) || null;
      dataPoint.tolerance = parseFloat(parts[11]) || null;
    } else if (dataType === "PT-COMP") {
      dataPoint.x = parseFloat(parts[3]) || null;
      dataPoint.y = parseFloat(parts[4]) || null;
      dataPoint.z = parseFloat(parts[5]) || null;
    } else if (dataType === "DISTANCE") {
      dataPoint.x = parseFloat(parts[2]) || null;
      dataPoint.y = parseFloat(parts[3]) || null;
      dataPoint.z = parseFloat(parts[4]) || null;
      dataPoint.diameter = parseFloat(parts[9]) || null;
    }

    dataPoints.push(dataPoint);
  });

  return dataPoints;
}

// ======================
// ROUTES
// ======================

// Redirect login to home (no auth needed)
app.get("/login", (req, res) => {
  res.redirect("/");
});

app.post("/login", (req, res) => {
  res.redirect("/");
});

// Logout redirect
app.get("/logout", (req, res) => {
  res.redirect("/");
});

// Home page - NO AUTH REQUIRED
app.get("/", async (req, res) => {
  try {
    // Get all files
    const response = await databases.listDocuments(
      DATABASE_ID,
      COLLECTION_FILES,
      [Query.orderDesc("uploaded_at"), Query.limit(100)]
    );

    res.render("index", {
      files: response.documents,
      username: DEFAULT_USERNAME,
    });
  } catch (error) {
    console.error("Error fetching files:", error);
    res.render("index", {
      files: [],
      username: DEFAULT_USERNAME,
    });
  }
});

// Upload handler
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send("No file uploaded");
    }

    const filename = req.file.originalname;
    const content = req.file.buffer.toString("utf8");

    // Parse the TXT file
    const dataPoints = parseTxtFile(content);

    if (dataPoints.length === 0) {
      return res.status(400).send("No valid data found in file");
    }

    // Create file record
    const fileDoc = await databases.createDocument(
      DATABASE_ID,
      COLLECTION_FILES,
      ID.unique(),
      {
        filename: filename,
        uploaded_at: new Date().toISOString(),
        weight: null,
      }
    );

    const fileId = fileDoc.$id;

    // Insert data points
    for (const point of dataPoints) {
      await databases.createDocument(
        DATABASE_ID,
        COLLECTION_FILE_DATA,
        ID.unique(),
        {
          file_id: fileId,
          index: point.index,
          data_type: point.data_type,
          x: point.x,
          y: point.y,
          z: point.z,
          rot_x: point.rot_x,
          rot_y: point.rot_y,
          rot_z: point.rot_z,
          note: point.note || "",
          diameter: point.diameter,
          tolerance: point.tolerance,
        }
      );
    }

    res.redirect("/");
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).send("Error uploading file: " + error.message);
  }
});

// View file data
app.get("/files/:id", async (req, res) => {
  try {
    const fileId = req.params.id;

    // Get file info
    const file = await databases.getDocument(
      DATABASE_ID,
      COLLECTION_FILES,
      fileId
    );

    // Get file data
    const dataResponse = await databases.listDocuments(
      DATABASE_ID,
      COLLECTION_FILE_DATA,
      [Query.equal("file_id", fileId), Query.orderAsc("index"), Query.limit(1000)]
    );

    // Get highlight information
    const highlights = getHighlightMapping();

    res.render("fileData", {
      file: file,
      data: dataResponse.documents,
      highlights: highlights,
      username: DEFAULT_USERNAME,
      message: null,
    });
  } catch (error) {
    console.error("Error fetching file data:", error);
    res.status(500).send("Error loading file data");
  }
});

// Update weight - FIXED VERSION
app.post("/files/:id/update-weight", async (req, res) => {
  try {
    const fileId = req.params.id;
    const weight = parseFloat(req.body.weight);

    console.log('Update weight request:', { fileId, weight, body: req.body });

    if (isNaN(weight) || !weight) {
      console.log('Invalid weight value');
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid weight value' 
      });
    }

    await databases.updateDocument(
      DATABASE_ID,
      COLLECTION_FILES,
      fileId,
      { weight: weight }
    );

    console.log('Weight updated successfully');
    
    // Return JSON response for AJAX call
    if (req.headers['content-type']?.includes('application/json')) {
      return res.json({ success: true, weight: weight });
    }
    
    // Redirect for form submission
    res.redirect(`/files/${fileId}`);
  } catch (error) {
    console.error("Error updating weight:", error);
    
    if (req.headers['content-type']?.includes('application/json')) {
      return res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
    
    res.status(500).send("Error updating weight");
  }
});

// Save weight from main page - NEW ROUTE
app.post("/save-weight", async (req, res) => {
  try {
    const { fileId, weight } = req.body;
    const weightValue = parseFloat(weight);

    console.log('Save weight from main:', { fileId, weight: weightValue });

    if (!fileId || isNaN(weightValue)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid file ID or weight value' 
      });
    }

    await databases.updateDocument(
      DATABASE_ID,
      COLLECTION_FILES,
      fileId,
      { weight: weightValue }
    );

    res.json({ success: true, weight: weightValue });
  } catch (error) {
    console.error("Error saving weight:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Update weights - batch update from main page
app.post("/update-weights", async (req, res) => {
  try {
    const { weights } = req.body;

    if (!weights || !Array.isArray(weights)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid weights data' 
      });
    }

    // Update each weight
    for (const item of weights) {
      const weightValue = parseFloat(item.weight);
      
      if (item.fileId && !isNaN(weightValue)) {
        await databases.updateDocument(
          DATABASE_ID,
          COLLECTION_FILES,
          item.fileId,
          { weight: weightValue }
        );
      }
    }

    res.json({ success: true, count: weights.length });
  } catch (error) {
    console.error("Error updating weights:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Delete file from main page - NEW ROUTE
app.post("/delete-file", async (req, res) => {
  try {
    const { fileId } = req.body;

    if (!fileId) {
      return res.status(400).json({ 
        success: false, 
        error: 'File ID is required' 
      });
    }

    // Delete all associated data points
    const dataResponse = await databases.listDocuments(
      DATABASE_ID,
      COLLECTION_FILE_DATA,
      [Query.equal("file_id", fileId), Query.limit(1000)]
    );

    for (const doc of dataResponse.documents) {
      await databases.deleteDocument(
        DATABASE_ID,
        COLLECTION_FILE_DATA,
        doc.$id
      );
    }

    // Delete file record
    await databases.deleteDocument(
      DATABASE_ID,
      COLLECTION_FILES,
      fileId
    );

    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting file:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Export weights data
app.get("/export-weights", async (req, res) => {
  try {
    const filesResponse = await databases.listDocuments(
      DATABASE_ID,
      COLLECTION_FILES,
      [Query.orderAsc("filename"), Query.limit(1000)]
    );

    const weightsData = filesResponse.documents.map(file => ({
      filename: file.filename.replace(/\.txt$/i, ''),
      weight: file.weight || null,
      uploaded_at: file.uploaded_at
    }));

    res.json(weightsData);
  } catch (error) {
    console.error("Error exporting weights:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Delete file - UPDATED to handle both POST and DELETE
app.post("/files/:id/delete", async (req, res) => {
  try {
    const fileId = req.params.id;

    // Delete all associated data points
    const dataResponse = await databases.listDocuments(
      DATABASE_ID,
      COLLECTION_FILE_DATA,
      [Query.equal("file_id", fileId), Query.limit(1000)]
    );

    for (const doc of dataResponse.documents) {
      await databases.deleteDocument(
        DATABASE_ID,
        COLLECTION_FILE_DATA,
        doc.$id
      );
    }

    // Delete file record
    await databases.deleteDocument(
      DATABASE_ID,
      COLLECTION_FILES,
      fileId
    );

    // Return JSON for AJAX or redirect
    if (req.headers['content-type']?.includes('application/json')) {
      return res.json({ success: true });
    }
    
    res.redirect("/");
  } catch (error) {
    console.error("Error deleting file:", error);
    
    if (req.headers['content-type']?.includes('application/json')) {
      return res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
    
    res.status(500).send("Error deleting file");
  }
});

// Data export (JSON)
app.get("/export-data", async (req, res) => {
  try {
    // Get all files
    const filesResponse = await databases.listDocuments(
      DATABASE_ID,
      COLLECTION_FILES,
      [Query.orderDesc("uploaded_at"), Query.limit(100)]
    );

    const exportData = [];

    // Get data for each file
    for (const file of filesResponse.documents) {
      const dataResponse = await databases.listDocuments(
        DATABASE_ID,
        COLLECTION_FILE_DATA,
        [Query.equal("file_id", file.$id), Query.limit(1000)]
      );

      exportData.push({
        file: file,
        data: dataResponse.documents,
      });
    }

    res.json(exportData);
  } catch (error) {
    console.error("Export error:", error);
    res.status(500).json({ error: "Export failed" });
  }
});

// Health check / Status
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    database: "Appwrite",
    timestamp: new Date().toISOString(),
  });
});

// PDF export route (simplified - browser print)
app.get("/export-pdf", (req, res) => {
  res.json({
    message: "Please use your browser's Print function (Ctrl+P) to save as PDF",
  });
});

// Summary page - Multiple files report - UPDATED
app.get("/summary", async (req, res) => {
  try {
    const selectedFilesParam = req.query.selectedFiles || "";
    const fileIds = selectedFilesParam
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0);

    if (fileIds.length === 0) {
      return res.redirect("/");
    }

    const filesData = [];
    const fileData = {}; // Processed data for template

    // Fetch each file and its data
    for (const fileId of fileIds) {
      try {
        // Get file info
        const file = await databases.getDocument(
          DATABASE_ID,
          COLLECTION_FILES,
          fileId
        );

        // Get file data
        const dataResponse = await databases.listDocuments(
          DATABASE_ID,
          COLLECTION_FILE_DATA,
          [
            Query.equal("file_id", fileId),
            Query.orderAsc("index"),
            Query.limit(1000),
          ]
        );

        filesData.push({
          file: file,
          data: dataResponse.documents,
        });

        // Process data using measurement processor
        const measurements = processFileDataForMeasurements(dataResponse.documents);
        
        // Process G values (combine G1-G4 validation)
        const gValue = processGValues(measurements);
        
        // Create final fileData structure for template
        fileData[file.$id] = {
          ...measurements,
          'G': gValue  // Replace individual G1-G4 with combined G
        };
        
      } catch (error) {
        console.error(`Error fetching file ${fileId}:`, error);
        // Continue with other files even if one fails
      }
    }

    // Extract files array for template compatibility
    const files = filesData.map(fd => fd.file);

    res.render("summary", {
      filesData: filesData,
      files: files,
      fileData: fileData,
      validationRanges: validationRanges,
      username: DEFAULT_USERNAME,
      inspectorName: DEFAULT_USERNAME,
    });
  } catch (error) {
    console.error("Error generating summary:", error);
    res.status(500).send("Error generating summary");
  }
});

// ======================
// ERROR HANDLERS
// ======================

app.use((req, res) => {
  res.status(404).send("Page not found");
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send("Something went wrong!");
});

// ======================
// START SERVER
// ======================

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Database: Appwrite`);
  console.log(`Authentication: DISABLED`);
  console.log(`Measurement processor: ENABLED`);
});

module.exports = app;