import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithRedirect, getRedirectResult, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, getDoc, updateDoc, collection, addDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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
let map, playerMarker, lastSpawnPos = null;
let zMarkers = [];
let lootMarkers = [];

document.getElementById('google-btn').onclick = () => signInWithRedirect(auth, provider);
getRedirectResult(auth).catch(e => console.error(e));

onAuthStateChanged(auth, async user => {
    if (user) {
        const s = await getDoc(doc(db, "users", user.uid));
        if (s.exists()) state = { ...state, ...s.data() };
        document.getElementById('landing-page').style.display = 'none';
        document.getElementById('game-container').style.display = 'block';
        initGame();
    }
});

function initGame() {
    if (map) return;
    map = L.map('map', { zoomControl: false, attributionControl: false }).setView([52.2, 21.0], 18);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

    playerMarker = L.marker([0, 0], { 
        icon: L.divIcon({ className: 'player-arrow', iconSize: [24, 24], iconAnchor: [12, 12] }) 
    }).addTo(map);

    // KOMPAS
    window.addEventListener('deviceorientationabsolute', (e) => {
        let heading = e.webkitCompassHeading || (360 - e.alpha);
        if (heading) {
            const el = playerMarker.getElement();
            if (el) el.style.transform = `rotate(${heading}deg)`;
        }
    }, true);

    // GPS + AUTO-SPAWN
    navigator.geolocation.watchPosition(pos => {
        const p = [pos.coords.latitude, pos.coords.longitude];
        playerMarker.setLatLng(p);
        map.panTo(p);

        if (!lastSpawnPos || map.distance(p, lastSpawnPos) > 40) {
            lastSpawnPos = p;
            autoSpawn(p);
        }
    }, null, { enableHighAccuracy: true });

    setInterval(gameLoop, 1000);
}

function autoSpawn(p) {
    // Generuj 3-4 paczki i zombie co 40 metrów marszu
    for(let i=0; i<3; i++) {
        const off = () => (Math.random() - 0.5) * 0.002;
        const loot = L.marker([p[0]+off(), p[1]+off()], { icon: L.divIcon({ html: '📦', className: 'loot-icon' }) }).addTo(map);
        loot.on('click', () => {
            if(map.distance(playerMarker.getLatLng(), loot.getLatLng()) < 40) {
                map.removeLayer(loot);
                state.scrap += 5; state.wood += 5;
                showMsg("+5⚙️ +5🪵"); updateUI(true);
            }
        });
        
        const z = L.marker([p[0]+off(), p[1]+off()], { icon: L.divIcon({ html: '🧟', className: 'zombie-icon' }) }).addTo(map);
        zMarkers.push(z);
    }
}

function gameLoop() {
    if(!playerMarker) return;
    const pPos = playerMarker.getLatLng();
    zMarkers.forEach(z => {
        const zPos = z.getLatLng();
        const dist = map.distance(zPos, pPos);
        if(dist < 100) {
            const speed = 0.00007; // Zombie idą w Twoją stronę
            z.setLatLng([
                zPos.lat + (pPos.lat > zPos.lat ? speed : -speed),
                zPos.lng + (pPos.lng > zPos.lng ? speed : -speed)
            ]);
            if(dist < 10) { state.hp -= 0.2; updateUI(); }
        }
    });
}

document.getElementById('btn-attack').onclick = () => {
    const p = playerMarker.getLatLng();
    zMarkers = zMarkers.filter(z => {
        if(map.distance(p, z.getLatLng()) < 40) {
            map.removeLayer(z); state.scrap += 2;
            showMsg("ZABITY (+2⚙️)"); updateUI(true);
            return false;
        }
        return true;
    });
};

function updateUI(cloud = false) {
    document.getElementById('hp-bar').style.width = (state.hp * 10) + "%";
    document.getElementById('s-scrap').innerText = state.scrap;
    document.getElementById('s-wood').innerText = state.wood;
    document.getElementById('s-food').innerText = state.food;
    if(cloud && auth.currentUser) updateDoc(doc(db, "users", auth.currentUser.uid), state);
}

function showMsg(t) {
    const m = document.getElementById("msg");
    m.innerText = t; m.style.display = "block";
    setTimeout(() => m.style.display = "none", 2000);
}
