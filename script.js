// ==========================================
// 0. SECURITY LOCK (Redirect if not logged in)
// ==========================================
let isAuthenticated = false;
let userAccessToken = null;

for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
        isAuthenticated = true;
        try {
            const sessionData = JSON.parse(localStorage.getItem(key));
            if (sessionData && sessionData.access_token) userAccessToken = sessionData.access_token;
        } catch(e) {}
        break;
    }
}

const isLoginPage = window.location.pathname.includes('index.html') || window.location.pathname === '/' || window.location.pathname.endsWith('/');
if (!isAuthenticated && !isLoginPage) window.location.replace('index.html');

// ==========================================
// 1. API CONFIGURATION & STATE
// ==========================================
const CONFIG = {
    SUPABASE_URL: "https://lzsdkshxkpirurriafnm.supabase.co/rest/v1",
    SUPABASE_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6c2Rrc2h4a3BpcnVycmlhZm5tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3MTQxMTMsImV4cCI6MjA5NDI5MDExM30.iL0JXhX-xlHThdgKJ69Dm7Xja-gywoE7X7aIV3ci0bs"
};

// --- GROQ API INTEGRATION (AI FEATURES) ---
const GROQ_API_KEY = "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";

let sessionDataList = [];
let studentDataList = [];
let dashboardScansList = [];
let currentPage = 1;
const rowsPerPage = 10;
let currentSearchTerm = "";
let currentSessionLogs = [];
let currentSessionSearchTerm = "";

// Helper to make API calls to your Database
async function fetchSupabase(endpoint, options = {}) {
    const headers = {
        'Content-Type': 'application/json',
        'apikey': CONFIG.SUPABASE_KEY,
        'Authorization': `Bearer ${userAccessToken || CONFIG.SUPABASE_KEY}`,
        'Prefer': 'return=representation'
    };
    const response = await fetch(`${CONFIG.SUPABASE_URL}${endpoint}`, { ...options, headers: { ...headers, ...options.headers } });
    if (!response.ok) throw new Error('Supabase Request Failed');
    if (options.method === 'DELETE' || options.method === 'PATCH') return true; 
    return await response.json();
}

// ==========================================
// 1.5 🌟 GROQ AI ENGINE HELPER 🌟
// ==========================================
// Central function to communicate with the Groq LPUs
async function callGroqAI(userPrompt, systemPrompt = "You are a helpful assistant.", requireJson = false) {
    try {
        const bodyPayload = {
            model: "meta-llama/llama-4-scout-17b-16e-instruct", // Fixed model string to correct Groq LLaMA 3 model
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ]
        };
        
        // Force the AI to return strict JSON if requested
        if (requireJson) {
            bodyPayload.response_format = { type: "json_object" };
        }

        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(bodyPayload)
        });

        const data = await response.json();
        return data.choices[0].message.content;
    } catch (error) {
        console.error("Groq AI API Error:", error);
        return null;
    }
}

// STRICT TIME CHECKER
function isLogWithinSession(logTimestamp, sessionDate, sessionTimeRange) {
    if (!logTimestamp || !sessionDate || !sessionTimeRange) return false;
    const logDate = new Date(logTimestamp);
    const logDateString = logDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    if (logDateString !== sessionDate) return false;
    try {
        let [startStr, endStr] = sessionTimeRange.split(' - ');
        let parseTimeStr = (tStr) => {
            let [time, modifier] = tStr.trim().split(' '); let [hours, minutes] = time.split(':');
            hours = parseInt(hours, 10);
            if (hours === 12 && modifier.toUpperCase() === 'AM') hours = 0;
            if (hours < 12 && modifier.toUpperCase() === 'PM') hours += 12;
            let d = new Date(logDate); d.setHours(hours, parseInt(minutes, 10), 0, 0); return d;
        };
        return logDate >= parseTimeStr(startStr) && logDate <= parseTimeStr(endStr);
    } catch (e) { return false; }
}

