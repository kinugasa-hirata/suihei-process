// app.js - Appwrite Version (NO AUTHENTICATION)
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

    res.render("fileData", {
      file: file,
      data: dataResponse.documents,
      username: DEFAULT_USERNAME,
      message: null,
    });
  } catch (error) {
    console.error("Error fetching file data:", error);
    res.status(500).send("Error loading file data");
  }
});

// Update weight
app.post("/files/:id/update-weight", async (req, res) => {
  try {
    const fileId = req.params.id;
    const weight = parseFloat(req.body.weight);

    if (isNaN(weight)) {
      return res.redirect(`/files/${fileId}`);
    }

    await databases.updateDocument(
      DATABASE_ID,
      COLLECTION_FILES,
      fileId,
      { weight: weight }
    );

    res.redirect(`/files/${fileId}`);
  } catch (error) {
    console.error("Error updating weight:", error);
    res.status(500).send("Error updating weight");
  }
});

// Delete file
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

    res.redirect("/");
  } catch (error) {
    console.error("Error deleting file:", error);
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

// Summary page - Multiple files report
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
      } catch (error) {
        console.error(`Error fetching file ${fileId}:`, error);
        // Continue with other files even if one fails
      }
    }

    res.render("summary", {
      filesData: filesData,
      username: DEFAULT_USERNAME,
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
});

module.exports = app;