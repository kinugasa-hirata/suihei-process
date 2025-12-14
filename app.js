// app.js - WITH DATABASE-BASED SESSIONS FOR VERCEL
const express = require("express");
const multer = require("multer");
const path = require("path");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
require("dotenv").config();

const { Client, Databases, Query, ID } = require("node-appwrite");

const app = express();
const PORT = process.env.PORT || 3000;

// ======================
// USER CONFIGURATION
// ======================

const AUTHORIZED_USERS = ['naemura', 'iwatsuki'];

function isValidPassword(password) {
  return /^\d{4}$/.test(password);
}

function canEditWeights(username) {
  return AUTHORIZED_USERS.includes(username);
}

function getDisplayName(username) {
  const nameMap = {
    'naemura': '苗村',
    'iwatsuki': '岩月'
  };
  return nameMap[username.toLowerCase()] || username;
}

// ======================
// MEASUREMENT CONFIGURATION
// ======================

const validationRanges = {
  'A': { min: 8.0, max: 8.4 },
  'B': { min: 37.2, max: 37.8 },
  'C': { min: 15.7, max: 16.1 },
  'D': { min: 23.9, max: 24.3 },
  'E': { min: 11.2, max: 11.4 },
  'F': { min: 3.1, max: 3.3 },
  'G1': { min: 7.8, max: 8.2 },
  'G2': { min: 7.8, max: 8.2 },
  'G3': { min: 7.8, max: 8.2 },
  'G4': { min: 7.8, max: 8.2 },
  'H': { min: 4.9, max: 5.1 },
  'I': { min: 29.8, max: 30.2 },
  'J': { min: 154.9, max: 155.9 },
  'K': { min: 82.8, max: 83.4 },
  'L': { min: 121.8, max: 122.8 },
  'M': null,
  'N': null
};

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
  'K': { index: 2, type: 'PT-COMP', field: 'x', absolute: true },
  'L': { index: 14, type: 'CIRCLE', field: 'diameter', absolute: false },
  'M': { type: 'MANUAL', field: 'PassFail' },
  'N': { type: 'VISUAL', field: 'PassFail' }
};

// ======================
// APPWRITE CONFIGURATION
// ======================

const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT || "https://cloud.appwrite.io/v1")
  .setProject(process.env.APPWRITE_PROJECT_ID)
  .setKey(process.env.APPWRITE_API_KEY);

const databases = new Databases(client);

const DATABASE_ID = process.env.APPWRITE_DATABASE_ID;
const COLLECTION_FILES = process.env.APPWRITE_COLLECTION_FILES_ID;
const COLLECTION_FILE_DATA = process.env.APPWRITE_COLLECTION_FILE_DATA_ID;
const COLLECTION_LOGIN_LOGS = process.env.APPWRITE_COLLECTION_LOGIN_LOGS_ID;
const COLLECTION_SESSIONS = process.env.APPWRITE_COLLECTION_SESSIONS_ID;

// ======================
// MIDDLEWARE
// ======================

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static("public"));
app.use(cookieParser(process.env.SESSION_SECRET || 'your-secret-key-change-in-production'));

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
// SESSION HELPERS
// ======================

function generateSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

async function getSession(sessionId) {
  if (!sessionId) return null;
  
  try {
    const sessions = await databases.listDocuments(
      DATABASE_ID,
      COLLECTION_SESSIONS,
      [Query.equal('session_id', sessionId), Query.limit(1)]
    );
    
    if (sessions.documents.length === 0) return null;
    
    const session = sessions.documents[0];
    
    if (new Date(session.expires_at) < new Date()) {
      await databases.deleteDocument(DATABASE_ID, COLLECTION_SESSIONS, session.$id);
      return null;
    }
    
    return session;
  } catch (error) {
    console.error('Error getting session:', error);
    return null;
  }
}

async function createSession(username) {
  const sessionId = generateSessionId();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  
  await databases.createDocument(
    DATABASE_ID,
    COLLECTION_SESSIONS,
    ID.unique(),
    {
      session_id: sessionId,
      username: username,
      can_edit_weights: canEditWeights(username),
      created_at: new Date().toISOString(),
      expires_at: expiresAt.toISOString()
    }
  );
  
  return sessionId;
}

