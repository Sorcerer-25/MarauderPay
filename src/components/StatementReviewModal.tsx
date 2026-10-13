import React, { useState, useEffect, useMemo } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  Modal, 
  TouchableOpacity, 
  ScrollView, 
  TextInput, 
  KeyboardAvoidingView, 
  Platform
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useExpenses } from '../contexts/ExpenseContext';
import { useToast } from '../contexts/ToastContext';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/types';
import { getSolidColor } from '../theme/palettes';
import { ExpenseLog } from '../types';
import { ParsedTransaction } from '../utils/statementParser';
import { suggestCategory } from '../utils/categorizer';

interface StatementReviewModalProps {
  visible: boolean;
  onClose: () => void;
  transactions: ParsedTransaction[];
}

interface StagedItem {
  id: string;
  selected: boolean;
  date: string;
  amount: string;
  merchant: string;
  category: string;
  paymentMode: 'UPI' | 'Card';
  rawLine: string;
}

export const StatementReviewModal: React.FC<StatementReviewModalProps> = ({
  visible,
  onClose,
  transactions
}) => {
  const { theme, mode } = useTheme();
  const { showToast } = useToast();
  const styles = getStyles(theme, mode);
  
  const { expenses, setAllExpenses, categories, addCategory, activeEvent } = useExpenses();
  const [stagedItems, setStagedItems] = useState<StagedItem[]>([]);

  // Initialize staging items when modal becomes visible
  useEffect(() => {
    if (visible) {
      const items = transactions.map((tx, idx) => {
        const suggested = suggestCategory(tx.merchant, tx.rawLine);
        return {
          id: `stmt_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 7)}`,
          selected: true,
          date: tx.date,
          amount: tx.amount.toString(),
          merchant: tx.merchant,
          category: categories.includes(suggested) ? suggested : 'Others',
          paymentMode: tx.paymentMode,
          rawLine: tx.rawLine
        };
      });
      setStagedItems(items);
    }
  }, [visible, transactions, categories]);

  // Calculations for header summary
  const summary = useMemo(() => {
    const selected = stagedItems.filter(item => item.selected);
    const count = selected.length;
    const totalAmount = selected.reduce((sum, item) => {
      const val = parseFloat(item.amount);
      return sum + (isNaN(val) ? 0 : val);
    }, 0);
    return { count, totalAmount };
  }, [stagedItems]);

  const allSelected = useMemo(() => {
    return stagedItems.length > 0 && stagedItems.every(item => item.selected);
  }, [stagedItems]);

  const toggleSelectItem = (id: string) => {
    setStagedItems(prev => 
      prev.map(item => item.id === id ? { ...item, selected: !item.selected } : item)
    );
  };

  const handleUpdateItem = (id: string, field: keyof StagedItem, value: any) => {
    setStagedItems(prev => 
      prev.map(item => item.id === id ? { ...item, [field]: value } : item)
    );
  };

  const handleDeleteItem = (id: string) => {
    setStagedItems(prev => prev.filter(item => item.id !== id));
  };

  const handleToggleSelectAll = () => {
    const target = !allSelected;
    setStagedItems(prev => prev.map(item => ({ ...item, selected: target })));
  };

  const handleConfirmAndAdd = async () => {
    const selectedItems = stagedItems.filter(item => item.selected);
    
    if (selectedItems.length === 0) {
      showToast('Please select at least one transaction to import.', 'info');
      return;
    }

    // Validation check
    for (const item of selectedItems) {
      const amtVal = parseFloat(item.amount);
      if (isNaN(amtVal) || amtVal <= 0) {
        showToast(`Please enter a valid amount for "${item.merchant}".`, 'error');
        return;
      }
      
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(item.date)) {
        showToast(`Please enter date in YYYY-MM-DD format for "${item.merchant}".`, 'error');
        return;
      }
    }

    try {
      // 1. Process category additions
      const newCategories = selectedItems.map(item => item.category);
      const uniqueNewCategories = Array.from(new Set(newCategories)).filter(
        cat => !categories.includes(cat)
      );

      for (const cat of uniqueNewCategories) {
        await addCategory(cat);
      }

      // 2. Build final ExpenseLog objects
      const newExpensesToAdd: ExpenseLog[] = selectedItems.map(item => {
        const parsedAmount = parseFloat(item.amount);
        return {
          id: item.id,
          expenseDate: item.date,
          createdAt: new Date().toISOString(),
          category: item.category,
          totalAmount: parsedAmount,
          myShare: parsedAmount,
          remark: item.merchant,
          paymentMode: item.paymentMode,
          isSplit: false,
          eventId: activeEvent?.id
        };
      });

      // 3. Batch insert in a single write operation
      const updatedExpenses = [...expenses, ...newExpensesToAdd];
      await setAllExpenses(updatedExpenses);

      onClose();
      showToast(`Successfully imported ${newExpensesToAdd.length} expenses to your log!`, 'success');
    } catch (e) {
      console.error(e);
      showToast('Failed to import expenses.', 'error');
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.modalContainer}>
        {/* Header */}
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onClose} style={styles.modalCloseButton}>
            <Ionicons name="arrow-back" size={24} color={theme.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.modalHeaderTitle}>Import Review Queue</Text>
          <View style={{ width: 24 }} />
        </View>

        {/* Keyboard Aware View for Scroll List */}
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          {/* Summary Row */}
          <View style={styles.summaryBar}>
            <Text style={styles.summaryText}>
              Selected: <Text style={styles.summaryHighlight}>{summary.count}</Text> / {stagedItems.length} transactions
            </Text>
            <Text style={styles.summaryAmount}>
              Total: <Text style={styles.summaryHighlight}>₹{summary.totalAmount.toFixed(2)}</Text>
            </Text>
          </View>

          {stagedItems.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="documents-outline" size={48} color={theme.textMuted} />
              <Text style={styles.emptyText}>No transactions in the queue</Text>
              <TouchableOpacity onPress={onClose} style={styles.backBtn}>
                <Text style={styles.backBtnText}>Go Back</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <ScrollView 
              style={styles.scrollContainer}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
            >
              {stagedItems.map((item) => (
                <View key={item.id} style={[styles.card, !item.selected && styles.cardDeselected]}>
                  {/* Card Title & Checkbox */}
                  <View style={styles.cardHeader}>
                    <TouchableOpacity 
                      onPress={() => toggleSelectItem(item.id)}
                      style={styles.checkboxContainer}
                    >
                      <Ionicons 
                        name={item.selected ? "checkbox" : "square-outline"} 
                        size={22} 
                        color={item.selected ? theme.primary : theme.textMuted} 
                      />
                    </TouchableOpacity>
                    
                    <TextInput
                      style={styles.merchantInput}
                      value={item.merchant}
                      onChangeText={(val) => handleUpdateItem(item.id, 'merchant', val)}
                      placeholder="Remark/Merchant"
                      placeholderTextColor={theme.textMuted}
                    />

                    <TouchableOpacity 
                      onPress={() => handleDeleteItem(item.id)}
                      style={styles.deleteBtn}
                    >
                      <Ionicons name="trash-outline" size={20} color={theme.danger} />
                    </TouchableOpacity>
                  </View>

                  {/* Input Fields Row */}
                  <View style={styles.fieldsRow}>
                    <View style={styles.fieldColumn}>
                      <Text style={styles.fieldLabel}>Date (YYYY-MM-DD)</Text>
                      <TextInput
                        style={styles.fieldInput}
                        value={item.date}
                        onChangeText={(val) => handleUpdateItem(item.id, 'date', val)}
                        placeholder="YYYY-MM-DD"
                        placeholderTextColor={theme.textMuted}
                      />
                    </View>
                    
                    <View style={[styles.fieldColumn, { flex: 0.8 }]}>
                      <Text style={styles.fieldLabel}>Amount (₹)</Text>
                      <TextInput
                        style={styles.fieldInput}
                        value={item.amount}
                        onChangeText={(val) => handleUpdateItem(item.id, 'amount', val)}
                        keyboardType="numeric"
                        placeholder="Amount"
                        placeholderTextColor={theme.textMuted}
                      />
                    </View>
                  </View>

                  {/* Category Chip Picker */}
                  <View style={styles.categoryPickerSection}>
                    <Text style={styles.fieldLabel}>Suggested Category</Text>
                    <ScrollView 
                      horizontal 
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.categoryChipsScroll}
                    >
                      {categories.map((cat) => {
                        const isSelected = item.category === cat;
                        return (
                          <TouchableOpacity
                            key={cat}
                            onPress={() => handleUpdateItem(item.id, 'category', cat)}
                            style={[
                              styles.categoryChip,
                              isSelected && styles.categoryChipSelected
                            ]}
                          >
                            <Text style={[
                              styles.categoryChipText,
                              isSelected && styles.categoryChipTextSelected
                            ]}>
                              {cat}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  </View>
                </View>
              ))}
            </ScrollView>
          )}

          {/* Footer Controls */}
          {stagedItems.length > 0 && (
            <View style={styles.footer}>
              <TouchableOpacity 
                onPress={handleToggleSelectAll}
                style={styles.toggleAllBtn}
                activeOpacity={0.7}
              >
                <Ionicons 
                  name={allSelected ? "checkbox" : "square-outline"} 
                  size={20} 
                  color={theme.textSecondary} 
                />
                <Text style={styles.toggleAllText}>
                  {allSelected ? "Deselect All" : "Select All"}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity 
                onPress={handleConfirmAndAdd}
                style={styles.confirmBtn}
                activeOpacity={0.8}
              >
                <Text style={styles.confirmBtnText}>
                  Confirm & Add to Expenses
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
};

const getStyles = (theme: ThemeColors, mode: 'light' | 'dark') => StyleSheet.create({
  modalContainer: {
    flex: 1,
    backgroundColor: getSolidColor(theme.background, mode === 'dark' ? '#121820' : '#FAFAFA'),
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: getSolidColor(theme.card, mode === 'dark' ? '#1A202C' : '#FFFFFF'),
    borderBottomWidth: 1,
    borderBottomColor: theme.cardBorder,
    ...Platform.select({
      ios: { paddingTop: 50 },
      android: { paddingTop: 16 },
    }),
  },
  modalHeaderTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.textPrimary,
  },
  modalCloseButton: {
    padding: 4,
  },
  summaryBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: getSolidColor(theme.surface, mode === 'dark' ? '#242C3D' : '#F4F5F7'),
    borderBottomWidth: 1,
    borderBottomColor: theme.cardBorder,
  },
  summaryText: {
    fontSize: 14,
    color: theme.textSecondary,
  },
  summaryHighlight: {
    fontWeight: 'bold',
    color: theme.primary,
  },
  summaryAmount: {
    fontSize: 14,
    color: theme.textPrimary,
    fontWeight: '600',
  },
  scrollContainer: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: getSolidColor(theme.card, mode === 'dark' ? '#1A202C' : '#FFFFFF'),
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: theme.cardBorder,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  cardDeselected: {
    opacity: 0.6,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  checkboxContainer: {
    padding: 4,
    marginRight: 6,
  },
  merchantInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: theme.textPrimary,
    borderBottomWidth: 1,
    borderBottomColor: theme.cardBorder,
    paddingVertical: 4,
    marginRight: 8,
  },
  deleteBtn: {
    padding: 6,
  },
  fieldsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  fieldColumn: {
    flex: 1,
  },
  fieldLabel: {
    fontSize: 11,
    color: theme.textMuted,
    marginBottom: 4,
  },
  fieldInput: {
    backgroundColor: getSolidColor(theme.surface, mode === 'dark' ? '#242C3D' : '#F4F5F7'),
    borderWidth: 1,
    borderColor: theme.cardBorder,
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    fontSize: 14,
    color: theme.textPrimary,
  },
  categoryPickerSection: {
    marginTop: 4,
  },
  categoryChipsScroll: {
    paddingVertical: 4,
    gap: 8,
  },
  categoryChip: {
    backgroundColor: getSolidColor(theme.surface, mode === 'dark' ? '#242C3D' : '#F4F5F7'),
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.cardBorder,
  },
  categoryChipSelected: {
    backgroundColor: theme.primary,
    borderColor: theme.primary,
  },
  categoryChipText: {
    fontSize: 12,
    color: theme.textSecondary,
  },
  categoryChipTextSelected: {
    color: '#FFF',
    fontWeight: 'bold',
  },
  footer: {
    flexDirection: 'row',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: theme.cardBorder,
    backgroundColor: getSolidColor(theme.card, mode === 'dark' ? '#1A202C' : '#FFFFFF'),
    alignItems: 'center',
    gap: 12,
  },
  toggleAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  toggleAllText: {
    fontSize: 14,
    color: theme.textSecondary,
    fontWeight: '600',
  },
  confirmBtn: {
    flex: 1,
    backgroundColor: theme.primary,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  confirmBtnText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: 'bold',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyText: {
    fontSize: 16,
    color: theme.textMuted,
    marginTop: 12,
    marginBottom: 20,
  },
  backBtn: {
    backgroundColor: theme.primary,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  backBtnText: {
    color: '#FFF',
    fontWeight: 'bold',
  }
});
