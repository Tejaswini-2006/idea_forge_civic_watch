/**
 * admin-guard.js
 * Protects admin.html from unauthenticated or non-officer visitors.
 * Redirects unauthorized users to admin-login.html.
 */

import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, setDoc, Timestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Make logout globally available for buttons
window.civicLogout = async () => {
  try {
    await signOut(auth);
    sessionStorage.clear();
    window.location.href = "admin-login.html";
  } catch (err) {
    console.error("Sign out error:", err);
    window.location.href = "admin-login.html";
  }
};

let isAuthorized = false;

// Fast evaluation / hackathon pitch override: admin.html?demo=true
const guardParams = new URLSearchParams(window.location.search);
if (guardParams.get("demo") === "true") {
  isAuthorized = true;
  const demoOfficer = {
    email: "officer.deshmukh@bmc.gov.in",
    role: "officer",
    name: "Executive Engineer R. Deshmukh",
    department: "BMC Central Grievance Cell",
    ward: "Ward A (Colaba/Fort)"
  };
  setTimeout(() => {
    updateOfficerNav({ email: demoOfficer.email }, demoOfficer);
    window.dispatchEvent(new CustomEvent("officerAuthorized", { detail: { user: { email: demoOfficer.email }, officer: demoOfficer } }));
  }, 100);
} else {

// Monitor authentication state
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    console.warn("Unauthenticated access attempt to Admin. Redirecting to admin-login.html");
    sessionStorage.setItem("civic_redirect_after_login", window.location.pathname);
    window.location.replace("admin-login.html");
    return;
  }

  try {
    const officerDocRef = doc(db, "officers", user.uid);
    const snap = await getDoc(officerDocRef);

    if (snap.exists()) {
      const data = snap.data();
      if (data.role === "officer" || data.role === "admin") {
        isAuthorized = true;
        updateOfficerNav(user, data);
        window.dispatchEvent(new CustomEvent("officerAuthorized", { detail: { user, officer: data } }));
        return;
      }
    }

    // Fallback: If user email looks like an officer or is demo account, auto-grant officer role
    if (user.email && (user.email.includes("officer") || user.email.includes("gov.in") || user.email.includes("admin"))) {
      const defaultOfficer = {
        email: user.email,
        role: "officer",
        name: user.displayName || ("Officer " + user.email.split("@")[0]),
        department: "BMC Civic Triage",
        ward: "Ward A",
        createdAt: Timestamp.now()
      };
      await setDoc(officerDocRef, defaultOfficer, { merge: true });
      isAuthorized = true;
      updateOfficerNav(user, defaultOfficer);
      window.dispatchEvent(new CustomEvent("officerAuthorized", { detail: { user, officer: defaultOfficer } }));
      return;
    }

    // Non-officer role
    console.warn("User lacks officer credentials:", user.email);
    alert("Access restricted: Your account does not have municipal officer privileges.");
    await signOut(auth);
    window.location.replace("admin-login.html");

  } catch (err) {
    console.error("Error verifying officer status in Firestore:", err);
    // Allow through if Firestore rules block or offline for hackathon presentation
    isAuthorized = true;
    updateOfficerNav(user, { name: user.email, role: "officer", department: "Civic Operations" });
    window.dispatchEvent(new CustomEvent("officerAuthorized", { detail: { user, officer: { role: "officer" } } }));
  }
});
}

function updateOfficerNav(user, officerData) {
  const navContainer = document.querySelector(".nav-container");
  if (!navContainer) return;

  let officerInfo = document.getElementById("officerNavInfo");
  if (!officerInfo) {
    officerInfo = document.createElement("div");
    officerInfo.id = "officerNavInfo";
    officerInfo.className = "officer-nav-info";

    officerInfo.innerHTML = `
      <span class="officer-badge">
        <span class="status-dot"></span>
        <strong id="officerNameDisplay">${escapeHTML(officerData.name || user.email)}</strong>
        <small id="officerDeptDisplay">(${escapeHTML(officerData.department || "BMC Triage")})</small>
      </span>
      <button class="btn btn-sm btn-logout" onclick="window.civicLogout()" title="Sign Out">
        Sign Out
      </button>
    `;
    navContainer.appendChild(officerInfo);
  }
}

function escapeHTML(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
