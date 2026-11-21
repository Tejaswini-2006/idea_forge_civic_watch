/**
 * admin.js
 * Officer Control Panel: Grievance management, SLA monitoring, status transitions,
 * audit history logging, and Gemini-powered Proof-of-Fix verification.
 */

import { db, auth } from "./firebase.js";
import {
  collection,
  getDocs,
  doc,
  updateDoc,
  getDoc,
  Timestamp,
  arrayUnion
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { escapeHTML, sanitizeUrl, formatDate, getDaysPending, showToast } from "./utils.js";
import { verifyProofOfFix } from "./ai.js";
import { getDemoSeedComplaints } from "./seed.js";

let adminComplaints = [];

/**
 * Loads complaints into the Officer Control Panel table
 */
export async function loadAdminTable() {
  const tbody = document.getElementById("adminTableBody");
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;">Fetching municipal complaint records...</td></tr>`;

  try {
    const snap = await Promise.race([
      getDocs(collection(db, "Complaints")),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Firestore query timeout")), 1200))
    ]);
    adminComplaints = [];

    snap.forEach((d) => {
      const data = d.data();
      adminComplaints.push({
        id: d.id,
        ...data,
        daysPending: getDaysPending(data.createdAt)
      });
    });

    if (adminComplaints.length === 0) {
      adminComplaints = getDemoSeedComplaints();
    }

    // Sort: open/overdue issues first
    adminComplaints.sort((a, b) => {
      if (a.status === "Resolved" && b.status !== "Resolved") return 1;
      if (a.status !== "Resolved" && b.status === "Resolved") return -1;
      return (b.aiTriage?.severity || 3) - (a.aiTriage?.severity || 3);
    });

    renderAdminRows(adminComplaints);

  } catch (err) {
    console.warn("Firestore live query note for admin, using demo items:", err);
    adminComplaints = getDemoSeedComplaints();
    adminComplaints.sort((a, b) => {
      if (a.status === "Resolved" && b.status !== "Resolved") return 1;
      if (a.status !== "Resolved" && b.status === "Resolved") return -1;
      return (b.aiTriage?.severity || 3) - (a.aiTriage?.severity || 3);
    });
    renderAdminRows(adminComplaints);
  }
}

/**
 * Renders table rows safely
 */
function renderAdminRows(complaints) {
  const tbody = document.getElementById("adminTableBody");
  if (!tbody) return;

  tbody.innerHTML = "";

  if (complaints.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;">No complaint records in database.</td></tr>`;
    return;
  }

  complaints.forEach((item) => {
    const tr = document.createElement("tr");

    // 1. Image Thumbnail
    const tdImg = document.createElement("td");
    const imgUrl = sanitizeUrl(item.imageUrl || item.mediaUrls?.photoUrl);
    if (imgUrl) {
      const img = document.createElement("img");
      img.src = imgUrl;
      img.className = "thumb-img";
      img.alt = escapeHTML(item.issueType);
      img.onclick = () => window.open(imgUrl, "_blank");
      tdImg.appendChild(img);
    } else {
      const noImg = document.createElement("span");
      noImg.className = "text-muted";
      noImg.textContent = "No image";
      tdImg.appendChild(noImg);
    }
    tr.appendChild(tdImg);

    // 2. Issue Type & Severity
    const tdIssue = document.createElement("td");
    tdIssue.innerHTML = `
      <strong>${escapeHTML(item.issueType)}</strong>
      <div class="table-sub-meta">
        ${item.aiTriage ? `<span class="badge-mini">⚡ Sev: ${item.aiTriage.severity}/10</span>` : ''}
        ${item.reports > 1 ? `<span class="badge-mini">👥 ${item.reports} reports</span>` : ''}
      </div>
    `;
    tr.appendChild(tdIssue);

    // 3. Ward & Department
    const tdWard = document.createElement("td");
    tdWard.innerHTML = `
      <div>${escapeHTML(item.ward || "Ward A")}</div>
      <small class="text-muted">${escapeHTML(item.department || item.aiTriage?.suggestedAuthority || "BMC Civil")}</small>
    `;
    tr.appendChild(tdWard);

    // 4. Date & Age
    const tdDate = document.createElement("td");
    tdDate.innerHTML = `
      <div>${formatDate(item.createdAt)}</div>
      <small class="text-muted">${item.daysPending}d pending</small>
    `;
    tr.appendChild(tdDate);

    // 5. Current Status Badge
    const tdStatus = document.createElement("td");
    const statusClass = (item.status || "reported").toLowerCase().replace(/\s+/g, "");
    tdStatus.innerHTML = `
      <span class="badge status-${statusClass}">
        ${escapeHTML(item.status || "Reported")}
      </span>
      ${item.isOverdue ? '<div class="overdue-tag">⚠️ Overdue</div>' : ''}
    `;
    tr.appendChild(tdStatus);

    // 6. Action / Update Workflow
    const tdAction = document.createElement("td");
    const select = document.createElement("select");
    select.className = "status-dropdown";
    ["Reported", "Acknowledged", "In Progress", "Resolved"].forEach((st) => {
      const opt = document.createElement("option");
      opt.value = st;
      opt.textContent = st;
      if (item.status === st) opt.selected = true;
      select.appendChild(opt);
    });

    select.addEventListener("change", async (e) => {
      const newStatus = e.target.value;
      if (newStatus === "Resolved") {
        // Enforce AI Proof-of-Fix verification modal
        promptProofOfFixModal(item, select);
      } else {
        await executeStatusUpdate(item.id, newStatus, "Status transitioned by municipal officer.");
      }
    });

    tdAction.appendChild(select);
    tr.appendChild(tdAction);

    tbody.appendChild(tr);
  });
}

/**
 * Updates status in Firestore and appends an audit history entry
 */
export async function executeStatusUpdate(issueId, newStatus, comment = "", proofData = null) {
  try {
    const officerEmail = auth.currentUser?.email || "Municipal Officer";
    const updatePayload = {
      status: newStatus,
      updatedAt: Timestamp.now(),
      history: arrayUnion({
        status: newStatus,
        timestamp: new Date().toISOString(),
        officer: officerEmail,
        comment: comment || `Status updated to ${newStatus}`
      })
    };

    if (proofData) {
      updatePayload.proofOfFix = proofData;
      if (proofData.resolvedImageUrl) {
        updatePayload["mediaUrls.resolvedPhotoUrl"] = proofData.resolvedImageUrl;
      }
    }

    await updateDoc(doc(db, "Complaints", issueId), updatePayload);
    showToast(`Grievance updated to "${newStatus}"`, "success");
    loadAdminTable();

  } catch (err) {
    console.error("Error updating status:", err);
    showToast("Failed to update status. Please try again.", "error");
  }
}

/**
 * Proof-of-Fix verification modal for closing out resolved issues
 */
function promptProofOfFixModal(item, selectElement) {
  let modal = document.getElementById("proofOfFixModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "proofOfFixModal";
    modal.className = "modal-overlay";
    document.body.appendChild(modal);
  }

  const beforeUrl = sanitizeUrl(item.imageUrl || item.mediaUrls?.photoUrl);

  modal.innerHTML = `
    <div class="modal-dialog">
      <div class="modal-header">
        <span class="badge status-inprogress">Mandatory Resolution Audit</span>
        <h2>AI Proof-of-Fix Verification</h2>
        <p class="modal-sub">Brihanmumbai Municipal Corporation Accountability Standard</p>
      </div>

      <div class="modal-body">
        <p class="modal-instruction">
          To mark <strong>${escapeHTML(item.issueType)}</strong> as Resolved, upload the official "After" completion photo.
          The Multimodal Gemini Engine will verify that the defect has been remediated at this specific site.
        </p>

        <div class="proof-compare-box">
          <div class="compare-side">
            <h4>Original Before Photo</h4>
            ${beforeUrl ? `<img src="${beforeUrl}" class="proof-img" alt="Before">` : `<p class="text-muted">No before photo</p>`}
          </div>
          <div class="compare-side">
            <h4>After Completion Photo</h4>
            <div id="afterPreviewContainer" class="after-preview-empty">
              <span>Upload repair photo below</span>
            </div>
          </div>
        </div>

        <div class="form-group" style="margin-top:1.5rem;">
          <label>Upload Work Completion Photo <span>*</span></label>
          <input type="file" id="afterImageInput" accept="image/*" class="file-input">
        </div>

        <div class="form-group">
          <label>Resolution Officer Notes</label>
          <input type="text" id="resolutionNotes" class="input-text" placeholder="e.g. Asphalting completed by Ward Road Squad #4">
        </div>

        <div id="proofAiFeedback" style="display:none; margin-top:1rem;"></div>

        <div class="modal-actions" style="margin-top:1.5rem;">
          <button id="btnVerifyAndResolve" class="btn btn-primary" disabled>
            🔍 Verify with Gemini & Resolve
          </button>
          <button id="btnCancelProof" class="btn btn-secondary">
            Cancel
          </button>
        </div>
      </div>
    </div>
  `;

  const fileInput = document.getElementById("afterImageInput");
  const verifyBtn = document.getElementById("btnVerifyAndResolve");
  const previewContainer = document.getElementById("afterPreviewContainer");
  const feedbackContainer = document.getElementById("proofAiFeedback");
  let selectedFile = null;

  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) {
      selectedFile = file;
      const reader = new FileReader();
      reader.onload = (re) => {
        previewContainer.innerHTML = `<img src="${re.target.result}" class="proof-img" alt="After Repair">`;
        verifyBtn.disabled = false;
      };
      reader.readAsDataURL(file);
    }
  });

  verifyBtn.addEventListener("click", async () => {
    if (!selectedFile) return;

    verifyBtn.disabled = true;
    verifyBtn.textContent = "Analyzing Before & After Imagery...";
    feedbackContainer.style.display = "block";
    feedbackContainer.innerHTML = `<div class="loading-spinner">Gemini Vision comparing sites and assessing repair validity...</div>`;

    try {
      const result = await verifyProofOfFix({
        beforeImage: beforeUrl,
        afterImage: selectedFile,
        issueType: item.issueType
      });

      if (result.fixed) {
        feedbackContainer.innerHTML = `
          <div class="alert alert-success">
            <strong>✅ AI Verified Resolution!</strong>
            <p>${escapeHTML(result.reason)} (Confidence: ${Math.round(result.confidence * 100)}%)</p>
          </div>
        `;

        const notes = document.getElementById("resolutionNotes").value.trim();
        // Convert after image to dataURL for demo storage
        const reader = new FileReader();
        reader.onloadend = async () => {
          await executeStatusUpdate(item.id, "Resolved", notes || "Work verified and resolved via AI Proof-of-Fix.", {
            verified: true,
            confidence: result.confidence,
            verificationReason: result.reason,
            resolvedImageUrl: reader.result,
            verifiedAt: Timestamp.now(),
            verifiedByOfficer: auth.currentUser?.email || "BMC Officer"
          });
          modal.remove();
        };
        reader.readAsDataURL(selectedFile);

      } else {
        // Disputed or unverified
        feedbackContainer.innerHTML = `
          <div class="alert alert-danger">
            <strong>❌ Fix Disputed by AI Inspector</strong>
            <p>${escapeHTML(result.reason)}</p>
            <small>Status set to 'Fix Disputed - Needs Review' to protect public trust.</small>
          </div>
        `;
        await executeStatusUpdate(item.id, "Fix Disputed", `AI Inspection Warning: ${result.reason}`);
        setTimeout(() => modal.remove(), 2500);
      }

    } catch (err) {
      console.error("Proof verification failed:", err);
      // Fallback: allow manual officer sign-off if offline
      await executeStatusUpdate(item.id, "Resolved", "Officer manual resolution sign-off.");
      modal.remove();
    }
  });

  document.getElementById("btnCancelProof").addEventListener("click", () => {
    // Reset select element back to previous status
    selectElement.value = item.status;
    modal.remove();
  });
}

// Automatically load on admin page
if (document.getElementById("adminTableBody")) {
  loadAdminTable().then(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("triggerProofOfFix") === "true") {
      setTimeout(() => {
        if (adminComplaints.length > 0) {
          const firstSelect = document.querySelector(".status-dropdown");
          promptProofOfFixModal(adminComplaints[0], firstSelect || document.createElement("select"));
        }
      }, 800);
    }
  });
}