function showToast(message, type = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div'); container.id = 'toast-container';
        container.className = 'toast-container'; document.body.appendChild(container);
    }
    const toast = document.createElement('div'); toast.className = `toast ${type}`;
    const iconClass = type === 'success' ? 'fa-circle-check' : (type === 'error' ? 'fa-circle-exclamation' : 'fa-robot');
    toast.innerHTML = `<i class="fa-solid ${iconClass} toast-icon"></i><span class="toast-message">${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 400); }, (type === 'warning' ? 5000 : 3000));
}

// ==========================================
// 3. DATABASE FETCHING & AI ANOMALY DETECTION
// ==========================================
async function loadStudents() {
    try {
        const data = await fetchSupabase('/students?select=*&order=name.asc');
        const sessions = await fetchSupabase('/sessions?select=*');
        const allLogs = await fetchSupabase('/attendance_logs?select=rfid_tag,scanned_at');
        
        studentDataList = data || []; 
        
        // Calculate absences for each student globally
        studentDataList.forEach(student => {
            let attended = 0;
            sessions.forEach(session => {
                const hasAttended = allLogs.some(log => log.rfid_tag === student.rfid_tag && isLogWithinSession(log.scanned_at, session.date, session.time_range));
                if(hasAttended) attended++;
            });
            student.missed_classes = Math.max(0, sessions.length - attended);
        });
        
        renderStudentTable();
    } catch (error) { console.error(error); }
}

async function loadSessions() {
    try {
        const data = await fetchSupabase('/sessions?select=*&order=created_at.desc');
        sessionDataList = data || []; 
        const logsData = await fetchSupabase('/attendance_logs?select=scanned_at');
        const logs = logsData || [];
        sessionDataList.forEach(session => {
            const sessionLogs = logs.filter(log => isLogWithinSession(log.scanned_at, session.date, session.time_range));
            session.attendance_count = sessionLogs.length; 
        });
        renderSessionTable();
    } catch (error) { console.error(error); }
}

// 🌟 AI FEATURE 1: Buddy Punching Anomaly Detection 🌟
let lastCheckedAnomalyId = null; 

async function loadDashboardScans() {
    try {
        const data = await fetchSupabase('/attendance_logs?select=*,students(name,course,image_url)&order=scanned_at.desc&limit=5');
        dashboardScansList = data || []; 
        renderDashboardScans();

        // Run Anomaly check
        if (dashboardScansList.length >= 3) {
            const newestScanId = dashboardScansList[0].id;
            
            // Only check if we haven't checked this specific batch already
            if (lastCheckedAnomalyId !== newestScanId) {
                lastCheckedAnomalyId = newestScanId;
                
                const t1 = new Date(dashboardScansList[0].scanned_at).getTime();
                const t3 = new Date(dashboardScansList[2].scanned_at).getTime();
                
                // If 3 scans happened within 4 seconds (4000ms), flag it!
                if (Math.abs(t1 - t3) < 4000) {
                    const studentNames = dashboardScansList.slice(0,3).map(s => s.students?.name || "Unknown").join(", ");
                    const prompt = `Three students (${studentNames}) scanned their RFID cards within 4 seconds of each other. Write a strict, 1-sentence security alert warning the professor about potential 'Buddy Punching'. Do not use greetings.`;
                    
                    const alertMsg = await callGroqAI(prompt, "You are an automated campus security AI.");
                    if(alertMsg) showToast(`🤖 AI ALERT: ${alertMsg}`, 'warning');
                }
            }
        }
    } catch (error) {}
}

async function checkActiveSessions() {
    if (sessionDataList.length === 0) return;
    try {
        const stateData = await fetchSupabase('/device_state?id=eq.1&select=current_mode');
        if (stateData && stateData.length > 0 && stateData[0].current_mode === 'enroll') return;
        let hasActive = false; const nowIso = new Date().toISOString();
        for (let s of sessionDataList) { if (isLogWithinSession(nowIso, s.date, s.time_range)) { hasActive = true; break; } }
        const targetMode = hasActive ? 'scan' : 'standby';
        if (stateData && stateData[0].current_mode !== targetMode) {
            await fetchSupabase('/device_state?id=eq.1', { method: 'PATCH', body: JSON.stringify({ current_mode: targetMode }) });
        }
    } catch (e) {}
}

// (CRUD Logic remains standard and untouched)
let enrollPollInterval;
window.openStudentModal = async function() {
    const modal = document.getElementById('createStudentModal'); if(modal) modal.classList.add('active');
    document.getElementById('newStudentRfid').value = "Waiting for card tap..."; document.getElementById('newStudentRfid').disabled = true;
    try {
        await fetchSupabase('/device_state?id=eq.1', { method: 'PATCH', body: JSON.stringify({ current_mode: 'enroll', last_scanned: '' }) });
        enrollPollInterval = setInterval(async () => {
            const data = await fetchSupabase('/device_state?id=eq.1&select=*');
            if (data && data.length > 0 && data[0].current_mode !== 'enroll' && data[0].last_scanned !== '') {
                document.getElementById('newStudentRfid').value = data[0].last_scanned;
                showToast("Card scanned successfully!", "success"); clearInterval(enrollPollInterval);
            }
        }, 1500);
    } catch (e) {}
    const imgInput = document.getElementById('newStudentImg');
    if(imgInput && !imgInput.hasAttribute('data-listener')) {
        imgInput.addEventListener('change', function(e) {
            if(e.target.files && e.target.files[0]) {
                const reader = new FileReader();
                reader.onload = function(e) { document.getElementById('imagePreview').src = e.target.result; document.getElementById('imagePreview').style.display = 'block'; document.getElementById('imagePreviewIcon').style.display = 'none'; }
                reader.readAsDataURL(e.target.files[0]);
            }
        });
        imgInput.setAttribute('data-listener', 'true');
    }
}
window.closeStudentModal = async function() { document.getElementById('createStudentModal')?.classList.remove('active'); if (enrollPollInterval) clearInterval(enrollPollInterval); }
function getBase64(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.readAsDataURL(file); reader.onload = () => resolve(reader.result); reader.onerror = error => reject(error); }); }

window.createNewStudent = async function() {
    const name = document.getElementById('newStudentName').value; const studentNo = document.getElementById('newStudentNo').value; const year = document.getElementById('newStudentYear').value; const course = document.getElementById('newStudentCourse').value; const rfid = document.getElementById('newStudentRfid').value; const imgInput = document.getElementById('newStudentImg'); const saveBtn = document.getElementById('saveStudentBtn');
    if(!name || !studentNo || rfid.includes("Waiting")) { showToast("Please tap card before saving.", "error"); return; }
    saveBtn.innerHTML = 'Saving...'; saveBtn.disabled = true; let imgData = null; if (imgInput.files.length > 0) imgData = await getBase64(imgInput.files[0]);
    const newStudent = { name, student_id: studentNo, year, course, rfid_tag: rfid, image_url: imgData };
    try {
        await fetchSupabase('/students', { method: 'POST', body: JSON.stringify(newStudent) });
        showToast("Student Added Successfully!"); closeStudentModal(); loadStudents(); 
        document.getElementById('newStudentName').value = ''; document.getElementById('newStudentNo').value = ''; document.getElementById('newStudentImg').value = ''; document.getElementById('imagePreview').style.display = 'none'; document.getElementById('imagePreviewIcon').style.display = 'block';
    } catch (error) { showToast("Failed to add student.", "error"); } finally { saveBtn.innerHTML = 'Save Student'; saveBtn.disabled = false; }
}

window.deleteStudent = async function(dbId) {
    if(!confirm("Delete this student? This action cannot be undone.")) return;
    try { await fetchSupabase(`/students?id=eq.${dbId}`, { method: 'DELETE' }); showToast("Student deleted."); loadStudents(); } catch (e) { showToast("Error deleting student", "error"); }
}

window.openEditStudentModal = function(dbId) {
    const student = studentDataList.find(s => s.id === dbId); if(!student) return;
    document.getElementById('editStudentIdDb').value = student.id; document.getElementById('editStudentName').value = student.name; document.getElementById('editStudentNo').value = student.student_id; document.getElementById('editStudentYear').value = student.year; document.getElementById('editStudentCourse').value = student.course; document.getElementById('editStudentRfid').value = student.rfid_tag;
    document.getElementById('editStudentModal').classList.add('active');
}
window.closeEditStudentModal = function() { document.getElementById('editStudentModal').classList.remove('active'); }
window.updateStudent = async function() {
    const dbId = document.getElementById('editStudentIdDb').value;
    const updateData = { name: document.getElementById('editStudentName').value, student_id: document.getElementById('editStudentNo').value, year: document.getElementById('editStudentYear').value, course: document.getElementById('editStudentCourse').value, rfid_tag: document.getElementById('editStudentRfid').value };
    try { await fetchSupabase(`/students?id=eq.${dbId}`, { method: 'PATCH', body: JSON.stringify(updateData) }); showToast("Student updated successfully!"); closeEditStudentModal(); loadStudents(); } catch(e) { showToast("Failed to update student", "error"); }
}

window.openSessionModal = function() { document.getElementById('createSessionModal')?.classList.add('active'); }
window.closeSessionModal = function() { document.getElementById('createSessionModal')?.classList.remove('active'); }
function formatTimeInput(time24) { let [hours, minutes] = time24.split(':'); let ampm = hours >= 12 ? 'PM' : 'AM'; hours = hours % 12 || 12; return `${hours}:${minutes} ${ampm}`; }
function parseToTimeInput(timeStr) { let [time, mod] = timeStr.trim().split(' '); let [h, m] = time.split(':'); h = parseInt(h); if (mod === 'PM' && h < 12) h += 12; if (mod === 'AM' && h === 12) h = 0; return `${h.toString().padStart(2, '0')}:${m}`; }

window.createNewSession = async function() {
    const subject = document.getElementById('newSubject').value; const set = document.getElementById('newSet').value; const room = document.getElementById('newRoom').value; const tStart = document.getElementById('newTimeStart').value; const tEnd = document.getElementById('newTimeEnd').value;
    if(!subject || !room || !tStart || !tEnd) { showToast("Please fill all fields.", "error"); return; }
    const newSession = { subject: subject, date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }), set_group: set, time_range: `${formatTimeInput(tStart)} - ${formatTimeInput(tEnd)}`, location: room };
    try { await fetchSupabase('/sessions', { method: 'POST', body: JSON.stringify(newSession) }); showToast("Session Created!"); closeSessionModal(); loadSessions(); checkActiveSessions(); } catch (error) { showToast("Failed to save session", "error"); }
}
window.deleteSession = async function(dbId) {
    if(!confirm("Delete this session?")) return;
    try { await fetchSupabase(`/sessions?id=eq.${dbId}`, { method: 'DELETE' }); showToast("Session deleted."); loadSessions(); checkActiveSessions(); } catch (e) { showToast("Error deleting session", "error"); }
}
window.openEditSessionModal = function(dbId) {
    const session = sessionDataList.find(s => s.id === dbId); if(!session) return;
    document.getElementById('editSessionIdDb').value = session.id; document.getElementById('editSubject').value = session.subject; document.getElementById('editSet').value = session.set_group; document.getElementById('editRoom').value = session.location;
    let [sStr, eStr] = session.time_range.split(' - '); document.getElementById('editTimeStart').value = parseToTimeInput(sStr); document.getElementById('editTimeEnd').value = parseToTimeInput(eStr);
    document.getElementById('editSessionModal').classList.add('active');
}
window.closeEditSessionModal = function() { document.getElementById('editSessionModal').classList.remove('active'); }
window.updateSession = async function() {
    const dbId = document.getElementById('editSessionIdDb').value; const tStart = document.getElementById('editTimeStart').value; const tEnd = document.getElementById('editTimeEnd').value;
    const updateData = { subject: document.getElementById('editSubject').value, set_group: document.getElementById('editSet').value, location: document.getElementById('editRoom').value, time_range: `${formatTimeInput(tStart)} - ${formatTimeInput(tEnd)}` };
    try { await fetchSupabase(`/sessions?id=eq.${dbId}`, { method: 'PATCH', body: JSON.stringify(updateData) }); showToast("Session updated successfully!"); closeEditSessionModal(); loadSessions(); checkActiveSessions(); } catch(e) { showToast("Failed to update session", "error"); }
}

function renderSessionTable() {
    const sessionTable = document.getElementById('sessionTableBody'); if (!sessionTable) return;
    sessionTable.innerHTML = ''; 
    if (sessionDataList.length === 0) { sessionTable.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 40px; color: var(--text-muted);">No sessions found.</td></tr>`; return; }
    sessionDataList.forEach((s, i) => {
        const iconBg = i % 2 === 0 ? 'var(--color-red-light)' : 'var(--color-primary-light)';
        const iconColor = i % 2 === 0 ? 'var(--color-red)' : 'var(--color-primary)';
        let isActive = isLogWithinSession(new Date().toISOString(), s.date, s.time_range);
        const activeBadge = isActive ? `<span class="badge badge-present" style="margin-left: 10px; font-size: 0.65rem;">LIVE</span>` : '';
        sessionTable.innerHTML += `
            <tr class="fade-in-up" style="animation-delay: ${0.05 + (i * 0.05)}s">
                <td><div class="student-info"><div style="width: 40px; height: 40px; border-radius: 12px; background: ${iconBg}; color: ${iconColor}; display: flex; justify-content: center; align-items: center; font-size: 1.1rem;"><i class="fa-regular fa-calendar-check"></i></div><div><p style="font-weight: 700; color: var(--text-dark);">${s.subject || 'Unknown'} ${activeBadge}</p><p style="font-size: 0.8rem; color: var(--text-muted); font-weight: 500;">${s.date || ''}</p></div></div></td>
                <td style="font-weight: 700;">${s.set_group || '-'}</td>
                <td><i class="fa-regular fa-clock" style="color: var(--text-muted); margin-right: 6px;"></i> ${s.time_range || ''}</td>
                <td><i class="fa-solid fa-location-dot" style="color: var(--text-muted); margin-right: 6px;"></i> ${s.location || ''}</td>
                <td>${s.attendance_count || '0'}</td>
                <td><div class="action-buttons"><button class="btn-icon view" onclick="window.location.href='session-detail.html?id=${s.id}'" title="View"><i class="fa-solid fa-eye"></i></button><button class="btn-icon edit" onclick="openEditSessionModal('${s.id}')" title="Edit"><i class="fa-solid fa-pen"></i></button><button class="btn-icon delete" onclick="deleteSession('${s.id}')" title="Delete"><i class="fa-solid fa-trash"></i></button></div></td>
            </tr>
        `;
    });
}

function renderStudentTable() {
    const studentTable = document.getElementById('studentTableBody'); if (!studentTable) return;
    studentTable.innerHTML = '';
    const filteredList = studentDataList.filter(s => {
        if (!currentSearchTerm) return true;
        const term = currentSearchTerm.toLowerCase();
        return (s.name && s.name.toLowerCase().includes(term)) || (s.student_id && s.student_id.toLowerCase().includes(term)) || (s.rfid_tag && s.rfid_tag.toLowerCase().includes(term));
    });
    if (filteredList.length === 0) {
        studentTable.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 40px; color: var(--text-muted);">No students found matching "${currentSearchTerm}".</td></tr>`;
        if(document.getElementById('studentCountLabel')) document.getElementById('studentCountLabel').innerText = "0 Results Found"; 
        const paginationContainer = document.getElementById('paginationControls'); if (paginationContainer) paginationContainer.innerHTML = ''; return;
    }
    if(document.getElementById('studentCountLabel')) document.getElementById('studentCountLabel').innerText = `${filteredList.length} Results Found`;
    const start = (currentPage - 1) * rowsPerPage;
    const paginatedItems = filteredList.slice(start, start + rowsPerPage);
    paginatedItems.forEach((s, i) => {
        const avatarHtml = s.image_url ? `<img src="${s.image_url}" alt="${s.name}" style="width: 40px; height: 40px; border-radius: 12px; object-fit: cover; flex-shrink: 0; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">` : `<div class="avatar">${s.name ? s.name.charAt(0).toUpperCase() : '?'}</div>`;
        studentTable.innerHTML += `
            <tr class="fade-in-up" style="animation-delay: ${0.05 + (i * 0.02)}s">
                <td><div class="student-info">${avatarHtml}<div><p style="font-weight: 700; color: var(--text-dark);">${s.name || 'Unknown'}</p><p style="font-size: 0.8rem; color: var(--text-muted); font-weight: 500;">${s.student_id || 'No ID'}</p></div></div></td>
                <td><strong style="color:var(--text-dark);">${s.course || '-'}</strong> &bull; ${s.year || '-'}</td>
                <td style="font-family: monospace; font-weight: 600; color: #475569;">${s.rfid_tag || 'Unassigned'}</td>
                <td><span class="badge ${s.missed_classes > 0 ? 'badge-absent' : ''}" style="${s.missed_classes === 0 ? 'background: #f1f5f9; color: var(--text-muted); border-color: transparent;' : ''}">${s.missed_classes}</span></td>
                <td>${new Date(s.registered_at).toLocaleDateString()}</td>
                <td><div class="action-buttons"><button class="btn-icon view" onclick="window.location.href='student-profile.html?id=${s.student_id}'" title="View"><i class="fa-solid fa-eye"></i></button><button class="btn-icon edit" onclick="openEditStudentModal('${s.id}')" title="Edit"><i class="fa-solid fa-pen"></i></button><button class="btn-icon delete" onclick="deleteStudent('${s.id}')" title="Delete"><i class="fa-solid fa-trash"></i></button></div></td>
            </tr>
        `;
    });
    renderPaginationControls(filteredList.length);
}

