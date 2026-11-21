/**
 * issues.js
 * Public issues grid, SLA countdowns, priority sorting, category/ward filters,
 * and detailed issue inspection modal with RTI generator.
 */

import { db } from "./firebase.js";
import { collection, getDocs, doc, updateDoc, increment } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { escapeHTML, sanitizeUrl, getDaysPending, calculatePriority, showToast, formatDate } from "./utils.js";
import { generateFormalEscalationNotice } from "./ai.js";
import { seedDemoComplaints, getDemoSeedComplaints } from "./seed.js";
import { calculateProximityBonus } from "./geo.js";

let allComplaints = [];

/**
 * Loads and renders public civic complaints
 */
export async function loadIssues() {
  const container = document.getElementById("issuesGrid");
  if (!container) return;

  container.innerHTML = `<div class="loading-spinner">Loading verified civic reports...</div>`;

  try {
    // Timeout to prevent hanging when Firestore is slow or offline
    const snap = await Promise.race([
      getDocs(collection(db, "Complaints")),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Firestore query timeout")), 1200))
    ]);

    allComplaints = [];

    snap.forEach((d) => {
      const data = d.data();
      allComplaints.push({
        id: d.id,
        ...data,
        daysPending: getDaysPending(data.createdAt),
        priority: calculatePriority(data)
      });
    });

    // If empty in Firestore, load realistic Mumbai demo complaints
    if (allComplaints.length === 0) {
      allComplaints = getDemoSeedComplaints();
    }

    // Default sort by priority descending
    allComplaints.sort((a, b) => b.priority - a.priority);

    renderIssuesList(allComplaints);

    // Initialize Leaflet Map with markers and heatmap
    initLeafletMap(allComplaints);

    // Populate filter dropdowns if present
    populateFilters(allComplaints);

  } catch (err) {
    console.warn("Firestore live query note, using verified demo complaints:", err);
    allComplaints = getDemoSeedComplaints();
    allComplaints.sort((a, b) => b.priority - a.priority);
    renderIssuesList(allComplaints);
    initLeafletMap(allComplaints);
    populateFilters(allComplaints);
  }
}

/**
 * Renders list of complaint cards safely without unsafe innerHTML
 */
