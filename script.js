/**
 * script.js (Legacy Aggregator)
 * CivicWatch has transitioned to modular ES modules:
 * - report.js: Citizen complaint submission & multimodal capture
 * - issues.js: Public complaints grid, SLA tracking & RTI escalation
 * - admin.js: Municipal officer control panel & proof-of-fix verification
 * - dashboard.js: Ward scorecard v2 & impact counters
 * - ai.js: Gemini multimodal analysis & verification
 * - geo.js: GPS, Mumbai ward detection & Haversine clustering
 * - utils.js: XSS sanitization, formatters & toasts
 */

export * from "./utils.js";
export * from "./geo.js";
export * from "./ai.js";
export * from "./dashboard.js";
export * from "./issues.js";
export * from "./admin.js";
export * from "./report.js";
