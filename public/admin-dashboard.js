// admin-dashboard.js (Socket.io SQLite version)
const socket = io();

// Ensure local session storage is checked (basic admin protection)
const uid = localStorage.getItem('uid');
const loginTime = localStorage.getItem('loginTimestamp');
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

if (!uid || !loginTime || (Date.now() - parseInt(loginTime)) > TWENTY_FOUR_HOURS) {
    alert("Admin session expired or invalid. Please log in again.");
    localStorage.removeItem('loginTimestamp');
    localStorage.removeItem('uid');
    window.location.replace("index.html");
}

const $ = (id) => document.getElementById(id);
const safeText = (id, text) => { if ($(id)) $(id).textContent = text; };

/* ------------- State Management ------------- */
let currentTab = 'today';
let gateLogs = [], bookLogs = [], waitlistLogs = [], inventoryData = [], studentsData = [], whitelistData = [];
let allUsersMap = {};
let manualScanner = null; // Holds the camera instance

/* ------------- Fetch All Data via Socket ------------- */
function refreshData() {
    socket.emit("adminFetchAllData", (res) => {
        if (res.error) {
            console.error("Failed to fetch admin data:", res.error);
            return;
        }

        studentsData = res.users;
        inventoryData = res.books;
        bookLogs = res.borrowedBooks;
        gateLogs = res.activityLogs;
        whitelistData = res.whitelist;

        // Build mapping of user ID to user object for easy lookup
        allUsersMap = {};
        studentsData.forEach(u => {
            allUsersMap[u.uid] = u;
        });

        // Update counts
        updateDashboardCounts();

        // Render current active tab
        if (currentTab === 'whitelist') {
            renderWhitelistTable();
        } else {
            renderLogsTable();
        }
    });
}

// Initial fetch and listener for updates
if (socket.connected) {
    refreshData();
} else {
    socket.on("connect", refreshData);
}
socket.on("adminDataUpdated", refreshData);
socket.on("booksUpdated", (books) => {
    inventoryData = books;
    updateDashboardCounts();
    if (currentTab === 'inventory') renderLogsTable();
});

function updateDashboardCounts() {
    // Total Books
    const totalBooks = inventoryData.reduce((acc, b) => acc + (parseInt(b.quantity) || 0), 0);
    safeText('totalBooksCount', totalBooks);

    // Borrowed
    const activeBorrows = bookLogs.filter(b => !b.returned);
    safeText('totalBorrowedCount', activeBorrows.length);

    // Overdue
    let overdue = 0;
    const now = Date.now();
    activeBorrows.forEach(b => {
        const dueMs = b.dueDate ? new Date(b.dueDate).getTime() : 0;
        if (dueMs && dueMs < now) {
            overdue++;
        }
    });
    safeText('overdueCount', overdue);
}

