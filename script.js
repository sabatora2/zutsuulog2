let currentUser = null;
let calendar;

// --- 1. ログイン状態の監視と初期化 ---
window.addEventListener('load', () => {
    window.authFunc.onAuthStateChanged(window.auth, (user) => {
        const appElement = document.getElementById('app');
        const navElement = document.querySelector('.tab-bar');
        const authOverlay = document.getElementById('authOverlay');

        if (user) {
            currentUser = user;
            authOverlay.style.display = 'none';
            appElement.style.display = 'block';
            navElement.style.display = 'flex';
            
            if (!calendar) {
                initCalendar();
            } else {
                refreshEvents();
            }
        } else {
            currentUser = null;
            authOverlay.style.display = 'block';
            appElement.style.display = 'none';
            navElement.style.display = 'none';
        }
    });

    const pickerConfig = {
        enableTime: true,
        noCalendar: true,
        dateFormat: "H:i",
        time_24hr: true,
        minuteIncrement: 15,
        disableMobile: false
    };
    flatpickr("#date", { locale: "ja", defaultDate: "today", dateFormat: "Y-m-d" });
    flatpickr(".time-picker", pickerConfig);
});

// --- 2. 認証処理 ---
async function handleLogin() {
    const email = document.getElementById('loginEmail').value;
    const pw = document.getElementById('loginPw').value;
    const errorEl = document.getElementById('authError');
    errorEl.innerText = "";
    try {
        await window.authFunc.signInWithEmailAndPassword(window.auth, email, pw);
    } catch (err) {
        errorEl.innerText = "ログインに失敗しました。";
    }
}

async function handleLogout() {
    if (confirm('ログアウトしますか？')) {
        await window.authFunc.signOut(window.auth);
        location.reload();
    }
}

// --- 3. カレンダー関連 ---
// --- 1. カレンダー初期化の修正 ---
function initCalendar() {
    const calendarEl = document.getElementById('calendarDisplay');
    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        locale: 'ja',
        dayCellContent: function(e) {
            return e.dayNumberText.replace('日', '');
        },
        height: 'auto',
        headerToolbar: { left: 'prev', center: 'title', right: 'next' },
        // 月が切り替わった時に実行される処理を追加
        datesSet: function(info) {
            updateMonthlyStats(info.start, info.end);
        },
        eventClick: (info) => {
            loadLogToForm(info.event.id);
        }
    });
    calendar.render();
    refreshEvents();
}

async function refreshEvents() {
    if (!currentUser || !window.db) return;
    const q = window.fs.query(
        window.fs.collection(window.db, "headacheLogs"),
        window.fs.where("userId", "==", currentUser.uid),
        window.fs.orderBy("timestamp", "desc")
    );
    
    try {
        const querySnapshot = await window.fs.getDocs(q);
        const events = [];
        querySnapshot.forEach((doc) => {
            const log = doc.data();
            let eventColor;
            if (!log.medication) {
                eventColor = '#3498db'; // 薬なし：青
            } else {
                if (log.degree == '3') eventColor = '#ff4757';      // 重：赤
                else if (log.degree == '2') eventColor = '#ffa502'; // 中：オレンジ
                else eventColor = '#2ed573';                       // 軽：緑
            }
            events.push({
                id: doc.id,
                title: log.degree == '3' ? '重' : (log.degree == '2' ? '中' : '軽'),
                start: log.date,
                color: eventColor
            });
        });
        calendar.setOption('events', events);
        updateReport();
    } catch (err) {
        console.error("データ取得エラー:", err);
    }
}

// --- 4. データ操作 ---
document.getElementById('recordForm').onsubmit = async (e) => {
    e.preventDefault();
    if (!currentUser) return;

    const editId = document.getElementById('editId').value;
    const data = {
        userId: currentUser.uid,
        date: document.getElementById('date').value,
        start: document.getElementById('startTime').value,
        end: document.getElementById('endTime').value,
        degree: document.querySelector('input[name="degree"]:checked').value,
        medication: document.getElementById('medication').value === 'true',
        medTime: document.getElementById('medTime').value,
        memo: document.getElementById('memo').value,
        timestamp: new Date(document.getElementById('date').value).getTime()
    };

    try {
        if (editId) {
            await window.fs.updateDoc(window.fs.doc(window.db, "headacheLogs", editId), data);
        } else {
            await window.fs.addDoc(window.fs.collection(window.db, "headacheLogs"), data);
        }
        resetForm();
        showSection('calendar', 'カレンダー');
    } catch (err) {
        alert("保存に失敗しました。");
    }
};

