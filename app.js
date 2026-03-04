// app.js - EFFICIENT SCHEMA VERSION WITH STOCK MANAGEMENT
// Updated: Added stock management system for orders and imports
// Modified: Excel import/export, Status tracking, Order management

const express = require("express");
const multer = require("multer");
const path = require("path");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const XLSX = require("xlsx");
require("dotenv").config();

const { Client, Databases, Query, ID } = require("node-appwrite");

const app = express();
const PORT = process.env.PORT || 3000;

// ======================
// USER CONFIGURATION
// ======================

// Users who can edit weights (naemura, iwatsuki)
const AUTHORIZED_USERS = ['naemura', 'iwatsuki'];

// Authentication: Any username with any 4-digit password can log in
// Only AUTHORIZED_USERS (above) can edit weights
// All other users can view and upload files but cannot edit weights

function isValidPassword(password) {
  return /^\d{4}$/.test(password);
}

function canEditWeights(username) {
  return AUTHORIZED_USERS.includes(username.toLowerCase());
}

function getDisplayName(username) {
  const nameMap = {
    'naemura': '苗村',
    'iwatsuki': '岩月'
  };
  return nameMap[username.toLowerCase()] || username;
}

// ======================
// STATUS CONFIGURATION
// ======================

const STATUS_CONFIG = {
  'upcoming_import': {
    label: '入荷予定',
    color: 'transparent',
    opacity: 0,
    order: 1
  },
  'imported': {
    label: '入荷済',
    color: '#e9ecef',
    opacity: 0.5,
    order: 2
  },
  'inspection': {
    label: '検査中',
    color: '#dee2e6',
    opacity: 0.67,
    order: 3
  },
  'finished_inspection': {
    label: '検査完了',
    color: '#ced4da',
    opacity: 1,
    order: 4
  },
  'shipped': {
    label: '出荷済',
    color: '#6c757d',
    opacity: 1,
    order: 5,
    hidden: true // Don't show in main view
  }
};

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

// Existing collections
const DATABASE_ID = process.env.APPWRITE_DATABASE_ID;
const COLLECTION_INSPECTIONS = process.env.APPWRITE_COLLECTION_INSPECTIONS_ID;
const COLLECTION_LOGIN_LOGS = process.env.APPWRITE_COLLECTION_LOGIN_LOGS_ID;
const COLLECTION_SESSIONS = process.env.APPWRITE_COLLECTION_SESSIONS_ID;

// New collections for stock management
const COLLECTION_ORDERS = process.env.APPWRITE_COLLECTION_ORDERS_ID;
const COLLECTION_IMPORTS = process.env.APPWRITE_COLLECTION_IMPORTS_ID;

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
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === ".txt" || ext === ".xlsx" || ext === ".xls") {
      cb(null, true);
    } else {
      cb(new Error("Only .txt, .xlsx, and .xls files are allowed"));
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
  
  console.log(`[SESSION] Creating session for user: ${username}`);
  console.log(`[SESSION] Session ID: ${sessionId.substring(0, 10)}...`);
  console.log(`[SESSION] Can edit weights: ${canEditWeights(username)}`);
  
  try {
    const doc = await databases.createDocument(
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
    console.log(`[SESSION] Document created: ${doc.$id}`);
    return sessionId;
  } catch (error) {
    console.error(`[SESSION] Error creating session document:`, {
      message: error.message,
      code: error.code,
      type: error.type
    });
    throw error;
  }
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
// LOGIN & LOGOUT
// ======================

app.get("/login", (req, res) => {
  res.render("login", { error: null });
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.render("login", { 
      error: "Username and password are required" 
    });
  }
  
  if (!isValidPassword(password)) {
    return res.render("login", { 
      error: "Password must be exactly 4 digits" 
    });
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
          logged_in_at: new Date().toISOString(),
          can_edit_weights: canEditWeights(username)
        }
      );
    } catch (logError) {
      console.error('Error logging login:', logError);
    }
    
    res.redirect("/");
  } catch (error) {
    console.error('Login error:', error);
    res.render("login", { 
      error: "Login failed. Please try again." 
    });
  }
});

app.get("/logout", async (req, res) => {
  const sessionId = req.cookies.session_id;
  await deleteSession(sessionId);
  res.clearCookie('session_id');
  res.redirect('/login');
});

app.post("/logout", async (req, res) => {
  const sessionId = req.cookies.session_id;
  await deleteSession(sessionId);
  res.clearCookie('session_id');
  res.redirect('/login');
});

// ======================
// INVENTORY & ALLOCATION FUNCTIONS
// ======================

/**
 * Categorize inspections by status
 */
function categorizeInventory(inspections) {
  const inventory = {
    finished_inspection: [],
    inspection: [],
    imported: [],
    upcoming_import: []
  };

  inspections.forEach(item => {
    const status = item.status || 'finished_inspection';
    if (inventory[status] !== undefined) {
      inventory[status].push(item);
    } else {
      inventory['finished_inspection'].push(item);
    }
  });

  // Sort each category by file number (ascending)
  Object.keys(inventory).forEach(key => {
    inventory[key].sort((a, b) => {
      const numA = parseInt(a.filename.replace('.txt', '')) || 0;
      const numB = parseInt(b.filename.replace('.txt', '')) || 0;
      return numA - numB;
    });
  });

  return inventory;
}

/**
 * Get total available products
 */
function getTotalAvailableInventory(inventory) {
  let total = 0;
  Object.keys(inventory).forEach(status => {
    total += inventory[status].length;
  });
  return total;
}

/**
 * Get inventory by priority order (ready first)
 */
