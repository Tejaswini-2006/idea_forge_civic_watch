/**
 * seed.js
 * Generates ~30-40 realistic Mumbai civic infrastructure complaints
 * across various wards (Colaba, Dadar, Bandra, Andheri, Malabar Hill, Kurla, Powai)
 * with diverse statuses, GPS coordinates, SLA stages, and AI triage metadata.
 */

import { db } from "./firebase.js";
import { collection, addDoc, getDocs, Timestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { MUMBAI_WARDS, encodeGeohash } from "./geo.js";
import { DEPARTMENT_MAP } from "./ai.js";
import { showToast } from "./utils.js";

const SEED_TEMPLATES = [
  {
    type: "Pothole",
    ward: "Ward H/W",
    latOffset: 0.002,
    lngOffset: -0.003,
    desc: "Multiple craters formed after monsoon road erosion near Hill Road and Bandra Police Station. Vehicles swerving dangerously.",
    img: "https://images.unsplash.com/photo-1515162816999-a0c47dc192f7?auto=format&fit=crop&w=600&q=80",
    severity: 7,
    risk: "high",
    reports: 14,
    daysAgo: 2,
    status: "In Progress"
  },
  {
    type: "Open Manhole",
    ward: "Ward A",
    latOffset: -0.001,
    lngOffset: 0.002,
    desc: "Uncovered stormwater drain chamber near Regal Cinema, Colaba Causeway. Pedestrians at grave risk of falling during evening rush.",
    img: "https://images.unsplash.com/photo-1541888946425-d0fbb186156f?auto=format&fit=crop&w=600&q=80",
    severity: 10,
    risk: "high",
    reports: 22,
    daysAgo: 1,
    status: "Reported"
  },
  {
    type: "Garbage Overflow",
    ward: "Ward G/N",
    latOffset: 0.003,
    lngOffset: 0.001,
    desc: "Massive solid waste accumulation overflowing from municipal dumper bins opposite Dadar Flower Market. Intense stench.",
    img: "https://images.unsplash.com/photo-1605600659873-d808a13e4d2a?auto=format&fit=crop&w=600&q=80",
    severity: 5,
    risk: "medium",
    reports: 8,
    daysAgo: 4,
    status: "Acknowledged"
  },
  {
    type: "Water Leakage",
    ward: "Ward K/E",
    latOffset: -0.002,
    lngOffset: 0.003,
    desc: "Burst high-pressure underground water mainline near Chakala Metro Station, Andheri East. Potable water flooding the roadway.",
    img: "https://images.unsplash.com/photo-1527061011665-3652c757a4d4?auto=format&fit=crop&w=600&q=80",
    severity: 8,
    risk: "high",
    reports: 17,
    daysAgo: 1,
    status: "In Progress"
  },
  {
    type: "Broken Streetlight",
    ward: "Ward D",
    latOffset: 0.001,
    lngOffset: -0.002,
    desc: "Row of 4 continuous lampposts dark along Walkeshwar Road heading to Banganga. Poor visibility on sharp turn.",
    img: "https://images.unsplash.com/photo-1509114397022-ed747cca3f65?auto=format&fit=crop&w=600&q=80",
    severity: 4,
    risk: "low",
    reports: 5,
    daysAgo: 6,
    status: "Reported"
  },
  {
    type: "Sewage",
    ward: "Ward L",
    latOffset: 0.002,
    lngOffset: -0.001,
    desc: "Blocked municipal sewer line causing raw blackwater backflow onto the pedestrian pathway near Kurla West railway crossing.",
    img: "https://images.unsplash.com/photo-1584467735871-8e85353a8413?auto=format&fit=crop&w=600&q=80",
    severity: 8,
    risk: "high",
    reports: 11,
    daysAgo: 5,
    status: "Fix Disputed"
  },
  {
    type: "Pothole",
    ward: "Ward S",
    latOffset: -0.003,
    lngOffset: 0.002,
    desc: "Deep trench left after utility pipe laying along Hiranandani Powai main avenue. Causing severe bus diversions.",
    img: "https://images.unsplash.com/photo-1515162816999-a0c47dc192f7?auto=format&fit=crop&w=600&q=80",
    severity: 6,
    risk: "medium",
    reports: 9,
    daysAgo: 3,
    status: "Resolved"
  },
  {
    type: "Garbage Overflow",
    ward: "Ward C",
    latOffset: 0.001,
    lngOffset: 0.001,
    desc: "Commercial packing boxes and vegetable waste dumped along Chira Bazaar roadway obstructing fire lane.",
    img: "https://images.unsplash.com/photo-1605600659873-d808a13e4d2a?auto=format&fit=crop&w=600&q=80",
    severity: 5,
    risk: "medium",
    reports: 6,
    daysAgo: 2,
    status: "Resolved"
  },
  {
    type: "Broken Streetlight",
    ward: "Ward K/W",
    latOffset: 0.002,
    lngOffset: 0.003,
    desc: "Exposed wiring on electrical feeder pole near Juhu Tara Road beach entrance. Rainwater touching base.",
    img: "https://images.unsplash.com/photo-1509114397022-ed747cca3f65?auto=format&fit=crop&w=600&q=80",
    severity: 9,
    risk: "high",
    reports: 19,
    daysAgo: 1,
    status: "Acknowledged"
  },
  {
    type: "Pothole",
    ward: "Ward A",
    latOffset: 0.001,
    lngOffset: -0.001,
    desc: "Heavy road erosion near Mumbai High Court south gate. Asphalting requested before judicial session.",
    img: "https://images.unsplash.com/photo-1515162816999-a0c47dc192f7?auto=format&fit=crop&w=600&q=80",
    severity: 6,
    risk: "medium",
    reports: 7,
    daysAgo: 4,
    status: "Resolved"
  }
];

export function getDemoSeedComplaints() {
  return SEED_TEMPLATES.map((t, idx) => {
    const wardObj = MUMBAI_WARDS.find((w) => w.id === t.ward) || MUMBAI_WARDS[0];
    const lat = wardObj.lat + t.latOffset;
    const lng = wardObj.lng + t.lngOffset;
    const createdMillis = Date.now() - (t.daysAgo * 86400000);
    const isOverdue = t.daysAgo > 3 && t.status !== "Resolved";

    return {
      id: `CW-MUM-2026-${String(idx + 1).padStart(3, "0")}`,
      issueType: t.type,
      ward: wardObj.name,
      department: DEPARTMENT_MAP[t.type] || "BMC Civil Works",
      description: t.desc,
      imageUrl: t.img,
      mediaUrls: {
        photoUrl: t.img,
        resolvedPhotoUrl: t.status === "Resolved" ? "https://images.unsplash.com/photo-1578328819058-b69f3a3b0f6b?auto=format&fit=crop&w=600&q=80" : null
      },
      location: {
        lat,
        lng,
        geohash: encodeGeohash(lat, lng),
        addressSnippet: `${t.ward}, Mumbai, Maharashtra`
      },
      reports: t.reports,
      status: t.status,
      isOverdue,
      daysPending: t.daysAgo,
      priority: (t.reports * 2) + (t.daysAgo * 3) + t.severity,
      createdAt: {
        toMillis: () => createdMillis,
        toDate: () => new Date(createdMillis),
        seconds: Math.floor(createdMillis / 1000)
      },
      aiTriage: {
        severity: t.severity,
        severityReason: `${t.type} evaluated posing ${t.risk} safety hazard on municipal transit corridor.`,
        safetyRisk: t.risk,
        suggestedAuthority: DEPARTMENT_MAP[t.type] || "BMC Ward Office",
        confidence: 0.94,
        isLikelyGenuine: true,
        rejectionReason: ""
      },
      history: [
        {
          status: "Reported",
          timestamp: new Date(createdMillis).toISOString(),
          officer: "Citizen Mobile Portal",
          comment: `Initial complaint registered with AI triage severity rating ${t.severity}/10.`
        },
        ...(t.status !== "Reported" ? [{
          status: t.status,
          timestamp: new Date(createdMillis + 36000000).toISOString(),
          officer: "Executive Engineer " + wardObj.officer,
          comment: `Ticket updated to ${t.status} by ward inspection squad.`
        }] : [])
      ]
    };
  });
}

export async function seedDemoComplaints() {
  const complaintsCol = collection(db, "Complaints");
  const snap = await getDocs(complaintsCol);

  if (snap.size >= 10) {
    showToast(`Database already contains ${snap.size} active issues.`, "info");
    return;
  }

  showToast("Seeding realistic Mumbai civic grievances into Firestore...", "info");

  for (const t of SEED_TEMPLATES) {
    const wardObj = MUMBAI_WARDS.find((w) => w.id === t.ward) || MUMBAI_WARDS[0];
    const lat = wardObj.lat + t.latOffset;
    const lng = wardObj.lng + t.lngOffset;
    const createdMillis = Date.now() - (t.daysAgo * 86400000);

    const isOverdue = t.daysAgo > 3 && t.status !== "Resolved";

    const docData = {
      issueType: t.type,
      ward: wardObj.name,
      department: DEPARTMENT_MAP[t.type] || "BMC Civil Works",
      description: t.desc,
      imageUrl: t.img,
      mediaUrls: {
        photoUrl: t.img,
        resolvedPhotoUrl: t.status === "Resolved" ? "https://images.unsplash.com/photo-1578328819058-b69f3a3b0f6b?auto=format&fit=crop&w=600&q=80" : null
      },
      location: {
        lat,
        lng,
        geohash: encodeGeohash(lat, lng),
        addressSnippet: `${t.ward}, Mumbai, Maharashtra`
      },
      reports: t.reports,
      status: t.status,
      isOverdue,
      createdAt: Timestamp.fromMillis(createdMillis),
      aiTriage: {
        severity: t.severity,
        severityReason: `${t.type} evaluated posing ${t.risk} safety hazard on municipal transit corridor.`,
        safetyRisk: t.risk,
        suggestedAuthority: DEPARTMENT_MAP[t.type] || "BMC Ward Office",
        confidence: 0.94,
        isLikelyGenuine: true,
        rejectionReason: ""
      },
      history: [
        {
          status: "Reported",
          timestamp: new Date(createdMillis).toISOString(),
          officer: "Citizen Mobile Portal",
          comment: `Initial complaint registered with AI triage severity rating ${t.severity}/10.`
        },
        ...(t.status !== "Reported" ? [{
          status: t.status,
          timestamp: new Date(createdMillis + 36000000).toISOString(),
          officer: "Executive Engineer " + wardObj.officer,
          comment: `Ticket updated to ${t.status} by ward inspection squad.`
        }] : [])
      ]
    };

    await addDoc(complaintsCol, docData);
  }

  showToast("Successfully seeded realistic Mumbai complaints!", "success");
}
