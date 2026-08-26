import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Switch, Alert, Platform } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useExpenses } from '../contexts/ExpenseContext';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/types';
import { ExpenseCategory, ExpenseLog, SplitParticipant } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { startOfWeek, startOfMonth, isAfter, parseISO, format } from 'date-fns';
import { Ionicons } from '@expo/vector-icons';
import { ExpenseForm } from '../components/ExpenseForm';
import { StorageService } from '../services/StorageService';

export const DashboardScreen = () => {
  const { theme } = useTheme();
  const styles = getStyles(theme);

  const { expenses, addExpense } = useExpenses();
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(false);

  // Analytics Computation
  const analytics = useMemo(() => {
    const now = new Date();
    const weekStart = startOfWeek(now);
    const monthStart = startOfMonth(now);

    let weeklyTotal = 0;
    let monthlyTotal = 0;
    let grandTotal = 0;
    const categoryTotals: Record<string, number> = {};
    const historicalMonths: Record<string, number> = {};

    expenses.forEach(exp => {
      grandTotal += exp.myShare;

      const expDate = parseISO(exp.expenseDate);
      if (isAfter(expDate, weekStart) || expDate.getTime() === weekStart.getTime()) {
        weeklyTotal += exp.myShare;
      }
      if (isAfter(expDate, monthStart) || expDate.getTime() === monthStart.getTime()) {
        monthlyTotal += exp.myShare;
        categoryTotals[exp.category] = (categoryTotals[exp.category] || 0) + exp.myShare;
      }

      const monthKey = format(expDate, 'yyyy-MM');
      historicalMonths[monthKey] = (historicalMonths[monthKey] || 0) + exp.myShare;
    });

    const sortedHistory = Object.entries(historicalMonths)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, value]) => ({ monthLabel: format(parseISO(`${key}-01`), 'MMMM yyyy'), total: value }));

    return { weeklyTotal, monthlyTotal, grandTotal, categoryTotals, sortedHistory };
  }, [expenses]);

  return (
    <KeyboardAwareScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      enableOnAndroid={true}
      extraScrollHeight={120}
      extraHeight={120}
      keyboardShouldPersistTaps="handled"
    >
      {/* Analytics Section */}
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.8}
        onPress={() => setIsHistoryExpanded(!isHistoryExpanded)}
      >
        <View style={styles.cardHeaderRow}>
          <Text style={styles.cardTitle}>Analytics (My Share)</Text>
          <Ionicons name={isHistoryExpanded ? "chevron-up" : "chevron-down"} size={20} color={theme.textMuted} />
        </View>

        <View style={styles.row}>
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>This Week</Text>
            <Text style={styles.metricValue}>₹{analytics.weeklyTotal.toFixed(2)}</Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>This Month</Text>
            <Text style={styles.metricValue}>₹{analytics.monthlyTotal.toFixed(2)}</Text>
          </View>
        </View>

        {isHistoryExpanded && (
          <View style={styles.historySection}>
            <Text style={styles.historyTitle}>Monthly Breakdown</Text>
            {analytics.sortedHistory.map(item => (
              <View key={item.monthLabel} style={styles.historyRow}>
                <Text style={styles.historyLabel}>{item.monthLabel}</Text>
                <Text style={styles.historyValue}>₹{item.total.toFixed(2)}</Text>
              </View>
            ))}
            <View style={[styles.historyRow, styles.grandTotalRow]}>
              <Text style={styles.grandTotalLabel}>All-Time Total</Text>
              <Text style={styles.grandTotalValue}>₹{analytics.grandTotal.toFixed(2)}</Text>
            </View>
          </View>
        )}
      </TouchableOpacity>

      <ExpenseForm
        onSubmit={async (newExpense) => {
          let updatedExpense = { ...newExpense };

          if (updatedExpense.isSplit && updatedExpense.splitDetails) {
            const wallets = await StorageService.loadWallets();
            let walletsUpdated = false;

            const updatedParticipants = [...updatedExpense.splitDetails.participants];
            let extraRemark = "";

            for (let i = 0; i < updatedParticipants.length; i++) {
              const participant = updatedParticipants[i];
              if (participant.hasPaid) continue;

              const lowerName = participant.name.toLowerCase();
              const walletIndex = wallets.findIndex(w => w.name === lowerName);
              
              if (walletIndex !== -1 && wallets[walletIndex].creditBalance > 0) {
                const wallet = wallets[walletIndex];
                
                if (wallet.creditBalance >= participant.shareAmount) {
                  // Scenario A
                  wallet.creditBalance -= participant.shareAmount;
                  updatedParticipants[i] = { ...participant, hasPaid: true };
                  extraRemark += ` [₹${participant.shareAmount} auto-deducted from ${participant.name}'s wallet]`;
                  walletsUpdated = true;
                } else {
                  // Scenario B
                  const usedCredit = wallet.creditBalance;
                  updatedParticipants[i] = { 
                    ...participant, 
                    shareAmount: participant.shareAmount - usedCredit 
                  };
                  extraRemark += ` [Used remaining ₹${usedCredit} wallet credit for ${participant.name}]`;
                  wallet.creditBalance = 0;
                  walletsUpdated = true;
                }
              }
            }

            if (walletsUpdated) {
              const isSettled = updatedParticipants.every(p => p.hasPaid);
              updatedExpense = {
                ...updatedExpense,
                splitDetails: {
                  ...updatedExpense.splitDetails,
                  isSettled,
                  participants: updatedParticipants
                },
                remark: updatedExpense.remark ? `${updatedExpense.remark}${extraRemark}` : extraRemark.trim()
              };
              await StorageService.saveWallets(wallets);
            }
          }

          await addExpense(updatedExpense);
          Alert.alert('Success', 'Expense added successfully!');
        }}
      />
    </KeyboardAwareScrollView>
  );
};

const getStyles = (theme: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
  content: {
    padding: 16,
    paddingBottom: 200,
  },
  card: {
    backgroundColor: theme.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    borderWidth: 1,
    borderColor: theme.cardBorder,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.textPrimary,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  metric: {
    flex: 1,
    alignItems: 'center',
    padding: 10,
    backgroundColor: theme.surface,
    borderRadius: 8,
    marginHorizontal: 4,
  },
  metricLabel: {
    fontSize: 12,
    color: theme.textSecondary,
  },
  metricValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: theme.primary,
    marginTop: 4,
  },
  historySection: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: theme.cardBorder,
  },
  historyTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: theme.textSecondary,
    marginBottom: 12,
  },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  historyLabel: {
    fontSize: 14,
    color: theme.textSecondary,
  },
  historyValue: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.textPrimary,
  },
  grandTotalRow: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: theme.cardBorder,
  },
  grandTotalLabel: {
    fontSize: 14,
    fontWeight: 'bold',
    color: theme.textPrimary,
  },
  grandTotalValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: theme.primary,
  },
});
