import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

const firebaseConfig = {
  apiKey: 'AIzaSyBLInvEGpzEyKZoevUKKVux6hmSiRCRgko',
  appId: '1:790484815764:web:a07af65ba7854911c98981',
  authDomain: 'quizgomes-cbc48.firebaseapp.com',
  projectId: 'quizgomes-cbc48',
};

const firebaseApp = initializeApp(firebaseConfig);

export const firebaseAuth = getAuth(firebaseApp);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });
