import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

// Конфиг из консоли Firebase (эти ключи публичные — доступ ограничивают правила базы).
const firebaseConfig = {
  apiKey: "AIzaSyBtPAWrZvdk8dO-igv1uNfGZTQk9XGYNYo",
  authDomain: "family-budget-18a4c.firebaseapp.com",
  databaseURL: "https://family-budget-18a4c-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "family-budget-18a4c",
  storageBucket: "family-budget-18a4c.firebasestorage.app",
  messagingSenderId: "773699642502",
  appId: "1:773699642502:web:18c67b146b4ca7f39d1d07",
};

export const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