async function deleteSession(sessionId) {
  if (!sessionId) return;
  
  try {
    const sessions = await databases.listDocuments(
      DATABASE_ID,
      COLLECTION_SESSIONS,
      [Query.equal('session_id', sessionId), Query.limit(1)]
    );
    
    if (sessions.documents.length > 0) {
      await databases.deleteDocument(
        DATABASE_ID,
        COLLECTION_SESSIONS,
        sessions.documents[0].$id
      );
    }
  } catch (error) {
    console.error('Error deleting session:', error);
  }
}

// ======================
// AUTHENTICATION MIDDLEWARE
// ======================

async function requireAuth(req, res, next) {
  const sessionId = req.cookies.session_id;
  const session = await getSession(sessionId);
  
  if (!session) {
    return res.redirect('/login');
  }
  
  req.session = {
    username: session.username,
    canEditWeights: session.can_edit_weights
  };
  
  next();
}

async function requireWeightEditAuth(req, res, next) {
  const sessionId = req.cookies.session_id;
  const session = await getSession(sessionId);
  
  if (!session || !session.can_edit_weights) {
    return res.status(403).json({ 
      success: false, 
      error: 'Not authorized to edit weights. Only naemura and iwatsuki can edit weights.' 
    });
  }
  
  req.session = {
    username: session.username,
    canEditWeights: session.can_edit_weights
  };
  
  next();
}

// ======================
// MEASUREMENT PROCESSING FUNCTIONS
// ======================

function getValue(dataPoints, index, type, field) {
  const point = dataPoints.find(p => p.index === index && p.data_type === type);
  if (!point) return null;
  
  const value = point[field];
  if (value === null || value === undefined || value === '-') return null;
  
  return parseFloat(value);
}

function extractValue(dataPoints, mapping) {
  if (mapping.type === 'AVERAGE') {
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
    return null;
  }
  
  let value = getValue(dataPoints, mapping.index, mapping.type, mapping.field);
  if (value === null) return null;
  
  if (mapping.absolute) {
    value = Math.abs(value);
  }
  
  return value;
}

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
      isValid = true;
    }
    
    result[key] = {
      value: value !== null ? value.toFixed(3) : '-',
      isValid: isValid
    };
  });
  
  return result;
}

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
  
  return measurements['G1'];
}

function getHighlightMapping() {
  const highlights = [];
  
  Object.entries(measurementMapping).forEach(([key, mapping]) => {
    if (mapping.type === 'AVERAGE') {
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

function parseTxtFile(content) {
  const lines = content.split("\n").filter((line) => line.trim() !== "");
  const dataPoints = [];

  lines.forEach((line) => {
    const parts = line.split(";");
    if (parts.length < 3) return;

    const index = parseInt(parts[0]);
    const dataType = parts[1].trim();

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
// ROUTES - LOGIN/LOGOUT
// ======================

app.get("/login", (req, res) => {
  res.render("login", { error: null });
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.render("login", { error: "Username and password are required" });
  }

  if (!isValidPassword(password)) {
    return res.render("login", { error: "Password must be 4 digits" });
  }

  try {
    const sessionId = await createSession(username);
    
    res.cookie('session_id', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: 'lax'
    });

    try {
      await databases.createDocument(
        DATABASE_ID,
        COLLECTION_LOGIN_LOGS,
        ID.unique(),
        {
          username: username,
          login_time: new Date().toISOString()
        }
      );
    } catch (error) {
      console.error("Error logging login:", error);
    }

    res.redirect("/");
  } catch (error) {
    console.error("Login error:", error);
    res.render("login", { error: "Login failed. Please try again." });
  }
});

app.get("/logout", async (req, res) => {
  const sessionId = req.cookies.session_id;
  await deleteSession(sessionId);
  res.clearCookie('session_id');
  res.redirect('/login');
});

// ======================
// ROUTES - MAIN APP
// ======================

app.get("/", requireAuth, async (req, res) => {
  try {
    const response = await databases.listDocuments(
      DATABASE_ID,
      COLLECTION_FILES,
      [Query.orderDesc("uploaded_at"), Query.limit(100)]
    );

    res.render("index", {
      files: response.documents,
      username: req.session.username,
      displayName: getDisplayName(req.session.username),
      canEditWeights: req.session.canEditWeights
    });
  } catch (error) {
    console.error("Error fetching files:", error);
    res.render("index", {
      files: [],
      username: req.session.username,
      displayName: getDisplayName(req.session.username),
      canEditWeights: req.session.canEditWeights
    });
  }
});

app.post("/upload", requireAuth, upload.array("files"), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).send("No files uploaded");
    }

    for (const file of req.files) {
      const filename = file.originalname;
      const content = file.buffer.toString("utf8");
      const dataPoints = parseTxtFile(content);

      if (dataPoints.length === 0) {
        continue;
      }

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
    }

    res.redirect("/");
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).send("Error uploading file: " + error.message);
  }
});

