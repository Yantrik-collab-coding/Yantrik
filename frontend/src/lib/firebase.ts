import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider, signInWithPopup, sendPasswordResetEmail as firebaseSendPasswordReset } from 'firebase/auth'

// Replace with your Firebase config from Firebase Console
// Project Settings → Your apps → Web app → firebaseConfig
const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
}

const app      = initializeApp(firebaseConfig)
const auth     = getAuth(app)
const provider = new GoogleAuthProvider()
provider.addScope('email')
provider.addScope('profile')

export async function signInWithGoogle(): Promise<string> {
  const result = await signInWithPopup(auth, provider)
  const idToken = await result.user.getIdToken()
  return idToken
}

export async function sendPasswordResetEmail(email: string): Promise<void> {
  await firebaseSendPasswordReset(auth, email)
}

export { auth }