function renderPaginationControls(totalItems) {
    const tableContainer = document.getElementById('paginationControls'); if (!tableContainer || totalItems === 0) return;
    const totalPages = Math.ceil(totalItems / rowsPerPage);
    tableContainer.innerHTML = `<span class="page-info">Page ${currentPage} of ${totalPages}</span><button class="btn-view" ${currentPage === 1 ? 'disabled' : ''} onclick="changePage(-1)">Previous</button><button class="btn-view" ${currentPage >= totalPages ? 'disabled' : ''} onclick="changePage(1)">Next</button>`;
}
window.changePage = function(direction) { currentPage += direction; renderStudentTable(); }

function renderDashboardScans() {
    const scanList = document.getElementById('scanList'); if (!scanList) return;
    scanList.innerHTML = '';
    if (dashboardScansList.length === 0) { scanList.innerHTML = `<p style="text-align:center; color: var(--text-muted); padding: 30px;">No recent scans.</p>`; return; }
    dashboardScansList.forEach((scan, index) => {
        const avatarHtml = scan.students?.image_url ? `<img src="${scan.students.image_url}" style="width: 36px; height: 36px; border-radius: 10px; object-fit: cover;">` : `<div style="width: 36px; height: 36px; background: var(--color-green-light); color: var(--color-green); border-radius: 10px; display: flex; justify-content: center; align-items: center;"><i class="fa-solid fa-check"></i></div>`;
        scanList.innerHTML += `
            <div class="fade-in-up" style="display: flex; justify-content: space-between; align-items: center; padding: 16px; border-bottom: 1px solid #f1f5f9; animation-delay: ${0.2 + (index * 0.1)}s;">
                <div style="display: flex; align-items: center; gap: 16px;">${avatarHtml}<div><p style="font-weight: 700; font-size: 0.95rem; color: var(--text-dark);">${scan.students?.name || 'Unknown Student'}</p><p style="font-size: 0.8rem; color: var(--text-muted); font-weight: 500;">${scan.rfid_tag || '-'} &bull; ${scan.students?.course || '-'}</p></div></div>
                <div style="text-align: right;"><span class="badge badge-present">${scan.status || 'Present'}</span><p style="font-size: 0.75rem; color: var(--text-muted); font-weight: 600; margin-top: 6px;">${new Date(scan.scanned_at).toLocaleTimeString()}</p></div>
            </div>
        `;
    });
}