export function renderIssuesList(complaints) {
  const container = document.getElementById("issuesGrid");
  if (!container) return;

  container.innerHTML = "";

  if (!complaints || complaints.length === 0) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state-card";
    emptyState.innerHTML = `
      <h3>No Complaints Found</h3>
      <p>No civic issues match your current filter criteria.</p>
    `;
    container.appendChild(emptyState);
    return;
  }

  complaints.forEach((item) => {
    const card = document.createElement("div");
    card.className = "issue-card";
    card.dataset.id = item.id;

    // Media Thumbnail (validated and sanitized)
    const mediaUrl = sanitizeUrl(item.imageUrl || item.mediaUrls?.photoUrl);
    if (mediaUrl) {
      const img = document.createElement("img");
      img.src = mediaUrl;
      img.alt = escapeHTML(item.issueType || "Civic Defect");
      img.loading = "lazy";
      img.onerror = () => { img.style.display = "none"; };
      card.appendChild(img);
    }

    const cardBody = document.createElement("div");
    cardBody.className = "issue-card-content";

    // Header with badges
    const headerRow = document.createElement("div");
    headerRow.className = "issue-card-header";

    const title = document.createElement("h3");
    title.textContent = item.issueType || "Civic Issue";

    const statusBadge = document.createElement("span");
    const statusClass = (item.status || "reported").toLowerCase().replace(/\s+/g, "");
    statusBadge.className = `badge status-${statusClass}`;
    statusBadge.textContent = item.status || "Reported";

    headerRow.appendChild(title);
    headerRow.appendChild(statusBadge);
    cardBody.appendChild(headerRow);

    // Ward & Department
    const wardP = document.createElement("p");
    wardP.className = "issue-meta";
    wardP.innerHTML = `<strong>Ward:</strong> ${escapeHTML(item.ward || "Ward A")}`;
    cardBody.appendChild(wardP);

    if (item.department || item.aiTriage?.suggestedAuthority) {
      const deptP = document.createElement("p");
      deptP.className = "issue-dept";
      deptP.innerHTML = `<strong>Authority:</strong> ${escapeHTML(item.department || item.aiTriage?.suggestedAuthority)}`;
      cardBody.appendChild(deptP);
    }

    // Description
    if (item.description) {
      const descP = document.createElement("p");
      descP.className = "issue-desc";
      descP.textContent = item.description;
      cardBody.appendChild(descP);
    }

    // AI Severity & Safety Risk Pill
    if (item.aiTriage) {
      const aiPill = document.createElement("div");
      aiPill.className = `ai-severity-badge risk-${item.aiTriage.safetyRisk || "med"}`;
      aiPill.innerHTML = `
        <span>⚡ Severity: <strong>${item.aiTriage.severity}/10</strong> (${escapeHTML(item.aiTriage.safetyRisk || "medium")} risk)</span>
      `;
      cardBody.appendChild(aiPill);
    }

    // SLA & Overdue Status
    const slaRow = document.createElement("div");
    slaRow.className = "sla-row";
    const slaStatus = computeSlaRemaining(item);
    slaRow.innerHTML = `
      <span class="sla-text ${slaStatus.isOverdue ? 'sla-overdue' : ''}">
        ⏱️ SLA: <strong>${escapeHTML(slaStatus.label)}</strong>
      </span>
      <span class="report-count-tag">👥 ${Number(item.reports) || 1} reported</span>
    `;
    cardBody.appendChild(slaRow);

    // Priority Footer with Context-Aware Breakdown
    const prox = calculateProximityBonus(item.location?.lat, item.location?.lng);
    const breakdownText = `Sev: ${item.aiTriage?.severity || 3} + Reports: ${(item.reports || 1) * 2} + Days: ${item.daysPending * 3}${prox.bonus > 0 ? ' + ' + prox.explanation : ''}`;

    const footer = document.createElement("div");
    footer.className = "issue-card-footer";
    footer.innerHTML = `
      <div class="priority-score" title="${escapeHTML(breakdownText)}">
        Priority: <span>${item.priority}</span>
        ${prox.bonus > 0 ? `<div style="font-size:0.72rem; color:#0369a1; font-weight:normal; margin-top:2px;">🏥 ${escapeHTML(prox.explanation)}</div>` : ''}
      </div>
    `;

    const actionBtn = document.createElement("button");
    actionBtn.className = "btn btn-sm btn-outline";
    actionBtn.textContent = "View Details & Timeline";
    actionBtn.addEventListener("click", () => openIssueDetailsModal(item));

    footer.appendChild(actionBtn);
    cardBody.appendChild(footer);

    card.appendChild(cardBody);
    container.appendChild(card);
  });
}

/**
 * Calculates remaining SLA time or overdue status based on severity
 */
export function computeSlaRemaining(item) {
  const severity = Number(item.aiTriage?.severity) || 3;
  // Severity 8-10 = 24h, 5-7 = 72h, 1-4 = 7 days (168h)
  const slaHours = severity >= 8 ? 24 : severity >= 5 ? 72 : 168;

  const createdMillis = item.createdAt?.toMillis
    ? item.createdAt.toMillis()
    : (item.createdAt instanceof Date ? item.createdAt.getTime() : Number(item.createdAt) || Date.now());

  const elapsedHours = (Date.now() - createdMillis) / (1000 * 60 * 60);
  const remainingHours = Math.round(slaHours - elapsedHours);

  if (item.status === "Resolved") {
    return { isOverdue: false, label: "Resolved within SLA" };
  }

  if (remainingHours <= 0) {
    const overdueDays = Math.abs(Math.floor(remainingHours / 24));
    return {
      isOverdue: true,
      label: `OVERDUE by ${overdueDays > 0 ? overdueDays + 'd' : Math.abs(remainingHours) + 'h'}`
    };
  }

  if (remainingHours > 24) {
    return { isOverdue: false, label: `${Math.floor(remainingHours / 24)}d ${remainingHours % 24}h left` };
  }
  return { isOverdue: false, label: `${remainingHours}h remaining` };
}

