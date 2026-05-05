import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-auth.js";
import { doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-firestore.js";

let currentUserUid = null;
let currentUserEmail = null;

const profileForm = document.getElementById('profileForm');
const saveProfileBtn = document.getElementById('saveProfileBtn');
const resetPasswordBtn = document.getElementById('resetPasswordBtn');

// Load User Data
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "index.html";
        return;
    }
    
    currentUserUid = user.uid;
    currentUserEmail = user.email;
    document.getElementById('profEmail').value = user.email;

    try {
        const userDocRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userDocRef);

        if (userSnap.exists()) {
            const data = userSnap.data();
            // Checking both camelCase and lowercase just in case (based on your app.js)
            document.getElementById('profName').value = data.fullName || data.fullname || '';
            document.getElementById('profEnrollment').value = data.enrollment || data.enrollmentNo || '';
            document.getElementById('profSem').value = data.semester || '';
            document.getElementById('profDept').value = data.department || '';
        }
    } catch (error) {
        console.error("Error fetching user data:", error);
        alert("Failed to load profile data.");
    }
});

// Update User Data
profileForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    if (!currentUserUid) return;

    saveProfileBtn.disabled = true;
    saveProfileBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving...';

    const updatedData = {
        fullName: document.getElementById('profName').value.trim(),
        fullname: document.getElementById('profName').value.trim(), // Keep both synced to prevent breaks
        enrollment: document.getElementById('profEnrollment').value.trim(),
        semester: document.getElementById('profSem').value.trim(),
        department: document.getElementById('profDept').value.trim()
    };

    try {
        const userDocRef = doc(db, "users", currentUserUid);
        await updateDoc(userDocRef, updatedData);
        
        saveProfileBtn.innerHTML = '<i class="fas fa-check mr-2"></i>Saved!';
        saveProfileBtn.classList.replace('bg-primary', 'bg-green-600');
        
        setTimeout(() => {
            saveProfileBtn.disabled = false;
            saveProfileBtn.innerHTML = 'Save Changes';
            saveProfileBtn.classList.replace('bg-green-600', 'bg-primary');
        }, 2000);

    } catch (error) {
        console.error("Error updating profile:", error);
        alert("Failed to update profile.");
        saveProfileBtn.disabled = false;
        saveProfileBtn.innerHTML = 'Save Changes';
    }
});

// Password Reset
resetPasswordBtn.addEventListener('click', async () => {
    if (!currentUserEmail) return;

    const confirmReset = confirm(`Send a password reset link to ${currentUserEmail}?`);
    if (!confirmReset) return;

    try {
        await sendPasswordResetEmail(auth, currentUserEmail);
        alert("Password reset email sent! Please check your inbox.");
    } catch (error) {
        console.error("Error sending reset email:", error);
        alert("Failed to send reset email: " + error.message);
    }
});