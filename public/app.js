// app.js (WebSocket Version)
const socket = io(); // Connect to Socket.io server

// Helper: safe element getter
function $id(id) {
  return document.getElementById(id);
}

// Toggle Password Visibility
// Toggle Password Visibility (Fixed for Global Scope)
window.togglePasswordVisibility = function (inputId, iconElement) {
  const input = document.getElementById(inputId);

  if (input.type === "password") {
    input.type = "text";
    iconElement.textContent = "🙈"; // Change to 'hide' icon
  } else {
    input.type = "password";
    iconElement.textContent = "👁️";  // Change back to 'show' icon
  }
};
// --- 1. SIGNUP LOGIC
const signupForm = $id('signupForm');
if (signupForm) {
  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const fullName = $id('signupName')?.value.trim();
    const email = $id('signupEmail')?.value.trim().toLowerCase(); // Normalize email
    const password = $id('signupPassword')?.value;
    const confirmPassword = $id('signupConfirmPassword')?.value;
    const phone = $id('signupPhone')?.value.trim();
    const enrollment = $id('signupEnrollment')?.value.trim();
    const semester = $id('signupSemester')?.value?.trim();
    const department = $id('signupdepartment')?.value?.trim();

    // 1. Basic Field Validation
    if (!email || !password || !fullName || !enrollment || !phone) {
      alert('Please fill all required fields.');
      return;
    }

    // 2. Password Match Validation
    if (password !== confirmPassword) {
      alert("Passwords do not match!");
      return;
    }

    // 3. Strict Password Security Regex
    const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+{}\[\]:;<>,.?~\\/-]).{8,}$/;
    if (!passwordRegex.test(password)) {
      alert("Password must be at least 8 characters long, include at least one uppercase letter, one number, and one special character.");
      return;
    }

    try {
      socket.emit("signup", { email, password, fullName, phone, enrollment, semester, department }, (res) => {
        if (res.error) {
          alert("Signup Failed: " + res.error);
        } else {
          alert("Account created! You can now log in.");
          // Auto-switch back to the login form
          document.getElementById('signup-form').style.display = 'none';
          document.getElementById('login-form').style.display = 'block';
        }
      });
    } catch (error) {
      console.error("Signup Error:", error);
      alert(error.message);
    }
  });
}
// // --- 1. SIGNUP LOGIC
// const signupForm = $id('signupForm');
// if (signupForm) {
//   signupForm.addEventListener('submit', async (e) => {
//     e.preventDefault();

//     const email = $id('signupEmail')?.value.trim();
//     const password = $id('signupPassword')?.value;
//     const confirmPassword = $id('signupConfirmPassword')?.value;
//     const fullName = $id('signupName')?.value.trim();
//     const enrollment = $id('signupEnrollment')?.value.trim();
//     const semester = $id('signupSemester')?.value?.trim();
//     const department = $id('signupdepartment')?.value?.trim();

//     if (!email || !password || !fullName || !enrollment) {
//       alert('Please fill required fields.');
//       return;
//     }

//     if (password !== confirmPassword) {
//       alert("Passwords do not match!");
//       return;
//     }
//     // --- NEW: Strict Password Validation ---
//     // Rules: Minimum 8 chars, 1 Uppercase, 1 Number, 1 Special Character
//     const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+{}\[\]:;<>,.?~\\/-]).{8,}$/;

//     if (!passwordRegex.test(password)) {
//       alert("Password must be at least 8 characters long, include at least one uppercase letter, one number, and one special character.");
//       return;
//     }
//     // ---------------------------------------
//     // Basic Validation
//     // 1. Format Check (Keeps your '014' logic strict)
//     function isValidEnrollment(enroll) {
//       return (
//         enroll.length === 12 &&
//         enroll.slice(2, 5) === '014' && // Keeps strict college code
//         /^[0-9]+$/.test(enroll)
//       );
//     }

//     // 2. Uniqueness Check (Ensures it is different for every user)
//     async function isEnrollmentTaken(enroll) {
//       const usersRef = collection(db, "users");
//       const q = query(usersRef, where("enrollment", "==", enroll));
//       const snap = await getDocs(q);
//       return !snap.empty; // Returns true if it already exists
//     }

//     try {
//       const userCredential = await createUserWithEmailAndPassword(auth, email, password);
//       const user = userCredential.user;

//       // Save user details with default role 'user'
//       await setDoc(doc(db, 'users', user.uid), {
//         fullName,
//         email,
//         enrollment,
//         semester,
//         department,
//         role: "user",
//         isVerified: false,
//         createdAt: serverTimestamp()
//       });

//       alert('Signup successful! Please login.');
//       // Optional: Auto-login redirect could go here, but let's send them to login view
//       window.location.href = 'index.html';
//     } catch (error) {
//       alert(error.message);
//     }

//   });

// }

