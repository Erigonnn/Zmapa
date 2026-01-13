import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, collection, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

let state = { hp: 100, scrap: 50, wood: 50, food: 2, weapon: "PIĘŚCI", hasBase: false };
let map, playerMarker;
let zombies = [], loots = [];

// --- LOGOWANIE POPUP (NAPRAWIA PĘTLĘ) ---
document.getElementById('google-btn').onclick = () => {
    signInWithPopup(auth, provider).catch(err => alert("Błąd logowania: " + err.message));
};

onAuthStateChanged(auth, async (user) => {
    if (user) {
        const docRef = doc(db, "users", user.uid);
        const snap = await getDoc(docRef);
        if (snap.exists()) state = { ...state, ...snap.data() };
        else await setDoc(docRef, state);

        document.getElementById('landing-page').style.display = 'none';
        document.getElementById('game-container').style.display = 'block';
        if (!map) startSurvival();
    }
});

function startSurvival() {
    map = L.map('map', { zoomControl: false }).setView([52.2, 21.0], 18);
    // JASNA MAPA
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png').addTo(map);

    playerMarker = L.marker([52.2, 21.0], {
        icon: L.divIcon({ className: 'player-icon', id: 'arrow' })
    }).addTo(map);

    // GPS I LOOT
    navigator.geolocation.watchPosition(pos => {
        const p = [pos.coords.latitude, pos.coords.longitude];
        playerMarker.setLatLng(p);
        map.panTo(p);
        if (loots.length < 10) spawnLoot(p);
    }, null, { enableHighAccuracy: true });

    // KOMPAS
    window.addEventListener('deviceorientationabsolute', (e) => {
        let heading = e.webkitCompassHeading || (360 - e.alpha);
        if(heading) document.getElementById('arrow').style.transform = `rotate(${heading}deg)`;
    }, true);

    // POBIERANIE BAZ INNYCH
    onSnapshot(collection(db, "bases"), (snap) => {
        snap.forEach(d => {
            const b = d.data();
            L.marker([b.lat, b.lng], { icon: L.divIcon({ html: '🏠', className: 'base-label' }) }).addTo(map);
        });
    });

    setInterval(gameLoop, 1000);
}

function spawnLoot(p) {
    const off = () => (Math.random() - 0.5) * 0.005;
    const l = L.marker([p[0]+off(), p[1]+off()], { icon: L.divIcon({ html: '📦' }) }).addTo(map);
    l.on('click', () => {
        if(map.distance(playerMarker.getLatLng(), l.getLatLng()) < 30) {
            state.scrap += 15; updateUI(true); map.removeLayer(l);
            msg("Znalazłeś złom!");
        }
    });
    loots.push(l);
}

function gameLoop() {
    if (!playerMarker) return;
    const pPos = playerMarker.getLatLng();

    // Spawnowanie Zombie
    if(zombies.length < 5) {
        const off = () => (Math.random() - 0.5) * 0.007;
        const z = L.marker([pPos.lat+off(), pPos.lng+off()], { icon: L.divIcon({ html: '🧟' }) }).addTo(map);
        zombies.push(z);
    }

    zombies.forEach(z => {
        const zPos = z.getLatLng();
        const dist = map.distance(zPos, pPos);
        if(dist < 80) { // Atak
            const s = 0.00008;
            z.setLatLng([zPos.lat + (pPos.lat > zPos.lat ? s : -s), zPos.lng + (pPos.lng > zPos.lng ? s : -s)]);
            if(dist < 10) { state.hp -= 2; updateUI(); }
        } else { // Szwendanie
            z.setLatLng([zPos.lat + (Math.random()-0.5)*0.0001, zPos.lng + (Math.random()-0.5)*0.0001]);
        }
    });
}

window.handleCraft = async (type) => {
    if (type === 'weapon' && state.scrap >= 30) {
        state.scrap -= 30; state.weapon = "NÓŻ";
    } else if (type === 'base' && state.wood >= 100 && !state.hasBase) {
        state.wood -= 100; state.hasBase = true;
        const p = playerMarker.getLatLng();
        await setDoc(doc(db, "bases", auth.currentUser.uid), { lat: p.lat, lng: p.lng, owner: auth.currentUser.displayName });
    }
    updateUI(true);
    document.getElementById('craft-modal').style.display = 'none';
};

function updateUI(cloud = false) {
    document.getElementById('hp-bar').style.width = state.hp + "%";
    document.getElementById('hp-text').innerText = Math.max(0, Math.floor(state.hp));
    document.getElementById('s-scrap').innerText = state.scrap;
    document.getElementById('s-wood').innerText = state.wood;
    document.getElementById('s-food').innerText = state.food;
    document.getElementById('active-weapon').innerText = state.weapon;
    if(cloud && auth.currentUser) updateDoc(doc(db, "users", auth.currentUser.uid), state);
}

document.getElementById('btn-attack').onclick = () => {
    const p = playerMarker.getLatLng();
    zombies = zombies.filter(z => {
        if(map.distance(p, z.getLatLng()) < 35) {
            map.removeLayer(z); state.scrap += 5; updateUI(true);
            msg("Zombie pokonane!"); return false;
        }
        return true;
    });
};

document.getElementById('btn-craft').onclick = () => document.getElementById('craft-modal').style.display = 'flex';
document.getElementById('close-craft').onclick = () => document.getElementById('craft-modal').style.display = 'none';
function msg(m) { const t = document.getElementById('toast'); t.innerText = m; t.style.display='block'; setTimeout(()=>t.style.display='none', 2000); }