app.get("/files/:id", requireAuth, async (req, res) => {
  try {
    const fileId = req.params.id;

    const file = await databases.getDocument(
      DATABASE_ID,
      COLLECTION_FILES,
      fileId
    );

    const dataResponse = await databases.listDocuments(
      DATABASE_ID,
      COLLECTION_FILE_DATA,
      [Query.equal("file_id", fileId), Query.orderAsc("index"), Query.limit(1000)]
    );

    const highlights = getHighlightMapping();

    res.render("fileData", {
      file: file,
      data: dataResponse.documents,
      highlights: highlights,
      username: req.session.username,
      displayName: getDisplayName(req.session.username),
      canEditWeights: req.session.canEditWeights,
      message: null,
    });
  } catch (error) {
    console.error("Error fetching file data:", error);
    res.status(500).send("Error loading file data");
  }
});

app.post("/files/:id/update-weight", requireWeightEditAuth, async (req, res) => {
  try {
    const fileId = req.params.id;
    const weight = parseFloat(req.body.weight);

    if (isNaN(weight) || !weight) {
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
    
    res.redirect(`/files/${fileId}`);
  } catch (error) {
    console.error("Error updating weight:", error);
    res.status(500).send("Error updating weight");
  }
});

app.post("/update-weights", requireWeightEditAuth, async (req, res) => {
  try {
    const { weights } = req.body;

    if (!weights || !Array.isArray(weights)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid weights data' 
      });
    }

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

app.post("/delete-file", requireAuth, async (req, res) => {
  try {
    const { fileId } = req.body;

    if (!fileId) {
      return res.status(400).json({ 
        success: false, 
        error: 'File ID is required' 
      });
    }

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

app.get("/export-weights", requireAuth, async (req, res) => {
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

app.get("/summary", requireAuth, async (req, res) => {
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
    const fileData = {};

    for (const fileId of fileIds) {
      try {
        const file = await databases.getDocument(
          DATABASE_ID,
          COLLECTION_FILES,
          fileId
        );

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

        const measurements = processFileDataForMeasurements(dataResponse.documents);
        const gValue = processGValues(measurements);
        
        fileData[file.$id] = {
          ...measurements,
          'G': gValue
        };
        
      } catch (error) {
        console.error(`Error fetching file ${fileId}:`, error);
      }
    }

    const files = filesData.map(fd => fd.file);

    res.render("summary", {
      filesData: filesData,
      files: files,
      fileData: fileData,
      validationRanges: validationRanges,
      username: req.session.username,
      displayName: getDisplayName(req.session.username),
      inspectorName: getDisplayName(req.session.username),
    });
  } catch (error) {
    console.error("Error generating summary:", error);
    res.status(500).send("Error generating summary");
  }
});

app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    database: "Appwrite",
    timestamp: new Date().toISOString(),
  });
});

app.use((req, res) => {
  res.status(404).send("Page not found");
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send("Something went wrong!");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Database: Appwrite`);
  console.log(`Authentication: ENABLED (Database Sessions)`);
  console.log(`Authorized weight editors: ${AUTHORIZED_USERS.join(', ')}`);
});

module.exports = app;