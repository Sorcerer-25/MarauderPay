import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ThemeColors, StoredThemeConfig } from './types';
import { lightThemes, darkThemes } from './palettes';

interface ThemeContextValue {
  theme: ThemeColors;
  mode: 'light' | 'dark';
  selectedLightThemeId: string;
  selectedDarkThemeId: string;
  toggleMode: () => void;
  setLightTheme: (id: string) => void;
  setDarkTheme: (id: string) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const STORE_KEY = '@theme_config_store';

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setMode] = useState<'light' | 'dark'>('light');
  const [selectedLightThemeId, setSelectedLightThemeId] = useState<string>('clean-slate');
  const [selectedDarkThemeId, setSelectedDarkThemeId] = useState<string>('pure-oled');
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const loadThemeConfig = async () => {
      try {
        const storedConfig = await AsyncStorage.getItem(STORE_KEY);
        if (storedConfig) {
          const config: StoredThemeConfig = JSON.parse(storedConfig);
          if (config.mode) setMode(config.mode);
          if (config.selectedLightThemeId) setSelectedLightThemeId(config.selectedLightThemeId);
          if (config.selectedDarkThemeId) setSelectedDarkThemeId(config.selectedDarkThemeId);
        }
      } catch (error) {
        console.error('Failed to load theme config:', error);
      } finally {
        setIsReady(true);
      }
    };
    loadThemeConfig();
  }, []);

  const saveThemeConfig = async (config: Partial<StoredThemeConfig>) => {
    try {
      const currentConfig: StoredThemeConfig = {
        mode,
        selectedLightThemeId,
        selectedDarkThemeId,
        ...config,
      };
      await AsyncStorage.setItem(STORE_KEY, JSON.stringify(currentConfig));
    } catch (error) {
      console.error('Failed to save theme config:', error);
    }
  };

  const toggleMode = () => {
    const newMode = mode === 'light' ? 'dark' : 'light';
    setMode(newMode);
    saveThemeConfig({ mode: newMode });
  };

  const setLightTheme = (id: string) => {
    setSelectedLightThemeId(id);
    saveThemeConfig({ selectedLightThemeId: id });
  };

  const setDarkTheme = (id: string) => {
    setSelectedDarkThemeId(id);
    saveThemeConfig({ selectedDarkThemeId: id });
  };

  const activeTheme = useMemo(() => {
    if (mode === 'light') {
      const themeConfig = lightThemes.find(t => t.id === selectedLightThemeId) || lightThemes[0];
      return themeConfig.colors;
    } else {
      const themeConfig = darkThemes.find(t => t.id === selectedDarkThemeId) || darkThemes[0];
      return themeConfig.colors;
    }
  }, [mode, selectedLightThemeId, selectedDarkThemeId]);

  if (!isReady) {
    return null; // Or a loading spinner
  }

  return (
    <ThemeContext.Provider
      value={{
        theme: activeTheme,
        mode,
        selectedLightThemeId,
        selectedDarkThemeId,
        toggleMode,
        setLightTheme,
        setDarkTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
