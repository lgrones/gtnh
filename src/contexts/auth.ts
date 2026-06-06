import {
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updatePassword,
  type User,
} from 'firebase/auth';
import { create } from 'zustand';

import { auth } from '@/infrastructure/firebase';

interface AuthState {
  user: User | null;
  // true until the first onAuthStateChanged fires — avoids flashing the
  // sign-in screen before Firebase restores a persisted session
  loading: boolean;
  // email/password sign-in only. Account creation is disabled in the Firebase
  // console (Authentication → Settings → User actions), so the only accounts
  // that exist are ones added by hand — there is no public sign-up path.
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  // changing a password is a security-sensitive op, so Firebase requires a
  // recent login. Reauthenticate with the current password first, then update.
  changePassword: (
    currentPassword: string,
    newPassword: string,
  ) => Promise<void>;
}

export const useAuth = create<AuthState>()(() => ({
  user: null,
  loading: true,
  signIn: async (email, password) => {
    await signInWithEmailAndPassword(auth, email, password);
  },
  signOut: async () => {
    await firebaseSignOut(auth);
  },
  changePassword: async (currentPassword, newPassword) => {
    const user = auth.currentUser;
    if (!user?.email) throw new Error('Not signed in');
    const credential = EmailAuthProvider.credential(
      user.email,
      currentPassword,
    );
    await reauthenticateWithCredential(user, credential);
    await updatePassword(user, newPassword);
  },
}));

// mirror Firebase's auth lifecycle into the store. module-level so it attaches
// once, independent of React render — the store is the single source of truth
onAuthStateChanged(auth, user => {
  useAuth.setState({ user, loading: false });
});
