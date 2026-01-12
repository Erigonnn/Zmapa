import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, getDoc, updateDoc, collection, addDoc, onSnapshot, query, where, getDocs, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = { 
    apiKey: "AIzaSyBE3kWnpnQnlH1y8F5GF5Md_6vkfrxYVmc", 
    authDomain: "zmapa-b5d04.firebaseapp.com", 
    projectId: "zmapa-b5d04", 
    storageBucket: "zmapa-b5d04.firebasestorage.app", 
    messagingSenderId: "1017009188108", 
    appId: "1:1017009188108:web:c25d6822a4383d46906d29" 
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

let state = JSON.parse(localStorage.getItem("zmapa_progress")) || { hp: 10, scrap: 0, wood: 0, food: 5, looted: {} };
let map, player, rangeCircle, zMarkers = [], existingBases = {}, lastScanPos = null;

// --- AUTH LOGIC ---
document.getElementById('login-btn').onclick = () => {
    const e = document.getElementById('email').value, p = document.getElementById('password').value;
    signInWithEmailAndPassword(auth, e, p).catch(a => alert("DOSTĘP ZABRONIONY: " + a.message));
};
document.getElementById('google-btn').onclick = () => signInWithPopup(auth, provider);
document.getElementById('logout-btn').onclick = () => signOut(auth).then(() => location.reload());

onAuthStateChanged(auth, async u => {
    if(u) {
        const s = await getDoc(doc(db, "users", u.uid));
        if(s.exists()) state = {...state, ...s.data()};
        document.getElementById('landing-page').style.display = 'none';
        document.getElementById('game-container').style.display = 'block';
        initGame();
        listenToBases();
    }
});

// --- ENGINE GRY ---
function initGame() {
    if(map) return;
    map = L.map('map', { zoomControl: false, attributionControl: false }).setView([52.1388, 16.2731], 18);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

    player = L.marker([52.1388, 16.2731], { 
        icon: L.divIcon({ html: '<div class="player-arrow"></div>', className: 'p-wrap' }) 
    }).addTo(map);

    rangeCircle = L.circle([52.1388, 16.2731], { radius: 40, color: '#00f2ff', fillOpacity: 0.1, weight: 2 }).addTo(map);

    navigator.geolocation.watchPosition(pos => {
        const ll = [pos.coords.latitude, pos.coords.longitude];
        player.setLatLng(ll);
        rangeCircle.setLatLng(ll);
        map.panTo(ll);
        if(zMarkers.length < 8) spawnZombie(ll);
        scanLoot(ll);
    }, null, { enableHighAccuracy: true });

    setInterval(gameTick, 1000);
}

function spawnZombie(pos) {
    const loc = [pos[0] + (Math.random()-0.5)*0.012, pos[1] + (Math.random()-0.5)*0.012];
    const z = L.marker(loc, { icon: L.divIcon({ html: '💀', className: 'z-icon' }) }).addTo(map);
    z.walkTarget = [loc[0] + (Math.random()-0.5)*0.003, loc[1] + (Math.random()-0.5)*0.003];
    zMarkers.push(z);
}

function gameTick() {
    if(!player || !auth.currentUser) return;
    const pPos = player.getLatLng();
    let inSafeZone = false;

    // Leczenie w bazach
    Object.values(existingBases).forEach(b => {
        if(b.owner === auth.currentUser.uid && map.distance(pPos, [b.lat, b.lng]) < 30) {
            inSafeZone = true; if(state.hp < 10) { state.hp = Math.min(10, state.hp + 0.12); updateUI(); }
        }
    });

    zMarkers.forEach(z => {
        const zPos = z.getLatLng();
        const dist = map.distance(zPos, pPos);

        if (dist < 50) { // TRYB ATAKU
            const s = 0.00025;
            z.setLatLng([zPos.lat + (pPos.lat > zPos.lat ? s : -s)*0.5, zPos.lng + (pPos.lng > zPos.lng ? s : -s)*0.5]);
            if (dist < 12 && !inSafeZone) { state.hp = Math.max(0, state.hp - 0.35); updateUI(true); }
        } else { // TRYB SZWENDANIA
            const t = z.walkTarget;
            const s = 0.00007;
            if (map.distance(zPos, t) < 6) z.walkTarget = [zPos.lat + (Math.random()-0.5)*0.004, zPos.lng + (Math.random()-0.5)*0.004];
            else z.setLatLng([zPos.lat + (t[0] > zPos.lat ? s : -s), zPos.lng + (t[1] > zPos.lng ? s : -s)]);
        }
    });
}

// --- SYSTEM ŁUPÓW ---
async function scanLoot(pos) {
    if(lastScanPos && map.distance(pos, lastScanPos) < 45) return;
    lastScanPos = pos;
    const q = `[out:json];(node["shop"](around:100,${pos[0]},${pos[1]});node["amenity"~"restaurant|cafe|pharmacy|atm"](around:100,${pos[0]},${pos[1]}););out;`;
    fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: q })
    .then(r => r.json()).then(d => {
        d.elements.forEach(el => {
            if(state.looted[el.id]) return;
            const m = L.marker([el.lat, el.lon], { icon: L.divIcon({ html: '📦', className: 'poi-icon' }) }).addTo(map);
            m.on('click', () => {
                if(map.distance(player.getLatLng(), m.getLatLng()) < 40) {
                    map.removeLayer(m); state.looted[el.id] = true;
                    state.scrap += 2; state.wood += 2; updateUI(true);
                    showMsg("ŁUP ZEBRANY! +2⚙️ +2🪵");
                } else showMsg("ZA DALEKO OD SKRZYNI!");
            });
        });
    });
}