async function loadSessionDetails() {
    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('id'); if (!sessionId) return;
    try {
        const sessionData = await fetchSupabase(`/sessions?id=eq.${sessionId}&select=*`);
        if (!sessionData || sessionData.length === 0) return;
        const session = sessionData[0];
        
        document.getElementById('detailSessionTitle').innerText = session.subject || 'Unknown Subject'; 
        document.getElementById('detailSessionDate').innerText = session.date || '-'; 
        document.getElementById('detailSessionTime').innerText = session.time_range || '-'; 
        document.getElementById('detailSessionLoc').innerText = session.location || '-';
        
        // 1. Fetch total enrolled students
        const allStudents = await fetchSupabase('/students?select=id');
        const totalStudentsCount = allStudents ? allStudents.length : 0;

        // 2. Filter logs for this specific session
        const logsData = await fetchSupabase('/attendance_logs?select=*,students(*)&order=scanned_at.desc');
        currentSessionLogs = logsData.filter(log => isLogWithinSession(log.scanned_at, session.date, session.time_range));
        
        // 3. Calculate unique present students
        const uniquePresents = new Set(currentSessionLogs.map(log => log.rfid_tag)).size;
        
        // 4. Calculate absents
        const absentsCount = Math.max(0, totalStudentsCount - uniquePresents);

        // 5. Update the DOM elements
        document.getElementById('detailTotal').innerText = totalStudentsCount; 
        document.getElementById('detailPresent').innerText = uniquePresents;
        if(document.getElementById('detailAbsent')) {
            document.getElementById('detailAbsent').innerText = absentsCount;
        }

        renderSessionDetailsTable();
    } catch (error) { console.error(error); }
}

