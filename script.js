import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithRedirect, getRedirectResult, GoogleAuthProvider, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, collection, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = { /* TWOJE DANE */ };
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

let state = { hp: 100, scrap: 20, wood: 20, food: 3, weapon: "PIĘŚCI", hasBase: false };
let map, playerMarker;
let zombies = [], loots = [], globalBases = {};

// LOGOWANIE
document.getElementById('google-btn').onclick = () => signInWithRedirect(auth, provider);
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const s = await getDoc(doc(db, "users", user.uid));
        if (s.exists()) state = {...state, ...s.data()};
        document.getElementById('landing-page').style.display = 'none';
        document.getElementById('game-container').style.display = 'block';
        initGame();
        listenToBases(); // Widoczność baz innych graczy
    }
});

function initGame() {
    map = L.map('map', { zoomControl: false }).setView([52.2, 21.0], 18);
    // JASNY STYL MAPY
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png').addTo(map);

    playerMarker = L.marker([52.2, 21.0], {
        icon: L.divIcon({ className: 'player-arrow', id: 'p-arrow', iconSize: [24, 24] })
    }).addTo(map);

    // Kompas
    window.addEventListener('deviceorientationabsolute', (e) => {
        let heading = e.webkitCompassHeading || (360 - e.alpha);
        if(heading) document.getElementById('p-arrow').style.transform = `rotate(${heading}deg)`;
    }, true);

    // GPS i Loot
    navigator.geolocation.watchPosition(pos => {
        const p = [pos.coords.latitude, pos.coords.longitude];
        playerMarker.setLatLng(p);
        map.panTo(p);
        if(loots.length < 20) spawnLoot(p);
    }, null, { enableHighAccuracy: true });

    setInterval(gameLoop, 1000);
}

// Globalne bazy innych graczy
function listenToBases() {
    onSnapshot(collection(db, "bases"), (snap) => {
        snap.forEach(d => {
            if(!globalBases[d.id]) {
                const data = d.data();
                globalBases[d.id] = L.marker([data.lat, data.lng], {
                    icon: L.divIcon({ html: `🏠 Base v${data.lv}`, className: 'base-label' })
                }).addTo(map);
            }
        });
    });
}

function spawnLoot(p) {
    const off = () => (Math.random() - 0.5) * 0.005;
    const l = L.marker([p[0]+off(), p[1]+off()], { icon: L.divIcon({ html: '📦' }) }).addTo(map);
    l.on('click', () => {
        if(map.distance(playerMarker.getLatLng(), l.getLatLng()) < 30) {
            state.scrap += 10; updateUI(true); map.removeLayer(l);
        }
    });
    loots.push(l);
}

function gameLoop() {
    // Zombie logic
    if(zombies.length < 5) spawnZombie();
    zombies.forEach(z => {
        const zPos = z.getLatLng();
        const pPos = playerMarker.getLatLng();
        const dist = map.distance(zPos, pPos);
        
        if(dist < 100) { // Atak
            const step = 0.00008;
            z.setLatLng([zPos.lat + (pPos.lat > zPos.lat ? step : -step), zPos.lng + (pPos.lng > zPos.lng ? step : -step)]);
            if(dist < 10) { state.hp -= 2; updateUI(); }
        } else { // Szwendanie
            z.setLatLng([zPos.lat + (Math.random()-0.5)*0.0001, zPos.lng + (Math.random()-0.5)*0.0001]);
        }
    });
}

window.craft = async (type) => {
    if(type === 'weapon' && state.scrap >= 50) {
        state.scrap -= 50; state.weapon = "NÓŻ MYŚLIWSKI";
    } else if(type === 'base' && !state.hasBase && state.wood >= 100) {
        const p = playerMarker.getLatLng();
        state.wood -= 100; state.hasBase = true;
        await setDoc(doc(db, "bases", auth.currentUser.uid), { lat: p.lat, lng: p.lng, lv: 1, owner: auth.currentUser.displayName });
    }
    updateUI(true);
    document.getElementById('craft-panel').style.display = 'none';
};

function updateUI(cloud = false) {
    document.getElementById('hp-bar').style.width = state.hp + "%";
    document.getElementById('hp-val').innerText = Math.floor(state.hp);
    document.getElementById('s-scrap').innerText = state.scrap;
    document.getElementById('s-wood').innerText = state.wood;
    document.getElementById('s-food').innerText = state.food;
    document.getElementById('current-weapon').innerText = state.weapon;
    if(cloud && auth.currentUser) updateDoc(doc(db, "users", auth.currentUser.uid), state);
}
// Reszta przycisków...
document.getElementById('btn-open-craft').onclick = () => document.getElementById('craft-panel').style.display = 'flex';
document.getElementById('close-craft').onclick = () => document.getElementById('craft-panel').style.display = 'none';
