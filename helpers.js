import crypto from "crypto";

const SESSION_EXPIRY = 3600000; // 1 hour
const MAX_TOKENS = 1000; // Prevent memory bloat

// API key from environment variable
const API_KEY = process.env.API_KEY;

// Session token for check-duplicate
const sessionTokens = new Map();

// Middleware to check API key. The API key is an environment variable
// used to protect the endpoints used by the companion app to access the
// links
export function checkApiKey(req, res, next) {
  const providedApiKey = req.body.apiKey;
  if (!providedApiKey || providedApiKey !== API_KEY) {
    return res.status(401).json({ error: "Invalid API key" });
  }
  next();
}

// a new session token is created on index page load
export function newSessionToken() {
  const sessionToken = crypto.randomBytes(32).toString("hex");
  sessionTokens.set(sessionToken, Date.now());
  return sessionToken;
}

// Middleware to check session token. The session token is created at the
// default route, and used to protect the endpoints used by the frontend
export function checkSessionToken(req, res, next) {
  const sessionToken = req.cookies.sessionToken;
  if (!sessionToken || !sessionTokens.has(sessionToken)) {
    console.log("Session token validation failed");
    return res.status(401).json({ error: "Invalid session" });
  }
  next();
}

// Helper function to cleanup session tokens, called by timer
export function cleanupSessionTokens() {
  const now = Date.now();
  let removedCount = 0;
  // Remove expired tokens
  for (const [token, timestamp] of sessionTokens.entries()) {
    if (now - timestamp > SESSION_EXPIRY) {
      sessionTokens.delete(token);
      removedCount++;
    }
  }
  // If too many tokens accumulate, remove the oldest ones
  if (sessionTokens.size > MAX_TOKENS) {
    const sortedTokens = [...sessionTokens.entries()].sort(
      (a, b) => a[1] - b[1]
    );
    const tokensToRemove = sortedTokens.slice(
      0,
      sessionTokens.size - MAX_TOKENS
    );
    for (const [token] of tokensToRemove) {
      sessionTokens.delete(token);
    }
  }
}

// Helper function to process URL
export function processUrl(url) {
  const freshUrl = url.trim();
  // // Prevent potential XSS or injection
  if (freshUrl.includes("<") || freshUrl.includes(">")) {
    throw new Error("Invalid URL characters");
  }
  try {
    const parsedUrl = new URL(freshUrl);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      throw new Error("Invalid protocol");
    }
    return `${parsedUrl.protocol}//${parsedUrl.host}${parsedUrl.pathname}`;
  } catch (error) {
    console.error("URL Processing Error:", error);
    throw new Error("Invalid URL format");
  }
}

export function handleServerError(
  res,
  error,
  defaultMessage = "An unexpected error occurred"
) {
  console.error(error);
  res.status(error.status || 500).json({
    error: error.message || defaultMessage,
    timestamp: new Date().toISOString(),
  });
}
