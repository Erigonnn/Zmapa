import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, getDoc, updateDoc, collection, addDoc, onSnapshot, query, where, getDocs, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- KONFIGURACJA FIREBASE (WKLEJ SWOJĄ!) ---
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

// --- ZMIENNE GLOBALNE ---
let state = { hp: 10, scrap: 0, wood: 0, food: 3, looted: {} };
let map, player, rangeCircle;
let zMarkers = [];
let lastScanPos = null;
let lastLootGenTime = 0;
let existingBases = {};

// --- 1. SYSTEM LOGOWANIA ---
document.getElementById('login-btn').onclick = () => {
    const e = document.getElementById('email').value;
    const p = document.getElementById('password').value;
    if(!e || !p) return alert("Wprowadź dane!");
    signInWithEmailAndPassword(auth, e, p).catch(err => alert("Błąd: " + err.message));
};
document.getElementById('google-btn').onclick = () => signInWithPopup(auth, provider);
document.getElementById('logout-btn').onclick = () => signOut(auth).then(() => location.reload());

onAuthStateChanged(auth, async user => {
    if (user) {
        const docRef = doc(db, "users", user.uid);
        const s = await getDoc(docRef);
        if (s.exists()) state = { ...state, ...s.data() };
        
        document.getElementById('landing-page').style.display = 'none';
        document.getElementById('game-container').style.display = 'block';
        
        initGame();
        listenToBases();
        updateUI();
    }
});

// --- 2. INICJALIZACJA MAPY ---
function initGame() {
    if (map) return;
    // Startowa pozycja (zostanie nadpisana przez GPS)
    map = L.map('map', { zoomControl: false, attributionControl: false }).setView([52.2, 21.0], 17);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

    player = L.marker([0, 0], { 
        icon: L.divIcon({ className: 'player-icon', html: '' }) 
    }).addTo(map);

    rangeCircle = L.circle([0, 0], { radius: 40, color: '#00ffff', fillOpacity: 0.05, weight: 1 }).addTo(map);

    // GPS WATCHER
    navigator.geolocation.watchPosition(pos => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const newPos = [lat, lng];

        player.setLatLng(newPos);
        rangeCircle.setLatLng(newPos);
        map.panTo(newPos);

        // Mechaniki gry
        if (zMarkers.length < 5) spawnZombie(newPos);
        scanLoot(newPos);
    }, err => console.error(err), { enableHighAccuracy: true });

    // Pętla logiczna (ruch zombie, regeneracja)
    setInterval(gameLoop, 1000);
}

// --- 3. SYSTEM LOOTU (HYBRYDOWY) ---
async function scanLoot(pos) {
    const now = Date.now();
    // Nie skanuj częściej niż co 10s i tylko jak się ruszyłeś
    if (now - lastLootGenTime < 10000) return;
    if (lastScanPos && map.distance(pos, lastScanPos) < 60) return;

    lastScanPos = pos;
    lastLootGenTime = now;

    // Próba pobrania budynków z mapy
    const query = `[out:json][timeout:4];(node["building"](around:130,${pos[0]},${pos[1]});way["building"](around:130,${pos[0]},${pos[1]}););out center;`;

    try {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 3000); // 3 sekundy limitu
        
        const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: query, signal: controller.signal });
        clearTimeout(id);
        
        if(!res.ok) throw new Error("API Error");
        const data = await res.json();

        if(data.elements && data.elements.length > 0) {
            // Są budynki - użyj ich
            data.elements.forEach(el => {
                const lat = el.lat || (el.center && el.center.lat);
                const lon = el.lon || (el.center && el.center.lon);
                if(lat && lon) createLootMarker(lat, lon, el.id);
            });
        } else {
            throw new Error("Pusto");
        }
    } catch (e) {
        // Brak budynków lub błąd -> GENERUJ LOSOWE SKRZYNKI
        generateRandomLoot(pos);
    }
}

function generateRandomLoot(center) {
    const count = Math.floor(Math.random() * 3) + 3; // 3-5 skrzynek
    for(let i=0; i<count; i++) {
        const latOff = (Math.random() - 0.5) * 0.002;
        const lngOff = (Math.random() - 0.5) * 0.002
