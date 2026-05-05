// admin-dashboard.js (Complete Version with All Features, Fixes & Scanner)
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-auth.js";
import {
    doc, getDoc, collection, query, where, onSnapshot, orderBy, limit,
    updateDoc, deleteDoc, setDoc, runTransaction, getDocs, serverTimestamp, addDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/9.6.10/firebase-firestore.js";

import { signOut } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-auth.js";

// --- UNIFIED AUTH & SECURITY CHECK ---
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.replace("index.html");
        return;
    }

    // 1. Check 24-Hour Session
    const loginTime = localStorage.getItem('loginTimestamp');
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

    if (loginTime && (Date.now() - parseInt(loginTime)) > TWENTY_FOUR_HOURS) {
        alert("Admin session expired for security. Please log in again.");
        localStorage.removeItem('loginTimestamp');
        await signOut(auth);
        window.location.replace("index.html");
        return;
    }

    // 2. Check Admin Role
    try {
        const userDoc = await getDoc(doc(db, "users", user.uid));

        // This accepts the user if their database role is 'admin' OR if their email contains 'admin'
        const isDbAdmin = userDoc.exists() && userDoc.data().role === 'admin';
        const isEmailAdmin = user.email && user.email.includes('admin');

        if (!isDbAdmin && !isEmailAdmin) {
            console.warn("Unauthorized access attempt.");
            alert("Unauthorized! You do not have Admin privileges.");
            window.location.replace("dashboard.html"); // Send back to student dashboard
            return;
        }

        // 3. If they pass all security checks, start loading the data!
        startRealtimeListeners();

    } catch (error) {
        console.error("Role verification failed:", error);
        window.location.replace("index.html");
    }
});
// ----------------------------------------


// ... rest of your code ...
const $ = (id) => document.getElementById(id);
const safeText = (id, text) => { if ($(id)) $(id).textContent = text; };

/* ------------- State Management ------------- */
let currentTab = 'today';
let gateLogs = [], bookLogs = [], waitlistLogs = [], inventoryData = [], studentsData = [];
let allUsersMap = {};
let manualScanner = null; // Holds the camera instance

