// profile.js (Socket.io SQLite version)
const socket = io();
const uid = localStorage.getItem('uid');

if (!uid) {
    window.location.href = "index.html";
}

const profileForm = document.getElementById('profileForm');
const saveProfileBtn = document.getElementById('saveProfileBtn');
const resetPasswordBtn = document.getElementById('resetPasswordBtn');

// Load User Data
function loadUserProfile() {
    socket.emit("fetchProfile", { uid }, (res) => {
        if (res.error) {
            console.error("Error fetching profile:", res.error);
            alert("Failed to load profile data.");
            return;
        }

        const user = res.user;
        document.getElementById('profEmail').value = user.email || '';
        document.getElementById('profName').value = user.fullName || '';
        document.getElementById('profEnrollment').value = user.enrollment || '';
        document.getElementById('profSem').value = user.semester || '';
        document.getElementById('profDept').value = user.department || '';
    });
}

if (socket.connected) {
    loadUserProfile();
} else {
    socket.on("connect", loadUserProfile);
}

// Update User Data
profileForm.addEventListener('submit', (e) => {
    e.preventDefault();
    
    saveProfileBtn.disabled = true;
    saveProfileBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving...';

    const updatedData = {
        uid: uid,
        fullName: document.getElementById('profName').value.trim(),
        enrollment: document.getElementById('profEnrollment').value.trim(),
        semester: document.getElementById('profSem').value.trim(),
        department: document.getElementById('profDept').value.trim()
    };

    socket.emit("updateProfile", updatedData, (res) => {
        if (res.error) {
            alert("Failed to update profile: " + res.error);
            saveProfileBtn.disabled = false;
            saveProfileBtn.innerHTML = 'Save Changes';
            return;
        }

        // Save new fullName in localStorage to update welcome message
        localStorage.setItem('fullName', updatedData.fullName);

        saveProfileBtn.innerHTML = '<i class="fas fa-check mr-2"></i>Saved!';
        saveProfileBtn.classList.replace('bg-primary', 'bg-green-600');
        
        setTimeout(() => {
            saveProfileBtn.disabled = false;
            saveProfileBtn.innerHTML = 'Save Changes';
            saveProfileBtn.classList.replace('bg-green-600', 'bg-primary');
        }, 2000);
    });
});

// Password Reset
resetPasswordBtn.addEventListener('click', () => {
    alert("Offline Mode: Password reset via email is not available in local offline mode. Please contact the librarian to reset or change your password.");
});