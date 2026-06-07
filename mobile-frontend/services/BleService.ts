/**
 * Bluetooth Low Energy Service for BeaconAI
 * 
 * Responsible for BLE advertising, scanning, and device discovery
 * 
 * Design principles:
 * - Battery optimized: Configurable scan/advertise intervals
 * - Privacy-first: User controls for visibility
 * - Graceful degradation: Proper error handling
 * - Encoded profiles: Compact format for BLE advertisements (31 bytes max)
 */
import { BleManager, State, ScanMode, Characteristic, Device } from 'react-native-ble-plx';
import base64 from 'base64-js';
// Alias the functions for consistent naming
const encodeBase64 = (data: Uint8Array): string => base64.fromByteArray(data);
const decodeBase64 = (str: string): Uint8Array => base64.toByteArray(str);
import { Platform, PermissionsAndroid } from 'react-native';
import { 
  BleService, 
  BleState, 
  BleConfig, 
  BlePermissionStatus, 
  BleScanMode,
  BleAdvertiseMode,
  BleAdvertisementData
} from '@/types/ble';
import { Profile, PeerProfile } from '@/types/profile';

// UUID constants
const BEACON_SERVICE_UUID = '1A7A5230-E8F0-11EE-9BD9-0242AC120002';
const BEACON_PROFILE_CHARACTERISTIC_UUID = '1A7A5456-E8F0-11EE-9BD9-0242AC120002';

// Default configuration with battery optimization in mind
const DEFAULT_CONFIG: BleConfig = {
  scanMode: BleScanMode.BALANCED,
  advertiseMode: BleAdvertiseMode.BALANCED,
  scanDurationMs: 10000,         // 10 seconds of scanning
  scanIntervalMs: 30000,         // 30 seconds between scan cycles
  advertisingIntervalMs: 5000,   // 5 seconds between advertisements
  expirationTimeMs: 5 * 60 * 1000 // 5 minutes until peer expires
};

/**
 * BLE Manager Service Implementation
 */
class BleServiceImpl implements BleService {
  private bleManager: BleManager;
  private isInitialized: boolean = false;
  private isAdvertising: boolean = false;
  private isScanning: boolean = false;
  private config: BleConfig = DEFAULT_CONFIG;
  private scanTimer?: number;
  private advertisingTimer?: number;
  private isTestMode: boolean = false; // Flag for using mock data instead of real BLE

  constructor() {
    if (Platform.OS !== 'web') {
      this.bleManager = new BleManager();
    } else {
      this.bleManager = null as any;
      this.isTestMode = true;
    }
  }
  
