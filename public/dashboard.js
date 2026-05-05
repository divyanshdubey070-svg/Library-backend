// --- WebSocket Implementation ---
const uid = localStorage.getItem('uid');
const socket = io();
if (!uid) {
    window.location.href = "index.html";
}

// security check removed as it relied on Firebase

// The global socket is initialized in HTML, we can use it here
// Make sure it's accessible or re-initialize it if needed.
// Actually, it's defined in HTML or we can use the global `socket` if initialized there.
// Since `socket` is already created in the HTML via another script or below, let's just use it.

const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
const loginTime = localStorage.getItem('loginTimestamp');
if (!loginTime || (Date.now() - parseInt(loginTime)) > TWENTY_FOUR_HOURS) {
        alert("Your session has expired. Please log in again.");
        localStorage.removeItem('loginTimestamp');
        localStorage.removeItem('uid');
        window.location.href = "index.html";
        throw new Error("Session expired");
    }
// ----------------------------------------

// Elements
const qrScannerBtn = document.getElementById('qrScannerBtn');
const qrModal = document.getElementById('qrModal');
const qrModalOverlay = document.getElementById('qrModalOverlay');
const closeQrModal = document.getElementById('closeQrModal');
const qrCodeContainer = document.getElementById('userQrCode');

// --- Updated User Name Display ---
// We can fetch from local storage or ask the server
const userName = localStorage.getItem('fullName') || "Student";
document.querySelectorAll('#welcomeUserName').forEach(span => {
    span.textContent = " " + userName;
});

// --- NEW: Activity Logs Listener (WebSocket) ---
function startLogsListener(uid) {
    const logsTableBody = document.getElementById('studentLogsTable');
    
    // We assume socket is available globally
    if (typeof socket === 'undefined') return;

    socket.emit("fetchLogs", { uid }, (res) => {
        if (!res.success) return;
        
        let logRows = '';
        if (res.logs.length === 0) {
            logRows = `<tr><td colspan="4" class="px-6 py-4 text-center text-sm text-gray-500">No visit history found.</td></tr>`;
        } else {
            res.logs.forEach(log => {
                const date = new Date(log.timestamp).toLocaleDateString() || "Recent";
                const timeIn = log.timeIn || "--:--";
                const timeOut = log.timeOut || "--:--";

                const statusBadge = log.status === 1
                    ? `<span class="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">Inside</span>`
                    : `<span class="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800">Completed</span>`;

                logRows += `
                    <tr class="hover:bg-gray-50">
                        <td class="px-6 py-4 text-sm text-gray-900">${date}</td>
                        <td class="px-6 py-4 text-sm text-gray-600">${timeIn}</td>
                        <td class="px-6 py-4 text-sm text-gray-600">${timeOut}</td>
                        <td class="px-6 py-4 whitespace-nowrap">${statusBadge}</td>
                    </tr>
                `;
            });
        }
        if (logsTableBody) {
            logsTableBody.innerHTML = logRows;
        }
    });
}

// Load everything for the current uid
startLogsListener(uid);

// Utility: Open modal and generate QR code
async function openQrModal(uid) {
    if (!uid) return;
    
    const qrData = {
        uid: uid,
        loginTimestamp: new Date().toISOString()
    };
    
    const jsonString = JSON.stringify(qrData);
    const encodedData = btoa(encodeURIComponent(jsonString));

    qrCodeContainer.innerHTML = ""; // clear old QR
    new QRCode(qrCodeContainer, {
        text: encodedData,
        width: 220,
        height: 220
    });
    qrModal.classList.remove('hidden');
}

// Always set up close listeners once!
closeQrModal.addEventListener('click', () => qrModal.classList.add('hidden'));
qrModalOverlay.addEventListener('click', () => qrModal.classList.add('hidden'));

// --- RENEWAL LOGIC ---
window.renewBook = async (docId, currentDueDateStr) => {
    const confirmRenew = confirm("Do you want to renew this book for an additional 7 days?");
    if (!confirmRenew) return;

    if (typeof socket !== 'undefined') {
        socket.emit("renewBook", { bookId: docId, currentDueDateStr }, (res) => {
            if (res.error) {
                alert("Failed to renew book: " + res.error);
            } else {
                alert("✅ Book renewed successfully! Your new due date is " + new Date(res.newDueDate).toLocaleDateString());
                fetchBorrowedBooks(); // Refresh UI
            }
        });
    }
};