function getInventoryByPriority(inventory) {
  const priority = [];
  priority.push(...inventory.finished_inspection.map(item => ({...item, priority: 1})));
  priority.push(...inventory.inspection.map(item => ({...item, priority: 2})));
  priority.push(...inventory.imported.map(item => ({...item, priority: 3})));
  priority.push(...inventory.upcoming_import.map(item => ({...item, priority: 4})));
  return priority;
}

/**
 * Allocate products to a single order
 */
function allocateProductsToOrder(order, allOrders, currentInventory) {
  const quantity = parseInt(order.quantity);
  const inventoryByPriority = getInventoryByPriority(currentInventory);
  
  // Mark products allocated to earlier orders
  const allocatedByEarlierOrders = new Set();
  const earlierOrders = allOrders
    .filter(o => o.$id !== order.$id && new Date(o.due_date) < new Date(order.due_date))
    .sort((a, b) => new Date(a.due_date) - new Date(b.due_date));

  for (const earlierOrder of earlierOrders) {
    const earlierQty = parseInt(earlierOrder.quantity);
    let count = 0;
    for (const product of inventoryByPriority) {
      if (!allocatedByEarlierOrders.has(product.$id) && count < earlierQty) {
        allocatedByEarlierOrders.add(product.$id);
        count++;
      }
    }
  }

  // Allocate to this order
  const allocatedItems = [];
  for (const product of inventoryByPriority) {
    if (!allocatedByEarlierOrders.has(product.$id) && allocatedItems.length < quantity) {
      allocatedItems.push(product);
    }
  }

  // Determine status
  const readyCount = allocatedItems.filter(item => item.status === 'finished_inspection').length;
  const inProgressCount = allocatedItems.filter(item => 
    item.status === 'inspection' || item.status === 'imported'
  ).length;

  let allocationStatus = 'ready';
  let statusLabel = '出荷可能';
  let statusColor = '#198754';

  if (inProgressCount > 0) {
    allocationStatus = 'processing';
    statusLabel = '検査中含む';
    statusColor = '#6c757d';
  }

  return {
    allocatedItems,
    status: allocationStatus,
    statusLabel,
    statusColor,
    breakdown: { ready: readyCount, inProgress: inProgressCount }
  };
}

/**
 * Allocate to all orders
 */
function allocateToAllOrders(orders, currentInventory) {
  const allocations = {};
  const sortedOrders = [...orders].sort((a, b) => 
    new Date(a.due_date) - new Date(b.due_date)
  );

  for (const order of sortedOrders) {
    allocations[order.$id] = allocateProductsToOrder(order, orders, currentInventory);
  }
  return allocations;
}

/**
 * Get inventory status overview
 */
function getInventoryStatus(inventory) {
  const byStatus = {
    finished_inspection: inventory.finished_inspection.length,
    inspection: inventory.inspection.length,
    imported: inventory.imported.length,
    upcoming_import: inventory.upcoming_import.length
  };

  const total = getTotalAvailableInventory(inventory);
  return {
    total,
    byStatus,
    percentageReady: total > 0 ? (byStatus.finished_inspection / total * 100).toFixed(1) : 0
  };
}

// ======================
// TXT FILE PARSING
// ======================

function parseTxtFile(fileContent) {
  const lines = fileContent.split("\n").map(line => line.trim()).filter(l => l.length > 0);
  // Key structure: measurements[index][type] = {...}
  // This handles duplicate indices with different types (e.g. idx=1 CIRCLE, idx=1 PT-COMP)
  const data = { measurements: {} };

  const safeFloat = s => { const v = parseFloat(s); return isNaN(v) ? null : v; };

  lines.forEach((line) => {
    if (line.startsWith("Lot No.")) {
      const lotMatch = line.match(/Lot No\.\s*:\s*(.+)/);
      if (lotMatch) data.lot = lotMatch[1].trim();
      return;
    }

    const parts = line.split(";").map(p => p.trim());
    if (parts.length < 2) return;

    const index = parseInt(parts[0]);
    const type = parts[1];
    if (isNaN(index)) return;

    if (!data.measurements[index]) data.measurements[index] = {};

    if (type === "CIRCLE" && parts.length >= 12) {
      // Format: index;CIRCLE;count;x;y;z;rx;ry;rz;;diameter;roundness
      data.measurements[index]["CIRCLE"] = {
        type: "CIRCLE",
        x: safeFloat(parts[3]),
        y: safeFloat(parts[4]),
        z: safeFloat(parts[5]),
        diameter: safeFloat(parts[10]),
        roundness: safeFloat(parts[11])
      };
    } else if (type === "PT-COMP" && parts.length >= 6) {
      // Format: index;PT-COMP;count;x;y;z
      data.measurements[index]["PT-COMP"] = {
        type: "PT-COMP",
        x: Math.abs(safeFloat(parts[3])),
        y: safeFloat(parts[4]),
        z: safeFloat(parts[5])
      };
    } else if (type === "DISTANCE") {
      // Format: index;DISTANCE;;x;y;z;;;;;distance_value
      // parts[3] = x coordinate = the actual depth/distance measurement (use abs value)
      data.measurements[index]["DISTANCE"] = {
        type: "DISTANCE",
        y: safeFloat(parts[3]) !== null ? Math.abs(safeFloat(parts[3])) : null
      };
    }
  });

  return data;
}