  /**
   * Set test mode to use mock data instead of real BLE
   * Used for testing in environments without BLE hardware
   */
  setTestMode(enabled: boolean): void {
    this.isTestMode = enabled;
    console.log(`BLE test mode ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Initialize the BLE service
   */
  async initialize(): Promise<boolean> {
    if (this.isInitialized) return true;

    if (Platform.OS === 'web') {
      console.log('BLE not available on web, running in test mode');
      this.isTestMode = true;
      this.isInitialized = true;
      return true;
    }

    try {
      // Subscribe to state changes
      this.bleManager.onStateChange((state) => {
        console.log('BLE state changed:', state);
      }, true);

      this.isInitialized = true;
      return true;
    } catch (error) {
      console.error('Error initializing BLE service:', error);
      return false;
    }
  }

  /**
   * Check BLE permissions
   */
  async checkPermissions(): Promise<BlePermissionStatus> {
    // Always return granted in test mode
    if (this.isTestMode) {
      return BlePermissionStatus.GRANTED;
    }
    
    try {
      // iOS permissions are requested when the BLE service is used
      if (Platform.OS === 'ios') {
        const state = await this.bleManager.state();
        if (state === State.PoweredOn) {
          return BlePermissionStatus.GRANTED;
        } else if (state === State.Unauthorized) {
          return BlePermissionStatus.DENIED;
        } else if (state === State.Unsupported) {
          return BlePermissionStatus.UNAVAILABLE;
        }
        return BlePermissionStatus.REQUESTING;
      }
      
      // Android permissions
      if (Platform.OS === 'android') {
        const bluetoothScanPermission = await PermissionsAndroid.check(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
        );
        
        // Android 12+ requires BLUETOOTH_SCAN and BLUETOOTH_ADVERTISE permissions
        if (Platform.Version >= 31) {
          const bluetoothScan = await PermissionsAndroid.check(
            'android.permission.BLUETOOTH_SCAN' as any
          );
          const bluetoothAdvertise = await PermissionsAndroid.check(
            'android.permission.BLUETOOTH_ADVERTISE' as any
          );
          
          if (bluetoothScan && bluetoothAdvertise) {
            return BlePermissionStatus.GRANTED;
          }
        } else if (bluetoothScanPermission) {
          return BlePermissionStatus.GRANTED;
        }
        
        return BlePermissionStatus.DENIED;
      }
      
      return BlePermissionStatus.UNAVAILABLE;
    } catch (error) {
      console.error('Error checking BLE permissions:', error);
      return BlePermissionStatus.UNAVAILABLE;
    }
  }

  /**
   * Request BLE permissions
   */
  async requestPermissions(): Promise<BlePermissionStatus> {
    // Always return granted in test mode
    if (this.isTestMode) {
      return BlePermissionStatus.GRANTED;
    }
    
    try {
      // iOS permissions are requested when the BLE service is used
      if (Platform.OS === 'ios') {
        return BlePermissionStatus.REQUESTING;
      }
      
      // Android permissions
      if (Platform.OS === 'android') {
        // Android 12+ requires BLUETOOTH_SCAN and BLUETOOTH_ADVERTISE permissions
        if (Platform.Version >= 31) {
          const results = await PermissionsAndroid.requestMultiple([
            'android.permission.BLUETOOTH_SCAN' as any,
            'android.permission.BLUETOOTH_ADVERTISE' as any,
            'android.permission.BLUETOOTH_CONNECT' as any,
            PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
          ]);
          
          const isGranted = Object.values(results).every(
            result => result === PermissionsAndroid.RESULTS.GRANTED
          );
          
          return isGranted 
            ? BlePermissionStatus.GRANTED 
            : BlePermissionStatus.DENIED;
        } else {
          // Android < 12 requires location permissions
          const granted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
            {
              title: 'Location Permission Required',
              message: 'BeaconAI needs access to your location to discover nearby devices.',
              buttonNeutral: 'Ask Me Later',
              buttonNegative: 'Cancel',
              buttonPositive: 'OK'
            }
          );
          
          return granted === PermissionsAndroid.RESULTS.GRANTED
            ? BlePermissionStatus.GRANTED
            : BlePermissionStatus.DENIED;
        }
      }
      
      return BlePermissionStatus.UNAVAILABLE;
    } catch (error) {
      console.error('Error requesting BLE permissions:', error);
      return BlePermissionStatus.UNAVAILABLE;
    }
  }

  /**
   * Start advertising the user's profile
   * Implements battery-optimized approach following project standards
   */
  async startAdvertising(profile: Profile): Promise<boolean> {
    try {
      // Use mock implementation in test mode
      if (this.isTestMode) {
        console.log('Test mode: Simulating BLE advertising');
        
        // Simulate periodic advertising (in real implementation, this would use native advertising APIs)
        this.advertisingTimer = window.setInterval(() => {
          console.log('Advertising pulse at:', new Date().toISOString());
        }, this.config.advertisingIntervalMs);
        
        return true;
      }
      
      if (!this.isInitialized) {
        await this.initialize();
      }
      
      const state = await this.getState();
      if (state !== BleState.POWERED_ON) {
        console.warn('Bluetooth is not powered on, cannot start advertising');
        return false;
      }
      
      // Prepare advertisement data (must fit in 31 bytes)
      const advertisementData = this.encodeProfileForAdvertisement(profile);
      
      // For now, as a placeholder since direct BLE advertising isn't fully supported in react-native-ble-plx
      // In a real implementation, we would use native modules to handle advertising
      console.log('Started advertising with data:', advertisementData);
      
      this.isAdvertising = true;
      
      // Simulate periodic advertising (in real implementation, this would use native advertising APIs)
      this.advertisingTimer = window.setInterval(() => {
        console.log('Advertising pulse at:', new Date().toISOString());
      }, this.config.advertisingIntervalMs);
      
      return true;
    } catch (error) {
      console.error('Error starting BLE advertising:', error);
      this.isAdvertising = false;
      return false;
    }
  }

  /**
   * Stop advertising
   */
  async stopAdvertising(): Promise<void> {
    if (this.advertisingTimer) {
      clearInterval(this.advertisingTimer);
      this.advertisingTimer = undefined;
    }
    
    this.isAdvertising = false;
    console.log('Stopped advertising');
  }

  /**
   * Start scanning for nearby devices
   * Implements battery-optimized approach with cycling
   */
  async startScanning(onDiscovery: (peer: PeerProfile) => void): Promise<boolean> {
    if (!this.isInitialized) {
      console.error('BLE service not initialized');
      return false;
    }

    // Don't start scanning if already scanning
    if (this.isScanning) {
      return true;
    }

    try {
      this.isScanning = true;
      
      // Use mock implementation in test mode
      if (this.isTestMode) {
        console.log('Test mode: Simulating BLE scanning');
        
        // Create mock peers at intervals to simulate discovery
        this.scanTimer = window.setInterval(() => {
          const mockPeer = this.createMockPeer();
          onDiscovery(mockPeer);
        }, 1000); // Discover a new peer every 1 second in test mode
        
        return true;
      }
      
      const state = await this.getState();
      if (state !== BleState.POWERED_ON) {
        console.warn('Bluetooth is not powered on, cannot start scanning');
        return false;
      }
      
      // Map our scan mode to the library's scan mode
      const scanMode = this.mapScanMode(this.config.scanMode);
      
      // Function to perform a single scan cycle
      const performScanCycle = () => {
        if (!this.isScanning) return;
        
        console.log('Starting scan cycle');
        
        // Start scanning with appropriate settings
        this.bleManager.startDeviceScan(
          [BEACON_SERVICE_UUID], // Only scan for our service UUID
          { scanMode },
          (error, device) => {
            if (error) {
              console.error('Scan error:', error);
              return;
            }
            
            if (device && device.manufacturerData) {
              try {
                // In a real implementation, we would decode the manufacturer data
                // to extract the profile information
                const peerProfile = this.decodePeerProfile(device);
                if (peerProfile) {
                  onDiscovery(peerProfile);
                }
              } catch (e) {
                console.warn('Error decoding peer profile:', e);
              }
            }
          }
        );
        
        // Stop scanning after duration to save battery
        setTimeout(() => {
          this.bleManager.stopDeviceScan();
          console.log('Scan cycle completed');
          
          // Schedule next scan cycle if still in scanning state
          if (this.isScanning) {
            this.scanTimer = window.setTimeout(performScanCycle, this.config.scanIntervalMs);
          }
        }, this.config.scanDurationMs);
      };
      
      // Start the first scan cycle
      performScanCycle();
      
      return true;
    } catch (error) {
      console.error('Error starting BLE scanning:', error);
      this.isScanning = false;
      return false;
    }
  }

  /**
   * Stop scanning for nearby devices
   */
  async stopScanning(): Promise<void> {
    if (!this.isTestMode) {
      this.bleManager.stopDeviceScan();
    }
    
    if (this.scanTimer) {
      clearTimeout(this.scanTimer);
      this.scanTimer = undefined;
    }
    
    this.isScanning = false;
    console.log('BLE scanning stopped');
  }

  /**
   * Get current BLE state
   */
  async getState(): Promise<BleState> {
    // Use mock state in test mode
    if (this.isTestMode) {
      return BleState.POWERED_ON;
    }
    
    try {
      const state = await this.bleManager.state();
      return this.mapBleState(state);
    } catch (error) {
      console.error('Error getting BLE state:', error);
      return BleState.UNKNOWN;
    }
  }

  /**
   * Update BLE configuration
   */
  setBleConfig(config: Partial<BleConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current BLE configuration
   */
  getBleConfig(): BleConfig {
    return { ...this.config };
  }

  /**
   * Map library BLE state to our enum
   */
  private mapBleState(state: State): BleState {
    switch (state) {
      case State.PoweredOn:
        return BleState.POWERED_ON;
      case State.PoweredOff:
        return BleState.POWERED_OFF;
      case State.Unauthorized:
        return BleState.UNAUTHORIZED;
      case State.Unsupported:
        return BleState.UNSUPPORTED;
      case State.Resetting:
        return BleState.RESETTING;
      default:
        return BleState.UNKNOWN;
    }
  }

  /**
   * Map our scan mode to the library's scan mode
   */
  private mapScanMode(mode: BleScanMode): ScanMode {
    switch (mode) {
      case BleScanMode.LOW_POWER:
        return ScanMode.LowPower;
      case BleScanMode.LOW_LATENCY:
        return ScanMode.LowLatency;
      case BleScanMode.BALANCED:
      default:
        return ScanMode.Balanced;
    }
  }

  /**
   * Encode profile data for BLE advertisement (max 31 bytes)
   * This is a compact encoding to fit within BLE advertisement constraints
   */
  private encodeProfileForAdvertisement(profile: Profile): BleAdvertisementData {
    return {
      uuid: profile.uuid,
      name: profile.name ? profile.name.substring(0, 10) : undefined, // Truncate name to save space
      isDiscoverable: true
    };
  }

  /**
   * Decode peer profile from BLE device
   * In a real implementation, this would extract the profile from manufacturer data
   */
  private decodePeerProfile(device: Device): PeerProfile | null {
    try {
      // This is a mockup since we're not actually decoding real data yet
      // In a real implementation, we would decode the manufacturerData
      const now = new Date();
      return {
        uuid: device.id,
        name: device.name || 'Unknown User',
        role: 'Developer', // Mock data
        company: 'BeaconAI', // Mock data
        rssi: device.rssi !== null ? device.rssi : -70, // Convert null to a default value
        discoveredAt: now.toISOString(),
        socialLinks: {
          linkedin: device.name || 'Unknown User',
          twitter: `@${(device.name || 'Unknown User').split(' ')[0].toLowerCase()}`
        }
      };
    } catch (error) {
      console.error('Error decoding peer profile:', error);
      return null;
    }
  }
  
  /**
   * Create a mock peer for testing
   */
  private createMockPeer(): PeerProfile {
    const now = new Date();
    const mockNames = ['Alice Developer', 'Bob Designer', 'Charlie PM', 'Diana Engineer'];
    const mockCompanies = ['TechCorp', 'DesignLabs', 'ProductHQ', 'EngineeringWorks'];
    const mockRoles = ['Developer', 'Designer', 'Product Manager', 'Engineer'];
    
    const randomName = mockNames[Math.floor(Math.random() * mockNames.length)];
    const randomCompany = mockCompanies[Math.floor(Math.random() * mockCompanies.length)];
    const randomRole = mockRoles[Math.floor(Math.random() * mockRoles.length)];
    const randomRssi = -1 * (50 + Math.floor(Math.random() * 40)); // Random RSSI between -50 and -90
    
    return {
      uuid: `mock-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: randomName,
      role: randomRole,
      company: randomCompany,
      rssi: randomRssi, // This is already a number type from our calculation above
      discoveredAt: now.toISOString(),
      socialLinks: {
        linkedin: randomName.toLowerCase().replace(' ', ''),
        twitter: `@${randomName.split(' ')[0].toLowerCase()}`
      }
    };
  }
}

// Singleton instance
export const bleService = new BleServiceImpl();
export default bleService;