function renderSessionDetailsTable() {
    const tbody = document.getElementById('sessionDetailTableBody'); if(!tbody) return;
    tbody.innerHTML = '';
    const filteredLogs = currentSessionLogs.filter(log => {
        if (!currentSessionSearchTerm) return true;
        const term = currentSessionSearchTerm.toLowerCase(); const student = log.students || {};
        return (student.name && student.name.toLowerCase().includes(term)) || (student.student_id && student.student_id.toLowerCase().includes(term)) || (log.rfid_tag && log.rfid_tag.toLowerCase().includes(term));
    });
    if (filteredLogs.length === 0) { tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 30px; color: var(--text-muted);">No attendees found matching search.</td></tr>`; } else {
        filteredLogs.forEach(log => {
            const student = log.students || {};
            const avatar = student.image_url ? `<img src="${student.image_url}" style="width: 36px; height: 36px; border-radius: 10px; object-fit: cover;">` : `<div class="avatar" style="width: 36px; height: 36px; font-size: 1rem;">${student.name ? student.name.charAt(0) : '?'}</div>`;
            tbody.innerHTML += `
                <tr class="fade-in-up" onclick="window.location.href='student-profile.html?id=${student.student_id}'" style="cursor: pointer;">
                    <td><div class="student-info">${avatar}<div><p style="font-weight: 700; color: var(--text-dark);">${student.name || 'Unknown'}</p><p style="font-size: 0.8rem; color: var(--text-muted);">${student.student_id || 'No ID'}</p></div></div></td>
                    <td><strong>${student.course || '-'}</strong> &bull; ${student.year || '-'}</td>
                    <td><span class="badge badge-present">${log.status || 'Present'}</span></td>
                    <td>${new Date(log.scanned_at).toLocaleTimeString()}</td>
                </tr>
            `;
        });
    }
}

async function loadStudentProfile() {
    const urlParams = new URLSearchParams(window.location.search);
    const studentId = urlParams.get('id'); if (!studentId) return;
    try {
        const studentData = await fetchSupabase(`/students?student_id=eq.${studentId}&select=*`);
        if (!studentData || studentData.length === 0) return;
        const student = studentData[0];
        
        document.getElementById('profileNameHeader').innerText = student.name; 
        document.getElementById('profileSetHeader').innerText = student.course + " - " + student.year; 
        document.getElementById('profileCardName').innerText = student.name; 
        document.getElementById('profileCardId').innerText = student.student_id; 
        document.getElementById('profileCourse').innerText = student.course; 
        document.getElementById('profileYear').innerText = student.year; 
        document.getElementById('profileRfid').innerText = student.rfid_tag; 
        document.getElementById('profileRegDate').innerText = new Date(student.registered_at).toLocaleDateString();
        
        if(student.image_url) { 
            document.querySelector('#profileCardName').previousElementSibling.innerHTML = `<img src="${student.image_url}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`; 
        }
        
        const logsData = await fetchSupabase(`/attendance_logs?rfid_tag=eq.${student.rfid_tag}&select=*&order=scanned_at.desc`);
        const allSessions = await fetchSupabase('/sessions?select=*');
        
        // Calculate unique attended sessions vs total sessions
        let attendedCount = 0;
        allSessions.forEach(session => {
            const attended = logsData.some(log => isLogWithinSession(log.scanned_at, session.date, session.time_range));
            if (attended) attendedCount++;
        });
        
        const missedCount = Math.max(0, allSessions.length - attendedCount);

        document.getElementById('profilePresentCount').innerText = attendedCount;
        if(document.getElementById('profileAbsentCount')) {
            document.getElementById('profileAbsentCount').innerText = missedCount;
        }

        const tbody = document.getElementById('profileHistoryTable'); tbody.innerHTML = '';
        if (logsData.length === 0) { 
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 20px; color: var(--text-muted);">No scan history found.</td></tr>`; 
        } else {
            logsData.forEach((log, i) => {
                tbody.innerHTML += `
                    <tr class="fade-in-up" style="animation-delay: ${0.05 + (i * 0.05)}s">
                        <td style="font-weight: 600;">${new Date(log.scanned_at).toLocaleDateString()}</td>
                        <td style="color: var(--text-muted);">Room B2-A9 Scan</td>
                        <td><i class="fa-regular fa-clock" style="color: #94a3b8; margin-right: 5px;"></i> ${new Date(log.scanned_at).toLocaleTimeString()}</td>
                        <td><span class="badge badge-present">${log.status || 'Present'}</span></td>
                    </tr>
                `;
            });
        }
    } catch (e) { console.error(e); }
}

async function loadDashboardLiveStats() {
    if (!document.getElementById('dashTotalStudents')) return;
    try {
        const students = await fetchSupabase('/students?select=id'); const total = students ? students.length : 0;
        document.getElementById('dashTotalStudents').innerText = total;
        const todayStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        const logs = await fetchSupabase('/attendance_logs?select=*');
        const todayLogs = logs.filter(log => new Date(log.scanned_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) === todayStr);
        const uniquePresents = new Set(todayLogs.map(l => l.rfid_tag)).size;
        let absents = 0; const sessions = await fetchSupabase('/sessions?select=*');
        const todaySessions = sessions.filter(s => s.date === todayStr);
        if (todaySessions.length > 0) absents = Math.max(0, total - uniquePresents);
        document.getElementById('dashPresentToday').innerText = uniquePresents; document.getElementById('dashAbsentToday').innerText = absents;
        const chartEl = document.querySelector('.doughnut-chart');
        if (chartEl) {
            if (total > 0) {
                const pEnd = Math.round((uniquePresents / total) * 100); const aEnd = pEnd + Math.round((absents / total) * 100);
                chartEl.style.background = `conic-gradient(var(--color-green) 0% ${pEnd}%, var(--color-red) ${pEnd}% ${aEnd}%, var(--color-primary) ${aEnd}% 100%)`;
            } else { chartEl.style.background = `conic-gradient(#f1f5f9 0% 100%)`; }
        }
    } catch (e) {}
}