async function loadLogToForm(id) {
    try {
        const q = window.fs.query(
            window.fs.collection(window.db, "headacheLogs"),
            window.fs.where("userId", "==", currentUser.uid)
        );
        const querySnapshot = await window.fs.getDocs(q);
        let log;
        querySnapshot.forEach(d => { if(d.id === id) log = d.data(); });
        
        if (!log) return;

        document.getElementById('editId').value = id;
        document.getElementById('date').value = log.date;
        document.getElementById('startTime').value = log.start || "";
        document.getElementById('endTime').value = log.end || "";
        
        if(document.getElementById('date')._flatpickr) document.getElementById('date')._flatpickr.setDate(log.date);
        if(document.getElementById('startTime')._flatpickr) document.getElementById('startTime')._flatpickr.setDate(log.start);
        if(document.getElementById('endTime')._flatpickr) document.getElementById('endTime')._flatpickr.setDate(log.end);

        const degreeInput = document.querySelector(`input[name="degree"][value="${log.degree}"]`);
        if (degreeInput) degreeInput.checked = true;

        document.getElementById('medication').value = log.medication.toString();
        document.getElementById('medTime').value = log.medTime || "";
        if(document.getElementById('medTime')._flatpickr) document.getElementById('medTime')._flatpickr.setDate(log.medTime || "");
        document.getElementById('memo').value = log.memo || "";

        toggleMedTime();
        document.getElementById('saveBtn').innerText = "修正を保存する";
        document.getElementById('deleteBtn').style.display = "block";
        document.getElementById('cancelBtn').style.display = "block";
        
        showSection('input', '記録の修正');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
        console.error("Load Error:", err);
    }
}

async function handleDelete() {
    const id = document.getElementById('editId').value;
    if (!id || !confirm('削除しますか？')) return;
    try {
        await window.fs.deleteDoc(window.fs.doc(window.db, "headacheLogs", id));
        resetForm();
        showSection('calendar', 'カレンダー');
    } catch (err) {
        alert("削除に失敗しました。");
    }
}

// --- 5. UI制御 ---
function resetForm() {
    document.getElementById('recordForm').reset();
    document.getElementById('editId').value = "";
    document.getElementById('saveBtn').innerText = "保存してカレンダーへ";
    document.getElementById('deleteBtn').style.display = "none";
    document.getElementById('cancelBtn').style.display = "none";
    document.getElementById('medication').value = "true";
    toggleMedTime();
}

