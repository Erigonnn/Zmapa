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

let state = { hp: 10, scrap: 0, wood: 0, food: 3, looted: {} };
let map, playerMarker, rangeCircle;
let zMarkers = [];
let lastLootPos = null;
let existingBases = {};

// LOGOWANIE
document.getElementById('login-btn').onclick = () => {
    const e = document.getElementById('email').value, p = document.getElementById('password').value;
    signInWithEmailAndPassword(auth, e, p).catch(err => alert("Błąd: " + err.message));
};
document.getElementById('google-btn').onclick = () => signInWithPopup(auth, provider);
document.getElementById('logout-btn').onclick = () => signOut(auth).then(() => location.reload());

onAuthStateChanged(auth, async user => {
    if (user) {
        const s = await getDoc(doc(db, "users", user.uid));
        if (s.exists()) state = { ...state, ...s.data() };
        document.getElementById('landing-page').style.display = 'none';
        document.getElementById('game-container').style.display = 'block';
        initGame();
        listenToBases();
        updateUI();
    }
});

// MAPA I GPS
function initGame() {
    if (map) return;
    map = L.map('map', { zoomControl: false, attributionControl: false }).setView([52.2, 21.0], 18);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

    // Znacznik gracza (strzałka)
    playerMarker = L.marker([0, 0], { 
        icon: L.divIcon({ className: 'player-arrow', html: '', iconSize: [24, 24], iconAnchor: [12, 12] }) 
    }).addTo(map);

    rangeCircle = L.circle([0, 0], { radius: 40, color: '#00f2ff', fillOpacity: 0.1, weight: 1 }).addTo(map);

    // OBSŁUGA KOMPASU (OBRÓT)
    if (window.DeviceOrientationEvent) {
        window.addEventListener('deviceorientationabsolute', (event) => {
            let heading = event.alpha; // Dla Androida
            if (event.webkitCompassHeading) heading = event.webkitCompassHeading; // Dla iOS
            
            if (heading !== null) {
                const el = playerMarker.getElement();
                if (el) el.style.transform = `rotate(${heading}deg)`;
            }
        }, true);
    }

    // ŚLEDZENIE GPS
    navigator.geolocation.watchPosition(pos => {
        const lat = pos.coords.latitude, lng = pos.coords.longitude;
        const newPos = [lat, lng];
        
        playerMarker.setLatLng(newPos);
        rangeCircle.setLatLng(newPos);
        map.panTo(newPos);

        // Generuj loot i zombie, jeśli przeszedłeś min. 40 metrów
        if (!lastLootPos || map.distance(newPos, lastLootPos) > 40) {
            lastLootPos = newPos;
            spawnLootArea(newPos);
            if (zMarkers.length < 5) spawnZombie(newPos);
        }
    }, null, { enableHighAccuracy: true });

    setInterval(gameLoop, 1000);
}

// SYSTEM LOOTU (GWARANTOWANY)
function spawnLootArea(pos) {
    // Tworzy 5 losowych skrzynek w zasięgu wzroku
    for(let i=0; i<5; i++) {
        const latOff = (Math.random() - 0.5) * 0.0015;
        const lngOff = (Math.random() - 0.5) * 0.0015;
        const id = `loot_${Math.floor(pos[0]*10000)}_${i}`;
        
        if (!state.looted[id]) {
            const m = L.marker([pos[0] + latOff, pos[1] + lngOff], {
                icon: L.divIcon({ html: '📦', className: 'loot-icon', iconSize: [35, 35] })
            }).addTo(map);

            m.on('click', () => {
                if (map.distance(playerMarker.getLatLng(), m.getLatLng()) < 45) {
                    map.removeLayer(m);
                    state.looted[id] = true;
                    const sc = Math.floor(Math.random()*3)+2, wd = Math.floor(Math.random()*3)+2;
                    state.scrap += sc; state.wood += wd;
                    showMsg(`ŁUP: +${sc}⚙️ +${wd}🪵`);
                    updateUI(true);
                } else showMsg("ZA DALEKO!");
            });
        }
    }
}

// ZOMBIE AI
function spawnZombie(center) {
    const lat = center[0] + (Math.random()-0.5)*0.01;
    const lng = center[1] + (Math.random()-0.5)*0.01;
    const z = L.marker([lat, lng], { icon: L.divIcon({ html: '🧟', className: 'zombie-icon' }) }).addTo(map);
    zMarkers.push(z);
}