/* ------------- CSV Export Logic ------------- */
$('btnExportCSV').addEventListener('click', () => {
    const table = $('mainDataTable');
    let csvContent = "";

    // Extract Headers
    const headers = Array.from(table.querySelectorAll('th')).map(th => `"${th.innerText.replace(/"/g, '""')}"`);
    if (headers[headers.length - 1] && headers[headers.length - 1].includes('ACTION')) headers.pop();
    csvContent += headers.join(",") + "\n";

    // Extract Rows
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    rows.forEach(row => {
        const cells = Array.from(row.querySelectorAll('td'));
        if (cells.length === 1 && cells[0].innerText.includes('Loading')) return;

        const rowData = cells.map((cell, index) => {
            if (index === cells.length - 1 && cell.innerHTML.includes('<button')) return null;
            let text = cell.innerText.replace(/"/g, '""').replace(/\n/g, ' ');
            return `"${text}"`;
        }).filter(item => item !== null);

        csvContent += rowData.join(",") + "\n";
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", `Library_Report_${currentTab}_${new Date().toLocaleDateString()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
});

/* ------------- Actionable Overdue (WhatsApp/Email) ------------- */
window.notifyOverdue = (name, title, dueDate, phone) => {
    const message = `Library Notice: Hi ${name}, your borrowed book "${title}" was due on ${dueDate}. Please return it to the library to avoid any late fines. Thank you!`;
    if (phone && phone.length > 5) {
        const cleanPhone = phone.replace(/\D/g, '');
        window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`, '_blank');
    } else {
        alert("Phone number not registered. Copy this message to email:\n\n" + message);
    }
};

/* ------------- Student Overrides (Suspend / Force Exit) ------------- */
window.toggleSuspend = (uid, currentStatus) => {
    if (!confirm(`Are you sure you want to ${currentStatus ? 'UNSUSPEND' : 'SUSPEND'} this user?`)) return;
    socket.emit("adminToggleSuspend", { uid, currentStatus }, (res) => {
        if (res.error) alert("Failed: " + res.error);
        else alert("User status updated successfully.");
    });
};

window.forceExit = (uid) => {
    if (!confirm("Force check-out for this student?")) return;
    socket.emit("adminForceExit", { uid }, (res) => {
        if (res.error) alert("Failed: " + res.error);
        else alert("Student checked out successfully.");
    });
};

window.adminReturnBook = (bookId, studentUid) => {
    if (!confirm("Are you sure you want to mark this book as returned?")) return;
    socket.emit("transactionBook", { isbn: bookId, uid: studentUid, actionType: "return" }, (res) => {
        if (res.error) {
            alert("Failed to return book: " + res.error);
        } else {
            alert("✅ Book marked as returned!");
            refreshData();
        }
    });
};

/* ------------- Inventory Management (Edit/Delete) ------------- */
window.openEditBook = (isbn) => {
    const book = inventoryData.find(b => b.isbn === isbn);
    if (!book) return;
    $('editIsbnHidden').value = book.isbn;
    $('editTitle').value = book.title;
    $('editQuantity').value = book.quantity;
    $('editAvailable').value = book.available;
    $('editBookModal').classList.remove('hidden');
};

$('editBookForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const isbn = $('editIsbnHidden').value;
    const nTotal = parseInt($('editQuantity').value);
    const nAvail = parseInt($('editAvailable').value);

    if (nTotal < (nTotal - nAvail)) {
        alert("Error: Total quantity cannot be less than currently borrowed books.");
        return;
    }

    socket.emit("adminEditBook", { isbn, title: $('editTitle').value, quantity: nTotal, available: nAvail }, (res) => {
        if (res.error) {
            alert("Update failed: " + res.error);
        } else {
            $('editBookModal').classList.add('hidden');
            alert("Inventory updated!");
        }
    });
});

window.deleteBook = (isbn) => {
    const book = inventoryData.find(b => b.isbn === isbn);
    if (!book) return;
    const borrowed = parseInt(book.quantity) - parseInt(book.available);
    if (borrowed > 0) {
        alert(`Cannot delete. ${borrowed} copies are currently checked out.`);
        return;
    }
    if (confirm(`Permanently delete "${book.title}"?`)) {
        socket.emit("adminDeleteBook", { isbn }, (res) => {
            if (res.error) alert("Failed: " + res.error);
            else alert("Book deleted successfully.");
        });
    }
};

/* ------------- Dynamic Table Headers & Render ------------- */
function updateTableHeaders(mode) {
    const thead = $('dynamicTableHeaders');
    if (mode === 'inventory') {
        thead.innerHTML = `<tr><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Title</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">ISBN</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Total Stock</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Available</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th></tr>`;
    } else if (mode === 'students') {
        thead.innerHTML = `<tr><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Enrollment</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Branch</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th></tr>`;
    } else if (mode === 'whitelist') {
        thead.innerHTML = `<tr>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Enrollment</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Branch</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Phone</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase w-16 text-center">Actions</th>
        </tr>`;
    } else if (mode === 'waitlists') {
        thead.innerHTML = `<tr><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Position</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Book</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Student</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reserved On</th></tr>`;
    } else if (mode === 'borrows' || mode === 'returns') {
        thead.innerHTML = `<tr>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Enrollment</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Student Name</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Book Title / ISBN</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">${mode === 'borrows' ? 'Borrowed At' : 'Returned At'}</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">${mode === 'borrows' ? 'Due Date' : 'Originally Issued'}</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase w-1/5">${mode === 'borrows' ? 'Action' : 'Status'}</th>
        </tr>`;
    } else {
        thead.innerHTML = `<tr><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Enrollment</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time IN</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time OUT</th></tr>`;
    }
}

function renderLogsTable() {
    const tbody = $('logsTableBody');
    updateTableHeaders(currentTab);
    const today = new Date(); today.setHours(0, 0, 0, 0);

    if (currentTab === 'inventory') {
        tbody.innerHTML = inventoryData.map(b => `
            <tr class="hover:bg-gray-50 border-b">
                <td class="px-6 py-4 text-sm font-medium text-gray-900">${b.title}</td>
                <td class="px-6 py-4 text-sm text-gray-500">${b.isbn}</td>
                <td class="px-6 py-4 text-sm text-gray-500">${b.quantity}</td>
                <td class="px-6 py-4 text-sm font-bold ${b.available > 0 ? 'text-green-600' : 'text-red-600'}">${b.available}</td>
                <td class="px-6 py-4 text-sm space-x-2">
                    <button onclick="window.openEditBook('${b.isbn}')" class="text-yellow-600 hover:text-yellow-800"><i class="fas fa-edit"></i></button>
                    <button onclick="window.deleteBook('${b.isbn}')" class="text-red-600 hover:text-red-800"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `).join('') || `<tr><td colspan="5" class="px-6 py-8 text-center text-gray-500">No books found.</td></tr>`;
        return;
    }

    if (currentTab === 'students') {
        tbody.innerHTML = studentsData.map(s => `
            <tr class="hover:bg-gray-50 border-b">
                <td class="px-6 py-4 text-sm font-medium text-gray-900">${s.fullName || 'Unknown'}</td>
                <td class="px-6 py-4 text-sm text-gray-500">${s.enrollment || s.email || '-'}</td>
                <td class="px-6 py-4 text-sm text-gray-500">${s.department || '-'}</td>
                <td class="px-6 py-4 text-sm">${s.suspended ? '<span class="text-red-600 font-bold">Suspended</span>' : '<span class="text-green-600 font-bold">Active</span>'}</td>
                <td class="px-6 py-4 text-sm space-x-3 flex">
                    <button onclick="window.forceExit('${s.uid}')" class="text-blue-600 hover:text-blue-800" title="Force check out of gate"><i class="fas fa-sign-out-alt"></i></button>
                    <button onclick="window.toggleSuspend('${s.uid}', ${s.suspended || false})" class="${s.suspended ? 'text-green-600' : 'text-red-600'} hover:opacity-75" title="Toggle Access"><i class="fas ${s.suspended ? 'fa-check' : 'fa-ban'}"></i></button>
                </td>
            </tr>
        `).join('') || `<tr><td colspan="5" class="px-6 py-8 text-center text-gray-500">No students found.</td></tr>`;
        return;
    }

    let filteredData = [];
    if (currentTab === 'today') {
        filteredData = gateLogs.filter(l => new Date(l.timestamp) >= today);
    } else if (currentTab === 'history') {
        filteredData = gateLogs.filter(l => new Date(l.timestamp) < today);
    } else if (currentTab === 'waitlists') {
        filteredData = waitlistLogs;
    } else if (currentTab === 'borrows') {
        filteredData = bookLogs.filter(b => !b.returned);
    } else if (currentTab === 'returns') {
        filteredData = bookLogs.filter(b => b.returned);
    } else {
        filteredData = bookLogs;
    }

    if (filteredData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="px-6 py-8 text-center text-gray-500">No records found.</td></tr>`;
        return;
    }

    if (currentTab === 'waitlists') {
        tbody.innerHTML = filteredData.map((log, i) => {
            const user = allUsersMap[log.userId] || {};
            const displayName = user.fullName || 'Unknown';
            return `
            <tr class="hover:bg-gray-50 border-b">
                <td class="px-6 py-4 text-sm font-bold text-purple-600">#${i + 1}</td>
                <td class="px-6 py-4 text-sm font-medium">${log.bookTitle}</td>
                <td class="px-6 py-4 text-sm text-gray-500">${displayName}</td>
                <td class="px-6 py-4 text-sm text-gray-500">${new Date(log.timestamp).toLocaleString()}</td>
            </tr>
        `}).join('');
        return;
    }

    if (currentTab === 'borrows') {
        tbody.innerHTML = filteredData.map(log => {
            const user = allUsersMap[log.userId] || {};
            const dateObj = new Date(log.issuedAt);
            const dueObj = log.dueDate ? new Date(log.dueDate) : null;
            const displayEnrollment = log.enrollment || user.enrollment || '-';
            const displayName = log.name || user.fullName || 'Unknown';

            const isOverdue = dueObj && dueObj.getTime() < Date.now();
            const badge = `<span class="px-2 py-1 text-xs font-semibold rounded-full ${isOverdue ? 'bg-red-100 text-red-800' : 'bg-orange-100 text-orange-800'}">${isOverdue ? 'OVERDUE' : 'BORROWED'}</span>`;

            const returnBtn = `<button onclick="window.adminReturnBook('${log.bookId}', '${log.userId}')" class="ml-2 bg-green-50 hover:bg-green-100 text-green-600 font-semibold py-1 px-2 rounded text-xs transition-colors border border-green-200"><i class="fas fa-undo mr-1"></i>Return</button>`;

            let overdueAction = '';
            if (dueObj && isOverdue) {
                overdueAction = `<button onclick="window.notifyOverdue('${displayName}', '${log.title}', '${dueObj.toLocaleDateString()}', '${user.phone || ''}')" class="ml-3 text-red-600 hover:text-red-800 font-bold text-xs"><i class="fas fa-bell mr-1"></i>Notify</button>`;
            }

            return `
                <tr class="hover:bg-gray-50 border-b">
                    <td class="px-6 py-4 text-sm font-medium text-gray-900">${displayEnrollment}</td>
                    <td class="px-6 py-4 text-sm text-gray-500">${displayName}</td>
                    <td class="px-6 py-4 text-sm text-gray-900 font-medium">${log.title || 'Unknown Book'}<br><span class="text-xs text-blue-600">ISBN: ${log.bookId}</span></td>
                    <td class="px-6 py-4 text-sm text-gray-500">${dateObj.toLocaleDateString()} ${dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</td>
                    <td class="px-6 py-4 text-sm font-semibold ${isOverdue ? 'text-red-600' : 'text-gray-500'}">${dueObj ? dueObj.toLocaleDateString() : '-'}</td>
                    <td class="px-6 py-4 text-sm">${badge} ${returnBtn} ${overdueAction}</td>
                </tr>
            `;
        }).join('');
        return;
    }

    if (currentTab === 'returns') {
        tbody.innerHTML = filteredData.map(log => {
            const user = allUsersMap[log.userId] || {};
            const dateObj = log.returnedAt ? new Date(log.returnedAt) : (log.updatedAt ? new Date(log.updatedAt) : new Date());
            const issuedObj = log.issuedAt ? new Date(log.issuedAt) : null;
            const displayEnrollment = log.enrollment || user.enrollment || '-';
            const displayName = log.name || user.fullName || 'Unknown';

            const badge = `<span class="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">RETURNED</span>`;

            return `
                <tr class="hover:bg-gray-50 border-b">
                    <td class="px-6 py-4 text-sm font-medium text-gray-900">${displayEnrollment}</td>
                    <td class="px-6 py-4 text-sm text-gray-500">${displayName}</td>
                    <td class="px-6 py-4 text-sm text-gray-900 font-medium">${log.title || 'Unknown Book'}<br><span class="text-xs text-blue-600">ISBN: ${log.bookId}</span></td>
                    <td class="px-6 py-4 text-sm text-green-600 font-medium">${dateObj.toLocaleDateString()} ${dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</td>
                    <td class="px-6 py-4 text-sm text-gray-500">${issuedObj ? issuedObj.toLocaleDateString() : '-'}</td>
                    <td class="px-6 py-4 text-sm">${badge}</td>
                </tr>
            `;
        }).join('');
        return;
    }

    tbody.innerHTML = filteredData.map(log => {
        const user = allUsersMap[log.userId] || {};
        const dateObj = new Date(log.timestamp || log.issuedAt);
        const timeIn = log.timeIn || '--:--';
        const timeOut = log.timeOut || '--:--';

        const displayEnrollment = log.enrollment || user.enrollment || '-';
        const displayName = log.name || user.fullName || 'Unknown';

        return `
            <tr class="hover:bg-gray-50 border-b">
                <td class="px-6 py-4 text-sm font-medium text-gray-900">${displayEnrollment}</td>
                <td class="px-6 py-4 text-sm text-gray-500">${displayName}<br><span class="text-xs text-blue-600">${log.title || ''}</span></td>
                <td class="px-6 py-4 text-sm text-gray-500">${dateObj.toLocaleDateString()}</td>
                <td class="px-6 py-4 text-sm text-green-600">${timeIn}</td>
                <td class="px-6 py-4 text-sm text-red-600">${timeOut}</td>
            </tr>
        `;
    }).join('');
}

/* ------------- Tab Listeners ------------- */
['tabToday', 'tabHistory', 'tabBorrows', 'tabReturns', 'tabWaitlists', 'tabInventory', 'tabStudents', 'tabWhitelist'].forEach(id => {
    $(id).addEventListener('click', () => {
        ['tabToday', 'tabHistory', 'tabBorrows', 'tabReturns', 'tabWaitlists', 'tabInventory', 'tabStudents', 'tabWhitelist'].forEach(t => {
            $(t).classList.remove('text-blue-600', 'border-b-2', 'border-blue-600');
            $(t).classList.add('text-gray-500');
        });

        $(id).classList.add('text-blue-600', 'border-b-2', 'border-blue-600');
        currentTab = id.replace('tab', '').toLowerCase();

        if (currentTab === 'whitelist') {
            $('whitelistControls').classList.remove('hidden');
            renderWhitelistTable();
        } else {
            $('whitelistControls').classList.add('hidden');
            renderLogsTable();
        }
    });
});

/* ------------- Manual Issue/Return Form Logic ------------- */
$('btnManualTrans').addEventListener('click', () => $('manualTransModal').classList.remove('hidden'));

// Scanner Setup
$('startManualScanBtn').addEventListener('click', () => {
    $('manualScannerBox').classList.remove('hidden');
    if (manualScanner) { manualScanner.clear(); }

    manualScanner = new Html5Qrcode("manualScannerContainer");
    manualScanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 150 } },
        (decodedText) => {
            $('manualISBN').value = decodedText;
            stopManualScanner();
        },
        (err) => {}
    ).catch(err => {
        alert("Camera error: Ensure you have granted permission.");
        $('manualScannerBox').classList.add('hidden');
    });
});

function stopManualScanner() {
    if (manualScanner) {
        manualScanner.stop().then(() => {
            manualScanner.clear();
            manualScanner = null;
        }).catch(e => console.log(e));
    }
    $('manualScannerBox').classList.add('hidden');
}

$('stopManualScanBtn').addEventListener('click', stopManualScanner);

const closeManual = () => {
    $('manualTransModal').classList.add('hidden');
    stopManualScanner();
};
$('closeManualTrans').onclick = closeManual;
$('manualTransOverlay').onclick = closeManual;
$('closeEditBook').onclick = () => $('editBookModal').classList.add('hidden');
$('editBookOverlay').onclick = () => $('editBookModal').classList.add('hidden');

// Submit Transaction
$('manualTransForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const identifier = $('manualEnrollment').value.trim();
    const isbn = $('manualISBN').value.trim();
    const action = $('manualAction').value;

    const user = studentsData.find(u => u.enrollment === identifier || u.email === identifier);
    if (!user) { alert("Student not found. Please check enrollment number/email."); return; }

    socket.emit("transactionBook", { isbn, uid: user.uid, actionType: action }, (res) => {
        if (res.error) {
            alert("Transaction failed: " + res.error);
        } else {
            alert(`Successfully manually ${action}ed!`);
            $('manualTransModal').classList.add('hidden');
            $('manualTransForm').reset();
            refreshData();
        }
    });
});

/* ------------- Gate Scanner (Check-in/out) ------------- */
const scannerModal = $('scannerModal');
const openScannerBtn = $('openScannerBtn');
const closeScannerModal = $('closeScannerModal');
const scannerModalOverlay = $('scannerModalOverlay');
const messageBox = $('scanMessage');

let html5QrcodeScanner = null;
let lastScannedString = "";

function showMessage(text, type) {
    if (!messageBox) return;
    messageBox.textContent = text;
    messageBox.classList.remove('hidden', 'bg-green-100', 'text-green-800', 'bg-red-100', 'text-red-800', 'bg-yellow-100', 'text-yellow-800');

    if (type === 'success') messageBox.classList.add('bg-green-100', 'text-green-800');
    else if (type === 'error') messageBox.classList.add('bg-red-100', 'text-red-800');
    else if (type === 'warning') messageBox.classList.add('bg-yellow-100', 'text-yellow-800');

    messageBox.classList.remove('hidden');
    setTimeout(() => messageBox.classList.add('hidden'), 4000);
}

function handleScan(decodedText) {
    if (decodedText === lastScannedString) return;
    lastScannedString = decodedText;
    setTimeout(() => lastScannedString = "", 4000);

    let userData;
    try {
        userData = JSON.parse(decodeURIComponent(atob(decodedText)));
    } catch (err) {
        showMessage("Invalid QR Code Format.", "error");
        return;
    }

    const enrollment = userData.enrollment || "N/A";
    const name = userData.fullName || "Unknown User";
    const branch = userData.department || "-";
    const sem = userData.semester || "-";

    // Send scan log to SQLite backend via Socket
    socket.emit("adminScanGateQR", { enrollment, name, branch, sem, isVerifiedChecked: false }, (res) => {
        if (res.error) {
            showMessage(res.error, "error");
        } else if (res.needsVerification) {
            // Confirm verification physically
            const confirmActivation = confirm(`Verification Required: \nName: ${res.user.fullName}\nEnrollment: ${res.user.enrollment}\n\nHave you checked their physical ID card? Click OK to activate them permanently.`);
            if (confirmActivation) {
                // Emit again with verification confirmation
                socket.emit("adminScanGateQR", { enrollment, name, branch, sem, isVerifiedChecked: true }, (verifyRes) => {
                    if (verifyRes.error) {
                        showMessage(verifyRes.error, "error");
                    } else {
                        showMessage(`✅ Activated & Logged: ${name}`, "success");
                    }
                });
            } else {
                showMessage(`Activation cancelled for ${name}.`, "warning");
            }
        } else {
            const actionText = res.action === "in" ? "Checked IN" : "Checked OUT";
            showMessage(`✅ ${actionText}: ${res.name}`, "success");
        }
    });
}

function openScanner() {
    scannerModal.classList.remove('hidden');
    if (!html5QrcodeScanner) {
        const scannerConfig = {
            fps: 15,
            qrbox: { width: 300, height: 300 },
            disableFlip: false,
            formatsToSupport: [window.Html5QrcodeSupportedFormats.QR_CODE],
            videoConstraints: {
                facingMode: "environment",
                width: { min: 640, ideal: 1280, max: 1920 },
                height: { min: 480, ideal: 720, max: 1080 }
            }
        };
        html5QrcodeScanner = new window.Html5QrcodeScanner("reader", scannerConfig, false);
        html5QrcodeScanner.render(handleScan, () => {});
    }
}

function closeScanner() {
    scannerModal.classList.add('hidden');
    if (html5QrcodeScanner) {
        html5QrcodeScanner.clear().then(() => {
            html5QrcodeScanner = null;
        }).catch(err => console.error("Failed to clear scanner", err));
    }
}

if (openScannerBtn) openScannerBtn.addEventListener('click', openScanner);
if (closeScannerModal) closeScannerModal.addEventListener('click', closeScanner);
if (scannerModalOverlay) scannerModalOverlay.addEventListener('click', closeScanner);


/* ------------- Whitelist Management ------------- */
const whitelistSearchInput = document.getElementById('whitelistSearch');

if (whitelistSearchInput) {
    whitelistSearchInput.addEventListener('input', () => {
        if (currentTab === 'whitelist') renderWhitelistTable();
    });
}

function renderWhitelistTable() {
    const tbody = $('logsTableBody');
    updateTableHeaders('whitelist');

    const searchTerm = whitelistSearchInput ? whitelistSearchInput.value.toLowerCase() : '';

    const filtered = whitelistData.filter(student =>
        student.enrollment.toLowerCase().includes(searchTerm) ||
        (student.name && student.name.toLowerCase().includes(searchTerm))
    );

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="px-6 py-8 text-center text-gray-500">No whitelisted students found.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(s => {
        const statusBadge = s.isClaimed
            ? `<span class="px-2 py-1 bg-green-100 text-green-800 text-xs font-bold rounded border border-green-200">Claimed & Registered</span>`
            : `<span class="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs font-bold rounded border border-yellow-200">Pending Signup</span>`;

        return `
        <tr class="hover:bg-gray-50 border-b">
            <td class="px-6 py-4 text-sm font-medium text-gray-800">${s.name || 'N/A'}</td>
            <td class="px-6 py-4 text-sm font-mono text-gray-900 font-bold">${s.enrollment}</td>
            <td class="px-6 py-4 text-sm text-gray-500">${s.department || '-'}</td>
            <td class="px-6 py-4 text-sm text-gray-500">${s.email || '-'}</td>
            <td class="px-6 py-4 text-sm text-gray-500">${s.phone || '-'}</td>
            <td class="px-6 py-4 text-sm">${statusBadge}</td>
            <td class="px-6 py-4 text-sm text-center">
                 <button onclick="window.deleteWhitelistStudent('${s.enrollment}')" class="text-red-600 hover:text-red-800 p-2 rounded hover:bg-red-50 transition-colors" title="Delete from Whitelist">
                     <i class="fas fa-trash"></i>
                 </button>
            </td>
        </tr>
    `}).join('');
}

window.deleteWhitelistStudent = (enrollment) => {
    if (!confirm(`Are you sure you want to permanently delete enrollment ${enrollment} from the approved list?`)) return;

    socket.emit("adminDeleteWhitelist", { enrollment }, (res) => {
        if (res.error) alert("Failed: " + res.error);
        else alert("Student successfully removed from the whitelist.");
    });
};

document.getElementById('csvFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!confirm("Are you sure you want to bulk upload these students?")) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        const text = event.target.result;
        const rows = text.split('\n');
        const students = [];

        for (let i = 1; i < rows.length; i++) {
            const cols = rows[i].split(',');
            if (cols.length >= 5) {
                const enrollment = cols[0].trim();
                const name = cols[1].trim();
                const email = cols[2].trim().toLowerCase();
                const phone = cols[3].trim();
                const department = cols[4].trim();

                if (enrollment && name && email) {
                    students.push({ enrollment, name, email, phone, department });
                }
            }
        }

        if (students.length === 0) {
            alert("No valid student rows found in the CSV.");
            e.target.value = '';
            return;
        }

        socket.emit("adminBulkUploadWhitelist", { students }, (res) => {
            if (res.error) {
                alert("Upload failed: " + res.error);
            } else {
                alert(`Successfully uploaded ${res.count} students to the whitelist!`);
            }
            e.target.value = '';
        });
    };
    reader.readAsText(file);
});

window.openManualAddModal = () => {
    const enrollment = prompt("Enter 12-digit Enrollment Number:");
    if (!enrollment) return;

    const name = prompt("Enter Student Name:");
    if (!name) return;

    const email = prompt("Enter Official College Email:");
    if (!email) return;

    const phone = prompt("Enter Phone Number:");
    if (!phone) return;

    const department = prompt("Enter Department (e.g., CSE, ECE):");
    if (!department) return;

    socket.emit("adminAddWhitelist", {
        enrollment: enrollment.trim(),
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        department: department.trim()
    }, (res) => {
        if (res.error) alert("Failed: " + res.error);
        else alert(`${name} added to the whitelist successfully!`);
    });
};