// app.js - FIXED VERSION FOR MULTIPLE FILE UPLOAD
// Fixed: Changed upload.single("file") to upload.array("files") to match HTML form
// Updated: Ship order functionality - marks order as shipped, hides from Orders list,
//          marks allocated products as shipped (hidden from all views, data kept in Appwrite)

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

const AUTHORIZED_USERS = ['naemura', 'iwatsuki'];

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
    hidden: true
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

const DATABASE_ID = process.env.APPWRITE_DATABASE_ID;
const COLLECTION_INSPECTIONS = process.env.APPWRITE_COLLECTION_INSPECTIONS_ID;
const COLLECTION_LOGIN_LOGS = process.env.APPWRITE_COLLECTION_LOGIN_LOGS_ID;
const COLLECTION_SESSIONS = process.env.APPWRITE_COLLECTION_SESSIONS_ID;
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
  try {
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
  } catch (error) {
    console.error(`[SESSION] Error creating session:`, error);
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
      await databases.deleteDocument(DATABASE_ID, COLLECTION_SESSIONS, sessions.documents[0].$id);
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
    return res.render("login", { error: "Username and password are required" });
  }
  if (!isValidPassword(password)) {
    return res.render("login", { error: "Password must be exactly 4 digits" });
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
      await databases.createDocument(DATABASE_ID, COLLECTION_LOGIN_LOGS, ID.unique(), {
        username: username,
        login_time: new Date().toISOString(),
        can_edit_weights: canEditWeights(username)
      });
    } catch (logError) {
      console.error('Error logging login:', logError);
    }
    res.redirect("/");
  } catch (error) {
    console.error('Login error:', error);
    res.render("login", { error: "Login failed. Please try again." });
  }
});

app.post("/logout", async (req, res) => {
  const sessionId = req.cookies.session_id;
  await deleteSession(sessionId);
  res.clearCookie('session_id');
  res.redirect('/login');
});

app.get("/logout", async (req, res) => {
  const sessionId = req.cookies.session_id;
  await deleteSession(sessionId);
  res.clearCookie('session_id');
  res.redirect('/login');
});

// ======================
// TXT FILE PARSING
// ======================

