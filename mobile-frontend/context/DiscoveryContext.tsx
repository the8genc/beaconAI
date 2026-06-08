import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { Alert, Platform, AppState, AppStateStatus } from 'react-native';
import { useProfile } from './ProfileContext';
import { useSettings } from './SettingsContext';
import { PeerProfile } from '@/types/profile';
import bleService from '@/services/BleService';
import sessionService from '@/services/SessionService';
import { apiService } from '@/services/ApiService';
import { BleDiscoveryStatus, BlePermissionStatus, BleState } from '@/types/ble';
import { DiscoverySession } from '@/types/session';



// Map BleDiscoveryStatus to simpler UI status
type DiscoveryStatus = 'idle' | 'scanning' | 'advertising' | 'scanning_and_advertising' | 'error';

interface DiscoveryContextType {
  isDiscovering: boolean;
  status: DiscoveryStatus;
  nearbyPeers: PeerProfile[];
  currentSession: DiscoverySession | null;
  startDiscovery: () => void;
  stopDiscovery: () => void;
  permissionStatus: BlePermissionStatus;
  requestPermissions: () => Promise<boolean>;
  bleState: BleState;
  logPeerInteraction: (peerId: string, type: 'viewed' | 'saved' | 'shared') => Promise<void>;
}

const DiscoveryContext = createContext<DiscoveryContextType>({
  isDiscovering: false,
  status: 'idle',
  nearbyPeers: [],
  currentSession: null,
  startDiscovery: () => {},
  stopDiscovery: () => {},
  permissionStatus: BlePermissionStatus.UNKNOWN,
  requestPermissions: async () => false,
  bleState: BleState.UNKNOWN,
  logPeerInteraction: async () => {}
});

export const useDiscovery = () => useContext(DiscoveryContext);

