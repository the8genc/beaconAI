/**
 * API Service - connects to BeaconAI ZeroDB backend
 */
import { Platform } from 'react-native';
import { Profile, PeerProfile } from '@/types/profile';
import { DiscoverySession, ConnectionLog } from '@/types/session';

const API_BASE = Platform.OS === 'web'
  ? 'http://localhost:3001/api'
  : 'http://localhost:3001/api'; // Update for production

class ApiServiceImpl {
  private baseUrl: string;

  constructor() {
    this.baseUrl = API_BASE;
  }

  private async request(path: string, method = 'GET', body?: any) {
    const opts: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);

    try {
      const res = await fetch(`${this.baseUrl}${path}`, opts);
      if (!res.ok) {
        const err = await res.text();
        console.warn(`API ${method} ${path} failed (${res.status}):`, err);
        return null;
      }
      return res.json();
    } catch (err) {
      console.warn(`API ${method} ${path} error:`, err);
      return null;
    }
  }

  // ─── Profiles ───────────────────────────────────────
  async saveProfile(profile: Profile) {
    return this.request('/profiles', 'POST', {
      uuid: profile.uuid,
      name: profile.name,
      role: profile.role,
      company: profile.company,
      avatarUri: profile.avatarUri,
      socialLinks: profile.socialLinks,
    });
  }

  async getProfile(userId: string) {
    return this.request(`/profiles/${userId}`);
  }

  async listProfiles(limit = 50) {
    return this.request(`/profiles?limit=${limit}`);
  }

  // ─── Peers ──────────────────────────────────────────
  async recordPeer(peer: PeerProfile, discoveredBy: string, sessionId?: string) {
    return this.request('/peers', 'POST', {
      peerId: peer.uuid,
      name: peer.name,
      role: peer.role,
      company: peer.company,
      rssi: peer.rssi,
      sessionId,
      discoveredBy,
    });
  }

  async getPeers(userId: string) {
    return this.request(`/peers/${userId}`);
  }

  async savePeerContact(rowId: string) {
    return this.request(`/peers/${rowId}/save`, 'PUT');
  }

  // ─── Sessions ───────────────────────────────────────
  async startSession(userId: string, mode: string = 'default', roomCode?: string) {
    return this.request('/sessions', 'POST', { userId, mode, roomCode });
  }

  async endSession(rowId: string) {
    return this.request(`/sessions/${rowId}/end`, 'PUT');
  }

  async getSessions(userId: string) {
    return this.request(`/sessions/${userId}`);
  }

  // ─── Connections ────────────────────────────────────
  async logConnection(userId: string, peerId: string, type: string, sessionId?: string, notes?: string) {
    return this.request('/connections', 'POST', {
      userId,
      peerId,
      interactionType: type,
      sessionId,
      notes,
    });
  }

  async getConnections(userId: string) {
    return this.request(`/connections/${userId}`);
  }
}

export const apiService = new ApiServiceImpl();
export default apiService;