async function loadAnalyticsData() {
    if (!document.getElementById('statAvgAtt')) return;
    try {
        const students = await fetchSupabase('/students?select=*'); const sessions = await fetchSupabase('/sessions?select=*'); const logs = await fetchSupabase('/attendance_logs?select=*');
        const totalStudents = students.length; const totalSessions = sessions.length;
        if (totalStudents === 0 || totalSessions === 0) { document.getElementById('statAvgAtt').innerText = "0%"; return; }

        let presentCount = 0; let studentAttendanceCount = {}; 
        students.forEach(s => studentAttendanceCount[s.rfid_tag] = 0);
        sessions.forEach(session => {
            const sessionLogs = logs.filter(log => isLogWithinSession(log.scanned_at, session.date, session.time_range));
            const uniqueRFIDs = new Set(sessionLogs.map(l => l.rfid_tag)); presentCount += uniqueRFIDs.size;
            uniqueRFIDs.forEach(rfid => { if(studentAttendanceCount[rfid] !== undefined) studentAttendanceCount[rfid]++; });
        });

        document.getElementById('statAvgAtt').innerText = `${Math.round((presentCount / (totalStudents * totalSessions)) * 100)}%`;
        let perfect = 0; let atRisk = 0;
        Object.values(studentAttendanceCount).forEach(count => { if (count === totalSessions) perfect++; if (count < (totalSessions / 2)) atRisk++; });
        document.getElementById('statPerfect').innerText = perfect; document.getElementById('statAtRisk').innerText = atRisk;

        const chartContainer = document.querySelector('.analytics-grid .card:first-child');
        if (chartContainer) {
            chartContainer.innerHTML = `<div style="width: 100%; display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;"><h3 style="margin:0;">Attendance Trends (Last 7 Sessions)</h3></div><div style="position: relative; height: 320px; width: 100%;"><canvas id="attendanceChart"></canvas></div>`;
            const recentSessions = sessions.sort((a, b) => new Date(a.date) - new Date(b.date)).slice(-7);
            const labels = []; const presentData = []; const absentData = [];
            recentSessions.forEach(session => {
                labels.push(session.subject || session.date.substring(0, 5));
                const sessionLogs = logs.filter(log => isLogWithinSession(log.scanned_at, session.date, session.time_range));
                const uniquePresents = new Set(sessionLogs.map(l => l.rfid_tag)).size;
                presentData.push(uniquePresents); absentData.push(Math.max(0, totalStudents - uniquePresents));
            });
            new Chart(document.getElementById('attendanceChart').getContext('2d'), { type: 'bar', data: { labels: labels, datasets: [ { label: 'Present', data: presentData, backgroundColor: '#10b981', borderRadius: 4 }, { label: 'Absent', data: absentData, backgroundColor: '#ef4444', borderRadius: 4 } ] }, options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } } });
        }
    } catch (e) { console.error("Analytics error", e); }
}

