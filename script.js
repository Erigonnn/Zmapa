import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

let state = { hp: 100, scrap: 50, wood: 20 };
let map, playerMarker;

// 1. USTAW TRWAŁOŚĆ SESJI
setPersistence(auth, browserLocalPersistence);

// 2. OBSŁUGA LOGOWANIA
document.getElementById('google-btn').onclick = async () => {
    try {
        await signInWithPopup(auth, provider);
    } catch (err) {
        document.getElementById('debug-info').innerText = "Błąd: " + err.message;
    }
};

// 3. MONITOR SESJI (Główny silnik przełączania ekranów)
onAuthStateChanged(auth, async (user) => {
    if (user) {
        // Zalogowany - pobierz dane i wejdź do gry
        const docRef = doc(db, "users", user.uid);
        const snap = await getDoc(docRef);
        
        if (snap.exists()) {
            state = { ...state, ...snap.data() };
        } else {
            await setDoc(docRef, state);
        }

        document.getElementById('landing-page').style.display = 'none';
        document.getElementById('game-container').style.display = 'block';
        
        if (!map) initGame();
        updateUI();
    } else {
        // Niezalogowany - pokaż ekran startowy
        document.getElementById('landing-page').style.display = 'flex';
        document.getElementById('game-container').style.display = 'none';
    }
});

function initGame() {
    map = L.map('map', { zoomControl: false }).setView([52.2, 21.0], 18);
    // Jasna mapa
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png').addTo(map);

    playerMarker = L.circleMarker([52.2, 21.0], { color: '#00e5ff', radius: 10, fillOpacity: 0.8 }).addTo(map);

    navigator.geolocation.watchPosition(pos => {
        const p = [pos.coords.latitude, pos.coords.longitude];
        playerMarker.setLatLng(p);
        map.panTo(p);
    }, null, { enableHighAccuracy: true });
}

function updateUI() {
    document.getElementById('hp-fill').style.width = state.hp + "%";
    document.getElementById('s-scrap').innerText = state.scrap;
    document.getElementById('s-wood').innerText = state.wood;
}
