// import { auth, db } from './firebase-config.js';
// import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-auth.js";
// import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-firestore.js"; // Note: Changed getDoc to onSnapshot

// const statusIcon = document.getElementById('statusIcon');
// const statusTitle = document.getElementById('statusTitle');
// const statusDesc = document.getElementById('statusDesc');
// const instructionsCard = document.getElementById('instructionsCard');
// const qrCodeContainer = document.getElementById('qrCodeContainer');

// onAuthStateChanged(auth, (user) => {
//     if (!user) {
//         window.location.href = "index.html";
//         return;
//     }

//     const userDocRef = doc(db, "users", user.uid);

//     // --- REAL-TIME LISTENER ---
//     // This listens to the database continuously. 
//     // When the admin activates them, this triggers instantly on the student's phone.
//     onSnapshot(userDocRef, (userSnap) => {
//         if (userSnap.exists()) {
//             const userData = userSnap.data();
//             userData.uid = user.uid;

//             // 1. Check Status
//             if (userData.isVerified === true) {
//                 // UNLOCKED!
//                 statusIcon.innerHTML = '<i class="fas fa-check-circle text-green-600 text-3xl"></i>';
//                 statusTitle.textContent = "Account Activated!";
//                 statusDesc.textContent = "Redirecting you to the dashboard...";

//                 // Automatically send them to the dashboard after a 1.5-second celebratory delay
//                 setTimeout(() => {
//                     window.location.replace("dashboard.html");
//                 }, 1500);

//             } else {
//                 // LOCKED DOWN (Unverified)

//                 // Hide Desktop and Mobile Navigation menus so they cannot leave this page
//                 document.querySelector('aside')?.classList.add('hidden'); // Desktop sidebar
//                 document.querySelector('nav.md\\:hidden.fixed.bottom-0')?.classList.add('hidden'); // Mobile bottom nav

//                 statusIcon.className = "w-16 h-16 rounded-full flex items-center justify-center mr-4 bg-yellow-100";
//                 statusIcon.innerHTML = '<i class="fas fa-lock text-yellow-600 text-3xl"></i>';
//                 statusTitle.textContent = "Activation Required";
//                 statusTitle.className = "text-xl font-bold text-yellow-700";
//                 statusDesc.textContent = "Show this QR code to the librarian to permanently unlock your account.";
//                 if (instructionsCard) instructionsCard.classList.remove('hidden');

//                 // Generate the QR Code (Only if it hasn't been generated yet to prevent blinking)
//                 if (qrCodeContainer.childElementCount === 0) {

//                     // Force clear any hidden HTML comments or spaces first
//                     qrCodeContainer.innerHTML = "";

//                     userData.loginTimestamp = new Date().toISOString();
//                     const jsonString = JSON.stringify(userData);
//                     const encodedData = btoa(encodeURIComponent(jsonString));

//                     new QRCode(qrCodeContainer, {
//                         text: encodedData,
//                         width: 200,
//                         height: 200,
//                         colorDark: "#000000",
//                         colorLight: "#ffffff",
//                         correctLevel: QRCode.CorrectLevel.H
//                     });
//                 }
//             }
//         }
//     }, (error) => {
//         console.error("Real-time sync error:", error);
//     });
// });