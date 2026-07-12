import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

// Конфиг из консоли Firebase (публичные ключи — их безопасно хранить в коде).
const firebaseConfig = {
  apiKey: "ЗАМЕНИТЬ",
  authDomain: "family-budget-18a4c.firebaseapp.com",
  databaseURL: "ЗАМЕНИТЬ",
  projectId: "family-budget-18a4c",
  storageBucket: "family-budget-18a4c.appspot.com",
  messagingSenderId: "ЗАМЕНИТЬ",
  appId: "ЗАМЕНИТЬ",
};

export const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
