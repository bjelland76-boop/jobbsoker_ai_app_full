import { createContext, useContext } from 'react';

export const ProfileContext = createContext(null);
export const useProfileContext = () => useContext(ProfileContext);