export const DiscoveryProvider: React.FC<{ children: React.ReactNode }> = ({ 
  children 
}) => {
  const { profile, isProfileComplete } = useProfile();
  const { settings } = useSettings();
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [status, setStatus] = useState<DiscoveryStatus>('idle');
  const [nearbyPeers, setNearbyPeers] = useState<PeerProfile[]>([]);
  const [currentSession, setCurrentSession] = useState<DiscoverySession | null>(null);
  const [permissionStatus, setPermissionStatus] = useState<BlePermissionStatus>(BlePermissionStatus.UNKNOWN);
  const [bleState, setBleState] = useState<BleState>(BleState.UNKNOWN);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  
  // References for timeout and interval IDs - using number type for compatibility with browser setInterval/setTimeout
  const discoveryTimeoutRef = useRef<number | null>(null);
  const peerExpirationIntervalRef = useRef<number | null>(null);

  // Cleanup function for all intervals and timeouts and BLE operations
  const cleanup = () => {
    if (discoveryTimeoutRef.current) {
      clearTimeout(discoveryTimeoutRef.current);
      discoveryTimeoutRef.current = null;
    }
    
    if (peerExpirationIntervalRef.current) {
      clearInterval(peerExpirationIntervalRef.current);
      peerExpirationIntervalRef.current = null;
    }
    
    // Stop BLE operations
    bleService.stopAdvertising();
    bleService.stopScanning();
  };

  // Initialize BLE service
  useEffect(() => {
    const initialize = async () => {
      await bleService.initialize();
      updateBleState();
      checkPermissions();
    };
    
    initialize();

    // Handle app state changes (for battery optimization)
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      // When app goes to background, stop discovery to save battery
      if (appStateRef.current === 'active' && nextAppState.match(/inactive|background/)) {
        if (isDiscovering) {
          // Need to call stopDiscovery via reference to avoid TypeScript errors
          setIsDiscovering(false);
          setStatus('idle');
          cleanup();
        }
      } 
      // When app comes to foreground, check BLE state and permissions
      else if (appStateRef.current.match(/inactive|background/) && nextAppState === 'active') {
        updateBleState();
        checkPermissions();
      }
      
      appStateRef.current = nextAppState;
    };
    
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    
    // Clean up on unmount
    return () => {
      subscription.remove();
      cleanup();
    };
  }, []);
  
  // Update BLE state
  const updateBleState = async () => {
    const state = await bleService.getState();
    setBleState(state);
  };
  
  // Check BLE permissions
  const checkPermissions = async () => {
    const status = await bleService.checkPermissions();
    setPermissionStatus(status);
    return status === BlePermissionStatus.GRANTED;
  };
  
  // Request BLE permissions
  const requestPermissions = async () => {
    const status = await bleService.requestPermissions();
    setPermissionStatus(status);
    return status === BlePermissionStatus.GRANTED;
  };

  const startDiscovery = async () => {
    // Check if privacy mode is enabled
    if (settings.privacyMode) {
      Alert.alert(
        'Privacy Mode Enabled',
        'Discovery is disabled in privacy mode. Please disable privacy mode in settings to continue.',
        [{ text: 'OK' }]
      );
      return;
    }
    
    // Check if profile is complete
    if (!isProfileComplete) {
      Alert.alert(
        'Profile Required',
        'Please complete your profile before starting discovery.',
        [{ text: 'OK' }]
      );
      return;
    }
    
    // Check Bluetooth state
    const state = await bleService.getState();
    setBleState(state);
    
    if (state !== BleState.POWERED_ON) {
      Alert.alert(
        'Bluetooth Required',
        'Please enable Bluetooth to discover nearby peers.',
        [{ text: 'OK' }]
      );
      return;
    }
    
    // Check permissions
    const permissionsGranted = await checkPermissions();
    if (!permissionsGranted) {
      const requested = await requestPermissions();
      if (!requested) {
        Alert.alert(
          'Permissions Required',
          'Bluetooth permissions are needed to discover nearby peers.',
          [{ text: 'OK' }]
        );
        return;
      }
    }

    // Start discovery session
    const session = await sessionService.startSession();
    setCurrentSession(session);
    
    // Start discovery process
    setIsDiscovering(true);
    setStatus('scanning_and_advertising');
    setNearbyPeers([]);
    
    // Start advertising profile (only if advertising is enabled)
    const advertisingStarted = settings.advertisingEnabled 
      ? await bleService.startAdvertising(profile)
      : true; // Consider advertising "started" if disabled
    
    // Start scanning for peers
    const scanningStarted = await bleService.startScanning((discoveredPeer) => {
      // Add peer to current session
      sessionService.addPeerToSession(discoveredPeer.uuid);
      
      // Process discovered peer
      setNearbyPeers(prevPeers => {
        // Check if peer already exists
        if (prevPeers.some(p => p.uuid === discoveredPeer.uuid)) {
          // Update existing peer with new data (like RSSI)
          return prevPeers.map(p => 
            p.uuid === discoveredPeer.uuid 
              ? { ...p, rssi: discoveredPeer.rssi } 
              : p
          );
        }
        
        // Add new peer
        return [...prevPeers, discoveredPeer];
      });
    });
    
    // Update status based on what operations succeeded
    if (advertisingStarted && scanningStarted) {
      setStatus(settings.advertisingEnabled ? 'scanning_and_advertising' : 'scanning');
    } else if (advertisingStarted && settings.advertisingEnabled) {
      setStatus('advertising');
    } else if (scanningStarted) {
      setStatus('scanning');
    } else {
      setStatus('error');
      setIsDiscovering(false);
      Alert.alert(
        'Discovery Failed',
        'Failed to start Bluetooth discovery. Please try again.',
        [{ text: 'OK' }]
      );
      return;
    }

    // Auto-disconnect after 5 minutes (battery optimization)
    discoveryTimeoutRef.current = window.setTimeout(() => {
      stopDiscovery();
      Alert.alert('Session Timeout', 'Discovery session ended after 5 minutes to save battery');
    }, 5 * 60 * 1000);

    // Set up interval to remove expired peers
    peerExpirationIntervalRef.current = window.setInterval(() => {
      const expirationTimeMs = settings.autoExpireTimeout * 60 * 1000;
      const now = new Date().getTime();
      
      setNearbyPeers(prevPeers => {
        const activePeers = prevPeers.filter(peer => {
          if (!peer.discoveredAt) return true;
          
          const peerTime = new Date(peer.discoveredAt).getTime();
          const isActive = (now - peerTime) < expirationTimeMs;
          
          // Log when peers expire
          if (!isActive) {
            console.log(`Peer ${peer.name} (${peer.uuid}) expired after ${settings.autoExpireTimeout} minutes`);
          }
          
          return isActive;
        });
        
        return activePeers;
      });
    }, 30 * 1000);
  };

  const stopDiscovery = async () => {
    setIsDiscovering(false);
    setStatus('idle');
    
    // End current session
    await sessionService.endCurrentSession();
    setCurrentSession(null);
    
    // Stop BLE operations
    await bleService.stopAdvertising();
    await bleService.stopScanning();
    
    // Clean up timers
    cleanup();
  };

  const logPeerInteraction = async (peerId: string, type: 'viewed' | 'saved' | 'shared') => {
    await sessionService.logConnection(peerId, type);
    // Sync to ZeroDB backend
    apiService.logConnection(profile.uuid, peerId, type, currentSession?.id).catch(err => {
      console.warn('Failed to sync connection to backend:', err);
    });
  };

  return (
    <DiscoveryContext.Provider
      value={{
        isDiscovering,
        status,
        nearbyPeers,
        currentSession,
        startDiscovery,
        stopDiscovery,
        permissionStatus,
        requestPermissions,
        bleState,
        logPeerInteraction
      }}
    >
      {children}
    </DiscoveryContext.Provider>
  );
};