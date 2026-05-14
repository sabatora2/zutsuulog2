let currentUser = null;
let calendar;

// Firebase alias for cleaner code
const f = () => window.firebaseApp;

// --- 1. 初期化処理 ---
window.addEventListener('load', () => {
    // ログイン状態監視
    f().authFunc.onAuthStateChanged(f().auth, (user) => {
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
                refreshData();
            }
        } else {
            currentUser = null;
            authOverlay.style.display = 'flex';
            appElement.style.display = 'none';
            navElement.style.display = 'none';
        }
    });

    // フォームパーツ初期化
    flatpickr("#date", { locale: "ja", defaultDate: "today", dateFormat: "Y-m-d" });
    flatpickr(".time-picker", {
        enableTime: true,
        noCalendar: true,
        dateFormat: "H:i",
        time_24hr: true,
        minuteIncrement: 5,
        disableMobile: "true" // スマホでもカスタムUIを使用
    });
});

// --- 2. 認証 ---
async function handleLogin() {
    const email = document.getElementById('loginEmail').value;
    const pw = document.getElementById('loginPw').value;
    const errorEl = document.getElementById('authError');
    if(!email || !pw) return errorEl.innerText = "入力してください";
    
    try {
        await f().authFunc.signInWithEmailAndPassword(f().auth, email, pw);
    } catch (err) {
        errorEl.innerText = "ログインに失敗しました。";
    }
}

async function handleLogout() {
    if (confirm('ログアウトしますか？')) {
        await f().authFunc.signOut(f().auth);
        location.reload();
    }
}

// --- 3. カレンダー制御 ---
function initCalendar() {
    const calendarEl = document.getElementById('calendarDisplay');
    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        locale: 'ja',
        dayCellContent: (e) => e.dayNumberText.replace('日', ''),
        height: 'auto',
        headerToolbar: { left: 'prev', center: 'title', right: 'next' },
        datesSet: () => updateMonthlyStats(), // 月変更時に統計更新
        eventClick: (info) => loadLogToForm(info.event.id)
    });
    calendar.render();
    refreshData();
}

// 全データの再取得と全画面反映
async function refreshData() {
    if (!currentUser || !f().db) return;
    const q = f().fs.query(
        f().fs.collection(f().db, "headacheLogs"),
        f().fs.where("userId", "==", currentUser.uid),
        f().fs.orderBy("timestamp", "desc")
    );
    
    try {
        const querySnapshot = await f().fs.getDocs(q);
        const events = [];
        const logs = [];
        
        querySnapshot.forEach((doc) => {
            const log = { id: doc.id, ...doc.data() };
            logs.push(log);
            
            // 「病院」判定
            const isHospital = log.memo && log.memo.includes("病院");

            if (isHospital) {
                // 病院の場合は「💊」のみ、色はグレー等で控えめに
                events.push({
                    id: log.id,
                    title: '💊',
                    start: log.date,
                    color: '#95a5a6' 
                });
            } else {
                // 通常の頭痛記録
                let color = '#3498db'; 
                if (log.medication) {
                    color = log.degree == '3' ? '#ff4757' : (log.degree == '2' ? '#ffa502' : '#2ed573');
                }
                events.push({
                    id: log.id,
                    title: log.degree == '3' ? '重' : (log.degree == '2' ? '中' : '軽'),
                    start: log.date,
                    color: color
                });
            }
        });
        
        calendar.setOption('events', events);
        updateReportUI(logs);
        updateListUI(logs);
        updateMonthlyStats(); 
    } catch (err) {
        console.error("Data Fetch Error:", err);
    }
}

// --- 4. データ操作 ---
document.getElementById('recordForm').onsubmit = async (e) => {
    e.preventDefault();
    if (!currentUser) return;

    const editId = document.getElementById('editId').value;
    const medicationVal = document.getElementById('medication').value === 'true';
    
    const data = {
        userId: currentUser.uid,
        date: document.getElementById('date').value,
        start: document.getElementById('startTime').value,
        end: document.getElementById('endTime').value,
        degree: document.querySelector('input[name="degree"]:checked').value,
        medication: medicationVal,
        medTime: medicationVal ? document.getElementById('medTime').value : "",
        memo: document.getElementById('memo').value,
        timestamp: new Date(document.getElementById('date').value).getTime()
    };

    try {
        if (editId) {
            await f().fs.updateDoc(f().fs.doc(f().db, "headacheLogs", editId), data);
        } else {
            await f().fs.addDoc(f().fs.collection(f().db, "headacheLogs"), data);
        }
        resetForm();
        refreshData();
        showSection('calendar', 'カレンダー');
    } catch (err) {
        alert("保存に失敗しました。");
    }
};

async function loadLogToForm(id) {
    try {
        // ID指定で直接取得（効率化）
        const docRef = f().fs.doc(f().db, "headacheLogs", id);
        const docSnap = await f().fs.getDocs(f().fs.query(f().fs.collection(f().db, "headacheLogs"), f().fs.where("userId", "==", currentUser.uid)));
        
        let log = null;
        docSnap.forEach(d => { if(d.id === id) log = d.data(); });
        if (!log) return;

        document.getElementById('editId').value = id;
        document.getElementById('date').value = log.date;
        document.getElementById('startTime').value = log.start || "";
        document.getElementById('endTime').value = log.end || "";
        
        // Flatpickrに値をセット
        document.getElementById('date')._flatpickr.setDate(log.date);
        document.getElementById('startTime')._flatpickr.setDate(log.start);
        document.getElementById('endTime')._flatpickr.setDate(log.end);

        document.querySelector(`input[name="degree"][value="${log.degree}"]`).checked = true;
        document.getElementById('medication').value = log.medication.toString();
        document.getElementById('medTime').value = log.medTime || "";
        if(log.medTime) document.getElementById('medTime')._flatpickr.setDate(log.medTime);
        
        document.getElementById('memo').value = log.memo || "";

        toggleMedTime();
        document.getElementById('saveBtn').innerText = "修正を保存する";
        document.getElementById('deleteBtn').style.display = "block";
        document.getElementById('cancelBtn').style.display = "block";
        
        showSection('input', '記録の修正');
    } catch (err) { console.error(err); }
}

