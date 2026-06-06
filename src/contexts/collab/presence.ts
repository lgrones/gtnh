import { create } from 'zustand';

// one collaborator's live presence on the active graph
export interface Peer {
  uid: string;
  name: string;
  color: string;
  cursor?: { x: number; y: number } | null;
  selection?: string[];
}

interface PresenceState {
  // remote peers only (self is excluded), keyed by uid
  peers: Record<string, Peer>;
}

export const usePresence = create<PresenceState>()(() => ({ peers: {} }));

const COLORS = [
  '#e64980',
  '#7950f2',
  '#4263eb',
  '#1098ad',
  '#0ca678',
  '#f59f00',
  '#f76707',
] as const;

// stable per-user color from a hash of the uid
export const colorForUid = (uid: string): string => {
  let hash = 0;
  for (let i = 0; i < uid.length; i++)
    hash = (hash * 31 + uid.charCodeAt(i)) | 0;

  return COLORS[Math.abs(hash) % COLORS.length] ?? COLORS[0];
};
