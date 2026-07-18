const socket = typeof io !== 'undefined' ? io() : null;

document.addEventListener("DOMContentLoaded", () => {
  const barcodeModal = document.getElementById("barcodeModal");
  const overlay = document.getElementById("barcodeModalOverlay");
  const closeBtn = document.getElementById("closeBarcodeModal");
  const scannerContainer = document.getElementById("scannerContainer");

  // --- UI Setup (FIXED LAYOUT) ---
  let actionPanel = document.getElementById("scannerActionPanel");
  if (!actionPanel) {
    actionPanel = document.createElement("div");
    actionPanel.id = "scannerActionPanel";
    actionPanel.className = "mt-4 w-full"; // Ensure it takes full width
    actionPanel.style.display = "none";
    // Append to the modal content
    scannerContainer.parentElement.parentElement.appendChild(actionPanel);
  }

  // Redesigned UI using explicit styles to prevent Tailwind purging issues
  actionPanel.innerHTML = `
    <div id="scanInfo" class="mb-4 text-left bg-white border border-gray-200 p-4 rounded-lg shadow-sm"></div>
    <div class="flex flex-col space-y-3">
        <button id="confirmActionBtn" class="hidden py-3 rounded-lg shadow-md w-full font-bold text-white text-lg active:scale-95 transition-all"></button>
        <button id="scanAnotherBtn" class="hidden bg-gray-100 hover:bg-gray-200 text-gray-800 py-3 rounded-lg border border-gray-300 font-semibold transition-colors w-full">Scan Another Book</button>
        <button id="cancelActionBtn" class="text-gray-500 font-medium py-2 hover:text-gray-800 transition-colors">Cancel</button>
    </div>
  `;

  const infoDiv = document.getElementById("scanInfo");
  const confirmBtn = document.getElementById("confirmActionBtn");
  const scanAnotherBtn = document.getElementById("scanAnotherBtn");
  const cancelActionBtn = document.getElementById("cancelActionBtn");

  let html5QrCode = null;
  let isScannerRunning = false;
  let isScanningForForm = false; // Flag to track if we are scanning just to fill the form
  let currentUser = localStorage.getItem('uid');
  let isAdmin = localStorage.getItem('role') === 'admin';
  let scanStep = "student"; // "student" or "book"
  let selectedStudent = null; // Stores verified student { uid, fullName, enrollment }

  // --- Auth Check ---
  if (!currentUser) {
      console.warn("Scanner: No user logged in.");
  }

  // --- Scanner Functions ---
  async function openBarcodeScanner() {
    if (!currentUser) return;
    barcodeModal.classList.remove("hidden");
    actionPanel.style.display = "none";
    
    // Dynamically update modal title based on flow step
    const modalTitle = barcodeModal.querySelector("h3");
    if (isScanningForForm) {
      if (modalTitle) modalTitle.textContent = "Scan Book ISBN";
    } else {
      if (scanStep === "student") {
        if (modalTitle) modalTitle.textContent = "Step 1: Scan Student QR Code";
      } else {
        if (modalTitle) modalTitle.textContent = "Step 2: Scan Book Barcode";
      }
    }
    
    if (html5QrCode) { try { await html5QrCode.clear(); } catch(e){} }
    html5QrCode = new Html5Qrcode("scannerContainer");
    
    try {
      // Get all available cameras
      const devices = await Html5Qrcode.getCameras();
      
      if (devices && devices.length) {
        // Try to find a back camera, otherwise use the first one (usually webcam on laptops)
        let cameraId = devices[0].id;
        for (let i = 0; i < devices.length; i++) {
           let label = devices[i].label.toLowerCase();
           if (label.includes("back") || label.includes("environment") || label.includes("rear")) {
               cameraId = devices[i].id;
               break;
           }
        }

        html5QrCode.start(
          cameraId,
          { fps: 10, qrbox: { width: 250, height: 250 } },
          async (decodedText) => {
            console.log("✅ Scanned:", decodedText); 
            await stopBarcodeScanner(false); 

            if (isScanningForForm) {
                isScanningForForm = false;
                const isbnInput = document.getElementById("newBookISBN");
                if (isbnInput) {
                    isbnInput.value = decodedText;
                    isbnInput.classList.add('bg-green-50', 'border-green-500');
                    setTimeout(() => isbnInput.classList.remove('bg-green-50', 'border-green-500'), 2000);
                }
                // Bring back the add book modal
                document.getElementById("addBookModal")?.classList.remove("hidden");
                await stopBarcodeScanner(true);
            } else {
                if (scanStep === "student") {
                    await handleScannedStudent(decodedText);
                } else {
                    await handleScannedBook(decodedText);
                }
            }
          },
          (errorMessage) => {
             // Ignoring generic scan errors, they happen continuously until a QR is found
          }
        ).then(() => { isScannerRunning = true; })
         .catch(err => { console.error("Scanner start error:", err); alert("Camera error: Could not start the camera feed."); });
         
      } else {
        alert("No cameras found on your device.");
      }
    } catch (err) {
      console.error("Camera permission error:", err);
      alert("Camera error: Please ensure your browser has camera permissions and refresh.");
    }
  }

  async function stopBarcodeScanner(closeModal = true) {
    if (html5QrCode) {
      try { await html5QrCode.stop(); html5QrCode.clear(); } catch (err) {}
      isScannerRunning = false;
    }
    if (closeModal) {
      barcodeModal.classList.add("hidden");
      actionPanel.style.display = "none";
      // Reset scan state on full close
      scanStep = "student";
      selectedStudent = null;
    }
  }

  // --- Student QR Scanner Logic ---
  async function handleScannedStudent(decodedText) {
    try {
      infoDiv.innerHTML = '<div class="text-center py-4"><i class="fas fa-spinner fa-spin text-blue-500 text-2xl"></i><p class="mt-2 text-gray-600">Verifying student QR...</p></div>';
      actionPanel.style.display = "block";
      confirmBtn.classList.add("hidden");
      scanAnotherBtn.classList.add("hidden");

      let userData;
      try {
        userData = JSON.parse(decodeURIComponent(atob(decodedText)));
      } catch (err) {
        try {
          userData = JSON.parse(decodedText);
        } catch (e2) {
          userData = { enrollment: decodedText.trim() };
        }
      }

      const enrollment = userData.enrollment;
      if (!enrollment) {
        throw new Error("Invalid QR Code: Student enrollment number not found.");
      }

      socket.emit("findStudentByEnrollment", { enrollment }, async (res) => {
        if (res.error) {
          infoDiv.innerHTML = `
            <div class="text-center py-2">
              <p class="text-red-500 font-bold text-lg">❌ Student Not Registered</p>
              <p class="text-sm text-gray-600 mt-2">${res.error}</p>
            </div>
          `;
          scanAnotherBtn.textContent = "Retry Student Scan";
          scanAnotherBtn.classList.remove("hidden");
          return;
        }

        const student = res.user;
        selectedStudent = student;
        
        infoDiv.innerHTML = `
          <div class="border-b border-gray-200 pb-3 mb-3 text-center">
            <i class="fas fa-user-check text-4xl text-green-500 mb-2"></i>
            <h4 class="font-bold text-gray-800 text-lg">${student.fullName}</h4>
            <p class="text-sm text-gray-500 mt-1">Enrollment: ${student.enrollment}</p>
            <p class="text-xs text-gray-400 mt-1">${student.department || ''} - Sem ${student.semester || ''}</p>
          </div>
          <div class="p-3 bg-green-50 border border-green-200 rounded-lg text-center">
            <p class="text-green-800 font-semibold text-sm">Student verified successfully!</p>
          </div>
        `;

        confirmBtn.textContent = "Next: Scan Book Barcode";
        confirmBtn.style.backgroundColor = "#2563eb";
        confirmBtn.classList.remove("hidden");
        
        confirmBtn.onclick = async () => {
          scanStep = "book";
          actionPanel.style.display = "none";
          // Change Title to Book Scan
          const modalTitle = barcodeModal.querySelector("h3");
          if (modalTitle) modalTitle.textContent = "Step 2: Scan Book Barcode";
          await openBarcodeScanner();
        };
      });

    } catch (err) {
      console.error("Student Scan Error:", err);
      infoDiv.innerHTML = `<p class="text-red-500 text-center font-medium">Scan Error: ${err.message || err}</p>`;
      scanAnotherBtn.textContent = "Retry Student Scan";
      scanAnotherBtn.classList.remove("hidden");
    }
  }

  // --- Book Scanner Logic ---
  async function handleScannedBook(barcode) {
    try {
      infoDiv.innerHTML = '<div class="text-center py-4"><i class="fas fa-spinner fa-spin text-blue-500 text-2xl"></i><p class="mt-2 text-gray-600">Checking database...</p></div>';
      actionPanel.style.display = "block";
      
      confirmBtn.classList.add("hidden");
      scanAnotherBtn.classList.add("hidden");

      const targetUserId = selectedStudent ? selectedStudent.uid : currentUser;

      socket.emit("scanBook", { isbn: barcode, uid: targetUserId }, (res) => {
        if (res.error) {
            infoDiv.innerHTML = `<p class="text-red-500 text-center font-medium">System Error: ${res.error}</p>`;
            scanAnotherBtn.textContent = "Scan Book Again";
            scanAnotherBtn.classList.remove("hidden");
            return;
        }

        if (!res.found) {
            if (isAdmin) {
                barcodeModal.classList.add("hidden");
                if (window.openAddBookModalWithISBN) window.openAddBookModalWithISBN(barcode);
                else alert("Add Book UI missing.");
            } else {
                infoDiv.innerHTML = `<div class="text-center"><p class="text-red-500 font-bold text-lg">❌ Book not found</p><p class="text-sm text-gray-500 mt-1">ISBN: ${barcode}</p></div>`;
                scanAnotherBtn.textContent = "Scan Book Again";
                scanAnotherBtn.classList.remove("hidden");
            }
            return;
        }

        const bookData = res.book;
        const myBorrow = res.myBorrow; // Did target student borrow this book?
        const anyBorrow = res.isReturn; // Has ANYONE borrowed this book?
        
        const actionType = myBorrow ? "return" : "issue";

        if (actionType === "issue" && (bookData.available <= 0)) {
            infoDiv.innerHTML = `
                <div class="text-center">
                    <p class="font-bold text-red-600 text-lg">Out of Stock</p>
                    <p class="font-medium mt-1">${bookData.title}</p>
                    <p class="text-sm text-gray-500 mt-2">Available: 0 / ${bookData.quantity}</p>
                </div>
            `;
            scanAnotherBtn.textContent = "Scan Book Again";
            scanAnotherBtn.classList.remove("hidden");
            return;
        }

        infoDiv.innerHTML = `
            <div class="border-b border-gray-200 pb-3 mb-3">
                <h4 class="font-bold text-gray-800 text-base"><i class="fas fa-book text-blue-500 mr-2"></i>${bookData.title}</h4>
                <p class="text-xs text-gray-500 mt-1">ISBN: ${barcode}</p>
            </div>
            <div class="mb-3 text-sm text-gray-700 bg-gray-50 p-2 rounded border">
                <p class="font-bold">Student:</p>
                <p>${selectedStudent ? selectedStudent.fullName : 'Admin'} (${selectedStudent ? selectedStudent.enrollment : 'Admin'})</p>
            </div>
            <div class="p-3 rounded-lg text-center" style="background-color: ${actionType === 'return' ? '#fff7ed' : '#f0fdf4'}; border: 1px solid ${actionType === 'return' ? '#fdba74' : '#86efac'};">
                <p class="font-bold text-lg" style="color: ${actionType === 'return' ? '#c2410c' : '#15803d'};">
                    <i class="fas ${actionType === 'return' ? 'fa-undo' : 'fa-hand-holding'} mr-2"></i>
                    Ready to ${actionType === 'return' ? 'Return' : 'Borrow'}
                </p>
            </div>
        `;
        
        confirmBtn.textContent = actionType === 'return' ? "Confirm Return" : "Confirm Borrow";
        confirmBtn.style.backgroundColor = actionType === 'return' ? "#f97316" : "#16a34a";
        confirmBtn.classList.remove("hidden");
        
        confirmBtn.onclick = () => {
            confirmBtn.disabled = true;
            confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Processing...';

            socket.emit("transactionBook", { isbn: barcode, uid: targetUserId, actionType }, (transRes) => {
                if (transRes.success) {
                    infoDiv.innerHTML = `
                        <div class="text-center py-4">
                            <i class="fas fa-check-circle text-5xl text-green-500 mb-3"></i>
                            <p class="font-bold text-gray-800 text-xl">Success!</p>
                            <p class="text-gray-600 mt-1">Book ${actionType === 'return' ? 'returned' : 'borrowed'} successfully for ${selectedStudent ? selectedStudent.fullName : 'Admin'}.</p>
                        </div>
                    `;
                    confirmBtn.classList.add("hidden");
                    scanAnotherBtn.textContent = "Start Next Scan Flow";
                    scanAnotherBtn.classList.remove("hidden");
                } else {
                    alert("Action Failed: " + transRes.error);
                    confirmBtn.disabled = false;
                    confirmBtn.textContent = actionType === 'return' ? "Retry Return" : "Retry Borrow";
                }
            });
        };
      });

    } catch (err) {
      console.error("Logic Error:", err);
      infoDiv.innerHTML = `<p class="text-red-500 text-center font-medium">System Error: ${err.message}</p>`;
      scanAnotherBtn.textContent = "Scan Book Again";
      scanAnotherBtn.classList.remove("hidden");
    }
  }

  // --- Listeners ---
  scanAnotherBtn.addEventListener("click", () => {
    actionPanel.style.display = "none";
    if (isScanningForForm) {
      openBarcodeScanner();
    } else {
      // Reset scan step for next open
      scanStep = "student";
      selectedStudent = null;
      openBarcodeScanner();
    }
  });
  cancelActionBtn.addEventListener("click", () => {
    actionPanel.style.display = "none";
    barcodeModal.classList.add("hidden");
  });
  overlay.addEventListener("click", () => {
      stopBarcodeScanner(true);
      if (isScanningForForm) {
          isScanningForForm = false;
          document.getElementById("addBookModal")?.classList.remove("hidden");
      }
  });
  closeBtn.addEventListener("click", () => {
      stopBarcodeScanner(true);
      if (isScanningForForm) {
          isScanningForForm = false;
          document.getElementById("addBookModal")?.classList.remove("hidden");
      }
  });
  document.getElementById("openScannerBtn")?.addEventListener("click", () => {
      isScanningForForm = false;
      openBarcodeScanner();
  });
  
  // New listener for scanning directly into the form
  document.getElementById("scanIsbnBtn")?.addEventListener("click", () => {
      isScanningForForm = true;
      document.getElementById("addBookModal")?.classList.add("hidden");
      openBarcodeScanner();
  });
});