// --- 2. LOGIN LOGIC (UPDATED)
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
          // Store token and user data
          localStorage.setItem('accessToken', res.accessToken);
          localStorage.setItem('uid', res.user.uid);
          localStorage.setItem('loginTimestamp', Date.now().toString());

          if (res.user.role === 'admin') {
            window.location.href = "admin-dashboard.html";
          } else {
            window.location.href = "dashboard.html";
          }
        }
      });
    } catch (error) {
      console.error(error);
      alert("Login Error: " + error.message);
      btn.innerText = originalText;
      btn.disabled = false;
    }
  });
}

// --- 3. LOGOUT LOGIC
const logoutBtn = $id('logout-btn'); // Ensure your logout button has this ID
// Also check for links inside sidebar
const sidebarLogout = document.querySelector('a[href="index.html"]');

if (logoutBtn || sidebarLogout) {
  const handleLogout = (e) => {
    e.preventDefault();
    localStorage.removeItem('accessToken');
    localStorage.removeItem('uid');
    window.location.href = 'index.html';
  };

  if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);
  if (sidebarLogout) sidebarLogout.addEventListener('click', handleLogout);
}

// --- 4. UI TOGGLES (Login/Signup Switch)
const showSignupBtn = $id('show-signup');
const showLoginBtn = $id('show-login');
const loginFormBlock = $id('login-form');
const signupFormBlock = $id('signup-form');
const resetBlock = $id('resetPassword');

if (showSignupBtn && loginFormBlock && signupFormBlock) {
  showSignupBtn.addEventListener('click', (e) => {
    e.preventDefault();
    loginFormBlock.style.display = 'none';
    signupFormBlock.style.display = 'block';
    if (resetBlock) resetBlock.style.display = 'none';
  });
}
if (showLoginBtn && loginFormBlock && signupFormBlock) {
  showLoginBtn.addEventListener('click', (e) => {
    e.preventDefault();
    signupFormBlock.style.display = 'none';
    loginFormBlock.style.display = 'block';
    if (resetBlock) resetBlock.style.display = 'none';
  });
}

// --- 5. PASSWORD RESET
const resetForm = $id('resetForm');
if (resetForm) {
  resetForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $id('email')?.value.trim();
    const msg = $id('message');
    if (!email) {
      if (msg) { msg.textContent = "Please enter your email."; msg.style.color = "red"; }
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      if (msg) { msg.textContent = "Reset link sent to your email."; msg.style.color = "green"; }
    } catch (error) {
      if (msg) { msg.textContent = "Error: " + error.message; msg.style.color = "red"; }
    }
  });

}

// signupForm.addEventListener('submit', async (e) => {
//   e.preventDefault();

//   const fullName = document.getElementById('signupName').value.trim();
//   const email = document.getElementById('signupEmail').value.trim().toLowerCase(); // Normalize email
//   const password = document.getElementById('signupPassword').value;
//   const enrollment = document.getElementById('signupEnrollment').value.trim();
//   const semester = document.getElementById('signupSemester').value;
//   const department = document.getElementById('signupDepartment').value;
//   // Assuming you also added a phone input field to your signup HTML
//   const phone = document.getElementById('signupPhone')?.value.trim() || "";

//   try {
//     // --- STEP 1: THE SMART AUTOMATION CHECK ---
//     const whitelistRef = doc(db, 'approved_students', enrollment);
//     const whitelistSnap = await getDoc(whitelistRef);

//     if (!whitelistSnap.exists()) {
//       alert("Verification Failed: Your Enrollment Number is not in the college database.");
//       return;
//     }

//     const studentData = whitelistSnap.data();

//     // --- NEW: STRICT EMAIL MATCHING ---
//     if (studentData.email !== email) {
//       alert(`Security Alert: The email address provided does not match the official records for Enrollment ${enrollment}. Please use your registered college email.`);
//       return; // Instantly block the signup
//     }
//     // ----------------------------------

//     if (studentData.isClaimed === true) {
//       alert("Security Alert: An account has already been registered with this Enrollment Number.");
//       return;
//     }
//     // ------------------------------------------

//     // --- STEP 2: CREATE THE ACCOUNT ---
//     const cred = await createUserWithEmailAndPassword(auth, email, password);
//     const user = cred.user;

//     // --- STEP 3: SAVE USER AS INSTANTLY VERIFIED ---
//     await setDoc(doc(db, 'users', user.uid), {
//       fullName,
//       email,
//       phone, // Save the phone number to their active profile
//       enrollment,
//       semester,
//       department,
//       role: "user",
//       isVerified: true,
//       createdAt: serverTimestamp()
//     });

//     // --- STEP 4: MARK ENROLLMENT AS CLAIMED ---
//     await updateDoc(whitelistRef, {
//       isClaimed: true,
//       claimedByUid: user.uid
//     });

//     alert("Account created and securely verified! Welcome to the library.");
//     window.location.href = "dashboard.html";

//   } catch (error) {
//     console.error("Signup Error:", error);
//     alert(error.message);
//   }
// });