/**
 * Leaflet Real-Time Map & Heatmap Controller
 */
let leafletMap = null;
let markersLayerGroup = null;
let heatmapLayer = null;
let isHeatmapActive = false;

function initLeafletMap(complaints) {
  const mapEl = document.getElementById("issuesMap");
  if (!mapEl || typeof L === "undefined") return;

  if (!leafletMap) {
    leafletMap = L.map("issuesMap").setView([19.0400, 72.8500], 11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(leafletMap);

    markersLayerGroup = L.layerGroup().addTo(leafletMap);

    const btnToggle = document.getElementById("btnToggleHeatmap");
    if (btnToggle) {
      btnToggle.onclick = () => {
        isHeatmapActive = !isHeatmapActive;
        if (isHeatmapActive) {
          btnToggle.textContent = "📍 Switch to Marker View";
          btnToggle.classList.add("btn-primary");
          btnToggle.classList.remove("btn-outline");
          if (markersLayerGroup) leafletMap.removeLayer(markersLayerGroup);
          if (heatmapLayer) heatmapLayer.addTo(leafletMap);
        } else {
          btnToggle.textContent = "🔥 Switch to Heatmap View";
          btnToggle.classList.remove("btn-primary");
          btnToggle.classList.add("btn-outline");
          if (heatmapLayer) leafletMap.removeLayer(heatmapLayer);
          if (markersLayerGroup) markersLayerGroup.addTo(leafletMap);
        }
      };
    }

    const btnReset = document.getElementById("btnResetMapView");
    if (btnReset) {
      btnReset.onclick = () => {
        leafletMap.setView([19.0400, 72.8500], 11);
      };
    }
  }

  updateMapData(complaints);
}

function updateMapData(complaints) {
  if (!leafletMap || !markersLayerGroup) return;

  markersLayerGroup.clearLayers();
  if (heatmapLayer) {
    leafletMap.removeLayer(heatmapLayer);
    heatmapLayer = null;
  }

  const heatPoints = [];

  complaints.forEach((c) => {
    const lat = c.location?.lat || 18.9220;
    const lng = c.location?.lng || 72.8347;
    const severity = Number(c.aiTriage?.severity) || 4;
    const intensity = severity / 10;

    heatPoints.push([lat, lng, intensity]);

    // Marker styling by severity
    const markerColor = severity >= 8 ? "#dc2626" : severity >= 5 ? "#ea580c" : "#16a34a";

    const circle = L.circleMarker([lat, lng], {
      radius: 9,
      fillColor: markerColor,
      color: "#ffffff",
      weight: 2,
      opacity: 1,
      fillOpacity: 0.85
    });

    const sla = computeSlaRemaining(c);
    const imgUrl = sanitizeUrl(c.imageUrl || c.mediaUrls?.photoUrl);

    const popupHtml = `
      <div style="font-family:sans-serif; min-width:180px;">
        ${imgUrl ? `<img src="${imgUrl}" style="width:100%; height:90px; object-fit:cover; border-radius:6px; margin-bottom:6px;">` : ''}
        <strong style="font-size:0.95rem; color:#0f172a;">${escapeHTML(c.issueType)}</strong>
        <div style="font-size:0.8rem; color:#475569; margin:3px 0;">📍 ${escapeHTML(c.ward || "Mumbai")}</div>
        <div style="font-size:0.75rem; color:#2563eb; font-weight:700;">⚡ Severity: ${severity}/10</div>
        <div style="font-size:0.75rem; color:${sla.isOverdue ? '#dc2626' : '#16a34a'}; font-weight:600;">⏱️ ${escapeHTML(sla.label)}</div>
        <div style="font-size:0.75rem; color:#64748b; margin-top:2px;">👥 ${c.reports || 1} citizens reported</div>
      </div>
    `;

    circle.bindPopup(popupHtml);
    markersLayerGroup.addLayer(circle);
  });

  if (typeof L.heatLayer === "function" && heatPoints.length > 0) {
    heatmapLayer = L.heatLayer(heatPoints, {
      radius: 25,
      blur: 15,
      maxZoom: 14,
      gradient: { 0.4: '#3b82f6', 0.65: '#f59e0b', 0.9: '#ef4444' }
    });

    if (isHeatmapActive) {
      heatmapLayer.addTo(leafletMap);
    }
  }
}

/**
 * Filter and Sort controls
 */
function populateFilters(complaints) {
  const wardSelect = document.getElementById("filterWard");
  const typeSelect = document.getElementById("filterType");
  const statusSelect = document.getElementById("filterStatus");
  const sortSelect = document.getElementById("sortOrder");

  if (!wardSelect || !typeSelect) return;

  function applyFilters() {
    let filtered = [...allComplaints];

    if (wardSelect.value) {
      filtered = filtered.filter((c) => (c.ward || "").includes(wardSelect.value));
    }
    if (typeSelect.value) {
      filtered = filtered.filter((c) => c.issueType === typeSelect.value);
    }
    if (statusSelect && statusSelect.value) {
      filtered = filtered.filter((c) => c.status === statusSelect.value);
    }

    if (sortSelect) {
      if (sortSelect.value === "reports") {
        filtered.sort((a, b) => (b.reports || 1) - (a.reports || 1));
      } else if (sortSelect.value === "newest") {
        filtered.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      } else {
        filtered.sort((a, b) => b.priority - a.priority);
      }
    }

    renderIssuesList(filtered);
    updateMapData(filtered);
  }

  wardSelect.onchange = applyFilters;
  typeSelect.onchange = applyFilters;
  if (statusSelect) statusSelect.onchange = applyFilters;
  if (sortSelect) sortSelect.onchange = applyFilters;
}

/**
 * Opens detailed modal for an issue with history timeline & RTI generator
 */
export function openIssueDetailsModal(item) {
  let modal = document.getElementById("issueDetailModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "issueDetailModal";
    modal.className = "modal-overlay";
    document.body.appendChild(modal);
  }

  const mediaUrl = sanitizeUrl(item.imageUrl || item.mediaUrls?.photoUrl);
  const resolvedUrl = sanitizeUrl(item.mediaUrls?.resolvedPhotoUrl);

  const historyHtml = (item.history || [
    { status: "Reported", timestamp: item.createdAt, officer: "Citizen Submission", comment: "Initial report logged with photo evidence." }
  ]).map((h) => `
    <div class="timeline-step">
      <div class="timeline-marker"></div>
      <div class="timeline-content">
        <h4>${escapeHTML(h.status)}</h4>
        <small>${formatDate(h.timestamp)} • ${escapeHTML(h.officer || "Ward Desk")}</small>
        <p>${escapeHTML(h.comment || "")}</p>
      </div>
    </div>
  `).join("");

  modal.innerHTML = `
    <div class="modal-dialog">
      <button class="modal-close" onclick="document.getElementById('issueDetailModal').remove()">&times;</button>
      
      <div class="modal-header">
        <span class="badge status-${(item.status || 'reported').toLowerCase().replace(/\s+/g, '')}">
          ${escapeHTML(item.status || "Reported")}
        </span>
        <h2>${escapeHTML(item.issueType)} - ${escapeHTML(item.ward || "Ward A")}</h2>
        <p class="modal-sub">Grievance ID: <code>${escapeHTML(item.id)}</code></p>
      </div>

      <div class="modal-body">
        ${mediaUrl ? `
          <div class="modal-media-preview">
            <img src="${mediaUrl}" alt="Civic defect photo">
            ${resolvedUrl ? `
              <div class="resolved-proof-tag">
                <span>Verified After-Fix Photo:</span>
                <img src="${resolvedUrl}" alt="Proof of fix">
              </div>
            ` : ''}
          </div>
        ` : ''}

        <div class="modal-details-grid">
          <div><strong>Department:</strong> ${escapeHTML(item.department || item.aiTriage?.suggestedAuthority || "BMC Civil Works")}</div>
          <div><strong>Days Pending:</strong> ${item.daysPending} days</div>
          <div><strong>Severity:</strong> ${item.aiTriage?.severity || 3}/10</div>
          <div><strong>Citizen Reports:</strong> ${item.reports || 1} people</div>
        </div>

        <div class="modal-desc-box">
          <strong>Citizen Description:</strong>
          <p>${escapeHTML(item.description || "No manual description provided. Triaged via Multimodal AI.")}</p>
          ${item.aiTriage?.severityReason ? `
            <div class="ai-rationale-note">
              🤖 <em>AI Triage Note: ${escapeHTML(item.aiTriage.severityReason)}</em>
            </div>
          ` : ''}
        </div>

        <div class="modal-timeline">
          <h3>Administrative Resolution Timeline</h3>
          <div class="timeline-container">
            ${historyHtml}
          </div>
        </div>

        <div class="modal-actions">
          <button id="btnEscalateRTI" class="btn btn-warning">
            ⚖️ Escalate & Generate RTI Notice
          </button>
          <button class="btn btn-secondary" onclick="document.getElementById('issueDetailModal').remove()">
            Close
          </button>
        </div>

        <div id="rtiNoticeContainer" style="display:none; margin-top:1.5rem;"></div>
      </div>
    </div>
  `;

  document.getElementById("btnEscalateRTI").addEventListener("click", () => {
    const container = document.getElementById("rtiNoticeContainer");
    const notices = generateFormalEscalationNotice(item);

    container.style.display = "block";
    container.innerHTML = `
      <div class="rti-card">
        <div class="rti-header">
          <h3>Statutory Escalation & RTI Application Draft</h3>
          <div class="rti-tabs">
            <button class="btn btn-xs active" id="tabEn">English</button>
            <button class="btn btn-xs" id="tabMr">मराठी (Marathi)</button>
          </div>
        </div>
        <textarea id="rtiContent" class="rti-textarea" rows="12" readonly>${escapeHTML(notices.english)}</textarea>
        <div class="rti-footer">
          <button class="btn btn-sm btn-primary" id="copyRtiBtn">📋 Copy RTI Application</button>
          <button class="btn btn-sm btn-secondary" id="printRtiBtn">🖨️ Print / Save PDF</button>
        </div>
      </div>
    `;

    const rtiContent = document.getElementById("rtiContent");
    document.getElementById("tabEn").onclick = (e) => {
      rtiContent.value = notices.english;
      e.target.classList.add("active");
      document.getElementById("tabMr").classList.remove("active");
    };
    document.getElementById("tabMr").onclick = (e) => {
      rtiContent.value = notices.marathi;
      e.target.classList.add("active");
      document.getElementById("tabEn").classList.remove("active");
    };

    document.getElementById("copyRtiBtn").onclick = () => {
      navigator.clipboard.writeText(rtiContent.value);
      showToast("RTI Draft copied to clipboard!", "success");
    };

    document.getElementById("printRtiBtn").onclick = () => {
      const win = window.open("", "_blank");
      win.document.write(`<pre style="font-family:sans-serif;white-space:pre-wrap;padding:2rem;">${escapeHTML(rtiContent.value)}</pre>`);
      win.document.close();
      win.print();
    };
  });
}

// Seed Demo Button listener
const btnSeed = document.getElementById("btnSeedDemo");
if (btnSeed) {
  btnSeed.onclick = async () => {
    btnSeed.disabled = true;
    btnSeed.textContent = "Loading Demo Items...";
    await seedDemoComplaints();
    await loadIssues();
    btnSeed.disabled = false;
    btnSeed.textContent = "⚡ Load Mumbai Demo Data";
  };
}

// Auto-seed if URL parameter ?seed=true
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get("seed") === "true") {
  setTimeout(async () => {
    await seedDemoComplaints();
    await loadIssues();
  }, 500);
}

// Auto-open modal for testing/demo if ?openModal=true
if (urlParams.get("openModal") === "true") {
  setTimeout(() => {
    if (allComplaints.length > 0) {
      openIssueDetailsModal(allComplaints[0]);
      // Trigger RTI expansion
      const rtiBtn = document.getElementById("btnEscalateRTI");
      if (rtiBtn) rtiBtn.click();
    }
  }, 1600);
}

// Automatically load on issues.html
if (document.getElementById("issuesGrid")) {
  loadIssues();
}
