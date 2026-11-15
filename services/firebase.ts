
import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBpzl6fjWkUem3cccZDMOUVdOgACcLtmFs",
  authDomain: "test-d4d57.firebaseapp.com",
  projectId: "test-d4d57",
  storageBucket: "test-d4d57.firebasestorage.app",
  messagingSenderId: "732057302908",
  appId: "1:732057302908:web:a45f3de76deba9ab1056f9",
  measurementId: "G-YG7HZWBMC4"
};

// تهيئة التطبيق كـ Singleton لضمان عدم تكرار التهيئة
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// تصدير نسخة Firestore مرتبطة بالتطبيق
export const db = getFirestore(app);
