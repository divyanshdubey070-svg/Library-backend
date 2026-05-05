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
  let isAdmin = true; // Temporary: Treat everyone as admin for testing purposes

  // --- Auth Check ---
  if (!currentUser) {
      console.warn("Scanner: No user logged in.");
  }

  // --- Scanner Functions ---
  async function openBarcodeScanner() {
    if (!currentUser) return;
    barcodeModal.classList.remove("hidden");
    actionPanel.style.display = "none";
    
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
            } else {
                await handleScannedBook(decodedText);
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
    }
  }

  // --- Logic Handler ---
  async function handleScannedBook(barcode) {
    try {
      infoDiv.innerHTML = '<div class="text-center py-4"><i class="fas fa-spinner fa-spin text-blue-500 text-2xl"></i><p class="mt-2 text-gray-600">Checking database...</p></div>';
      actionPanel.style.display = "block";
      
      // Hide buttons initially
      confirmBtn.classList.add("hidden");
      scanAnotherBtn.classList.add("hidden");

      // Replace Firebase fetch with Socket.io
      socket.emit("scanBook", { isbn: barcode, uid: currentUser }, (res) => {
        if (res.error) {
            infoDiv.innerHTML = `<p class="text-red-500 text-center font-medium">System Error: ${res.error}</p>`;
            scanAnotherBtn.classList.remove("hidden");
            return;
        }

        // 1. Admin Add Book & 2. Book Not Found
        if (!res.found) {
            if (isAdmin) {
                barcodeModal.classList.add("hidden");
                if (window.openAddBookModalWithISBN) window.openAddBookModalWithISBN(barcode);
                else alert("Add Book UI missing.");
            } else {
                infoDiv.innerHTML = `<div class="text-center"><p class="text-red-500 font-bold text-lg">❌ Book not found</p><p class="text-sm text-gray-500 mt-1">ISBN: ${barcode}</p></div>`;
                scanAnotherBtn.classList.remove("hidden");
            }
            return;
        }

        const bookData = res.book;
        const isReturn = res.isReturn;
        const actionType = isReturn ? "return" : "issue";

        // 4. Stock Check
        if (actionType === "issue" && (bookData.available <= 0)) {
            infoDiv.innerHTML = `
                <div class="text-center">
                    <p class="font-bold text-red-600 text-lg">Out of Stock</p>
                    <p class="font-medium mt-1">${bookData.title}</p>
                    <p class="text-sm text-gray-500 mt-2">Available: 0 / ${bookData.quantity}</p>
                </div>
            `;
            scanAnotherBtn.classList.remove("hidden");
            return;
        }

        // 5. Show Action UI
        infoDiv.innerHTML = `
            <div class="border-b border-gray-200 pb-3 mb-3">
                <h4 class="font-bold text-gray-800 text-lg"><i class="fas fa-book text-blue-500 mr-2"></i>${bookData.title}</h4>
                <p class="text-sm text-gray-500 mt-1">ISBN: ${barcode}</p>
            </div>
            <div class="p-3 rounded-lg text-center" style="background-color: ${isReturn ? '#fff7ed' : '#f0fdf4'}; border: 1px solid ${isReturn ? '#fdba74' : '#86efac'};">
                <p class="font-bold text-lg" style="color: ${isReturn ? '#c2410c' : '#15803d'};">
                    <i class="fas ${isReturn ? 'fa-undo' : 'fa-hand-holding'} mr-2"></i>
                    Ready to ${isReturn ? 'Return' : 'Borrow'}
                </p>
            </div>
        `;
        
        confirmBtn.textContent = isReturn ? "Confirm Return" : "Confirm Borrow";
        confirmBtn.style.backgroundColor = isReturn ? "#f97316" : "#16a34a";
        confirmBtn.classList.remove("hidden");
        
        // 6. Transaction via Socket
        confirmBtn.onclick = () => {
            confirmBtn.disabled = true;
            confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Processing...';

            socket.emit("transactionBook", { isbn: barcode, uid: currentUser, actionType }, (transRes) => {
                if (transRes.success) {
                    infoDiv.innerHTML = `
                        <div class="text-center py-4">
                            <i class="fas fa-check-circle text-5xl text-green-500 mb-3"></i>
                            <p class="font-bold text-gray-800 text-xl">Success!</p>
                            <p class="text-gray-600 mt-1">Book ${isReturn ? 'returned' : 'borrowed'} successfully.</p>
                        </div>
                    `;
                    confirmBtn.classList.add("hidden");
                    scanAnotherBtn.classList.remove("hidden");
                } else {
                    alert("Action Failed: " + transRes.error);
                    confirmBtn.disabled = false;
                    confirmBtn.textContent = isReturn ? "Retry Return" : "Retry Borrow";
                }
            });
        };
      });

    } catch (err) {
      console.error("Logic Error:", err);
      infoDiv.innerHTML = `<p class="text-red-500 text-center font-medium">System Error: ${err.message}</p>`;
      scanAnotherBtn.classList.remove("hidden");
    }
  }

  // --- Listeners ---
  scanAnotherBtn.addEventListener("click", () => {
    actionPanel.style.display = "none";
    openBarcodeScanner();
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