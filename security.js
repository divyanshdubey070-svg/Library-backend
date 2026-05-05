import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-firestore.js";

// pageType can be 'student' or 'admin'
export function runSecurityCheck(pageType = 'student') {

    // Firebase allows multiple onAuthStateChanged listeners. 
    // This one acts purely as a background security guard.
    onAuthStateChanged(auth, async (user) => {

        // 1. Not logged in? Kick to login page.
        if (!user) {
            window.location.replace("index.html");
            return;
        }

        // 2. 24-Hour Session Check
        const loginTime = localStorage.getItem('loginTimestamp');
        const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

        if (loginTime && (Date.now() - parseInt(loginTime)) > TWENTY_FOUR_HOURS) {
            alert("Your session has expired. Please log in again.");
            localStorage.removeItem('loginTimestamp');
            await signOut(auth);
            window.location.replace("index.html");
            return;
        }

        // 3. Database Role & Verification Check
        // try {
        //     const userDocRef = doc(db, "users", user.uid);
        //     const userSnap = await getDoc(userDocRef);

        //     if (userSnap.exists()) {
        //         const uData = userSnap.data();
        //         const currentPage = window.location.pathname;

        //         // --- NEW: HIDE STUDENT TABS FOR ADMINS ---
        //         if (uData.role === 'admin') {
        //             // Find all elements with the 'student-only' class and hide them
        //             document.querySelectorAll('.student-only').forEach(el => {
        //                 el.style.display = 'none';
        //             });
        //         }
        //         // -----------------------------------------

        //         // A. Admin Page Protection
        //         if (pageType === 'admin' && uData.role !== 'admin') {
        //             console.warn("Blocked: Non-admin attempted to access admin area.");
        //             window.location.replace("dashboard.html");
        //             return;
        //         }

        //         // B. Student Verification Lockdown (The Bouncer)
        //         if (pageType === 'student' && uData.role !== 'admin' && uData.isVerified === false) {
        //             if (!currentPage.includes("verification.html") && !currentPage.includes("profile.html")) {
        //                 window.location.replace("verification.html");
        //             }
        //         }
        //     }
        // } catch (e) {
        //     console.error("Security check failed:", e);
        // }
    });
}