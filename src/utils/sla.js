const { getDb } = require('../firebase');

/**
 * Default SLA configs (used as fallback if Firestore has none)
 */
const DEFAULT_SLA = {
  CRITICAL: { firstResponseHours: 1,  resolutionHours: 4   },
  HIGH:     { firstResponseHours: 4,  resolutionHours: 24  },
  MEDIUM:   { firstResponseHours: 8,  resolutionHours: 72  },
  LOW:      { firstResponseHours: 24, resolutionHours: 120 },
};

/** In-memory SLA cache */
let slaCache = null;
let slaCacheLoadedAt = null;
const SLA_CACHE_TTL_MS = 10 * 60 * 1000; // refresh every 10 minutes

/**
 * Load SLA configurations from Firestore (with in-memory cache)
 */
const loadSlaConfig = async () => {
  const now = Date.now();
  if (slaCache && slaCacheLoadedAt && (now - slaCacheLoadedAt) < SLA_CACHE_TTL_MS) {
    return slaCache;
  }

  try {
    const db = getDb();
    const snapshot = await db.collection('sla_configurations').where('isActive', '==', true).get();

    if (snapshot.empty) {
      slaCache = DEFAULT_SLA;
    } else {
      const loaded = {};
      snapshot.docs.forEach((doc) => {
        const data = doc.data();
        loaded[data.priority] = {
          firstResponseHours: data.firstResponseHours,
          resolutionHours: data.resolutionHours,
        };
      });
      // Fill any missing priorities with defaults
      slaCache = { ...DEFAULT_SLA, ...loaded };
    }
  } catch (err) {
    console.warn('[SLA] Failed to load from Firestore, using defaults:', err.message);
    slaCache = DEFAULT_SLA;
  }

  slaCacheLoadedAt = Date.now();
  return slaCache;
};

/**
 * Compute SLA deadlines for a new ticket
 * @param {string} priority - LOW | MEDIUM | HIGH | CRITICAL
 * @param {Date} createdAt  - ticket creation time
 * @returns {{ slaFirstResponse: string, slaResolution: string }}
 */
const computeSlaDeadlines = async (priority, createdAt = new Date()) => {
  const config = await loadSlaConfig();
  const sla = config[priority] || DEFAULT_SLA.MEDIUM;

  const firstResponseDeadline = new Date(createdAt.getTime() + sla.firstResponseHours * 60 * 60 * 1000);
  const resolutionDeadline = new Date(createdAt.getTime() + sla.resolutionHours * 60 * 60 * 1000);

  return {
    slaFirstResponse: firstResponseDeadline.toISOString(),
    slaResolution: resolutionDeadline.toISOString(),
    slaFirstResponseHours: sla.firstResponseHours,
    slaResolutionHours: sla.resolutionHours,
  };
};

/**
 * Check if the first response SLA has been breached.
 * @param {string} slaFirstResponse  - ISO deadline string
 * @param {string|null} firstResponseAt - ISO timestamp of first agent response
 * @returns {boolean}
 */
const isFirstResponseBreached = (slaFirstResponse, firstResponseAt) => {
  if (!slaFirstResponse) return false;
  const deadline = new Date(slaFirstResponse).getTime();
  const responseTime = firstResponseAt ? new Date(firstResponseAt).getTime() : Date.now();
  return responseTime > deadline;
};

/**
 * Check if the resolution SLA has been breached.
 * @param {string} slaResolution  - ISO deadline string
 * @param {string|null} resolvedAt  - ISO timestamp of resolution
 * @returns {boolean}
 */
const isResolutionBreached = (slaResolution, resolvedAt) => {
  if (!slaResolution) return false;
  const deadline = new Date(slaResolution).getTime();
  const resolutionTime = resolvedAt ? new Date(resolvedAt).getTime() : Date.now();
  return resolutionTime > deadline;
};

/** Invalidate the SLA cache (call after updating SLA config) */
const invalidateSlaCache = () => {
  slaCache = null;
  slaCacheLoadedAt = null;
};

module.exports = {
  loadSlaConfig,
  computeSlaDeadlines,
  isFirstResponseBreached,
  isResolutionBreached,
  invalidateSlaCache,
  DEFAULT_SLA,
};
