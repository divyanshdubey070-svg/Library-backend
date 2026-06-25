// app.js (Dedicated Admin Console Version)
const socket = io();

// Helper: safe element getter
function $id(id) {
  return document.getElementById(id);
}

// --- 1. ADMIN LOGIN LOGIC
const loginForm = $id('loginForm');
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $id('loginEmail')?.value.trim();
    const password = $id('loginPassword')?.value;
    const btn = loginForm.querySelector('button');

    // UI Feedback
    const originalText = btn.innerText;
    btn.innerText = "Logging in...";
    btn.disabled = true;

    try {
      socket.emit("login", { email, password }, (res) => {
        if (res.error) {
          alert("Login Failed: " + res.error);
          btn.innerText = originalText;
          btn.disabled = false;
        } else {
          // Restrict portal access to Admins only
          if (res.user.role !== 'admin') {
            alert("Access Denied: This console is only accessible by library administrators.");
            btn.innerText = originalText;
            btn.disabled = false;
            return;
          }

          // Store token and user data
          localStorage.setItem('accessToken', res.accessToken);
          localStorage.setItem('uid', res.user.uid);
          localStorage.setItem('role', res.user.role);
          localStorage.setItem('fullName', res.user.fullName);
          localStorage.setItem('loginTimestamp', Date.now().toString());

          // Redirect directly to admin dashboard
          window.location.href = "admin-dashboard.html";
        }
      });
    } catch (error) {
      console.error("Login Error:", error);
      alert("Login Error: " + error.message);
      btn.innerText = originalText;
      btn.disabled = false;
    }
  });
}

// --- 2. PASSWORD RESET (OFFLINE ALERT)
const resetForm = $id('resetForm');
if (resetForm) {
  resetForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const msg = $id('message');
    if (msg) {
      msg.textContent = "Offline Mode: Email password reset is disabled. Please update your admin password directly in the SQLite database configuration.";
      msg.style.color = "orange";
    }
  });
}