function gameLoop() {
    if(!playerMarker || !auth.currentUser) return;
    const pPos = playerMarker.getLatLng();
    let isSafe = false;

    // Leczenie w bazie
    Object.values(existingBases).forEach(b => {
        if(b.owner === auth.currentUser.uid && map.distance(pPos, [b.lat, b.lng]) < 30) {
            isSafe = true;
            if(state.hp < 10) state.hp = Math.min(10, state.hp + 0.1);
        }
    });

    zMarkers.forEach(z => {
        const zPos = z.getLatLng();
        const dist = map.distance(zPos, pPos);
        if(dist < 60) {
            const move = 0.0001; // Prędkość zombie
            z.setLatLng([
                zPos.lat + (pPos.lat > zPos.lat ? move : -move),
                zPos.lng + (pPos.lng > zPos.lng ? move : -move)
            ]);
            if(dist < 10 && !isSafe) {
                state.hp -= 0.4;
                showMsg("⚠️ OSTRZEŻENIE: ATAK!");
            }
        }
    });
    updateUI();
}

// AKCJE GRACZA
document.getElementById('btn-attack').onclick = () => {
    const pPos = playerMarker.getLatLng();
    let kill = false;
    zMarkers = zMarkers.filter(z => {
        if(map.distance(pPos, z.getLatLng()) < 45) {
            map.removeLayer(z);
            state.scrap += 2;
            kill = true; return false;
        }
        return true;
    });
    if(kill) { showMsg("CEL WYELIMINOWANY (+2⚙️)"); updateUI(true); }
};

document.getElementById('btn-base').onclick = async () => {
    if(state.wood >= 10 && state.scrap >= 5) {
        const p = playerMarker.getLatLng();
        const q = query(collection(db, "bases"), where("owner", "==", auth.currentUser.uid));
        const old = await getDocs(q);
        old.forEach(d => deleteDoc(d.ref));
        await addDoc(collection(db, "bases"), { lat: p.lat, lng: p.lng, owner: auth.currentUser.uid });
        state.wood -= 10; state.scrap -= 5;
        showMsg("BAZA OPERACYJNA AKTYWNA");
        updateUI(true);
    } else showMsg("BRAK MATERIAŁÓW (10🪵 5⚙️)");
};

function listenToBases() {
    onSnapshot(collection(db, "bases"), snap => {
        map.eachLayer(l => { if(l.options && l.options.className === 'base-icon') map.removeLayer(l); });
        existingBases = {};
        snap.forEach(d => {
            const b = d.data();
            existingBases[d.id] = b;
            L.marker([b.lat, b.lng], { icon: L.divIcon({ html: '🏠', className: 'base-icon' }) }).addTo(map);
        });
    });
}

// CRAFTING & UI
document.getElementById('btn-craft').onclick = () => document.getElementById('craft-modal').style.display = 'flex';
document.getElementById('btn-close-craft').onclick = () => document.getElementById('craft-modal').style.display = 'none';
document.getElementById('btn-craft-food').onclick = () => {
    if(state.wood >= 3 && state.scrap >= 2) {
        state.wood -= 3; state.scrap -= 2; state.food++;
        updateUI(true); showMsg("WYPRODUKOWANO RACJĘ");
    }
};
document.getElementById('btn-eat').onclick = () => {
    if(state.food > 0) { state.food--; state.hp = Math.min(10, state.hp + 4); updateUI(true); }
};

function updateUI(cloud = false) {
    document.getElementById('hp-bar').style.width = (state.hp * 10) + "%";
    document.getElementById('s-scrap').innerText = state.scrap;
    document.getElementById('s-wood').innerText = state.wood;
    document.getElementById('s-food').innerText = state.food;
    if(state.hp <= 0) {
        alert("SYSTEM SKASOWANY. RESTART...");
        state = { hp: 10, scrap: 0, wood: 0, food: 3, looted: {} };
        cloud = true;
    }
    if(cloud && auth.currentUser) updateDoc(doc(db, "users", auth.currentUser.uid), state);
}

function showMsg(t) {
    const m = document.getElementById("msg");
    m.innerText = t; m.style.display = "block";
    setTimeout(() => m.style.display = "none", 2000);
}
