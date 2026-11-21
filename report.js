/**
 * report.js
 * Citizen complaint reporting controller with Multimodal AI Triage,
 * GPS/Ward detection, duplicate clustering, preset evaluators, and interactive review card.
 */

import { db, storage } from "./firebase.js";
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  doc,
  updateDoc,
  increment,
  arrayUnion,
  Timestamp,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { escapeHTML, sanitizeUrl, showToast, severityMap } from "./utils.js";
import { triageCivicReport, VALID_ISSUE_TYPES, DEPARTMENT_MAP, getGeminiApiKey } from "./ai.js";
import { getCurrentCoordinates, detectNearestWard, calculateDistanceMeters, MUMBAI_WARDS, encodeGeohash } from "./geo.js";

// State
let capturedImageBlob = null;
let capturedAudioBlob = null;
let recordedMediaRecorder = null;
let audioChunks = [];
let detectedLocation = null;
let currentAiTriage = null;

// DOM Elements
const form = document.getElementById("reportForm");
const message = document.getElementById("message");
const issueTypeSelect = document.getElementById("issueType");
const wardSelect = document.getElementById("ward");
const descInput = document.getElementById("description");
const imageInput = document.getElementById("imageFileInput");
const imageUrlInput = document.getElementById("imageUrl");
const btnLocate = document.getElementById("btnLocateGps");
const gpsStatus = document.getElementById("gpsStatusText");
const submitBtn = document.getElementById("submitReportBtn");
const imagePreview = document.getElementById("imagePreviewThumbnail");

// Initialize Ward Dropdown with Mumbai Wards
function initWardDropdown() {
  if (!wardSelect) return;
  wardSelect.innerHTML = `<option value="">Select Ward</option>`;
  MUMBAI_WARDS.forEach((w) => {
    const opt = document.createElement("option");
    opt.value = w.id;
    opt.textContent = w.name;
    wardSelect.appendChild(opt);
  });
}
initWardDropdown();

/**
 * Handle GPS Geolocation
 */
if (btnLocate) {
  btnLocate.addEventListener("click", async () => {
    btnLocate.disabled = true;
    gpsStatus.textContent = "Acquiring high-accuracy GPS coordinates...";

    try {
      const coords = await getCurrentCoordinates();
      detectedLocation = coords;
      const nearest = detectNearestWard(coords.lat, coords.lng);

      if (wardSelect) wardSelect.value = nearest.id;

      gpsStatus.innerHTML = `📍 Detected: <strong>${escapeHTML(nearest.name)}</strong> (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)})`;
      gpsStatus.style.color = "#16a34a";
      showToast(`Location locked: ${nearest.id}`, "success");

    } catch (err) {
      console.warn("GPS error, defaulting to Ward A:", err);
      detectedLocation = { lat: 18.9220, lng: 72.8347 };
      if (wardSelect) wardSelect.value = "Ward A";
      gpsStatus.textContent = "📍 Locked to Ward A (Colaba/Fort default)";
      gpsStatus.style.color = "#475569";
    } finally {
      btnLocate.disabled = false;
    }
  });
}

/**
 * Leaflet Interactive Map Pin-Picker Fallback
 */
let pickerMap = null;
let pickerMarker = null;
const btnToggleMap = document.getElementById("btnToggleMapPicker");
const pinMapContainer = document.getElementById("pinMapPicker");

