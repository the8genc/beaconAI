import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { v4 as uuidv4 } from 'uuid';
import { Profile } from '@/types/profile';
import { apiService } from '@/services/ApiService';

interface ProfileContextType {
  profile: Profile;
  saveProfile: (profile: Profile) => Promise<void>;
  resetProfile: () => Promise<void>;
  isProfileComplete: boolean;
}

const ProfileContext = createContext<ProfileContextType>({
  profile: { uuid: '' },
  saveProfile: async () => {},
  resetProfile: async () => {},
  isProfileComplete: false,
});

export const useProfile = () => useContext(ProfileContext);

export const ProfileProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [profile, setProfile] = useState<Profile>({ uuid: '' });
  const [isProfileComplete, setIsProfileComplete] = useState(false);

  useEffect(() => {
    loadProfile();
  }, []);

  useEffect(() => {
    // Check if profile is complete (name is required)
    setIsProfileComplete(!!profile.name);
  }, [profile]);

  const loadProfile = async () => {
    try {
      const storedProfile = await AsyncStorage.getItem('user_profile');
      if (storedProfile) {
        const parsedProfile = JSON.parse(storedProfile);
        setProfile(parsedProfile);
      } else {
        // Initialize with a new UUID
        const newProfile = { uuid: uuidv4() };
        setProfile(newProfile);
        await AsyncStorage.setItem('user_profile', JSON.stringify(newProfile));
      }
    } catch (error) {
      console.error('Error loading profile:', error);
    }
  };

  const saveProfile = async (updatedProfile: Profile) => {
    try {
      // Ensure UUID is preserved
      const profileToSave = {
        ...updatedProfile,
        uuid: profile.uuid || uuidv4(),
      };

      await AsyncStorage.setItem('user_profile', JSON.stringify(profileToSave));
      setProfile(profileToSave);

      // Sync to ZeroDB backend
      apiService.saveProfile(profileToSave).catch(err => {
        console.warn('Failed to sync profile to backend:', err);
      });
    } catch (error) {
      console.error('Error saving profile:', error);
    }
  };

  const resetProfile = async () => {
    try {
      // Keep UUID but reset everything else
      const newProfile = { uuid: uuidv4() };
      await AsyncStorage.setItem('user_profile', JSON.stringify(newProfile));
      setProfile(newProfile);
    } catch (error) {
      console.error('Error resetting profile:', error);
    }
  };

  return (
    <ProfileContext.Provider 
      value={{ 
        profile, 
        saveProfile, 
        resetProfile,
        isProfileComplete
      }}
    >
      {children}
    </ProfileContext.Provider>
  );
};