async function handleDelete() {
    const id = document.getElementById('editId').value;
    if (!id || !confirm('この記録を削除しますか？')) return;
    try {
        await f().fs.deleteDoc(f().fs.doc(f().db, "headacheLogs", id));
        resetForm();
        refreshData();
        showSection('calendar', 'カレンダー');
    } catch (err) { alert("削除失敗"); }
}

// --- 5. UI更新系 ---
function showSection(id, title) {
    document.querySelectorAll('section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.tab-bar button').forEach(b => b.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    document.getElementById('pageTitle').innerText = title;
    document.getElementById('btn-' + id).classList.add('active');

    if(id === 'calendar') {
        calendar.updateSize();
    }
    window.scrollTo(0,0);
}

// 一覧表示の更新
function updateListUI(logs) {
    const container = document.getElementById('logList');
    if (logs.length === 0) {
        container.innerHTML = '<p class="empty-msg">記録がありません</p>';
        return;
    }
    
    container.innerHTML = logs.map(log => {
        const isHospital = log.memo && log.memo.includes("病院");
        
        if (isHospital) {
            // 病院の場合のシンプルな表示
            return `
                <div class="log-item" onclick="loadLogToForm('${log.id}')" style="border-left-color: #95a5a6">
                    <div class="log-line-1">
                        <strong>${log.date}</strong>
                        <span style="font-weight: bold; color: #fff;">病院 💊</span>
                    </div>
                </div>
            `;
        } else {
            // 通常の表示
            let color = !log.medication ? '#3498db' : (log.degree == '3' ? '#ff4757' : (log.degree == '2' ? '#ffa502' : '#2ed573'));
            return `
                <div class="log-item" onclick="loadLogToForm('${log.id}')" style="border-left-color: ${color}">
                    <div class="log-line-1">
                        <strong>${log.date}</strong>
                        <span>${log.start}〜${log.end || '--:--'}</span>
                    </div>
                    <div class="log-line-2">
                        <span>度合い: ${'★'.repeat(log.degree)}</span>
                        <span>薬: ${log.medication ? (log.medTime || '服用') : 'なし'}</span>
                    </div>
                    ${log.memo ? `<div class="log-line-3">${log.memo}</div>` : ''}
                </div>
            `;
        }
    }).join('');
}

// 統計の計算から除外
function updateReportUI(logs) {
    const now = new Date();
    const curMonth = now.toISOString().substring(0, 7);
    const curYear = now.getFullYear().toString();

    // 「病院」を含まないログだけで統計を出す
    const validLogs = logs.filter(l => !(l.memo && l.memo.includes("病院")));

    const mLogs = validLogs.filter(l => l.date.startsWith(curMonth));
    const yLogs = validLogs.filter(l => l.date.startsWith(curYear));

    document.getElementById('countHeadache').innerText = mLogs.length;
    document.getElementById('countMed').innerText = mLogs.filter(l => l.medication).length;
    document.getElementById('yearCountHeadache').innerText = yLogs.length;
    document.getElementById('yearCountMed').innerText = yLogs.filter(l => l.medication).length;

    if (validLogs.length > 0) {
        const lastDate = new Date(validLogs[0].date);
        const diff = Math.floor((now - lastDate) / (1000 * 60 * 60 * 24));
        document.getElementById('daysSince').innerText = Math.max(0, diff);
    } else {
        document.getElementById('daysSince').innerText = "-";
    }
}

function updateMonthlyStats() {
    if (!calendar) return;
    const currentViewDate = calendar.getDate();
    const targetMonth = currentViewDate.getMonth();
    const targetYear = currentViewDate.getFullYear();

    const events = calendar.getEvents();
    let monthH = 0;
    let monthM = 0;

    events.forEach(ev => {
        const d = ev.start;
        // 表示月と一致するか判定
        if (d.getMonth() === targetMonth && d.getFullYear() === targetYear) {
            // タイトルが「💊」（病院）でない場合のみ、頭痛回数としてカウント
            if (ev.title !== '💊') {
                monthH++;
                // 薬を飲んだ記録（青色以外）であれば服用回数としてカウント
                if (ev.backgroundColor !== '#3498db') {
                    monthM++;
                }
            }
        }
    });

    // 表示の更新
    const calH = document.getElementById('calCountHeadache');
    const calM = document.getElementById('calCountMed');
    if (calH) calH.innerText = monthH + "回";
    if (calM) calM.innerText = monthM + "回";
}
function resetForm() {
    document.getElementById('recordForm').reset();
    document.getElementById('editId').value = "";
    document.getElementById('saveBtn').innerText = "保存してカレンダーへ";
    document.getElementById('deleteBtn').style.display = "none";
    document.getElementById('cancelBtn').style.display = "none";
    document.getElementById('date')._flatpickr.setDate(new Date());
    toggleMedTime();
}

function toggleMedTime() {
    const isMed = document.getElementById('medication').value === 'true';
    document.getElementById('medTimeContainer').style.display = isMed ? 'block' : 'none';
}