function fetchBorrowedBooks() {
    if (typeof socket === 'undefined') return;
    
    socket.emit("fetchDashboardData", { uid }, (res) => {
        if (!res.success) return;
        
        let borrowedCount = 0;
        let dueSoonCount = 0;
        let overdueCount = 0;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const tableBody = document.getElementById('studentBooksTable');
        let tableRows = '';

        res.books.forEach(data => {
            if (!data.returned) {
                borrowedCount++;

                let dueDateStr = "N/A";
                let borrowedDateStr = "N/A";
                let statusBadge = `<span class="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800">Unknown</span>`;

                let dueVal = data.dueDate || data.dueAt || null;
                let diffDays = 0;
                let validIsoDate = null;

                if (data.issuedAt) borrowedDateStr = new Date(data.issuedAt).toLocaleDateString();

                if (dueVal) {
                    const dueDate = new Date(dueVal);
                    dueDate.setHours(0, 0, 0, 0);
                    dueDateStr = dueDate.toLocaleDateString();
                    validIsoDate = dueDate.toISOString();

                    const diffTime = dueDate - today;
                    diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                    if (diffDays < 0) {
                        overdueCount++;
                        statusBadge = `<span class="px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800">Overdue by ${Math.abs(diffDays)} days</span>`;
                    } else if (diffDays === 0) {
                        dueSoonCount++;
                        statusBadge = `<span class="px-2 py-1 text-xs font-semibold rounded-full bg-orange-100 text-orange-800 animate-pulse">Due Today!</span>`;
                    } else if (diffDays <= 3) {
                        dueSoonCount++;
                        statusBadge = `<span class="px-2 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800">${diffDays} days left</span>`;
                    } else {
                        statusBadge = `<span class="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">${diffDays} days left</span>`;
                    }
                }

                let renewButton = `<span class="text-xs text-gray-400">N/A</span>`;

                if (dueVal && validIsoDate) {
                    // Note: Use data._id since MongoDB uses _id instead of Firebase's doc.id
                    renewButton = `<button onclick="window.renewBook('${data._id}', '${validIsoDate}')" class="bg-blue-50 hover:bg-blue-100 text-blue-600 font-medium py-1.5 px-3 rounded text-xs transition-colors border border-blue-200"><i class="fas fa-redo-alt mr-1"></i> Renew</button>`;

                    if (diffDays < -3) {
                        renewButton = `<span class="text-xs text-red-500 italic">See Librarian</span>`;
                    }
                }

                tableRows += `
                    <tr class="hover:bg-gray-50">
                        <td class="px-6 py-4 text-sm font-medium text-gray-900">${data.title || data.bookTitle || 'Unknown Book'}</td>
                        <td class="px-6 py-4 text-sm text-gray-500">${borrowedDateStr}</td>
                        <td class="px-6 py-4 text-sm text-gray-500">${dueDateStr}</td>
                        <td class="px-6 py-4 whitespace-nowrap">${statusBadge}</td>
                        <td class="px-6 py-4 whitespace-nowrap">${renewButton}</td>
                    </tr>
                `;
            }
        });
        
        document.getElementById("booksBorrowedCount").textContent = borrowedCount;
        document.getElementById("booksDueSoonCount").textContent = dueSoonCount;
        document.getElementById("overdueBooksCount").textContent = overdueCount;

        if (tableBody) {
            if (tableRows === '') {
                tableBody.innerHTML = `<tr><td colspan="5" class="px-6 py-4 text-center text-sm text-gray-500">You have no actively borrowed books.</td></tr>`;
            } else {
                tableBody.innerHTML = tableRows;
            }
        }
    });
}

// Initial fetch
fetchBorrowedBooks();

// Listen for updates from server to refresh live
if (typeof socket !== 'undefined') {
    socket.on("bookUpdated", () => {
        fetchBorrowedBooks();
    });
}

// QR button event listener
qrScannerBtn.addEventListener('click', () => {
    openQrModal(uid);
});