function extractMeasurementValue(parsedData, measureKey) {
  const config = measurementMapping[measureKey];
  if (!config) return null;

  if (config.type === 'AVERAGE') {
    const values = config.indices
      .map(indexConfig => {
        // New structure: measurements[index][type]
        const byIndex = parsedData.measurements[indexConfig.index];
        const measurement = byIndex && byIndex[indexConfig.type];
        if (!measurement) return null;
        return measurement[indexConfig.field];
      })
      .filter(v => v !== null);

    if (values.length === 0) return null;
    const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
    return config.absolute ? Math.abs(avg) : avg;
  }

  // New structure: measurements[index][type]
  const byIndex = parsedData.measurements[config.index];
  const measurement = byIndex && byIndex[config.type];
  if (!measurement) return null;

  const value = measurement[config.field];
  if (value === null || value === undefined) return null;
  return config.absolute ? Math.abs(value) : value;
}

function isValidMeasurement(value, measureKey) {
  if (value === null || value === undefined) return null;
  
  const range = validationRanges[measureKey];
  if (!range) return null;
  
  return value >= range.min && value <= range.max;
}

function processGValues(measurements) {
  const gKeys = ['G1', 'G2', 'G3', 'G4'];

  // Parse numeric values safely - DB stores them as strings (e.g. "8.020")
  const validGValues = gKeys
    .map(key => {
      const m = measurements[key];
      if (!m || m.value === null || m.value === undefined || m.value === '-') return null;
      const numeric = parseFloat(m.value);
      if (isNaN(numeric)) return null;
      return { value: numeric, isValid: m.isValid };
    })
    .filter(m => m !== null);

  if (validGValues.length === 0) {
    return { value: null, isValid: null };
  }

  const gSum = validGValues.reduce((sum, m) => sum + m.value, 0);
  const gAverage = gSum / validGValues.length;
  const gRange = validationRanges['G1'];
  const gIsValid = gAverage >= gRange.min && gAverage <= gRange.max;

  return { value: gAverage, isValid: gIsValid };
}

// ======================
// MAIN INDEX ROUTE
// ======================

app.get("/", requireAuth, async (req, res) => {
  try {
    const showArchived = req.query.archived === 'true';
    const queries = [
      Query.equal('is_archived', showArchived),
      Query.orderDesc('uploaded_at'),
      Query.limit(1000)
    ];

    const result = await databases.listDocuments(
      DATABASE_ID,
      COLLECTION_INSPECTIONS,
      queries
    );

    const files = result.documents
      .filter(doc => doc.status !== 'shipped')           // exclude shipped
      .filter(doc => doc.measurementA && doc.measurementA !== '-')  // exclude placeholders (no real data yet)
      .map(doc => {
        const status = doc.status || 'finished_inspection';
        const statusCfg = STATUS_CONFIG[status] || STATUS_CONFIG['finished_inspection'];
        return {
          ...doc,
          fileNumber: doc.filename ? doc.filename.replace(/\.(txt|TXT)$/, '') : 'Unknown',
          statusColor: statusCfg.color,
          statusOpacity: statusCfg.opacity,
          statusLabel: statusCfg.label
        };
      });

    res.render("index", {
      files: files,
      username: req.session.username,
      displayName: getDisplayName(req.session.username),
      canEditWeights: req.session.canEditWeights,
      showArchived: showArchived,
      statusConfig: STATUS_CONFIG
    });
  } catch (error) {
    console.error("Error fetching files:", error);
    res.status(500).send("Error loading files");
  }
});

// ======================
// STOCK AVAILABILITY CALCULATION
// ======================

// Stock allocation now handled by inline functions above
// See: categorizeInventory, allocateProductsToOrder, allocateToAllOrders

// ======================
// STOCK MANAGEMENT VIEW
// ======================

app.get("/stock-management", requireAuth, async (req, res) => {
  try {
    // Fetch orders (exclude shipped)
    const ordersResult = await databases.listDocuments(
      DATABASE_ID,
      COLLECTION_ORDERS,
      [Query.notEqual('status', 'shipped'), Query.orderAsc('due_date'), Query.limit(100)]
    );

    // Fetch imports (exclude imported)
    const importsResult = await databases.listDocuments(
      DATABASE_ID,
      COLLECTION_IMPORTS,
      [Query.notEqual('status', 'imported'), Query.orderAsc('scheduled_date'), Query.limit(100)]
    );

    // Fetch all inspections (not shipped)
    const inspectionsResult = await databases.listDocuments(
      DATABASE_ID,
      COLLECTION_INSPECTIONS,
      [
        Query.equal('is_archived', false),
        Query.orderDesc('uploaded_at'),
        Query.limit(1000)
      ]
    );

    // Group inspections by status (filter shipped, treat NULL as finished_inspection)
    const inspectionsByStatus = {
      upcoming_import: [],
      imported: [],
      inspection: [],
      finished_inspection: []
    };

    // Helper: extract numeric file number for sorting DESC
    const fileNum = doc => {
      const m = doc.filename && doc.filename.match(/^(\d+)/);
      return m ? parseInt(m[1]) : 0;
    };

    // Also build a map of import_id -> list of filenames for the imports table
    const importFileMap = {};
    inspectionsResult.documents.forEach(doc => {
      const status = doc.status || 'finished_inspection';
      if (status === 'shipped') return;  // skip shipped
      if (inspectionsByStatus[status] !== undefined) {
        inspectionsByStatus[status].push(doc);
      } else {
        inspectionsByStatus['finished_inspection'].push(doc);
      }
      if (doc.import_id) {
        if (!importFileMap[doc.import_id]) importFileMap[doc.import_id] = [];
        importFileMap[doc.import_id].push(doc.filename);
      }
    });

    // Sort each section ASC by file number (lowest first: 492, 493, 494...)
    Object.keys(inspectionsByStatus).forEach(key => {
      inspectionsByStatus[key].sort((a, b) => fileNum(a) - fileNum(b));
    });

    // *** Use inline inventory and allocation system ***
    // Step 1: Categorize current inventory by status
    const activeInspections = inspectionsResult.documents.filter(doc => doc.status !== 'shipped');
    const currentInventory = categorizeInventory(activeInspections);
    
    // Step 2: Allocate products to orders by due date priority
    const allocations = allocateToAllOrders(
      ordersResult.documents,
      currentInventory
    );
    
    // Step 3: Enhance order objects with allocation info
    const ordersWithStock = ordersResult.documents.map(order => {
      const allocation = allocations[order.$id];
      return {
        ...order,
        stockAvailability: {
          status: allocation.status,
          label: allocation.statusLabel,
          color: allocation.statusColor,
          allocatedItems: allocation.allocatedItems,
          breakdown: allocation.breakdown
        }
      };
    });

    // Attach linked_files to each import
    const importsWithFiles = importsResult.documents.map(imp => ({
      ...imp,
      linked_files: importFileMap[imp.$id] || []
    }));

    res.render("stock-management", {
      orders: ordersWithStock,  // *** CHANGED: Use ordersWithStock instead of ordersResult.documents ***
      imports: importsWithFiles,
      inspectionsByStatus: inspectionsByStatus,
      statusConfig: STATUS_CONFIG,
      username: req.session.username,
      displayName: getDisplayName(req.session.username),
      canEditWeights: req.session.canEditWeights
    });
  } catch (error) {
    console.error("Error loading stock management:", error);
    res.status(500).send("Error loading stock management");
  }
});

