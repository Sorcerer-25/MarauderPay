export interface ThemeColors {
  background: string;
  surface: string;
  card: string;
  cardBorder: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  primary: string;
  primaryLight: string;
  accent: string;
  danger: string;
  dangerSurface: string;
  success: string;
  tabBar: string;
  tabBarBorder: string;
}

export interface ThemeOption {
  id: string;
  name: string;
  type: 'light' | 'dark';
  colors: ThemeColors;
}

export interface StoredThemeConfig {
  mode: 'light' | 'dark';
  selectedLightThemeId: string;
  selectedDarkThemeId: string;
}