if (btnToggleMap && pinMapContainer) {
  btnToggleMap.addEventListener("click", () => {
    if (pinMapContainer.style.display === "none" || !pinMapContainer.style.display) {
      pinMapContainer.style.display = "block";
      btnToggleMap.textContent = "🗺️ Hide Map";

      const initLat = detectedLocation ? detectedLocation.lat : 18.9220;
      const initLng = detectedLocation ? detectedLocation.lng : 72.8347;

      if (!pickerMap && typeof L !== "undefined") {
        pickerMap = L.map("pinMapPicker").setView([initLat, initLng], 14);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "&copy; OpenStreetMap contributors"
        }).addTo(pickerMap);

        pickerMarker = L.marker([initLat, initLng], { draggable: true }).addTo(pickerMap);

        const updateFromPin = (lat, lng) => {
          detectedLocation = { lat, lng };
          const nearest = detectNearestWard(lat, lng);
          if (wardSelect) wardSelect.value = nearest.id;
          gpsStatus.innerHTML = `📍 Map Pin: <strong>${escapeHTML(nearest.name)}</strong> (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
          gpsStatus.style.color = "#2563eb";
        };

        pickerMarker.on("dragend", (e) => {
          const pos = e.target.getLatLng();
          updateFromPin(pos.lat, pos.lng);
        });

        pickerMap.on("click", (e) => {
          pickerMarker.setLatLng(e.latlng);
          updateFromPin(e.latlng.lat, e.latlng.lng);
        });
      } else if (pickerMap) {
        setTimeout(() => pickerMap.invalidateSize(), 200);
      }
    } else {
      pinMapContainer.style.display = "none";
      btnToggleMap.textContent = "🗺️ Pin on Map";
    }
  });
}

/**
 * Audio Recording (MediaRecorder API)
 */
const btnRecordAudio = document.getElementById("btnRecordAudio");
const audioPlayback = document.getElementById("audioPlayback");
const recordingTimer = document.getElementById("recordingTimer");
let timerInterval = null;
let recordSeconds = 0;

if (btnRecordAudio) {
  btnRecordAudio.addEventListener("click", async () => {
    if (recordedMediaRecorder && recordedMediaRecorder.state === "recording") {
      recordedMediaRecorder.stop();
      btnRecordAudio.textContent = "🎙️ Record Voice Note";
      btnRecordAudio.classList.remove("recording");
      clearInterval(timerInterval);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];
      recordedMediaRecorder = new MediaRecorder(stream);

      recordedMediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
      };

      recordedMediaRecorder.onstop = () => {
        capturedAudioBlob = new Blob(audioChunks, { type: "audio/webm" });
        if (audioPlayback) {
          audioPlayback.src = URL.createObjectURL(capturedAudioBlob);
          audioPlayback.style.display = "block";
        }
        showToast("Voice note recorded! AI analyzing speech in Hindi/Marathi/English...", "info");
        triggerAiPreTriage();
      };

      recordedMediaRecorder.start();
      btnRecordAudio.textContent = "⏹️ Stop Recording";
      btnRecordAudio.classList.add("recording");

      recordSeconds = 0;
      if (recordingTimer) {
        recordingTimer.style.display = "inline";
        recordingTimer.textContent = "00:00";
        timerInterval = setInterval(() => {
          recordSeconds++;
          const mins = String(Math.floor(recordSeconds / 60)).padStart(2, "0");
          const secs = String(recordSeconds % 60).padStart(2, "0");
          recordingTimer.textContent = `${mins}:${secs}`;
        }, 1000);
      }

    } catch (err) {
      console.warn("Microphone access unavailable:", err);
      showToast("Microphone not available. You can type or upload an image.", "warning");
    }
  });
}

/**
 * Image upload change listener
 */
if (imageInput) {
  imageInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) {
      capturedImageBlob = file;
      if (imagePreview) {
        imagePreview.src = URL.createObjectURL(file);
        imagePreview.style.display = "block";
      }
      triggerAiPreTriage();
    }
  });
}

/**
 * Preset Demo Buttons for 3-minute Pitch
 */
const DEMO_PRESETS = {
  pothole: {
    type: "Pothole",
    ward: "Ward H/W",
    coords: { lat: 19.0596, lng: 72.8295 },
    desc: "Severe asphalt crater on Hill Road near Bandra station. Causing traffic bottleneck and bike skidding.",
    imgUrl: "https://images.unsplash.com/photo-1515162816999-a0c47dc192f7?auto=format&fit=crop&w=800&q=80"
  },
  manhole: {
    type: "Open Manhole",
    ward: "Ward A",
    coords: { lat: 18.9220, lng: 72.8347 },
    desc: "Hazardous deep open manhole with broken chamber lid near Regal Cinema, Colaba. Fatal pedestrian safety hazard.",
    imgUrl: "https://images.unsplash.com/photo-1541888946425-d0fbb186156f?auto=format&fit=crop&w=800&q=80"
  },
  garbage: {
    type: "Garbage Overflow",
    ward: "Ward G/N",
    coords: { lat: 19.0390, lng: 72.8465 },
    desc: "Community bins overflowing for past 4 days near Dadar flower market. Stray cattle gathering.",
    imgUrl: "https://images.unsplash.com/photo-1605600659873-d808a13e4d2a?auto=format&fit=crop&w=800&q=80"
  },
  leakage: {
    type: "Water Leakage",
    ward: "Ward K/E",
    coords: { lat: 19.1136, lng: 72.8697 },
    desc: "High pressure potable water burst near Western Express Highway junction, Andheri East.",
    imgUrl: "https://images.unsplash.com/photo-1527061011665-3652c757a4d4?auto=format&fit=crop&w=800&q=80"
  }
};

document.querySelectorAll(".btn-preset").forEach((btn) => {
  btn.addEventListener("click", async () => {
    loadPreset(btn.dataset.preset);
  });
});

function loadPreset(key) {
  const preset = DEMO_PRESETS[key];
  if (!preset) return;

  if (descInput) descInput.value = preset.desc;
  if (imageUrlInput) imageUrlInput.value = preset.imgUrl;
  if (wardSelect) wardSelect.value = preset.ward;
  detectedLocation = preset.coords;

  if (gpsStatus) {
    gpsStatus.innerHTML = `📍 Locked via preset: <strong>${escapeHTML(preset.ward)}</strong> (${preset.coords.lat}, ${preset.coords.lng})`;
    gpsStatus.style.color = "#16a34a";
  }

  if (imagePreview) {
    imagePreview.style.display = "none";
    imagePreview.onload = () => { imagePreview.style.display = "block"; };
    imagePreview.onerror = () => { imagePreview.style.display = "none"; };
    imagePreview.src = preset.imgUrl;
  }

  showToast(`Loaded ${preset.type} scenario! Multimodal AI triaging...`, "info");
  triggerAiPreTriage();
}

// Auto-trigger preset from URL query parameter e.g. report.html?preset=pothole
const urlParams = new URLSearchParams(window.location.search);
const initialPreset = urlParams.get("preset");
if (initialPreset && DEMO_PRESETS[initialPreset]) {
  setTimeout(() => loadPreset(initialPreset), 300);
}

/**
 * Triggers Multimodal AI Analysis and renders the "AI Understood This As..." Card
 */
async function triggerAiPreTriage() {
  const card = document.getElementById("aiPreviewCard");
  if (!card) return;

  const desc = descInput ? descInput.value.trim() : "";
  const ward = wardSelect ? wardSelect.value : "Ward A";
  const urlVal = imageUrlInput ? imageUrlInput.value.trim() : "";

  card.style.display = "block";
  card.innerHTML = `
    <div class="ai-analyzing-box" style="padding:1rem; text-align:center;">
      <div class="spinner-dot" style="display:inline-block; width:12px; height:12px; background:#2563eb; border-radius:50%; margin-right:8px; animation:pulse 1s infinite;"></div>
      <span style="font-size:0.9rem; font-weight:600; color:#1e40af;">Multimodal Gemini is analyzing visual hazard, severity, and jurisdiction...</span>
    </div>
  `;

  try {
    const triage = await triageCivicReport({
      imageFile: capturedImageBlob,
      audioFile: capturedAudioBlob,
      descriptionText: desc || urlVal,
      ward
    });

    currentAiTriage = triage;

    // Auto-select form inputs based on AI recommendation
    if (issueTypeSelect && triage.issueType) {
      issueTypeSelect.value = triage.issueType;
    }

    const isLowConfidence = triage.confidence < 0.60;

    // Render Editable "AI Understood This As..." Card
    card.innerHTML = `
      <div class="ai-card-content">
        <div class="ai-card-badge">🤖 AI UNDERSTOOD THIS AS…</div>
        
        <div class="ai-header-row">
          <div>
            <h3 id="aiDetectedTitle" style="margin:0 0 4px 0; color:#0f172a; font-size:1.15rem;">${escapeHTML(triage.issueType)}</h3>
            <small class="text-muted">Target Dept: <strong>${escapeHTML(triage.suggestedAuthority)}</strong></small>
          </div>
          <div class="ai-metric-pills">
            <span class="severity-meter sev-${triage.severity}">
              ⚡ Severity: <strong>${triage.severity}/10</strong>
            </span>
            <span class="risk-badge risk-${triage.safetyRisk}">
              ${escapeHTML(triage.safetyRisk).toUpperCase()} RISK
            </span>
          </div>
        </div>

        <p class="ai-rationale-text" style="margin:8px 0;">
          "${escapeHTML(triage.severityReason)}"
        </p>

        ${triage.transcript ? `
          <div class="ai-transcript-box" style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:8px 12px; margin:8px 0;">
            <div style="font-weight:700; color:#1e293b; font-size:0.8rem;">🗣️ Speech-to-Text Transcription:</div>
            <p style="margin:4px 0; font-size:0.85rem; color:#334155;">"${escapeHTML(triage.transcript)}"</p>
            ${triage.englishTranslation && triage.englishTranslation !== triage.transcript ? `
              <div style="font-size:0.78rem; color:#64748b;"><strong>English Translation:</strong> "${escapeHTML(triage.englishTranslation)}"</div>
            ` : ''}
          </div>
        ` : ''}

        ${isLowConfidence ? `
          <div class="ai-low-confidence-warning" style="background:#fef3c7; border-left:4px solid #f59e0b; padding:8px 12px; border-radius:6px; margin:8px 0; font-size:0.82rem; color:#92400e;">
            ⚠️ <strong>Low Detection Confidence (${Math.round(triage.confidence * 100)}%):</strong> Please confirm or edit the category and ward below before submitting.
          </div>
        ` : ''}

        <div class="ai-card-footer" style="display:flex; justify-content:space-between; align-items:center; margin-top:8px; font-size:0.78rem; color:#64748b; border-top:1px dashed #cbd5e1; padding-top:6px;">
          <span>AI Confidence: <strong>${Math.round(triage.confidence * 100)}%</strong> • Genuine Score: <strong>${triage.isLikelyGenuine ? 'Passed' : 'Flagged'}</strong></span>
          <span style="color:#2563eb; font-weight:600;">You can adjust any field below</span>
        </div>
      </div>
    `;

  } catch (err) {
    console.warn("AI Triage UI error, fallback to manual mode:", err);
    card.style.display = "block";
    card.innerHTML = `
      <div style="background:#fffbeb; border:1px solid #fde68a; border-radius:8px; padding:10px; font-size:0.85rem; color:#b45309;">
        ⚠️ AI service unavailable. Manual triage active using BMC baseline priority rules.
      </div>
    `;
  }
}

/**
 * Uploads media file to Firebase Storage with a Data URL fallback
 */
async function storeMedia(fileOrBlob, filename = "evidence.jpg") {
  if (!fileOrBlob) return null;

  try {
    const storagePath = `complaints/${Date.now()}_${filename}`;
    const storageRef = ref(storage, storagePath);
    await uploadBytes(storageRef, fileOrBlob);
    const downloadUrl = await getDownloadURL(storageRef);
    return downloadUrl;
  } catch (err) {
    console.warn("Firebase Storage unavailable; saving as Data URL for demo:", err);
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(fileOrBlob);
    });
  }
}

/**
 * Proximity Duplicate Detection
 */
async function checkForDuplicateComplaint(issueType, lat, lng) {
  if (!lat || !lng) return null;

  try {
    const q = query(
      collection(db, "Complaints"),
      where("issueType", "==", issueType),
      where("status", "in", ["Reported", "Acknowledged", "In Progress"])
    );
    const snap = await getDocs(q);

    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      if (data.location?.lat && data.location?.lng) {
        const dist = calculateDistanceMeters(lat, lng, data.location.lat, data.location.lng);
        if (dist <= 60) {
          return { id: docSnap.id, distance: dist, ...data };
        }
      }
    }
  } catch (e) {
    console.warn("Duplicate query error:", e);
  }
  return null;
}

/**
 * Styled Modal for Duplicate Clustering & Upvoting
 */
function showDuplicateClusterDialog(duplicate) {
  return new Promise((resolve) => {
    let modal = document.getElementById("duplicateClusterModal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "duplicateClusterModal";
      modal.className = "modal-overlay";
      document.body.appendChild(modal);
    }

    const imgUrl = sanitizeUrl(duplicate.imageUrl || duplicate.mediaUrls?.photoUrl);

    modal.innerHTML = `
      <div class="modal-dialog" style="max-width:520px;">
        <div class="modal-header">
          <span class="badge status-inprogress">Smart Duplicate Prevention</span>
          <h2 style="font-size:1.3rem; margin-top:6px;">Similar Issue Already Active</h2>
          <p class="modal-sub">Identified ~${duplicate.distance} meters from your report location</p>
        </div>

        <div class="modal-body" style="margin-top:1rem;">
          ${imgUrl ? `
            <div style="margin-bottom:1rem;">
              <img src="${imgUrl}" alt="Active report evidence" style="width:100%; height:180px; object-fit:cover; border-radius:8px;">
            </div>
          ` : ''}

          <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px; margin-bottom:1.2rem; font-size:0.88rem;">
            <div><strong>Category:</strong> ${escapeHTML(duplicate.issueType)}</div>
            <div><strong>Ward:</strong> ${escapeHTML(duplicate.ward || "Mumbai")}</div>
            <div><strong>Current Citizen Endorsements:</strong> 👥 ${duplicate.reports || 1} people</div>
            <div><strong>Status:</strong> <span class="badge-mini status-reported">${escapeHTML(duplicate.status || "Reported")}</span></div>
          </div>

          <p style="font-size:0.85rem; color:#475569; margin-bottom:1.5rem;">
            Instead of filing a duplicate report that fragments municipal attention, upvote this ticket to automatically boost its priority score and add your evidence to the case file.
          </p>

          <div class="modal-actions" style="display:flex; flex-direction:column; gap:8px;">
            <button id="btnMergeDuplicate" class="btn btn-primary btn-full">
              ⚡ Upvote & Corroborate Existing Report
            </button>
            <button id="btnProceedDistinct" class="btn btn-secondary btn-full">
              Proceed as Distinct Separate Defect
            </button>
          </div>
        </div>
      </div>
    `;

    document.getElementById("btnMergeDuplicate").onclick = () => {
      modal.remove();
      resolve("merge");
    };

    document.getElementById("btnProceedDistinct").onclick = () => {
      modal.remove();
      resolve("new");
    };
  });
}

/**
 * Handle Report Submission
 */
if (form) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    submitBtn.disabled = true;
    submitBtn.textContent = "Transmitting to Municipal Ledger...";
    message.textContent = "";

    const issueType = issueTypeSelect.value;
    const ward = wardSelect.value;
    const description = descInput ? descInput.value.trim() : "";
    let photoUrl = imageUrlInput ? imageUrlInput.value.trim() : "";

    // 1. Process Visual Media
    if (capturedImageBlob) {
      photoUrl = await storeMedia(capturedImageBlob, "photo.jpg");
    }

    // 2. Process Audio Media
    let audioUrl = null;
    if (capturedAudioBlob) {
      audioUrl = await storeMedia(capturedAudioBlob, "audio.webm");
    }

    // Default location if GPS not acquired
    const loc = detectedLocation || { lat: 18.9220, lng: 72.8347 };

    try {
      // 3. Proximity Duplicate Detection (~50-60m)
      const duplicate = await checkForDuplicateComplaint(issueType, loc.lat, loc.lng);

      if (duplicate) {
        const userChoice = await showDuplicateClusterDialog(duplicate);

        if (userChoice === "merge") {
          await runTransaction(db, async (transaction) => {
            const dupRef = doc(db, "Complaints", duplicate.id);
            const freshDoc = await transaction.get(dupRef);
            if (!freshDoc.exists()) throw new Error("Document does not exist");

            const currentReports = (freshDoc.data().reports || 1) + 1;
            transaction.update(dupRef, {
              reports: currentReports,
              additionalEvidence: arrayUnion({
                reportedAt: Timestamp.now(),
                imageUrl: photoUrl || null,
                audioUrl: audioUrl || null,
                note: description || "Additional citizen corroboration."
              })
            });
          });

          message.innerHTML = `✅ Successfully corroborated active grievance! Priority score boosted.`;
          message.style.color = "#16a34a";
          form.reset();
          setTimeout(() => { window.location.href = "issues.html"; }, 1400);
          return;
        }
      }

      // 4. Create New Complaint Document with full aiTriage object
      const triageData = currentAiTriage || {
        issueType,
        severity: severityMap[issueType] || 3,
        severityReason: "Citizen logged civic infrastructure report.",
        safetyRisk: "medium",
        suggestedAuthority: DEPARTMENT_MAP[issueType] || "BMC Ward Office",
        confidence: 0.9,
        isLikelyGenuine: true,
        rejectionReason: ""
      };

      const docData = {
        issueType,
        ward,
        department: triageData.suggestedAuthority || DEPARTMENT_MAP[issueType] || "BMC Civil Works",
        description: description || (triageData.transcript ? `Voice Note: "${triageData.transcript}"` : "Reported via mobile evidence."),
        imageUrl: photoUrl || null,
        mediaUrls: {
          photoUrl: photoUrl || null,
          audioUrl: audioUrl || null
        },
        location: {
          lat: loc.lat,
          lng: loc.lng,
          geohash: encodeGeohash(loc.lat, loc.lng),
          addressSnippet: `${ward}, Mumbai`
        },
        status: "Reported",
        reports: 1,
        createdAt: Timestamp.now(),
        aiTriage: triageData,
        history: [
          {
            status: "Reported",
            timestamp: new Date().toISOString(),
            officer: "Citizen Portal",
            comment: `Issue logged with AI triage verification (Severity ${triageData.severity}/10).`
          }
        ]
      };

      await addDoc(collection(db, "Complaints"), docData);

      message.innerHTML = `🎉 Grievance registered successfully on the Public Transparency Ledger!`;
      message.style.color = "#16a34a";
      showToast("Report submitted successfully!", "success");
      form.reset();

      setTimeout(() => {
        window.location.href = "issues.html";
      }, 1200);

    } catch (err) {
      console.error("Submission failed:", err);
      message.textContent = "Error submitting report: " + (err.message || "Please try again.");
      message.style.color = "#dc2626";
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit Verified Grievance";
    }
  });
}

/**
 * AI Settings Modal
 */
const btnOpenSettings = document.getElementById("btnOpenAiSettings");
const btnCloseSettings = document.getElementById("btnCloseAiSettings");
const settingsModal = document.getElementById("aiSettingsModal");
const apiKeyInput = document.getElementById("geminiApiKeyInput");
const btnSaveKey = document.getElementById("btnSaveAiKey");
const btnClearKey = document.getElementById("btnClearAiKey");

if (btnOpenSettings && settingsModal) {
  btnOpenSettings.addEventListener("click", () => {
    if (apiKeyInput) apiKeyInput.value = getGeminiApiKey();
    settingsModal.style.display = "flex";
  });

  if (btnCloseSettings) {
    btnCloseSettings.addEventListener("click", () => {
      settingsModal.style.display = "none";
    });
  }

  if (btnSaveKey) {
    btnSaveKey.addEventListener("click", () => {
      const key = apiKeyInput.value.trim();
      if (key) {
        localStorage.setItem("civic_gemini_key", key);
        showToast("Gemini API Key saved! Live AI calls enabled.", "success");
      } else {
        localStorage.removeItem("civic_gemini_key");
        showToast("Key cleared. Running in smart simulation mode.", "info");
      }
      settingsModal.style.display = "none";
    });
  }

  if (btnClearKey) {
    btnClearKey.addEventListener("click", () => {
      localStorage.removeItem("civic_gemini_key");
      if (apiKeyInput) apiKeyInput.value = "";
      showToast("Gemini key cleared.", "info");
      settingsModal.style.display = "none";
    });
  }
}