/* ------------- CSV Export Logic ------------- */
$('btnExportCSV').addEventListener('click', () => {
    const table = $('mainDataTable');
    let csvContent = "";

    // Extract Headers
    const headers = Array.from(table.querySelectorAll('th')).map(th => `"${th.innerText.replace(/"/g, '""')}"`);
    // Remove the last "Actions" header if it exists so buttons don't export
    if (headers[headers.length - 1].includes('ACTION')) headers.pop();
    csvContent += headers.join(",") + "\n";

    // Extract Rows
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    rows.forEach(row => {
        const cells = Array.from(row.querySelectorAll('td'));
        if (cells.length === 1 && cells[0].innerText.includes('Loading')) return; // skip empty

        const rowData = cells.map((cell, index) => {
            // Skip the action buttons column for the CSV
            if (index === cells.length - 1 && cell.innerHTML.includes('<button')) return null;
            let text = cell.innerText.replace(/"/g, '""').replace(/\n/g, ' ');
            return `"${text}"`;
        }).filter(item => item !== null);

        csvContent += rowData.join(",") + "\n";
    });

    // Download Blob
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
        // Strip non-numbers
        const cleanPhone = phone.replace(/\D/g, '');
        window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`, '_blank');
    } else {
        alert("Phone number not registered. Copy this message to email:\n\n" + message);
    }
};

/* ------------- Student Overrides (Suspend / Force Exit) ------------- */
window.toggleSuspend = async (uid, currentStatus) => {
    if (!confirm(`Are you sure you want to ${currentStatus ? 'UNSUSPEND' : 'SUSPEND'} this user?`)) return;
    try {
        await updateDoc(doc(db, 'users', uid), { suspended: !currentStatus });
        alert("User status updated.");
    } catch (e) { console.error(e); alert("Failed to update user."); }
};

window.forceExit = async (uid) => {
    if (!confirm("Force check-out for this student?")) return;
    try {
        const q = query(collection(db, 'activityLogs'), where("userId", "==", uid), where("status", "==", 1));
        const snap = await getDocs(q);
        if (snap.empty) { alert("Student is not currently marked as inside the library."); return; }

        const logDoc = snap.docs[0];
        await updateDoc(doc(db, 'activityLogs', logDoc.id), {
            status: 0,
            timeOut: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });
        alert("Student checked out successfully.");
    } catch (e) { console.error(e); alert("Failed to force exit."); }
};

/* ------------- Inventory Management (Edit/Delete) ------------- */
window.openEditBook = (isbn) => {
    const book = inventoryData.find(b => b.id === isbn || b.isbn === isbn);
    if (!book) return;
    $('editIsbnHidden').value = book.isbn || book.id;
    $('editTitle').value = book.title;
    $('editQuantity').value = book.quantity;
    $('editAvailable').value = book.available;
    $('editBookModal').classList.remove('hidden');
};

$('editBookForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const isbn = $('editIsbnHidden').value;
    const nTotal = parseInt($('editQuantity').value);
    const nAvail = parseInt($('editAvailable').value);

    if (nTotal < (nTotal - nAvail)) {
        alert("Error: Total quantity cannot be less than currently borrowed books.");
        return;
    }

    try {
        await updateDoc(doc(db, 'books', isbn), { title: $('editTitle').value, quantity: nTotal, available: nAvail });
        $('editBookModal').classList.add('hidden');
        alert("Inventory updated!");
    } catch (e) { alert("Update failed."); }
});

window.deleteBook = async (isbn) => {
    const book = inventoryData.find(b => b.id === isbn || b.isbn === isbn);
    const borrowed = parseInt(book.quantity) - parseInt(book.available);
    if (borrowed > 0) {
        alert(`Cannot delete. ${borrowed} copies are currently checked out.`);
        return;
    }
    if (confirm(`Permanently delete "${book.title}"?`)) {
        try { await deleteDoc(doc(db, 'books', isbn)); alert("Book deleted."); }
        catch (e) { alert("Failed to delete."); }
    }
};

/* ------------- Dynamic Table Headers & Render ------------- */
function updateTableHeaders(mode) {
    const thead = $('dynamicTableHeaders');
    if (mode === 'inventory') {
        thead.innerHTML = `<tr><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Title</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">ISBN</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Total Stock</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Available</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th></tr>`;
    } else if (mode === 'students') {
        thead.innerHTML = `<tr><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Enrollment</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Branch</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th></tr>`;
    }
    else if (mode === 'whitelist') {
        // NEW: Dedicated Headers for the Approved Students tab (7 columns)
        thead.innerHTML = `<tr>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Enrollment</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Branch</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Phone</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase w-16 text-center">Actions</th>
        </tr>`;
    }
    else if (mode === 'waitlists') {
        thead.innerHTML = `<tr><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Position</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Book</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Student</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reserved On</th></tr>`;
    }

    else {
        thead.innerHTML = `<tr><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Enrollment</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time IN</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time OUT</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase ${mode === 'books' ? '' : 'hidden'}">Transaction / Actions</th></tr>`;
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
                <td class="px-6 py-4 text-sm text-gray-500">${b.isbn || b.id}</td>
                <td class="px-6 py-4 text-sm text-gray-500">${b.quantity}</td>
                <td class="px-6 py-4 text-sm font-bold ${b.available > 0 ? 'text-green-600' : 'text-red-600'}">${b.available}</td>
                <td class="px-6 py-4 text-sm space-x-2">
                    <button onclick="window.openEditBook('${b.isbn || b.id}')" class="text-yellow-600 hover:text-yellow-800"><i class="fas fa-edit"></i></button>
                    <button onclick="window.deleteBook('${b.isbn || b.id}')" class="text-red-600 hover:text-red-800"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `).join('') || `<tr><td colspan="5" class="px-6 py-8 text-center text-gray-500">No books found.</td></tr>`;
        return;
    }

    if (currentTab === 'students') {
        tbody.innerHTML = studentsData.map(s => `
            <tr class="hover:bg-gray-50 border-b">
                <td class="px-6 py-4 text-sm font-medium text-gray-900">${s.fullName || s.name || 'Unknown'}</td>
                <td class="px-6 py-4 text-sm text-gray-500">${s.enrollment || s.enrollmentNo || s.email || '-'}</td>
                <td class="px-6 py-4 text-sm text-gray-500">${s.branch || '-'}</td>
                <td class="px-6 py-4 text-sm">${s.suspended ? '<span class="text-red-600 font-bold">Suspended</span>' : '<span class="text-green-600 font-bold">Active</span>'}</td>
                <td class="px-6 py-4 text-sm space-x-3 flex">
                    <button onclick="window.forceExit('${s.id}')" class="text-blue-600 hover:text-blue-800" title="Force check out of gate"><i class="fas fa-sign-out-alt"></i></button>
                    <button onclick="window.toggleSuspend('${s.id}', ${s.suspended || false})" class="${s.suspended ? 'text-green-600' : 'text-red-600'} hover:opacity-75" title="Toggle Access"><i class="fas ${s.suspended ? 'fa-check' : 'fa-ban'}"></i></button>
                </td>
            </tr>
        `).join('');
        return;
    }

    let filteredData = [];
    if (currentTab === 'today') filteredData = gateLogs.filter(l => (l.timestamp?.toDate() || new Date()) >= today);
    else if (currentTab === 'history') filteredData = gateLogs.filter(l => (l.timestamp?.toDate() || new Date()) < today);
    else if (currentTab === 'waitlists') filteredData = waitlistLogs;
    else filteredData = bookLogs;

    if (filteredData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="px-6 py-8 text-center text-gray-500">No records found.</td></tr>`;
        return;
    }

    if (currentTab === 'waitlists') {
        tbody.innerHTML = filteredData.map((log, i) => {
            const user = allUsersMap[log.userId] || {};
            const displayName = user.fullName || user.name || 'Unknown';
            return `
            <tr class="hover:bg-gray-50 border-b"><td class="px-6 py-4 text-sm font-bold text-purple-600">#${i + 1}</td>
            <td class="px-6 py-4 text-sm font-medium">${log.bookTitle}</td>
            <td class="px-6 py-4 text-sm text-gray-500">${displayName}</td>
            <td class="px-6 py-4 text-sm text-gray-500">${log.timestamp?.toDate().toLocaleString() || '-'}</td></tr>
        `}).join('');
        return;
    }

    // Gate & Books Rendering
    tbody.innerHTML = filteredData.map(log => {
        const user = allUsersMap[log.userId] || {};
        const dateObj = (log.timestamp || log.issueDate || log.issuedAt)?.toDate() || new Date();
        const timeIn = log.timeIn || (currentTab === 'books' && !log.returned ? dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-');
        const timeOut = log.timeOut || (currentTab === 'books' && log.returned ? dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-');

        // FIX: Comprehensive fallback for missing enrollment/name
        const displayEnrollment = log.enrollment || user.enrollment || user.enrollmentNo || user.email || '-';
        const displayName = user.fullName || user.name || log.userName || log.name || 'Unknown';

        let actionCell = '';
        if (currentTab === 'books') {
            const isBorrow = !log.returned;
            const badge = `<span class="px-2 text-xs font-semibold rounded-full ${isBorrow ? 'bg-orange-100 text-orange-800' : 'bg-green-100 text-green-800'}">${isBorrow ? 'BORROWED' : 'RETURNED'}</span>`;

            // OVERDUE ACTION LOGIC
            let overdueAction = '';
            if (isBorrow) {
                const dVal = log.dueDate || log.dueAt;
                const dueMs = dVal?.toDate?.().getTime() || new Date(dVal).getTime();
                if (dueMs && dueMs < Date.now()) {
                    overdueAction = `<button onclick="window.notifyOverdue('${displayName}', '${log.bookTitle || log.title}', '${new Date(dueMs).toLocaleDateString()}', '${user.phone || ''}')" class="ml-3 text-red-600 hover:text-red-800 font-bold text-xs"><i class="fas fa-bell mr-1"></i>Notify</button>`;
                }
            }
            actionCell = `<td class="px-6 py-4 text-sm">${badge} ${overdueAction}</td>`;
        }

        return `
            <tr class="hover:bg-gray-50 border-b">
                <td class="px-6 py-4 text-sm font-medium text-gray-900">${displayEnrollment}</td>
                <td class="px-6 py-4 text-sm text-gray-500">${displayName}<br><span class="text-xs text-blue-600">${log.bookTitle || log.title || ''}</span></td>
                <td class="px-6 py-4 text-sm text-gray-500">${dateObj.toLocaleDateString()}</td>
                <td class="px-6 py-4 text-sm text-green-600">${timeIn}</td>
                <td class="px-6 py-4 text-sm text-red-600">${timeOut}</td>
                ${actionCell}
            </tr>
        `;
    }).join('');
}

/* ------------- Tab Listeners ------------- */
/* ------------- Tab Listeners ------------- */
['tabToday', 'tabHistory', 'tabBooks', 'tabWaitlists', 'tabInventory', 'tabStudents', 'tabWhitelist'].forEach(id => {
    $(id).addEventListener('click', () => {
        // Reset all tabs to gray
        ['tabToday', 'tabHistory', 'tabBooks', 'tabWaitlists', 'tabInventory', 'tabStudents', 'tabWhitelist'].forEach(t => {
            $(t).classList.remove('text-blue-600', 'border-b-2', 'border-blue-600');
            $(t).classList.add('text-gray-500');
        });

        // Highlight clicked tab
        $(id).classList.add('text-blue-600', 'border-b-2', 'border-blue-600');
        currentTab = id.replace('tab', '').toLowerCase();

        // --- NEW: Toggle the Search/Upload Controls ---
        if (currentTab === 'whitelist') {
            $('whitelistControls').classList.remove('hidden');
            renderWhitelistTable();
        } else {
            $('whitelistControls').classList.add('hidden');
            renderLogsTable();
        }
    });
});

/* ------------- Manual Issue/Return Form Logic (WITH SCANNER) ------------- */
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
            $('manualISBN').value = decodedText; // Auto-fill
            stopManualScanner(); // Stop camera
        },
        (err) => { /* Ignore minor errors */ }
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

// Close Handlers (Ensures camera turns off if they click X)
const closeManual = () => {
    $('manualTransModal').classList.add('hidden');
    stopManualScanner();
};
$('closeManualTrans').onclick = closeManual;
$('manualTransOverlay').onclick = closeManual;
$('closeEditBook').onclick = () => $('editBookModal').classList.add('hidden');
$('editBookOverlay').onclick = () => $('editBookModal').classList.add('hidden');


// Submit Transaction
$('manualTransForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const identifier = $('manualEnrollment').value.trim();
    const isbn = $('manualISBN').value.trim();
    const action = $('manualAction').value;

    // Search for user by enrollment OR email
    const user = studentsData.find(u => u.enrollment === identifier || u.enrollmentNo === identifier || u.email === identifier);
    if (!user) { alert("Student not found. Please check enrollment number."); return; }

    const book = inventoryData.find(b => b.id === isbn || b.isbn === isbn);
    if (!book) { alert("Book not found. Please check ISBN."); return; }

    try {
        const bookRef = doc(db, 'books', book.id);
        const borrowRef = doc(db, 'borrowedBooks', `${user.id}_${book.id}`);

        await runTransaction(db, async (transaction) => {
            const freshBook = await transaction.get(bookRef);
            const avail = parseInt(freshBook.data().available);

            if (action === 'issue') {
                if (avail <= 0) throw "Book out of stock!";
                transaction.update(bookRef, { available: avail - 1 });
                const dueDate = new Date(); dueDate.setDate(dueDate.getDate() + 14);
                transaction.set(borrowRef, {
                    userId: user.id, bookId: book.id, title: book.title, author: book.author,
                    issuedAt: new Date(), dueDate: dueDate, returned: false
                });
            } else {
                transaction.update(bookRef, { available: avail + 1 });
                transaction.update(borrowRef, { returned: true, returnedAt: new Date() });
            }
        });
        alert(`Successfully manually ${action}ed!`);
        $('manualTransModal').classList.add('hidden');
        $('manualTransForm').reset();
    } catch (err) {
        alert("Transaction failed: " + err);
    }
});

/* ------------- Real-time DB Sync ------------- */
function startRealtimeListeners() {
    onSnapshot(collection(db, 'users'), (snap) => {
        allUsersMap = {}; studentsData = [];
        snap.forEach(s => { const d = { id: s.id, ...s.data() }; allUsersMap[s.id] = d; studentsData.push(d); });
        renderLogsTable();
    });

    onSnapshot(collection(db, 'books'), (snap) => {
        inventoryData = [];
        snap.forEach(s => inventoryData.push({ id: s.id, ...s.data() }));
        safeText('totalBooksCount', String(snap.size));
        if (currentTab === 'inventory') renderLogsTable();
    });

    onSnapshot(collection(db, 'borrowedBooks'), (snap) => {
        let borrowed = [], total = 0, overdue = 0, now = Date.now();
        snap.forEach(s => {
            const d = s.data();
            if (!d.returned) {
                total++;
                const dueMs = d.dueDate?.toDate?.().getTime() || new Date(d.dueDate).getTime();
                if (dueMs < now) overdue++;
            }
            borrowed.push({ id: s.id, ...d, source: 'borrowedBooks' });
        });
        safeText('totalBorrowedCount', total); safeText('overdueCount', overdue);
        bookLogs = borrowed; // Simplified for brevity
        if (currentTab === 'books') renderLogsTable();
    });

    onSnapshot(query(collection(db, 'activityLogs'), orderBy('timestamp', 'desc'), limit(100)), (snap) => {
        gateLogs = []; snap.forEach(s => gateLogs.push({ id: s.id, ...s.data() }));
        if (['today', 'history'].includes(currentTab)) renderLogsTable();
    });

    onSnapshot(query(collection(db, 'reservations'), where("status", "==", "waiting"), orderBy('timestamp', 'asc')), (snap) => {
        waitlistLogs = []; snap.forEach(s => waitlistLogs.push({ id: s.id, ...s.data() }));
        if (currentTab === 'waitlists') renderLogsTable();
    });
}

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

    setTimeout(() => messageBox.classList.add('hidden'), 4000);
}