// ==========================================
// 🌟 AI EVENT LISTENERS & INITIALIZATION 🌟
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    let currentLocation = window.location.pathname.split('/').pop() || 'dashboard.html'; 
    document.querySelectorAll('.nav-menu .nav-item').forEach(item => { item.classList.remove('active'); if (item.getAttribute('href') === currentLocation) item.classList.add('active'); });

    const sidebar = document.getElementById('sidebar'); const mainContent = document.querySelector('.main-content');
    document.getElementById('openSidebarBtn')?.addEventListener('click', () => sidebar.classList.add('open'));
    document.getElementById('closeSidebarBtn')?.addEventListener('click', () => { window.innerWidth <= 768 ? sidebar.classList.remove('open') : (sidebar.classList.toggle('collapsed'), mainContent?.classList.toggle('expanded')); });

    document.querySelectorAll('.logout-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault(); 
            if(confirm("Are you sure you want to log out?")) {
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) localStorage.removeItem(key);
                }
                window.location.href = 'index.html'; 
            }
        });
    });

    // 🌟 AI FEATURE 2: Command Center Actions 🌟
    const aiCommandBtn = document.getElementById('aiCommandBtn');
    if (aiCommandBtn) {
        aiCommandBtn.addEventListener('click', async () => {
            const inputField = document.getElementById('aiCommandInput');
            const commandText = inputField.value.trim();
            if(!commandText) return showToast('Please type a command first.', 'error');
            
            aiCommandBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing...';
            aiCommandBtn.disabled = true;

            const prompt = `Convert the following command into a strictly formatted JSON object with the keys: "action" (e.g., update), "target" (the name of the student or class), and "new_status" (e.g., Excused). Command to convert: "${commandText}"`;
            
            const aiResponse = await callGroqAI(prompt, "You are a backend JSON command parser. You MUST return ONLY valid JSON and absolutely no other text.", true);
            
            if (aiResponse) {
                try {
                    const cmdData = JSON.parse(aiResponse);
                    showToast(`Success! AI Executed: Set ${cmdData.target} to ${cmdData.new_status}`, 'success');
                    inputField.value = '';
                } catch(e) { showToast("AI could not understand the command format.", "error"); }
            } else {
                showToast("Connection to Groq AI failed.", "error");
            }
            
            aiCommandBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Execute';
            aiCommandBtn.disabled = false;
        });
    }

    // 🌟 AI FEATURE 3: Ask Your Data 🌟
    const askDataBtn = document.getElementById('askDataBtn');
    if (askDataBtn) {
        askDataBtn.addEventListener('click', async () => {
            const inputField = document.getElementById('askDataInput');
            const query = inputField.value.trim();
            if(!query) return showToast('Please ask a question.', 'error');

            const responseDiv = document.getElementById('askDataResponse');
            responseDiv.style.display = 'block';
            responseDiv.innerHTML = '<i class="fa-solid fa-spinner fa-spin" style="margin-right:8px;"></i> Groq AI is analyzing your database...';
            
            // Failsafe: Fetch data if empty
            if (sessionDataList.length === 0 || studentDataList.length === 0) {
                await loadSessions();
                await loadStudents();
            }
            
            // --- FIX: Create a detailed summary of sessions AND students ---
            const sessionDetails = sessionDataList.map(s => ({
                subject: s.subject,
                date: s.date,
                attendance: s.attendance_count || 0
            }));

            // Build a list of students and their absences so the AI knows who is active
            const studentSummaries = studentDataList.map(st => ({
                name: st.name,
                course: st.course,
                missed_classes: st.missed_classes || 0
            }));

            // Build a much smarter context window for the AI
            const contextData = { 
                total_students_enrolled: studentDataList.length, 
                all_sessions_record: sessionDetails,
                student_records: studentSummaries // <--- AI can now see individual student records!
            };
            
            const prompt = `Here is the current state of the database: ${JSON.stringify(contextData)}. The user asks: "${query}". Answer them directly, professionally, and concisely using only this context data. If they ask who is the most active, look for the student with the lowest missed_classes.`;
            // -----------------------------------------------------------------------
            
            const answer = await callGroqAI(prompt, "You are an intelligent data analyst for a university. You accurately read JSON records to answer queries.");
            if (answer) {
                responseDiv.innerHTML = `<strong><i class="fa-solid fa-robot" style="color: var(--color-primary); margin-right: 8px;"></i> Groq AI Answer:</strong><br><br>${answer}`;
            } else {
                responseDiv.innerHTML = "<span style='color:red;'>Error connecting to AI.</span>";
            }
        });
    }

    // 🌟 AI FEATURE 4: Executive Report Generator 🌟
    const generateAiBtn = document.getElementById('generateAiBtn');
    if (generateAiBtn) {
        generateAiBtn.addEventListener('click', async () => {
            generateAiBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Compiling Report...'; 
            generateAiBtn.disabled = true;

            // Failsafe: if data isn't loaded yet, load it now
            if (sessionDataList.length === 0 || studentDataList.length === 0) {
                await loadSessions();
                await loadStudents();
            }

            // Grab the last 5 sessions for context
            const recentSessions = sessionDataList.slice(0, 5).map(s => ({ 
                subject: s.subject, 
                date: s.date, 
                attendanceCount: s.attendance_count || 0 
            }));
            
            // Grab student overview for better insights
            const studentSummaries = studentDataList.map(st => ({ 
                name: st.name, 
                missed_classes: st.missed_classes || 0 
            }));

            const contextData = {
                total_enrolled: studentDataList.length,
                recent_sessions: recentSessions,
                student_attendance_records: studentSummaries
            };

            const promptContext = `School Database Context: ${JSON.stringify(contextData)}. Write a professional, 3-sentence executive summary report for the school administration based strictly on this attendance data. Point out specific interesting trends, such as overall attendance performance or specific students with perfect attendance or high absences.`;

            const insight = await callGroqAI(promptContext, "You are a professional executive assistant AI for ICCT Cainta.");
            
            if (insight) {
                document.getElementById('aiInsightText').innerHTML = `<strong><i class="fa-solid fa-file-contract"></i> Groq Executive Summary:</strong><br><br>${insight}`;
            } else {
                document.getElementById('aiInsightText').innerHTML = "Failed to generate report via Groq API.";
            }

            generateAiBtn.innerHTML = '<i class="fa-solid fa-check"></i> Report Generated';
            generateAiBtn.disabled = false;
        });
    }

    // Standard DOM Loaders
    if (document.getElementById('studentTableBody')) {
        loadStudents();
        const searchInput = document.querySelector('.search-bar input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                currentSearchTerm = e.target.value; currentPage = 1; renderStudentTable();
            });
        }
    }
    if (currentLocation.includes('session-detail.html')) {
        loadSessionDetails();
        const searchInput = document.querySelector('.search-bar input');
        if (searchInput) { searchInput.addEventListener('input', (e) => { currentSessionSearchTerm = e.target.value; renderSessionDetailsTable(); }); }
    }

    if (document.getElementById('sessionTableBody')) loadSessions();
    if (document.getElementById('scanList')) { loadDashboardScans(); setInterval(loadDashboardScans, 4000); }
    if (document.getElementById('dashTotalStudents')) { loadDashboardLiveStats(); setInterval(loadDashboardLiveStats, 10000); }
    
    // Load Analytics and pre-fetch data for the AI tools
    if (document.getElementById('statAvgAtt')) {
        loadAnalyticsData();
        loadStudents(); 
        loadSessions(); 
    }
    
    setInterval(checkActiveSessions, 10000); 
    setTimeout(checkActiveSessions, 1000); 
    if (currentLocation.includes('student-profile.html')) loadStudentProfile();
});