// --- AKCJE ---
document.getElementById('btn-attack').onclick = () => {
    let killed = false;
    zMarkers = zMarkers.filter(z => {
        if(map.distance(player.getLatLng(), z.getLatLng()) < 40) {
            map.removeLayer(z); state.scrap += 1; killed = true; return false;
        } return true;
    });
    if(killed) { showMsg("ZOMBIE WYELIMINOWANY!"); updateUI(true); }
};

document.getElementById('btn-eat').onclick = () => {
    if(state.food > 0) { state.food--; state.hp = Math.min(10, state.hp + 3); updateUI(true); }
    else showMsg("BRAK RACJI ŻYWNOŚCIOWYCH!");
};

document.getElementById('btn-craft').onclick = () => document.getElementById('craft-modal').style.display = 'flex';
document.getElementById('btn-close-craft').onclick = () => document.getElementById('craft-modal').style.display = 'none';
document.getElementById('btn-craft-food').onclick = () => {
    if(state.wood >= 3 && state.scrap >= 2) {
        state.wood -= 3; state.scrap -= 2; state.food++; updateUI(true);
        showMsg("STWORZONO JEDZENIE!");
    } else showMsg("BRAK SUROWCÓW!");
};

document.getElementById('btn-base').onclick = async () => {
    if(state.wood >= 10 && state.scrap >= 5) {
        const p = player.getLatLng();
        const q = query(collection(db, "bases"), where("owner", "==", auth.currentUser.uid));
        const old = await getDocs(q);
        for(const d of old.docs) await deleteDoc(doc(db, "bases", d.id));
        await addDoc(collection(db, "bases"), { lat: p.lat, lng: p.lng, owner: auth.currentUser.uid });
        state.wood -= 10; state.scrap -= 5; updateUI(true);
        showMsg("BAZA POSTAWIONA!");
    } else showMsg("10🪵 I 5⚙️ WYMAGANE!");
};

function listenToBases() {
    onSnapshot(collection(db, "bases"), snap => {
        map.eachLayer(l => { if(l.options && l.options.className === 'base-icon' || (l instanceof L.Circle && l !== rangeCircle)) map.removeLayer(l); });
        snap.forEach(d => {
            const b = d.data(); existingBases[d.id] = b;
            L.marker([b.lat, b.lng], { icon: L.divIcon({ html: '🏠', className: 'base-icon' }) }).addTo(map);
            if(b.owner === auth.currentUser.uid) L.circle([b.lat, b.lng], { radius: 30, color: '#0f0', weight: 1 }).addTo(map);
        });
    });
}

function updateUI(cloud = false) {
    document.getElementById('hp-bar').style.width = (state.hp * 10) + "%";
    document.getElementById('s-scrap').innerText = Math.floor(state.scrap);
    document.getElementById('s-wood').innerText = Math.floor(state.wood);
    document.getElementById('s-food').innerText = state.food;
    localStorage.setItem("zmapa_progress", JSON.stringify(state));
    if(cloud && auth.currentUser) updateDoc(doc(db, "users", auth.currentUser.uid), state);
    if(state.hp <= 0) { alert("ZGINĄŁEŚ W STREFIE."); state = {hp:10, scrap:0, wood:0, food:2, looted:{}}; updateUI(true); location.reload(); }
}

function showMsg(t) {
    const m = document.getElementById("msg"); m.innerText = t; m.style.display = "block";
    setTimeout(() => m.style.display = "none", 2500);
}

updateUI();
