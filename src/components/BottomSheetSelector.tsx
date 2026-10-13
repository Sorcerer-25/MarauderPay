import React from 'react';
import { View, Text, Modal, TouchableOpacity, FlatList, StyleSheet, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/types';
import { getSolidColor } from '../theme/palettes';

const { height } = Dimensions.get('window');

interface BottomSheetSelectorProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  data: Array<{ label: string; value: string }>;
  selectedValue?: string;
  onSelect: (value: string) => void;
}

export const BottomSheetSelector: React.FC<BottomSheetSelectorProps> = ({
  visible,
  onClose,
  title,
  data,
  selectedValue,
  onSelect,
}) => {
  const { theme, mode } = useTheme();
  const styles = getStyles(theme, mode);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <TouchableOpacity 
        style={styles.overlay} 
        activeOpacity={1} 
        onPressOut={onClose}
      >
        <View style={styles.sheetContainer}>
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Ionicons name="close" size={24} color={theme.textSecondary} />
            </TouchableOpacity>
          </View>
          
          <FlatList
            data={data}
            keyExtractor={(item) => item.value}
            renderItem={({ item }) => {
              const isSelected = item.value === selectedValue;
              return (
                <TouchableOpacity
                  style={[styles.item, isSelected && styles.itemSelected]}
                  onPress={() => {
                    onSelect(item.value);
                    onClose();
                  }}
                >
                  <Text style={[styles.itemText, isSelected && styles.itemTextSelected]}>
                    {item.label}
                  </Text>
                  {isSelected && (
                    <Ionicons name="checkmark-circle" size={24} color={theme.primary} />
                  )}
                </TouchableOpacity>
              );
            }}
            contentContainerStyle={styles.listContent}
          />
        </View>
      </TouchableOpacity>
    </Modal>
  );
};

const getStyles = (theme: ThemeColors, mode: 'light' | 'dark') => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    backgroundColor: getSolidColor(theme.card, mode === 'dark' ? '#1A202C' : '#FFFFFF'),
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: height * 0.6,
    paddingTop: 16,
    paddingBottom: 32,
    elevation: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    borderWidth: 1,
    borderColor: theme.cardBorder,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.cardBorder,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.textPrimary,
  },
  closeButton: {
    padding: 4,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  item: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 8,
    backgroundColor: getSolidColor(theme.surface, mode === 'dark' ? '#242C3D' : '#F4F5F7'),
  },
  itemSelected: {
    backgroundColor: theme.primaryLight,
    borderColor: theme.primary,
    borderWidth: 1,
  },
  itemText: {
    fontSize: 16,
    color: theme.textPrimary,
  },
  itemTextSelected: {
    fontWeight: '600',
    color: theme.primary,
  },
});