async function handleScan(decodedText) {
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

    // Rely on Enrollment since it is guaranteed in the QR
    const enrollment = userData.enrollment || userData.enrollmentNo || "N/A";
    const name = userData.fullName || userData.fullname || "Unknown User";
    const branch = userData.department || userData.branch || "-";
    const sem = userData.semester || userData.sem || "-";

    try {
        // --- 1. BULLETPROOF VERIFICATION CHECK ---
        // Find the user document by Enrollment Number
        const usersRef = collection(db, "users");
        const qUser = query(usersRef, where("enrollment", "==", enrollment));
        const userQuerySnap = await getDocs(qUser);

        let correctUserId = "Unknown";

        if (!userQuerySnap.empty) {
            const userDoc = userQuerySnap.docs[0];
            const uData = userDoc.data();
            correctUserId = userDoc.id; // Grab the correct UID for gate logs

            // Check if they specifically need verification
            if (uData.isVerified === false) {
                // Pause the scanner to ask the admin
                const confirmActivation = confirm(`Verification Required: \nName: ${name}\nEnrollment: ${enrollment}\n\nHave you checked their physical ID card? Click OK to activate them permanently.`);

                if (confirmActivation) {
                    await updateDoc(doc(db, "users", correctUserId), { isVerified: true });
                    showMessage(`✅ Activated successfully: ${name}`, "success");
                } else {
                    showMessage(`Activation cancelled for ${name}.`, "warning");
                }

                closeScanner();
                return; // Stop here. Do not log them into the gate yet.
            }
        }
        // -----------------------------------------

        // --- 2. GATE CHECK-IN/OUT LOGIC ---
        const q = query(collection(db, "activityLogs"), where("enrollment", "==", enrollment), where("status", "==", 1));
        const querySnapshot = await getDocs(q);

        const now = new Date();
        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        if (querySnapshot.empty) {
            // CHECK IN
            await addDoc(collection(db, "activityLogs"), {
                userId: correctUserId, // Uses the guaranteed verified ID
                enrollment: enrollment,
                name: name,
                branch: branch,
                sem: sem,
                status: 1,
                timestamp: serverTimestamp(),
                timeIn: timeStr,
                timeOut: null
            });
            showMessage(`✅ Checked IN: ${name}`, "success");
        } else {
            // CHECK OUT
            const activeDoc = querySnapshot.docs[0];
            const logData = activeDoc.data();

            const checkInTime = logData.timestamp ? logData.timestamp.toDate() : now;
            const timeDiffMs = now - checkInTime;

            const COOLDOWN_MS = 1 * 60 * 1000;
            if (timeDiffMs < COOLDOWN_MS) {
                const remainingMinutes = Math.ceil((COOLDOWN_MS - timeDiffMs) / 60000);
                showMessage(`⏳ Wait ${remainingMinutes} min(s) before checking out.`, "warning");
                return;
            }

            await updateDoc(doc(db, "activityLogs", activeDoc.id), {
                status: 0,
                timeOut: timeStr
            });
            showMessage(`👋 Checked OUT: ${name}`, "success");
        }
    } catch (error) {
        console.error("Scanner DB Error:", error);
        showMessage("Database error.", "error");
    }
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
        html5QrcodeScanner.render(handleScan, () => { }); // Empty function ignores background errors
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




// Automatic Whitelist Management Logic
let whitelistData = []; // Store the raw data for searching
const whitelistSearchInput = document.getElementById('whitelistSearch');

// Update your tab click listener array to include 'tabWhitelist'
// Inside the tab click logic, toggle the controls:
// Add this inside your startRealtimeListeners() function
onSnapshot(collection(db, 'approved_students'), (snap) => {
    whitelistData = [];
    snap.forEach(s => {
        whitelistData.push({ id: s.id, ...s.data() });
    });
    if (currentTab === 'whitelist') renderWhitelistTable();
});

// Search functionality
if (whitelistSearchInput) {
    whitelistSearchInput.addEventListener('input', () => {
        if (currentTab === 'whitelist') renderWhitelistTable();
    });
}

function renderWhitelistTable() {
    const tbody = $('logsTableBody');

    // --- NEW: FORCE THE HEADERS TO UPDATE ---
    updateTableHeaders('whitelist');
    // ----------------------------------------

    const searchTerm = whitelistSearchInput ? whitelistSearchInput.value.toLowerCase() : '';

    // Filter data based on search
    const filtered = whitelistData.filter(student =>
        student.id.toLowerCase().includes(searchTerm) ||
        (student.name && student.name.toLowerCase().includes(searchTerm))
    );

    if (filtered.length === 0) {
        // Changed colspan to 7 to match your new headers
        tbody.innerHTML = `<tr><td colspan="7" class="px-6 py-8 text-center text-gray-500">No students found.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(s => {
        // Format the Verification Date or show Pending
        let statusBadge = '';
        if (s.isClaimed) {
            let dateStr = "Verified";
            if (s.verifiedAt && s.verifiedAt.toDate) {
                dateStr = s.verifiedAt.toDate().toLocaleDateString();
            }
            statusBadge = `<span class="px-2 py-1 bg-green-100 text-green-800 text-xs font-bold rounded border border-green-200">Verified: ${dateStr}</span>`;
        } else {
            statusBadge = `<span class="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs font-bold rounded border border-yellow-200">Pending Signup</span>`;
        }

        // Return exactly 7 columns to match the 7 headers
        return `
        <tr class="hover:bg-gray-50 border-b">
            <td class="px-6 py-4 text-sm font-medium text-gray-800">${s.name || 'N/A'}</td>
            <td class="px-6 py-4 text-sm font-mono text-gray-900 font-bold">${s.id}</td>
            <td class="px-6 py-4 text-sm text-gray-500">${s.department || '-'}</td>
            <td class="px-6 py-4 text-sm text-gray-500">${s.email || '-'}</td>
            <td class="px-6 py-4 text-sm text-gray-500">${s.phone || '-'}</td>
            <td class="px-6 py-4 text-sm">${statusBadge}</td>
            <td class="px-6 py-4 text-sm text-center">
                 <button onclick="window.deleteWhitelistStudent('${s.id}')" class="text-red-600 hover:text-red-800 p-2 rounded hover:bg-red-50 transition-colors" title="Delete from Whitelist">
                     <i class="fas fa-trash"></i>
                 </button>
            </td>
        </tr>
    `}).join('');
}

// Function to delete a student from the whitelist
window.deleteWhitelistStudent = async (enrollment) => {
    if (!confirm(`Are you sure you want to permanently delete enrollment ${enrollment} from the approved list?`)) return;

    try {
        await deleteDoc(doc(db, 'approved_students', enrollment));
        alert("Student successfully removed from the whitelist.");
    } catch (error) {
        console.error("Error deleting student:", error);
        alert("Failed to delete student.");
    }
};

document.getElementById('csvFileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!confirm("Are you sure you want to bulk upload these students?")) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
        const text = event.target.result;
        const rows = text.split('\n');

        let successCount = 0;
        let batch = writeBatch(db);
        let operationCounter = 0;

        // Skip the header row (i=1)
        for (let i = 1; i < rows.length; i++) {
            const cols = rows[i].split(',');
            if (cols.length >= 5) { // Updated to expect at least 5 columns
                const enrollment = cols[0].trim();
                const name = cols[1].trim();
                const email = cols[2].trim().toLowerCase(); // Normalize to lowercase for safe matching
                const phone = cols[3].trim();
                const department = cols[4].trim();

                if (enrollment) {
                    const docRef = doc(db, 'approved_students', enrollment);
                    batch.set(docRef, {
                        name: name,
                        email: email,
                        phone: phone,
                        department: department,
                        isClaimed: false
                    }, { merge: true });

                    successCount++;
                    operationCounter++;

                    if (operationCounter >= 400) {
                        await batch.commit();
                        batch = writeBatch(db);
                        operationCounter = 0;
                    }
                }
            }
        }

        // Commit any remaining operations
        if (operationCounter > 0) {
            await batch.commit();
        }

        alert(`Successfully uploaded ${successCount} students to the whitelist!`);
        e.target.value = ''; // Reset the file input
    };
    reader.readAsText(file);
});




window.openManualAddModal = async () => {
    const enrollment = prompt("Enter 12-digit Enrollment Number:");
    if (!enrollment) return;

    const name = prompt("Enter Student Name:");
    if (!name) return;

    const email = prompt("Enter Official College Email:");
    if (!email) return;

    const phone = prompt("Enter Phone Number:");
    if (!phone) return;

    const department = prompt("Enter Department (e.g., Computer Science):");
    if (!department) return;

    try {
        await setDoc(doc(db, 'approved_students', enrollment.trim()), {
            name: name.trim(),
            email: email.trim().toLowerCase(),
            phone: phone.trim(),
            department: department.trim(),
            isClaimed: false
        });
        alert(`${name} added to the whitelist successfully!`);
    } catch (error) {
        console.error("Error adding student:", error);
        alert("Failed to add student.");
    }
};