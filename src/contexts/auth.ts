import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { create } from 'zustand';

import { auth } from '@/infrastructure/firebase';

interface AuthState {
  user: User | null;
  // true until the first onAuthStateChanged fires — avoids flashing the
  // sign-in screen before Firebase restores a persisted session
  loading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const provider = new GoogleAuthProvider();

export const useAuth = create<AuthState>()(() => ({
  user: null,
  loading: true,
  signIn: async () => {
    await signInWithPopup(auth, provider);
  },
  signOut: async () => {
    await firebaseSignOut(auth);
  },
}));

// mirror Firebase's auth lifecycle into the store. module-level so it attaches
// once, independent of React render — the store is the single source of truth
onAuthStateChanged(auth, user => {
  useAuth.setState({ user, loading: false });
});