function showSection(id, title) {
    document.querySelectorAll('section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.tab-bar button').forEach(b => b.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    document.getElementById('pageTitle').innerText = title;
    document.getElementById('btn-' + id).classList.add('active');

    if(id === 'calendar' && calendar) {
        calendar.render();
        calendar.updateSize();
        refreshEvents();
    }
    if(id === 'report') updateReport();
    if(id === 'list') updateList();
}

async function updateList() {
    if (!currentUser) return;
    const q = window.fs.query(
        window.fs.collection(window.db, "headacheLogs"), 
        window.fs.where("userId", "==", currentUser.uid),
        window.fs.orderBy("timestamp", "desc")
    );
    
    try {
        const querySnapshot = await window.fs.getDocs(q);
        const container = document.getElementById('logList');
        let html = "";
        
        querySnapshot.forEach((doc) => {
            const log = doc.data();
            let borderColor;
            if (!log.medication) {
                borderColor = '#3498db';
            } else {
                if (log.degree == '3') borderColor = '#ff4757';
                else if (log.degree == '2') borderColor = '#ffa502';
                else borderColor = '#2ed573';
            }

            const medInfo = log.medication ? `服用: ${log.medTime || '--:--'}` : 'なし';
            
            html += `
                <div class="log-item" onclick="loadLogToForm('${doc.id}')" style="border-left-color: ${borderColor}">
                    <div class="log-line-1">
                        <strong>${log.date}</strong>
                        <span>${log.start} 〜 ${log.end || '--:--'}</span>
                    </div>
                    <div class="log-line-2">
                        <span>度合い: ${'★'.repeat(log.degree)}</span>
                        <span>薬: ${medInfo}</span>
                    </div>
                    <div class="log-line-3">
                        ${log.memo || '(メモなし)'}
                    </div>
                </div>
            `;
        });
        container.innerHTML = html || '<p style="text-align:center; color:#999;">記録がありません</p>';
    } catch (err) {
        console.error("List Update Error:", err);
    }
}

async function updateReport() {
    if (!currentUser) return;
    const q = window.fs.query(
        window.fs.collection(window.db, "headacheLogs"),
        window.fs.where("userId", "==", currentUser.uid),
        window.fs.orderBy("timestamp", "desc")
    );
    
    try {
        const querySnapshot = await window.fs.getDocs(q);
        const logs = [];
        querySnapshot.forEach(doc => logs.push(doc.data()));

        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonthStr = now.toISOString().substring(0, 7);
        const yearStartStr = `${currentYear}-01-01`;

        const thisMonthLogs = logs.filter(l => l.date.startsWith(currentMonthStr));
        const monthHeadache = thisMonthLogs.length;
        const monthMed = thisMonthLogs.filter(l => l.medication).length;

        const thisYearLogs = logs.filter(l => l.date >= yearStartStr);
        const yearHeadache = thisYearLogs.length;
        const yearMed = thisYearLogs.filter(l => l.medication).length;

        let daysSince = "0";
        if (logs.length > 0) {
            const lastDate = new Date(Math.max(...logs.map(l => l.timestamp)));
            daysSince = Math.floor(Math.abs(now - lastDate) / (1000 * 60 * 60 * 24));
        }

        document.getElementById('countHeadache').innerText = monthHeadache;
        document.getElementById('countMed').innerText = monthMed;
        document.getElementById('yearCountHeadache').innerText = yearHeadache;
        document.getElementById('yearCountMed').innerText = yearMed;
        document.getElementById('daysSince').innerText = daysSince;

        const calH = document.getElementById('calCountHeadache');
        const calM = document.getElementById('calCountMed');
        if (calH) calH.innerText = monthHeadache + "回";
        if (calM) calM.innerText = monthMed + "回";
    } catch (err) {
        console.error("Report Update Error:", err);
    }
}

// --- 2. 表示されている月に合わせて統計を更新する関数を追加 ---
async function updateMonthlyStats(viewStart, viewEnd) {
    if (!currentUser || !window.db) return;

    const q = window.fs.query(
        window.fs.collection(window.db, "headacheLogs"),
        window.fs.where("userId", "==", currentUser.uid)
    );

    try {
        const querySnapshot = await window.fs.getDocs(q);
        let monthHeadache = 0;
        let monthMed = 0;

        querySnapshot.forEach((doc) => {
            const log = doc.data();
            const logDate = new Date(log.date);

            // 表示されているカレンダーの範囲内（前月末や翌月頭の遊び分を除く「今月」のみ）を判定
            // FullCalendarのinfo.start/endは表示領域全域を指すため、
            // カレンダーの中央付近の日付から「現在の月」を特定してフィルタリングします。
            const currentMonth = calendar.getDate().getMonth();
            const currentYear = calendar.getDate().getFullYear();

            if (logDate.getMonth() === currentMonth && logDate.getFullYear() === currentYear) {
                monthHeadache++;
                if (log.medication) {
                    monthMed++;
                }
            }
        });

        // カレンダー下部の表示を更新
        const calH = document.getElementById('calCountHeadache');
        const calM = document.getElementById('calCountMed');
        if (calH) calH.innerText = monthHeadache + "回";
        if (calM) calM.innerText = monthMed + "回";

    } catch (err) {
        console.error("月間統計の更新エラー:", err);
    }
}


function toggleMedTime() {
    const isMed = document.getElementById('medication').value === 'true';
    document.getElementById('medTimeContainer').style.display = isMed ? 'block' : 'none';
}