function parseTxtFile(fileContent) {
  const lines = fileContent.split("\n").map(line => line.trim());
  const data = { measurements: {} };

  lines.forEach((line) => {
    if (line.startsWith("Lot No.")) {
      const lotMatch = line.match(/Lot No\.\s*:\s*(.+)/);
      if (lotMatch) data.lot = lotMatch[1].trim();
    } else {
      const circleMatch = line.match(/^(\d+)\s+CIRCLE\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
      if (circleMatch) {
        const index = parseInt(circleMatch[1]);
        data.measurements[index] = {
          type: "CIRCLE",
          x: parseFloat(circleMatch[2]),
          y: parseFloat(circleMatch[3]),
          z: parseFloat(circleMatch[4]),
          diameter: parseFloat(circleMatch[5]),
          roundness: parseFloat(circleMatch[6])
        };
      }
      const ptCompMatch = line.match(/^(\d+)\s+PT-COMP\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
      if (ptCompMatch) {
        const index = parseInt(ptCompMatch[1]);
        data.measurements[index] = {
          type: "PT-COMP",
          x: parseFloat(ptCompMatch[2]),
          y: parseFloat(ptCompMatch[3]),
          z: parseFloat(ptCompMatch[4])
        };
      }
      const distanceMatch = line.match(/^(\d+)\s+DISTANCE\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
      if (distanceMatch) {
        const index = parseInt(distanceMatch[1]);
        data.measurements[index] = {
          type: "DISTANCE",
          x: parseFloat(distanceMatch[2]),
          y: parseFloat(distanceMatch[3]),
          z: parseFloat(distanceMatch[4]),
          distance: parseFloat(distanceMatch[5])
        };
      }
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
        const measurement = parsedData.measurements[indexConfig.index];
        if (!measurement || measurement.type !== indexConfig.type) return null;
        return measurement[indexConfig.field];
      })
      .filter(v => v !== null);
    if (values.length === 0) return null;
    const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
    return config.absolute ? Math.abs(avg) : avg;
  }
  const measurement = parsedData.measurements[config.index];
  if (!measurement || measurement.type !== config.type) return null;
  const value = measurement[config.field];
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
  const validGValues = gKeys
    .map(key => measurements[key])
    .filter(m => m && m.value !== null && m.value !== undefined && m.isValid === true);
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
// STOCK AVAILABILITY CALCULATION
// Determines which inspection items are allocated to each order,
// respecting due-date priority (earlier orders get first pick of stock)
// ======================

function calculateStockAvailability(orderQuantity, inspections, allOrders, currentOrder) {
  // Sort other orders by due date ascending — earlier due dates have priority
  const sortedPriorOrders = allOrders
    .filter(o => o.$id !== currentOrder.$id)
    .sort((a, b) => new Date(a.due_date) - new Date(b.due_date));

  const allocatedStock = new Set();

  // Allocate stock to orders with an earlier due date first
  for (const order of sortedPriorOrders) {
    if (new Date(order.due_date) < new Date(currentOrder.due_date)) {
      const orderQty = parseInt(order.quantity);
      const availableForPriorOrder = inspections
        .filter(item => item.status && item.status !== 'shipped')
        .filter(item => !allocatedStock.has(item.$id))
        .map(item => ({ ...item, fileNumber: parseInt(item.filename.replace('.txt', '')) }))
        .filter(item => !isNaN(item.fileNumber))
        .sort((a, b) => a.fileNumber - b.fileNumber);
      availableForPriorOrder.slice(0, orderQty).forEach(item => allocatedStock.add(item.$id));
    }
  }

  // What remains after prior orders is available for this order
  const availableStock = inspections
    .filter(item => item.status && item.status !== 'shipped')
    .filter(item => !allocatedStock.has(item.$id))
    .map(item => ({ ...item, fileNumber: parseInt(item.filename.replace('.txt', '')) }))
    .filter(item => !isNaN(item.fileNumber))
    .sort((a, b) => a.fileNumber - b.fileNumber);

  const needed = parseInt(orderQuantity);

  if (availableStock.length < needed) {
    return {
      status: 'insufficient',
      color: '#fd7e14',
      icon: '⚠️',
      label: '在庫不足',
      available: availableStock.length,
      needed: needed,
      shortage: needed - availableStock.length,
      allocatedItems: availableStock
    };
  }

  const allocated = availableStock.slice(0, needed);
  const hasUpcomingImport = allocated.some(item => item.status === 'upcoming_import');
  const hasImportedOrInspection = allocated.some(item =>
    item.status === 'imported' || item.status === 'inspection'
  );
  const allFinished = allocated.every(item => item.status === 'finished_inspection');

  if (allFinished) {
    return { status: 'ready', color: '#198754', icon: '✓', label: '出荷可能', allocatedItems: allocated };
  } else if (hasUpcomingImport) {
    return { status: 'uncertain', color: '#ffc107', icon: '⚠', label: '入荷予定含む', allocatedItems: allocated };
  } else if (hasImportedOrInspection) {
    return { status: 'processing', color: '#6c757d', icon: '◐', label: '検査中含む', allocatedItems: allocated };
  }
  return { status: 'unknown', color: '#6c757d', icon: '?', label: '不明', allocatedItems: allocated };
}

// ======================
// MAIN INDEX ROUTE
// ======================

app.get("/", requireAuth, async (req, res) => {
  try {
    const showArchived = req.query.archived === 'true';
    const result = await databases.listDocuments(
      DATABASE_ID,
      COLLECTION_INSPECTIONS,
      [
        Query.equal('is_archived', showArchived),
        Query.orderDesc('uploaded_at'),
        Query.limit(1000)
      ]
    );

    const files = result.documents
      .filter(doc => doc.status !== 'shipped')
      .map(doc => ({
        ...doc,
        fileNumber: doc.filename ? doc.filename.replace(/\.(txt|TXT)$/, '') : 'Unknown',
        statusColor: STATUS_CONFIG[doc.status]?.color || STATUS_CONFIG['finished_inspection'].color,
        statusOpacity: STATUS_CONFIG[doc.status]?.opacity ?? STATUS_CONFIG['finished_inspection'].opacity,
        statusLabel: STATUS_CONFIG[doc.status]?.label || STATUS_CONFIG['finished_inspection'].label
      }));

    res.render("index", {
      files,
      username: req.session.username,
      displayName: getDisplayName(req.session.username),
      canEditWeights: req.session.canEditWeights,
      showArchived,
      statusConfig: STATUS_CONFIG
    });
  } catch (error) {
    console.error("Error fetching files:", error);
    res.status(500).send("Error loading files");
  }
});

// ======================
// STOCK MANAGEMENT VIEW
// Orders with status 'shipped' are excluded from the Orders list.
// Inspections with status 'shipped' are excluded from Inventory.
// ======================

app.get("/stock-management", requireAuth, async (req, res) => {
  try {
    // Only fetch orders that are NOT shipped
    const ordersResult = await databases.listDocuments(
      DATABASE_ID,
      COLLECTION_ORDERS,
      [
        Query.notEqual('status', 'shipped'),
        Query.orderAsc('due_date'),
        Query.limit(100)
      ]
    );

    const importsResult = await databases.listDocuments(
      DATABASE_ID,
      COLLECTION_IMPORTS,
      [Query.orderAsc('scheduled_date'), Query.limit(100)]
    );

    // Fetch all inspections that are NOT shipped
    const inspectionsResult = await databases.listDocuments(
      DATABASE_ID,
      COLLECTION_INSPECTIONS,
      [
        Query.notEqual('status', 'shipped'),
        Query.equal('is_archived', false),
        Query.orderDesc('uploaded_at'),
        Query.limit(1000)
      ]
    );

    // Group inspections by status for the Inventory tab
    const inspectionsByStatus = {
      upcoming_import: [],
      imported: [],
      inspection: [],
      finished_inspection: []
    };

    inspectionsResult.documents.forEach(doc => {
      const status = doc.status || 'finished_inspection';
      if (inspectionsByStatus[status] !== undefined) {
        inspectionsByStatus[status].push(doc);
      }
    });

    // Calculate stock availability per order (time-aware, priority by due date)
    // We need ALL orders (including shipped ones) for the allocation algorithm?
    // No — shipped orders' products are already marked shipped so they won't appear
    // in inspectionsResult anyway. We only need active orders for priority sorting.
    const ordersWithStock = ordersResult.documents.map(order => {
      const stockCheck = calculateStockAvailability(
        order.quantity,
        inspectionsResult.documents,
        ordersResult.documents,
        order
      );
      return { ...order, stockAvailability: stockCheck };
    });

    res.render("stock-management", {
      orders: ordersWithStock,
      imports: importsResult.documents,
      inspectionsByStatus,
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

// Get single order (for edit modal)
app.get("/api/orders/:orderId", requireAuth, async (req, res) => {
  try {
    const order = await databases.getDocument(DATABASE_ID, COLLECTION_ORDERS, req.params.orderId);
    res.json(order);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create order
app.post("/api/orders", requireAuth, async (req, res) => {
  try {
    const { quantity, due_date } = req.body;
    if (!quantity || !due_date) {
      return res.status(400).json({ success: false, error: 'Quantity and due date are required' });
    }
    const order = await databases.createDocument(DATABASE_ID, COLLECTION_ORDERS, ID.unique(), {
      quantity: parseInt(quantity),
      due_date,
      status: 'pending'
    });
    res.json({ success: true, order });
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
    const order = await databases.updateDocument(DATABASE_ID, COLLECTION_ORDERS, orderId, updateData);
    res.json({ success: true, order });
  } catch (error) {
    console.error("Error updating order:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete order
app.delete("/api/orders/:orderId", requireAuth, async (req, res) => {
  try {
    await databases.deleteDocument(DATABASE_ID, COLLECTION_ORDERS, req.params.orderId);
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting order:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ======================
// SHIP ORDER API
// - Sets order status to 'shipped' (hidden from Orders list)
// - Sets all allocated inspection items to status 'shipped' (hidden from all views)
// - All data is preserved in Appwrite — nothing is deleted
// ======================

app.put("/api/orders/:orderId/ship", requireAuth, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { itemIds } = req.body;

    if (!Array.isArray(itemIds) || itemIds.length === 0) {
      return res.status(400).json({ success: false, error: 'No item IDs provided' });
    }

    // Mark the order itself as shipped — it will no longer appear in the Orders list
    await databases.updateDocument(DATABASE_ID, COLLECTION_ORDERS, orderId, {
      status: 'shipped'
    });

    // Mark each allocated inspection item as shipped — they disappear from all views
    // Data remains intact in Appwrite
    let shippedCount = 0;
    const errors = [];
    for (const itemId of itemIds) {
      try {
        await databases.updateDocument(DATABASE_ID, COLLECTION_INSPECTIONS, itemId, {
          status: 'shipped'
        });
        shippedCount++;
      } catch (err) {
        console.error(`Failed to mark item ${itemId} as shipped:`, err);
        errors.push(itemId);
      }
    }

    res.json({
      success: true,
      shippedCount,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error("Error shipping order:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ======================
// IMPORT MANAGEMENT API
// ======================

app.get("/api/imports/:importId", requireAuth, async (req, res) => {
  try {
    const imp = await databases.getDocument(DATABASE_ID, COLLECTION_IMPORTS, req.params.importId);
    res.json(imp);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/imports", requireAuth, async (req, res) => {
  try {
    const { quantity, scheduled_date } = req.body;
    if (!quantity || !scheduled_date) {
      return res.status(400).json({ success: false, error: 'Quantity and scheduled date are required' });
    }
    const importDoc = await databases.createDocument(DATABASE_ID, COLLECTION_IMPORTS, ID.unique(), {
      quantity: parseInt(quantity),
      scheduled_date,
      status: 'scheduled'
    });
    res.json({ success: true, import: importDoc });
  } catch (error) {
    console.error("Error creating import:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put("/api/imports/:importId", requireAuth, async (req, res) => {
  try {
    const { importId } = req.params;
    const { quantity, scheduled_date, status, actual_date } = req.body;
    const updateData = {};
    if (quantity !== undefined) updateData.quantity = parseInt(quantity);
    if (scheduled_date !== undefined) updateData.scheduled_date = scheduled_date;
    if (status !== undefined) updateData.status = status;
    if (actual_date !== undefined) updateData.actual_date = actual_date;
    const importDoc = await databases.updateDocument(DATABASE_ID, COLLECTION_IMPORTS, importId, updateData);
    res.json({ success: true, import: importDoc });
  } catch (error) {
    console.error("Error updating import:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete("/api/imports/:importId", requireAuth, async (req, res) => {
  try {
    await databases.deleteDocument(DATABASE_ID, COLLECTION_IMPORTS, req.params.importId);
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
    const { status } = req.body;
    if (!status || !STATUS_CONFIG[status]) {
      return res.status(400).json({ success: false, error: 'Invalid status' });
    }
    const inspection = await databases.updateDocument(
      DATABASE_ID, COLLECTION_INSPECTIONS, req.params.inspectionId, { status }
    );
    res.json({ success: true, inspection });
  } catch (error) {
    console.error("Error updating inspection status:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ======================
// FILE UPLOAD (TXT) - FIXED FOR MULTIPLE FILES
// Changed from upload.single("file") to upload.array("files")
// Now accepts multiple files with field name "files" matching the HTML form
// ======================

app.post("/upload", requireAuth, upload.array("files"), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, error: "No files uploaded" });
    }

    const lotNumber = req.body.lot || null;
    const successfulUploads = [];
    const failedUploads = [];

    for (const file of req.files) {
      try {
        const fileContent = file.buffer.toString("utf-8");
        const parsedData = parseTxtFile(fileContent);
        const filename = file.originalname;

        const existingFiles = await databases.listDocuments(
          DATABASE_ID, COLLECTION_INSPECTIONS, [Query.equal('filename', filename), Query.limit(1)]
        );
        if (existingFiles.documents.length > 0) {
          failedUploads.push({ filename, error: `File ${filename} already exists` });
          continue;
        }

        const measurements = {};
        const validations = {};
        Object.keys(measurementMapping).forEach(key => {
          const value = extractMeasurementValue(parsedData, key);
          measurements[`measurement${key}`] = value;
          validations[`isValid${key}`] = isValidMeasurement(value, key);
        });

        await databases.createDocument(DATABASE_ID, COLLECTION_INSPECTIONS, ID.unique(), {
          filename,
          lot: lotNumber || parsedData.lot || null,
          weight: null,
          uploaded_at: new Date().toISOString(),
          is_archived: false,
          status: 'inspection',
          ...measurements,
          ...validations
        });

        successfulUploads.push(filename);
      } catch (fileError) {
        console.error(`Error processing file ${file.originalname}:`, fileError);
        failedUploads.push({ filename: file.originalname, error: fileError.message });
      }
    }

    const response = {
      success: failedUploads.length === 0,
      uploaded: successfulUploads.length,
      failed: failedUploads.length,
      successfulFiles: successfulUploads,
      failedFiles: failedUploads.length > 0 ? failedUploads : undefined
    };

    if (successfulUploads.length > 0) {
      response.message = `Successfully uploaded ${successfulUploads.length} file(s)`;
    }

    res.json(response);
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ======================
// FILE DATA RETRIEVAL
// ======================

app.get("/file-data/:fileId", requireAuth, async (req, res) => {
  try {
    const inspection = await databases.getDocument(DATABASE_ID, COLLECTION_INSPECTIONS, req.params.fileId);
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
      measurements,
      gValue,
      validationRanges,
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
    if (!fileId) return res.status(400).json({ success: false, error: 'File ID is required' });
    const weightValue = weight && weight.trim() !== '' ? parseFloat(weight) : null;
    if (weightValue !== null && (isNaN(weightValue) || weightValue < 0)) {
      return res.status(400).json({ success: false, error: 'Weight must be a positive number or empty' });
    }
    const formattedWeight = weightValue !== null ? weightValue.toFixed(1) : null;
    await databases.updateDocument(DATABASE_ID, COLLECTION_INSPECTIONS, fileId, { weight: formattedWeight });
    res.json({ success: true, weight: formattedWeight });
  } catch (error) {
    console.error("Error updating weight:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ======================
// UPDATE WEIGHTS (bulk)
// ======================

app.post("/update-weights", requireWeightEditAuth, async (req, res) => {
  try {
    const { weights } = req.body;
    if (!Array.isArray(weights) || weights.length === 0) {
      return res.status(400).json({ success: false, error: 'No weights provided' });
    }
    let updated = 0;
    const errors = [];
    for (const { fileId, weight } of weights) {
      try {
        const formattedWeight = parseFloat(weight).toFixed(1);
        await databases.updateDocument(DATABASE_ID, COLLECTION_INSPECTIONS, fileId, { weight: formattedWeight });
        updated++;
      } catch (err) {
        errors.push(fileId);
      }
    }
    res.json({ success: true, count: updated, errors: errors.length > 0 ? errors : undefined });
  } catch (error) {
    console.error("Error updating weights:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ======================
// WEIGHT EXCEL IMPORT
// ======================

app.post("/import-weights", requireWeightEditAuth, upload.single("weightFile"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: "No file uploaded" });
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 });
    let updated = 0, created = 0;
    const errors = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length < 2) continue;
      const filename = String(row[0]).trim();
      const weightStr = String(row[1]).trim();
      if (!filename || !weightStr) continue;
      const weight = parseFloat(weightStr);
      if (isNaN(weight) || weight < 0) { errors.push(filename); continue; }
      const formattedWeight = weight.toFixed(1);
      const filenameWithExt = filename.endsWith('.txt') ? filename : `${filename}.txt`;
      try {
        const result = await databases.listDocuments(
          DATABASE_ID, COLLECTION_INSPECTIONS, [Query.equal('filename', filenameWithExt), Query.limit(1)]
        );
        if (result.documents.length > 0) {
          await databases.updateDocument(DATABASE_ID, COLLECTION_INSPECTIONS, result.documents[0].$id, { weight: formattedWeight });
          updated++;
        } else {
          await databases.createDocument(DATABASE_ID, COLLECTION_INSPECTIONS, ID.unique(), {
            filename: filenameWithExt, lot: null, weight: formattedWeight,
            uploaded_at: new Date().toISOString(), is_archived: false, status: 'finished_inspection',
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
          });
          created++;
        }
      } catch (err) {
        console.error(`Failed to process ${filename}:`, err);
        errors.push(filename);
      }
    }
    res.json({ success: true, updated, created, errors: errors.length > 0 ? errors : undefined });
  } catch (error) {
    console.error("Error importing weights:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ======================
// WEIGHT EXCEL EXPORT
// ======================

app.get("/export-weights", requireAuth, async (req, res) => {
  try {
    const result = await databases.listDocuments(
      DATABASE_ID, COLLECTION_INSPECTIONS, [Query.orderDesc('uploaded_at'), Query.limit(1000)]
    );
    const data = [['File Name', 'Weight (g)']];
    result.documents
      .filter(doc => doc.weight !== null && doc.weight !== undefined)
      .sort((a, b) => {
        const numA = parseInt((a.filename.match(/^\d+/) || ['0'])[0]);
        const numB = parseInt((b.filename.match(/^\d+/) || ['0'])[0]);
        return numA - numB;
      })
      .forEach(doc => data.push([doc.filename.replace('.txt', ''), parseFloat(doc.weight).toFixed(1)]));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), 'Weights');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const today = new Date();
    const dateStr = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=weight_data_${dateStr}.xlsx`);
    res.send(buffer);
  } catch (error) {
    console.error("Error exporting weights:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ======================
// ARCHIVE / UNARCHIVE FILES
// ======================

app.post("/archive-files", requireAuth, async (req, res) => {
  try {
    const { fileIds } = req.body;
    if (!Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({ success: false, error: 'No file IDs provided' });
    }
    let archived = 0;
    const errors = [];
    for (const fileId of fileIds) {
      try {
        await databases.updateDocument(DATABASE_ID, COLLECTION_INSPECTIONS, fileId, { is_archived: true });
        archived++;
      } catch (err) { errors.push(fileId); }
    }
    res.json({ success: true, archived, errors: errors.length > 0 ? errors : undefined });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/unarchive-files", requireAuth, async (req, res) => {
  try {
    const { fileIds } = req.body;
    if (!Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({ success: false, error: 'No file IDs provided' });
    }
    let unarchived = 0;
    const errors = [];
    for (const fileId of fileIds) {
      try {
        await databases.updateDocument(DATABASE_ID, COLLECTION_INSPECTIONS, fileId, { is_archived: false });
        unarchived++;
      } catch (err) { errors.push(fileId); }
    }
    res.json({ success: true, unarchived, errors: errors.length > 0 ? errors : undefined });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ======================
// DELETE FILE
// ======================

app.post("/delete-file", requireAuth, async (req, res) => {
  try {
    const { fileId } = req.body;
    if (!fileId) return res.status(400).json({ success: false, error: 'File ID is required' });
    await databases.deleteDocument(DATABASE_ID, COLLECTION_INSPECTIONS, fileId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ======================
// SUMMARY ROUTE
// ======================

app.get("/summary", requireAuth, async (req, res) => {
  try {
    const selectedFilesParam = req.query.selectedFiles || "";
    const fileIds = selectedFilesParam.split(",").map(id => id.trim()).filter(id => id.length > 0);
    if (fileIds.length === 0) return res.redirect("/");
    const files = [];
    const fileData = {};
    for (const fileId of fileIds) {
      try {
        const inspection = await databases.getDocument(DATABASE_ID, COLLECTION_INSPECTIONS, fileId);
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
        fileData[inspection.$id] = { ...measurements, G: gValue };
      } catch (error) {
        console.error(`Error fetching inspection ${fileId}:`, error);
      }
    }
    res.render("summary", {
      files, fileData, validationRanges,
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
    schema: "Efficient with Stock Management + Ship Order",
    upload_fix: "Changed from upload.single('file') to upload.array('files') to match HTML form field name",
    timestamp: new Date().toISOString()
  });
});

app.use((req, res) => { res.status(404).send("Page not found"); });
app.use((err, req, res, next) => { console.error(err.stack); res.status(500).send("Something went wrong!"); });

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`✨ Ship Order API enabled — shipped orders/products hidden from views, data preserved in Appwrite`);
  console.log(`✅ Upload fixed — Now accepts multiple files with field name 'files' (matching HTML form)`);
});

module.exports = app;