// ======================
// ORDER MANAGEMENT API
// ======================

// Create new order
app.post("/api/orders", requireAuth, async (req, res) => {
  try {
    const { quantity, due_date } = req.body;

    if (!quantity || !due_date) {
      return res.status(400).json({
        success: false,
        error: 'Quantity and due date are required'
      });
    }

    const order = await databases.createDocument(
      DATABASE_ID,
      COLLECTION_ORDERS,
      ID.unique(),
      {
        quantity: parseInt(quantity),
        due_date: due_date,
        status: 'pending'
      }
    );

    res.json({ success: true, order: order });
  } catch (error) {
    console.error("Error creating order:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update order
app.put("/api/orders/:orderId", requireAuth, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { quantity, due_date, status } = req.body;

    const updateData = {};
    if (quantity !== undefined) updateData.quantity = parseInt(quantity);
    if (due_date !== undefined) updateData.due_date = due_date;
    if (status !== undefined) updateData.status = status;

    const order = await databases.updateDocument(
      DATABASE_ID,
      COLLECTION_ORDERS,
      orderId,
      updateData
    );

    res.json({ success: true, order: order });
  } catch (error) {
    console.error("Error updating order:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete order
app.delete("/api/orders/:orderId", requireAuth, async (req, res) => {
  try {
    const { orderId } = req.params;

    await databases.deleteDocument(
      DATABASE_ID,
      COLLECTION_ORDERS,
      orderId
    );

    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting order:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ======================
// IMPORT MANAGEMENT API
// ======================

// Helper: find the highest file number in inspections collection
async function getLastFileNumber() {
  try {
    const result = await databases.listDocuments(
      DATABASE_ID,
      COLLECTION_INSPECTIONS,
      [Query.orderDesc('uploaded_at'), Query.limit(500)]
    );
    let max = 0;
    result.documents.forEach(doc => {
      const match = doc.filename && doc.filename.match(/^(\d+)/);
      if (match) {
        const num = parseInt(match[1]);
        if (num > max) max = num;
      }
    });
    return max;
  } catch (e) {
    console.error('Error getting last file number:', e);
    return 0;
  }
}

// Helper: bulk update inspection status by import_id
async function updateInspectionStatusByImport(importId, newStatus) {
  try {
    const result = await databases.listDocuments(
      DATABASE_ID,
      COLLECTION_INSPECTIONS,
      [Query.equal('import_id', importId), Query.limit(500)]
    );
    for (const doc of result.documents) {
      await databases.updateDocument(
        DATABASE_ID,
        COLLECTION_INSPECTIONS,
        doc.$id,
        { status: newStatus }
      );
    }
    return result.documents.length;
  } catch (e) {
    console.error('Error bulk updating statuses:', e);
    return 0;
  }
}

// Create new import + auto-generate placeholder file records
app.post("/api/imports", requireAuth, async (req, res) => {
  try {
    const { quantity, scheduled_date } = req.body;

    if (!quantity || !scheduled_date) {
      return res.status(400).json({
        success: false,
        error: 'Quantity and scheduled date are required'
      });
    }

    const qty = parseInt(quantity);

    // Step 1: Create the import record
    const importDoc = await databases.createDocument(
      DATABASE_ID,
      COLLECTION_IMPORTS,
      ID.unique(),
      {
        quantity: qty,
        scheduled_date: scheduled_date,
        status: 'scheduled'
      }
    );

    // Step 2: Find the last file number and create sequential placeholders
    const lastNumber = await getLastFileNumber();
    const lotNumber = lastNumber + 1;  // Lot = youngest (lowest) number in the batch
    const createdFiles = [];
    const errors = [];

    for (let i = 1; i <= qty; i++) {
      const fileNumber = lastNumber + i;
      const filename = `${fileNumber}.txt`;

      try {
        // Match exact same fields as real upload to satisfy Appwrite schema
        await databases.createDocument(
          DATABASE_ID,
          COLLECTION_INSPECTIONS,
          ID.unique(),
          {
            filename: filename,
            uploaded_at: new Date().toISOString(),
            weight: null,
            lot: lotNumber,  // All files in batch share the same lot (lowest number)
            is_archived: false,
            status: 'upcoming_import',
            import_id: importDoc.$id,
            // Measurements - use '-' as placeholder (same as real upload)
            measurementA: '-', measurementB: '-', measurementC: '-',
            measurementD: '-', measurementE: '-', measurementF: '-',
            measurementG1: '-', measurementG2: '-', measurementG3: '-',
            measurementG4: '-', measurementH: '-', measurementI: '-',
            measurementJ: '-', measurementK: '-', measurementL: '-',
            // Validity flags - null until real data arrives
            isValidA: null, isValidB: null, isValidC: null,
            isValidD: null, isValidE: null, isValidF: null,
            isValidG1: null, isValidG2: null, isValidG3: null,
            isValidG4: null, isValidH: null, isValidI: null,
            isValidJ: null, isValidK: null, isValidL: null,
            // Status fields
            inspectionStatus: 'pending',
            failedMeasurements: ''
          }
        );
        createdFiles.push(filename);
      } catch (err) {
        console.error(`Failed to create placeholder ${filename}:`, err.message);
        errors.push({ file: filename, error: err.message });
      }
    }

    if (errors.length > 0) {
      console.error('Some placeholders failed:', JSON.stringify(errors));
      // Still return success for the import, but note errors
      return res.json({
        success: true,
        import: importDoc,
        createdFiles: createdFiles,
        startNumber: lastNumber + 1,
        endNumber: lastNumber + qty,
        errors: errors
      });
    }

    res.json({
      success: true,
      import: importDoc,
      createdFiles: createdFiles,
      startNumber: lastNumber + 1,
      endNumber: lastNumber + qty
    });
  } catch (error) {
    console.error("Error creating import:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update import + sync linked inspection statuses
app.put("/api/imports/:importId", requireAuth, async (req, res) => {
  try {
    const { importId } = req.params;
    const { quantity, scheduled_date, status, actual_date } = req.body;

    const updateData = {};
    if (quantity !== undefined) updateData.quantity = parseInt(quantity);
    if (scheduled_date !== undefined) updateData.scheduled_date = scheduled_date;
    if (status !== undefined) updateData.status = status;
    if (actual_date !== undefined) updateData.actual_date = actual_date;

    const importDoc = await databases.updateDocument(
      DATABASE_ID,
      COLLECTION_IMPORTS,
      importId,
      updateData
    );

    // Sync linked inspection statuses when import status changes
    let updatedCount = 0;
    if (status === 'arrived') {
      // Import arrived → move linked inspections to 'imported'
      updatedCount = await updateInspectionStatusByImport(importId, 'imported');
    }

    res.json({ success: true, import: importDoc, updatedInspections: updatedCount });
  } catch (error) {
    console.error("Error updating import:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete import
app.delete("/api/imports/:importId", requireAuth, async (req, res) => {
  try {
    const { importId } = req.params;

    await databases.deleteDocument(
      DATABASE_ID,
      COLLECTION_IMPORTS,
      importId
    );

    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting import:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ======================
// INSPECTION STATUS UPDATE API
// ======================

app.put("/api/inspections/:inspectionId/status", requireAuth, async (req, res) => {
  try {
    const { inspectionId } = req.params;
    const { status } = req.body;

    if (!status || !STATUS_CONFIG[status]) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status'
      });
    }

    const inspection = await databases.updateDocument(
      DATABASE_ID,
      COLLECTION_INSPECTIONS,
      inspectionId,
      { status: status }
    );

    res.json({ success: true, inspection: inspection });
  } catch (error) {
    console.error("Error updating inspection status:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Bulk advance all inspections from one status to another
app.put("/api/inspections/advance-status", requireAuth, async (req, res) => {
  try {
    const { fromStatus, toStatus } = req.body;

    if (!fromStatus || !toStatus || !STATUS_CONFIG[fromStatus] || !STATUS_CONFIG[toStatus]) {
      return res.status(400).json({ success: false, error: 'Invalid status values' });
    }

    // Fetch all docs with fromStatus
    const result = await databases.listDocuments(
      DATABASE_ID,
      COLLECTION_INSPECTIONS,
      [Query.equal('status', fromStatus), Query.limit(500)]
    );

    let updated = 0;
    for (const doc of result.documents) {
      await databases.updateDocument(
        DATABASE_ID,
        COLLECTION_INSPECTIONS,
        doc.$id,
        { status: toStatus }
      );
      updated++;
    }

    res.json({ success: true, updated: updated });
  } catch (error) {
    console.error("Error advancing status:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ======================
// FILE UPLOAD (TXT)
// ======================

app.post("/upload", requireAuth, upload.array("files"), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: "No file uploaded" 
      });
    }

    // Process each uploaded file
    const allResults = { successful: [], failed: [], updated: [] };

    for (const file of req.files) {
      try {
        await processSingleUpload(file, req, allResults);
      } catch (err) {
        allResults.failed.push({ filename: file.originalname, error: err.message });
      }
    }

    if (allResults.successful.length === 0 && allResults.updated.length === 0) {
      return res.status(400).json({ success: false, error: allResults.failed.map(f => f.error).join(', ') });
    }

    return res.json({ success: true, results: allResults });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

async function processSingleUpload(file, req, results) {
    const fileContent = file.buffer.toString("utf-8");
    const parsedData = parseTxtFile(fileContent);
    const filename = file.originalname;

    const existingFiles = await databases.listDocuments(
      DATABASE_ID,
      COLLECTION_INSPECTIONS,
      [Query.equal('filename', filename), Query.limit(1)]
    );

    const measurements = {};
    const validations = {};

    // Skip M and N — they are manual/visual fields not stored in Appwrite
    const dbKeys = Object.keys(measurementMapping).filter(k => k !== 'M' && k !== 'N');
    dbKeys.forEach(key => {
      const value = extractMeasurementValue(parsedData, key);
      // Appwrite stores measurements as String — convert numeric values
      measurements[`measurement${key}`] = value !== null ? String(value) : '-';
      validations[`isValid${key}`] = isValidMeasurement(value, key);
    });

    if (existingFiles.documents.length > 0) {
      const existingDoc = existingFiles.documents[0];
      const isPlaceholder = !existingDoc.measurementA || existingDoc.measurementA === '-';

      if (isPlaceholder) {
        // Placeholder exists from import schedule — fill in the real measurement data
        await databases.updateDocument(
          DATABASE_ID,
          COLLECTION_INSPECTIONS,
          existingDoc.$id,
          {
            uploaded_at: new Date().toISOString(),
            is_archived: false,
            status: 'inspection',
            // Keep existing lot and import_id from placeholder, only overwrite measurements
            ...measurements,
            ...validations
          }
        );
        results.updated.push({ filename });
        return;
      } else {
        // Real data already exists — skip with error
        results.failed.push({ filename, error: `${filename} already has measurement data` });
        return;
      }
    }

    // No existing file — create fresh
    await databases.createDocument(
      DATABASE_ID,
      COLLECTION_INSPECTIONS,
      ID.unique(),
      {
        filename: filename,
        lot: parsedData.lot || null,
        weight: null,
        uploaded_at: new Date().toISOString(),
        is_archived: false,
        status: 'inspection',
        ...measurements,
        ...validations
      }
    );

    results.successful.push({ filename });
}

// ======================
// FILE DATA RETRIEVAL
// ======================

app.get("/files/:fileId", requireAuth, async (req, res) => {
  try {
    const inspection = await databases.getDocument(
      DATABASE_ID,
      COLLECTION_INSPECTIONS,
      req.params.fileId
    );

    const measurements = {
      A: { value: inspection.measurementA, isValid: inspection.isValidA },
      B: { value: inspection.measurementB, isValid: inspection.isValidB },
      C: { value: inspection.measurementC, isValid: inspection.isValidC },
      D: { value: inspection.measurementD, isValid: inspection.isValidD },
      E: { value: inspection.measurementE, isValid: inspection.isValidE },
      F: { value: inspection.measurementF, isValid: inspection.isValidF },
      G1: { value: inspection.measurementG1, isValid: inspection.isValidG1 },
      G2: { value: inspection.measurementG2, isValid: inspection.isValidG2 },
      G3: { value: inspection.measurementG3, isValid: inspection.isValidG3 },
      G4: { value: inspection.measurementG4, isValid: inspection.isValidG4 },
      H: { value: inspection.measurementH, isValid: inspection.isValidH },
      I: { value: inspection.measurementI, isValid: inspection.isValidI },
      J: { value: inspection.measurementJ, isValid: inspection.isValidJ },
      K: { value: inspection.measurementK, isValid: inspection.isValidK },
      L: { value: inspection.measurementL, isValid: inspection.isValidL }
    };

    const gValue = processGValues(measurements);

    res.render("fileData", {
      file: inspection,
      measurements: measurements,
      gValue: gValue,
      validationRanges: validationRanges,
      username: req.session.username,
      displayName: getDisplayName(req.session.username),
      canEditWeights: req.session.canEditWeights
    });
  } catch (error) {
    console.error("Error fetching file data:", error);
    res.status(404).send("File not found");
  }
});

// ======================
// UPDATE WEIGHT
// ======================

app.post("/update-weight", requireWeightEditAuth, async (req, res) => {
  try {
    const { fileId, weight } = req.body;

    if (!fileId) {
      return res.status(400).json({ 
        success: false, 
        error: 'File ID is required' 
      });
    }

    const weightValue = weight && weight.trim() !== '' ? parseFloat(weight) : null;

    if (weightValue !== null && (isNaN(weightValue) || weightValue < 0)) {
      return res.status(400).json({
        success: false,
        error: 'Weight must be a positive number or empty'
      });
    }

    const formattedWeight = weightValue !== null ? parseFloat(weightValue.toFixed(1)) : null;

    await databases.updateDocument(
      DATABASE_ID,
      COLLECTION_INSPECTIONS,
      fileId,
      { 
        weight: formattedWeight,
        status: 'finished_inspection'
      }
    );

    res.json({ 
      success: true,
      weight: formattedWeight 
    });
  } catch (error) {
    console.error("Error updating weight:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Alias for frontend compatibility (some templates use /update-weights plural)
app.post("/update-weights", requireWeightEditAuth, async (req, res) => {
  try {
    const { weights } = req.body;

    if (!weights || !Array.isArray(weights) || weights.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Weights array is required' 
      });
    }

    const results = [];
    const errors = [];

    for (const item of weights) {
      const { fileId, weight } = item;

      if (!fileId) {
        errors.push({ error: 'File ID is required' });
        continue;
      }

      const weightValue = weight && weight.toString().trim() !== '' ? parseFloat(weight) : null;

      if (weightValue !== null && (isNaN(weightValue) || weightValue < 0)) {
        errors.push({ fileId, error: 'Weight must be a positive number or empty' });
        continue;
      }

      const formattedWeight = weightValue !== null ? parseFloat(weightValue.toFixed(1)) : null;

      try {
        await databases.updateDocument(
          DATABASE_ID,
          COLLECTION_INSPECTIONS,
          fileId,
          { 
            weight: formattedWeight,
            status: 'finished_inspection'
          }
        );
        results.push({ fileId, weight: formattedWeight, success: true });
      } catch (err) {
        errors.push({ fileId, error: err.message });
      }
    }

    res.json({ 
      success: errors.length === 0, 
      updated: results.length,
      results: results.length > 0 ? results : undefined,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error("Error updating weights:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ======================
// WEIGHT EXCEL IMPORT
// ======================

app.post("/import-weights", requireWeightEditAuth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        error: "No file uploaded" 
      });
    }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    let updated = 0;
    let created = 0;
    let errors = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length < 2) continue;

      let filename = String(row[0]).trim();
      const weightStr = String(row[1]).trim();

      if (!filename || !weightStr) continue;

      // Parse weight
      const weight = parseFloat(weightStr);
      if (isNaN(weight) || weight < 0) {
        errors.push(filename);
        continue;
      }

      const formattedWeight = parseFloat(weight.toFixed(1));
      
      // Handle filename: add .txt if not present
      const filenameWithExt = filename.endsWith('.txt') ? filename : `${filename}.txt`;

      try {
        // Find document by filename
        const result = await databases.listDocuments(
          DATABASE_ID,
          COLLECTION_INSPECTIONS,
          [Query.equal('filename', filenameWithExt), Query.limit(1)]
        );

        if (result.documents.length > 0) {
          // Update existing document
          const inspection = result.documents[0];
          await databases.updateDocument(
            DATABASE_ID,
            COLLECTION_INSPECTIONS,
            inspection.$id,
            { 
              weight: formattedWeight,
              status: 'finished_inspection'
            }
          );
          updated++;
        } else {
          // Create new document only if doesn't exist
          await databases.createDocument(
            DATABASE_ID,
            COLLECTION_INSPECTIONS,
            ID.unique(),
            {
              filename: filenameWithExt,
              lot: null,
              weight: formattedWeight,
              uploaded_at: new Date().toISOString(),
              is_archived: false,
              status: 'finished_inspection',
              measurementA: null, measurementB: null, measurementC: null,
              measurementD: null, measurementE: null, measurementF: null,
              measurementG1: null, measurementG2: null, measurementG3: null,
              measurementG4: null, measurementH: null, measurementI: null,
              measurementJ: null, measurementK: null, measurementL: null,
              isValidA: null, isValidB: null, isValidC: null,
              isValidD: null, isValidE: null, isValidF: null,
              isValidG1: null, isValidG2: null, isValidG3: null,
              isValidG4: null, isValidH: null, isValidI: null,
              isValidJ: null, isValidK: null, isValidL: null
            }
          );
          created++;
        }
      } catch (err) {
        console.error(`Failed to process ${filename}:`, err);
        errors.push(filename);
      }
    }
    
    res.json({ 
      success: true, 
      updated: updated,
      created: created,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error("Error importing weights:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ======================
// WEIGHT EXCEL EXPORT (SIMPLIFIED)
// ======================

app.get("/export-weights", requireWeightEditAuth, async (req, res) => {
  try {
    // Fetch ALL inspections (not just those with weights)
    const result = await databases.listDocuments(
      DATABASE_ID,
      COLLECTION_INSPECTIONS,
      [Query.limit(10000)]  // Increased limit to get all files
    );

    // Create export data for ALL files
    const dataWithWeights = result.documents
      .map(doc => {
        // Extract just the number from filename (e.g., "483.txt" → "483")
        const fileNumber = doc.filename.replace('.txt', '').replace(/[^0-9]/g, '');
        return {
          'ファイル番号': fileNumber,  // Just the number, no .txt
          '重量 (g)': doc.weight || ''  // Weight (empty if not filled)
        };
      })
      .sort((a, b) => {
        const numA = parseInt(a['ファイル番号']) || 0;
        const numB = parseInt(b['ファイル番号']) || 0;
        return numA - numB;
      });

    if (dataWithWeights.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No files in database to export'
      });
    }

    // Create workbook
    const worksheet = XLSX.utils.json_to_sheet(dataWithWeights);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Weights');

    // Set column widths
    worksheet['!cols'] = [
      { wch: 15 }, // ファイル番号
      { wch: 12 }  // 重量 (g)
    ];

    // Generate Excel file
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    // Send file with proper headers
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="weights_${new Date().toISOString().split('T')[0]}.xlsx"`);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(buffer);
  } catch (error) {
    console.error("Error exporting weights:", error);
    res.setHeader('Content-Type', 'application/json');
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ======================
// MEASUREMENT EXCEL EXPORT
// ======================

app.get("/export-measurements", requireAuth, async (req, res) => {
  try {
    // Fetch all inspections with measurements
    const result = await databases.listDocuments(
      DATABASE_ID,
      COLLECTION_INSPECTIONS,
      [Query.limit(1000)]
    );

    // Build data array with measurements
    const dataWithMeasurements = result.documents
      .map(doc => ({
        filename: doc.filename,
        lot: doc.lot || '',
        weight: doc.weight || '',
        status: doc.status || 'unknown',
        measurementA: doc.measurementA || '',
        measurementB: doc.measurementB || '',
        measurementC: doc.measurementC || '',
        measurementD: doc.measurementD || '',
        measurementE: doc.measurementE || '',
        measurementF: doc.measurementF || '',
        measurementG1: doc.measurementG1 || '',
        measurementG2: doc.measurementG2 || '',
        measurementG3: doc.measurementG3 || '',
        measurementG4: doc.measurementG4 || '',
        measurementH: doc.measurementH || '',
        measurementI: doc.measurementI || '',
        measurementJ: doc.measurementJ || '',
        measurementK: doc.measurementK || '',
        measurementL: doc.measurementL || '',
        isValidA: doc.isValidA || '',
        isValidB: doc.isValidB || '',
        isValidC: doc.isValidC || '',
        isValidD: doc.isValidD || '',
        isValidE: doc.isValidE || '',
        isValidF: doc.isValidF || '',
        isValidG1: doc.isValidG1 || '',
        isValidG2: doc.isValidG2 || '',
        isValidG3: doc.isValidG3 || '',
        isValidG4: doc.isValidG4 || '',
        isValidH: doc.isValidH || '',
        isValidI: doc.isValidI || '',
        isValidJ: doc.isValidJ || '',
        isValidK: doc.isValidK || '',
        isValidL: doc.isValidL || ''
      }))
      .sort((a, b) => {
        const numA = parseInt(a.filename.replace('.txt', '')) || 0;
        const numB = parseInt(b.filename.replace('.txt', '')) || 0;
        return numA - numB;
      });

    if (dataWithMeasurements.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No measurement data to export'
      });
    }

    // Create workbook
    const worksheet = XLSX.utils.json_to_sheet(dataWithMeasurements);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Measurements');

    // Set column widths
    worksheet['!cols'] = Array(35).fill({ wch: 12 });

    // Generate Excel file
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    // Send file with proper headers
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="measurements_export_${new Date().toISOString().split('T')[0]}.xlsx"`);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(buffer);
  } catch (error) {
    console.error("Error exporting measurements:", error);
    res.setHeader('Content-Type', 'application/json');
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ======================
// ARCHIVE FILES (Hide without deleting)
// ======================

app.post("/archive-files", requireAuth, async (req, res) => {
  try {
    const { fileIds } = req.body;
    
    if (!Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No file IDs provided'
      });
    }

    let archived = 0;
    let errors = [];

    for (const fileId of fileIds) {
      try {
        await databases.updateDocument(
          DATABASE_ID,
          COLLECTION_INSPECTIONS,
          fileId,
          { is_archived: true }
        );
        archived++;
      } catch (err) {
        console.error(`Failed to archive ${fileId}:`, err);
        errors.push(fileId);
      }
    }

    res.json({
      success: true,
      archived: archived,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error("Error archiving files:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ======================
// UNARCHIVE FILES (Restore visibility)
// ======================

app.post("/unarchive-files", requireAuth, async (req, res) => {
  try {
    const { fileIds } = req.body;
    
    if (!Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No file IDs provided'
      });
    }

    let unarchived = 0;
    let errors = [];

    for (const fileId of fileIds) {
      try {
        await databases.updateDocument(
          DATABASE_ID,
          COLLECTION_INSPECTIONS,
          fileId,
          { is_archived: false }
        );
        unarchived++;
      } catch (err) {
        console.error(`Failed to unarchive ${fileId}:`, err);
        errors.push(fileId);
      }
    }

    res.json({
      success: true,
      unarchived: unarchived,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error("Error unarchiving files:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ======================
// SUMMARY ROUTE
// ======================

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

    const files = [];
    const fileData = {};

    for (const fileId of fileIds) {
      try {
        const inspection = await databases.getDocument(
          DATABASE_ID,
          COLLECTION_INSPECTIONS,
          fileId
        );

        files.push(inspection);

        const measurements = {
          A: { value: inspection.measurementA, isValid: inspection.isValidA },
          B: { value: inspection.measurementB, isValid: inspection.isValidB },
          C: { value: inspection.measurementC, isValid: inspection.isValidC },
          D: { value: inspection.measurementD, isValid: inspection.isValidD },
          E: { value: inspection.measurementE, isValid: inspection.isValidE },
          F: { value: inspection.measurementF, isValid: inspection.isValidF },
          G1: { value: inspection.measurementG1, isValid: inspection.isValidG1 },
          G2: { value: inspection.measurementG2, isValid: inspection.isValidG2 },
          G3: { value: inspection.measurementG3, isValid: inspection.isValidG3 },
          G4: { value: inspection.measurementG4, isValid: inspection.isValidG4 },
          H: { value: inspection.measurementH, isValid: inspection.isValidH },
          I: { value: inspection.measurementI, isValid: inspection.isValidI },
          J: { value: inspection.measurementJ, isValid: inspection.isValidJ },
          K: { value: inspection.measurementK, isValid: inspection.isValidK },
          L: { value: inspection.measurementL, isValid: inspection.isValidL }
        };

        const gValue = processGValues(measurements);
        
        fileData[inspection.$id] = {
          ...measurements,
          G: gValue
        };

      } catch (error) {
        console.error(`Error fetching inspection ${fileId}:`, error);
      }
    }

    res.render("summary", {
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

// ======================
// HEALTH CHECK
// ======================

app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    database: "Appwrite",
    schema: "Efficient with Stock Management",
    timestamp: new Date().toISOString(),
  });
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
  console.log(`Database: Appwrite (Efficient Schema with Stock Management)`);
  console.log(`Authentication: ENABLED (Database Sessions)`);
  console.log(`Authorized weight editors: ${AUTHORIZED_USERS.join(', ')}`);
  console.log(`✨ Stock Management System Enabled`);
  console.log(`📊 Excel import/export enabled`);
});

module.exports = app;