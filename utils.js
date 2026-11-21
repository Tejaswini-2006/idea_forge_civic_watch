/**
 * Utility functions for CivicWatch
 * Sanitization, safe URL handling, formatting, toast notifications
 */

/**
 * Escapes unsafe HTML characters to prevent XSS attacks
 * @param {string|any} str
 * @returns {string}
 */
export function escapeHTML(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Validates and sanitizes media and image URLs
 * Allows only https, http, blob, or base64 data URLs
 * @param {string} url
 * @returns {string|null}
 */
export function sanitizeUrl(url) {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  try {
    // If it's a valid data URL for image/audio/video
    if (/^data:(image|audio|video)\/[a-zA-Z0-9.+_-]+;base64,/.test(trimmed)) {
      return trimmed;
    }
    // If it's a blob URL
    if (trimmed.startsWith("blob:")) {
      return trimmed;
    }
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.href;
    }
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Formats a Firebase Timestamp, Date object, or numeric milliseconds to locale date string
 * @param {any} timestamp
 * @returns {string}
 */
export function formatDate(timestamp) {
  if (!timestamp) return "-";
  if (typeof timestamp.toDate === "function") {
    return timestamp.toDate().toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric"
    });
  }
  if (timestamp instanceof Date) {
    return timestamp.toLocaleDateString("en-IN");
  }
  if (typeof timestamp === "number") {
    return new Date(timestamp).toLocaleDateString("en-IN");
  }
  return "-";
}

/**
 * Calculates days pending since creation
 * @param {any} timestamp
 * @returns {number}
 */
export function getDaysPending(timestamp) {
  if (!timestamp) return 0;
  const millis = typeof timestamp.toMillis === "function"
    ? timestamp.toMillis()
    : (timestamp instanceof Date ? timestamp.getTime() : Number(timestamp) || Date.now());
  const diff = Date.now() - millis;
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

/**
 * Formats relative time (e.g., "2 hours ago", "3 days ago")
 * @param {any} timestamp
 * @returns {string}
 */
export function formatRelativeTime(timestamp) {
  if (!timestamp) return "-";
  const millis = typeof timestamp.toMillis === "function"
    ? timestamp.toMillis()
    : (timestamp instanceof Date ? timestamp.getTime() : Number(timestamp) || Date.now());
  const diffSec = Math.floor((Date.now() - millis) / 1000);

  if (diffSec < 60) return "Just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  const days = Math.floor(diffSec / 86400);
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

/**
 * Default severity map for baseline fallback
 */
export const severityMap = {
  "Pothole": 3,
  "Open Manhole": 5,
  "Garbage Overflow": 2,
  "Broken Streetlight": 2,
  "Water Leakage": 3,
  "Sewage": 4,
  "Air/Noise Pollution": 2,
  "Other": 1
};

import { calculateProximityBonus } from "./geo.js";

/**
 * Calculate Priority Score
 * Priority = (Reports * 2) + (Days * 3) + Severity + ProximityBonus
 * @param {object} complaint
 * @returns {number}
 */
export function calculatePriority(complaint) {
  if (!complaint) return 0;
  const reports = Number(complaint.reports) || 1;
  const days = getDaysPending(complaint.createdAt);
  const severity = Number(complaint.aiTriage?.severity) || severityMap[complaint.issueType] || 2;
  const proxBonus = complaint.location?.lat ? calculateProximityBonus(complaint.location.lat, complaint.location.lng).bonus : 0;
  return (reports * 2) + (days * 3) + severity + proxBonus;
}

/**
 * In-app Toast notification
 * @param {string} message
 * @param {'success'|'error'|'info'|'warning'} type
 */
export function showToast(message, type = "info") {
  let toastContainer = document.getElementById("toastContainer");
  if (!toastContainer) {
    toastContainer = document.createElement("div");
    toastContainer.id = "toastContainer";
    toastContainer.className = "toast-container";
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;

  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("toast-show");
  }, 10);

  setTimeout(() => {
    toast.classList.remove("toast-show");
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
