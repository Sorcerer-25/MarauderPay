import React, { createContext, useContext, useState, useRef, useCallback, ReactNode } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';

export type ToastType = 'success' | 'info' | 'error';

export interface ToastOptions {
  type?: ToastType;
  duration?: number;
  title?: string;
}

interface ToastData {
  title?: string;
  message: string;
  type: ToastType;
}

interface ToastContextType {
  showToast: (
    message: string,
    typeOrOptions?: ToastType | ToastOptions,
    duration?: number,
    title?: string
  ) => void;
  hideToast: () => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { theme, mode } = useTheme();
  const insets = useSafeAreaInsets();

  const [visible, setVisible] = useState(false);
  const [toastData, setToastData] = useState<ToastData>({
    message: '',
    type: 'success',
  });

  const translateY = useRef(new Animated.Value(-140)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hideToast = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    Animated.parallel([
      Animated.timing(translateY, {
        toValue: -140,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setVisible(false);
    });
  }, [translateY, opacity]);

  const showToast = useCallback(
    (
      message: string,
      typeOrOptions?: ToastType | ToastOptions,
      duration?: number,
      title?: string
    ) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      let finalType: ToastType = 'success';
      let finalDuration = 3500;
      let finalTitle = title;

      if (typeof typeOrOptions === 'string') {
        finalType = typeOrOptions;
        if (typeof duration === 'number') {
          finalDuration = duration;
        }
      } else if (typeof typeOrOptions === 'object' && typeOrOptions !== null) {
        if (typeOrOptions.type) finalType = typeOrOptions.type;
        if (typeOrOptions.duration) finalDuration = typeOrOptions.duration;
        if (typeOrOptions.title) finalTitle = typeOrOptions.title;
      }

      setToastData({ message, type: finalType, title: finalTitle });
      setVisible(true);

      // Reset animation position
      translateY.setValue(-140);
      opacity.setValue(0);

      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          friction: 8,
          tension: 45,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }),
      ]).start();

      timerRef.current = setTimeout(() => {
        hideToast();
      }, finalDuration);
    },
    [translateY, opacity, hideToast]
  );

  const getIconName = (type: ToastType): keyof typeof Ionicons.glyphMap => {
    switch (type) {
      case 'success':
        return 'checkmark-circle';
      case 'error':
        return 'alert-circle';
      case 'info':
      default:
        return 'information-circle';
    }
  };

  const getAccentColor = (type: ToastType) => {
    switch (type) {
      case 'success':
        return '#10B981';
      case 'error':
        return '#EF4444';
      case 'info':
      default:
        return '#3B82F6';
    }
  };

  const accentColor = getAccentColor(toastData.type);
  const isDark = mode === 'dark';

  // Solid, 100% opaque backgrounds for crisp visibility without any transparency
  const solidBg = isDark ? '#1C2433' : '#FFFFFF';
  const solidBorder = isDark ? '#334155' : '#E2E8F0';
  const titleColor = isDark ? '#FFFFFF' : '#0F172A';
  const textColor = isDark ? '#CBD5E1' : '#475569';

  return (
    <ToastContext.Provider value={{ showToast, hideToast }}>
      {children}
      {visible && (
        <Animated.View
          style={[
            styles.toastContainer,
            {
              top: Math.max(insets.top, 14) + 6,
              transform: [{ translateY }],
              opacity,
            },
          ]}
          pointerEvents="box-none"
        >
          <TouchableOpacity
            activeOpacity={0.92}
            onPress={hideToast}
            style={[
              styles.toastCard,
              {
                backgroundColor: solidBg,
                borderColor: solidBorder,
                shadowColor: '#000',
              },
            ]}
          >
            {/* Left Accent Indicator Strip */}
            <View style={[styles.indicator, { backgroundColor: accentColor }]} />

            {/* Icon Badge */}
            <View style={[styles.iconContainer, { backgroundColor: `${accentColor}1A` }]}>
              <Ionicons name={getIconName(toastData.type)} size={24} color={accentColor} />
            </View>

            {/* Content Section */}
            <View style={styles.textContainer}>
              {toastData.title ? (
                <Text style={[styles.titleText, { color: titleColor }]} numberOfLines={1}>
                  {toastData.title}
                </Text>
              ) : null}
              <Text
                style={[
                  toastData.title ? styles.messageWithTitleText : styles.messageOnlyText,
                  { color: toastData.title ? textColor : titleColor },
                ]}
                numberOfLines={3}
              >
                {toastData.message}
              </Text>
            </View>

            {/* Manual Dismiss Button */}
            <TouchableOpacity
              onPress={hideToast}
              style={[
                styles.closeButton,
                { backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)' },
              ]}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close" size={16} color={isDark ? '#94A3B8' : '#64748B'} />
            </TouchableOpacity>
          </TouchableOpacity>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

const styles = StyleSheet.create({
  toastContainer: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 999999,
    alignItems: 'center',
  },
  toastCard: {
    width: '100%',
    maxWidth: 520,
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1.5,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 10,
    overflow: 'hidden',
  },
  indicator: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 6,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  textContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  titleText: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
    lineHeight: 18,
  },
  messageWithTitleText: {
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
  },
  messageOnlyText: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  closeButton: {
    marginLeft: 10,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
