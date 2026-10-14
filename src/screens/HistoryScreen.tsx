import React, { useMemo, useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  FlatList, 
  SectionList, 
  TouchableOpacity, 
  Alert, 
  Modal, 
  ScrollView, 
  TextInput, 
  KeyboardAvoidingView, 
  Platform,
  LayoutAnimation
} from 'react-native';
import { useExpenses } from '../contexts/ExpenseContext';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/types';
import { getSolidColor } from '../theme/palettes';
import { ExpenseLog, SplitParticipant, PaymentMode, UserWallet } from '../types';
import { parseISO, format } from 'date-fns';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';

import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { ExpenseForm } from '../components/ExpenseForm';
import { useToast } from '../contexts/ToastContext';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StorageService } from '../services/StorageService';

type ViewMode = 'FULL_LOG' | 'PENDING_RECEIVABLES';

export interface ActiveFilters {
  searchQuery: string;
  categories: string[]; // array of selected category strings
  paymentModes: string[];
  startDate: string | null;
  endDate: string | null;
}

interface DebtorSummary {
  name: string;
  totalOwed: number;
  transactionIds: string[]; // Track which transaction IDs make up this total
  creditBalance?: number;
}

const getPendingBalances = (expenses: ExpenseLog[]): DebtorSummary[] => {
  const summaryMap = new Map<string, DebtorSummary>();

  expenses.forEach(exp => {
    if (exp.isSplit && exp.splitDetails && !exp.splitDetails.isSettled) {
      exp.splitDetails.participants.forEach(p => {
        if (!p.hasPaid) {
          const lowerName = p.name.toLowerCase();
          const existing = summaryMap.get(lowerName);
          if (existing) {
            existing.totalOwed += p.shareAmount;
            existing.transactionIds.push(exp.id);
          } else {
            summaryMap.set(lowerName, {
              name: p.name,
              totalOwed: p.shareAmount,
              transactionIds: [exp.id],
            });
          }
        }
      });
    }
  });

  return Array.from(summaryMap.values());
};

export const HistoryScreen = () => {
  const { theme, mode } = useTheme();
  const { showToast } = useToast();
  const styles = getStyles(theme, mode);
  const { expenses, updateExpense, deleteExpense, events, setAllExpenses, activeEvent, categories: contextCategories, categoryGroups } = useExpenses();
  const [layoutMode, setLayoutMode] = useState<'detailed' | 'short'>('short');
  const [activeFilters, setActiveFilters] = useState<ActiveFilters>({
    searchQuery: '',
    categories: [],
    paymentModes: [],
    startDate: null,
    endDate: null,
  });
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [filterModalVisible, setFilterModalVisible] = useState(false);

  const [eventFilter, setEventFilter] = useState<string>('all');
  const [userChangedFilter, setUserChangedFilter] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('FULL_LOG');

  useEffect(() => {
    if (!userChangedFilter) {
      setEventFilter(activeEvent ? activeEvent.id : 'all');
    }
  }, [activeEvent, userChangedFilter]);

  const getEffectiveAmount = (exp: ExpenseLog) => {
    return (exp.isSplit && exp.splitDetails?.isSettled) ? exp.myShare : exp.totalAmount;
  };

  const [wallets, setWallets] = useState<UserWallet[]>([]);

  useEffect(() => {
    StorageService.loadWallets().then(setWallets);
  }, [expenses]);

  const pendingBalances = useMemo(() => {
    const debtors = getPendingBalances(expenses);
    const combined: DebtorSummary[] = debtors.map(debtor => {
      const lowerName = debtor.name.toLowerCase();
      const wallet = wallets.find(w => w.name === lowerName);
      return { ...debtor, creditBalance: wallet?.creditBalance || 0 };
    });

    wallets.forEach(wallet => {
      if (!combined.find(c => c.name.toLowerCase() === wallet.name)) {
        if (wallet.creditBalance > 0) {
          combined.push({
            name: wallet.name.charAt(0).toUpperCase() + wallet.name.slice(1),
            totalOwed: 0,
            transactionIds: [],
            creditBalance: wallet.creditBalance
          });
        }
      }
    });

    return combined;
  }, [expenses, wallets]);

  const filteredExpenses = useMemo(() => {
    let result = [...expenses];

    // 1. Filter by event
    if (eventFilter === 'none') {
      result = result.filter(e => !e.eventId);
    } else if (eventFilter !== 'all') {
      result = result.filter(e => e.eventId === eventFilter);
    }

    // 2. Filter by search query (remark containing query OR exact totalAmount/myShare query)
    if (activeFilters.searchQuery.trim() !== '') {
      const query = activeFilters.searchQuery.toLowerCase().trim();
      result = result.filter(e => {
        const remarkMatch = e.remark ? e.remark.toLowerCase().includes(query) : false;
        const totalAmtStr = e.totalAmount.toString();
        const totalAmtDec = e.totalAmount.toFixed(2);
        const myShareStr = e.myShare.toString();
        const myShareDec = e.myShare.toFixed(2);
        const amountMatch = totalAmtStr === query || totalAmtDec === query || myShareStr === query || myShareDec === query;
        return remarkMatch || amountMatch;
      });
    }

    // 3. Filter by selected categories
    if (activeFilters.categories.length > 0) {
      result = result.filter(e => activeFilters.categories.includes(e.category));
    }

    // 4. Filter by selected payment modes
    if (activeFilters.paymentModes.length > 0) {
      result = result.filter(e => e.paymentMode && activeFilters.paymentModes.includes(e.paymentMode));
    }

    // 5. Filter by Custom Date Range
    if (activeFilters.startDate) {
      result = result.filter(e => e.expenseDate >= activeFilters.startDate!);
    }
    if (activeFilters.endDate) {
      result = result.filter(e => e.expenseDate <= activeFilters.endDate!);
    }

    // Sort chronologically (newest first)
    return result.sort((a, b) => {
      const dayCompare = b.expenseDate.localeCompare(a.expenseDate);
      if (dayCompare !== 0) return dayCompare;
      return b.createdAt.localeCompare(a.createdAt);
    });
  }, [expenses, eventFilter, activeFilters]);

  // SectionList grouping logic (months sorted chronologically, newest first)
  const sections = useMemo(() => {
    const sectionsList: { title: string; data: ExpenseLog[] }[] = [];
    const seenMonths = new Set<string>();

    filteredExpenses.forEach(exp => {
      const dateObj = parseISO(exp.expenseDate);
      const monthYear = format(dateObj, 'MMMM yyyy'); // e.g. "June 2026"
      
      if (!seenMonths.has(monthYear)) {
        seenMonths.add(monthYear);
        sectionsList.push({
          title: monthYear,
          data: [exp]
        });
      } else {
        const sec = sectionsList.find(s => s.title === monthYear);
        if (sec) {
          sec.data.push(exp);
        }
      }
    });

    return sectionsList;
  }, [filteredExpenses]);

  // Temporary state for Advanced Filter modal
  const [tempCategories, setTempCategories] = useState<string[]>([]);
  const [tempPaymentModes, setTempPaymentModes] = useState<string[]>([]);
  const [tempStartDate, setTempStartDate] = useState<string | null>(null);
  const [tempEndDate, setTempEndDate] = useState<string | null>(null);

  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);

  // Sync temp state with active state when modal opens
  useEffect(() => {
    if (filterModalVisible) {
      setTempCategories(activeFilters.categories);
      setTempPaymentModes(activeFilters.paymentModes);
      setTempStartDate(activeFilters.startDate);
      setTempEndDate(activeFilters.endDate);
    }
  }, [filterModalVisible]);

  const onChangeStartDate = (event: any, selectedDate?: Date) => {
    setShowStartPicker(Platform.OS === 'ios');
    if (event.type === 'set' && selectedDate) {
      setTempStartDate(format(selectedDate, 'yyyy-MM-dd'));
    }
  };

  const onChangeEndDate = (event: any, selectedDate?: Date) => {
    setShowEndPicker(Platform.OS === 'ios');
    if (event.type === 'set' && selectedDate) {
      setTempEndDate(format(selectedDate, 'yyyy-MM-dd'));
    }
  };

  const handleClearAll = () => {
    setTempCategories([]);
    setTempPaymentModes([]);
    setTempStartDate(null);
    setTempEndDate(null);
  };

  const handleApplyFilters = () => {
    setActiveFilters(prev => ({
      ...prev,
      categories: tempCategories,
      paymentModes: tempPaymentModes,
      startDate: tempStartDate,
      endDate: tempEndDate,
    }));
    setFilterModalVisible(false);
  };

  const getPickerDate = (dateStr: string | null) => {
    if (dateStr) return parseISO(dateStr);
    return new Date();
  };

  const isAnyFilterActive = useMemo(() => {
    return activeFilters.categories.length > 0 || 
           activeFilters.paymentModes.length > 0 || 
           activeFilters.startDate !== null || 
           activeFilters.endDate !== null;
  }, [activeFilters]);

  const [selectedExpense, setSelectedExpense] = useState<ExpenseLog | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [expandedParticipantId, setExpandedParticipantId] = useState<string | null>(null);

  const [editingExpense, setEditingExpense] = useState<ExpenseLog | null>(null);

  const [settlementModalVisible, setSettlementModalVisible] = useState(false);
  const [selectedDebtor, setSelectedDebtor] = useState<DebtorSummary | null>(null);
  const [settlementAmount, setSettlementAmount] = useState<string>('');

  const openSettlementModal = (expense: ExpenseLog) => {
    if (!expense.isSplit || !expense.splitDetails) return;

    if (expense.splitDetails.isSettled) {
      Alert.alert(
        'Fully Settled',
        'This transaction has been fully settled. Are you sure you want to reopen it?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Yes',
            style: 'destructive',
            onPress: () => {
              setSelectedExpense(expense);
              setModalVisible(true);
            }
          }
        ]
      );
    } else {
      setSelectedExpense(expense);
      setModalVisible(true);
    }
  };

  const openDebtorSettlement = (debtor: DebtorSummary) => {
    setSelectedDebtor(debtor);
    setSettlementAmount(debtor.totalOwed.toString());
    setSettlementModalVisible(true);
  };

  const handleConfirmSettlement = async () => {
    if (!selectedDebtor) return;
    
    const amount = parseFloat(settlementAmount);
    if (isNaN(amount) || amount <= 0) {
      showToast('Please enter a valid amount.', 'error');
      return;
    }

    const lowerName = selectedDebtor.name.toLowerCase();
    
    // Filter matching transactions and sort oldest to newest
    const matchingExpenses = expenses.filter(exp => 
      exp.isSplit && 
      exp.splitDetails && 
      !exp.splitDetails.isSettled &&
      exp.splitDetails.participants.some(p => p.name.toLowerCase() === lowerName && !p.hasPaid)
    ).sort((a, b) => {
      return parseISO(a.expenseDate).getTime() - parseISO(b.expenseDate).getTime();
    });

    let remainingPool = amount;
    const updatedExpenses = [...expenses];

    for (let i = 0; i < matchingExpenses.length; i++) {
      if (remainingPool <= 0) break;

      const exp = matchingExpenses[i];
      const expenseIndex = updatedExpenses.findIndex(e => e.id === exp.id);
      
      if (expenseIndex === -1 || !exp.splitDetails) continue;

      const updatedSplitDetails = { ...exp.splitDetails };
      const updatedParticipants = [...updatedSplitDetails.participants];

      const participantIndex = updatedParticipants.findIndex(p => p.name.toLowerCase() === lowerName && !p.hasPaid);
      if (participantIndex === -1) continue;

      const participant = updatedParticipants[participantIndex];
      const currentOwed = participant.shareAmount;

      if (remainingPool >= currentOwed) {
        // Fully paid this share
        updatedParticipants[participantIndex] = { ...participant, hasPaid: true };
        remainingPool -= currentOwed;
      } else {
        // Partially paid this share
        updatedParticipants[participantIndex] = { 
          ...participant, 
          shareAmount: currentOwed - remainingPool 
        };
        const remarkNote = `[Partial payment of ₹${remainingPool} recorded]`;
        updatedExpenses[expenseIndex] = {
          ...updatedExpenses[expenseIndex],
          remark: exp.remark ? `${exp.remark} ${remarkNote}` : remarkNote
        };
        remainingPool = 0;
      }

      const isSettled = updatedParticipants.every(p => p.hasPaid);

      updatedExpenses[expenseIndex] = {
        ...updatedExpenses[expenseIndex],
        splitDetails: {
          ...updatedSplitDetails,
          isSettled,
          participants: updatedParticipants
        }
      };
    }

    try {
      if (remainingPool > 0) {
        const wallets = await StorageService.loadWallets();
        const existingWallet = wallets.find(w => w.name === lowerName);
        if (existingWallet) {
          existingWallet.creditBalance += remainingPool;
        } else {
          wallets.push({ name: lowerName, creditBalance: remainingPool });
        }
        await StorageService.saveWallets(wallets);
        showToast(`All debts settled! Surplus of ₹${remainingPool} added to ${selectedDebtor.name}'s wallet.`, 'success');
      } else {
        showToast('Payment recorded successfully.', 'success');
      }

      if (setAllExpenses) {
        await setAllExpenses(updatedExpenses);
      } else {
        await AsyncStorage.setItem('tracker_expenses', JSON.stringify(updatedExpenses));
      }
      setSettlementModalVisible(false);
      setSelectedDebtor(null);
      setSettlementAmount('');
    } catch (e) {
      console.error(e);
      showToast('Failed to save settlement.', 'error');
    }
  };

  const toggleParticipantState = (expenseId: string, participantId: string) => {
    const expense = expenses.find(e => e.id === expenseId);
    if (!expense || !expense.splitDetails) return;

    const participant = expense.splitDetails.participants.find(p => p.id === participantId);
    if (!participant) return;

    const wasPaid = participant.hasPaid;

    if (wasPaid) {
      if (expandedParticipantId === participantId) setExpandedParticipantId(null);
    } else {
      setExpandedParticipantId(participantId);
    }

    const updatedParticipants = expense.splitDetails.participants.map(p =>
      p.id === participantId ? { ...p, hasPaid: !wasPaid, paymentMode: wasPaid ? undefined : p.paymentMode } : p
    );

    const isSettled = updatedParticipants.every(p => p.hasPaid);

    const updatedExpense = {
      ...expense,
      splitDetails: {
        isSettled,
        participants: updatedParticipants,
      }
    };

    updateExpense(updatedExpense);

    if (selectedExpense && selectedExpense.id === expenseId) {
      setSelectedExpense(updatedExpense);
    }
  };

  const updateParticipantMode = (expenseId: string, participantId: string, mode: PaymentMode) => {
    const expense = expenses.find(e => e.id === expenseId);
    if (!expense || !expense.splitDetails) return;

    const updatedParticipants = expense.splitDetails.participants.map(p =>
      p.id === participantId ? { ...p, paymentMode: mode } : p
    );

    const updatedExpense = {
      ...expense,
      splitDetails: {
        ...expense.splitDetails,
        participants: updatedParticipants,
      }
    };

    updateExpense(updatedExpense);

    if (selectedExpense && selectedExpense.id === expenseId) {
      setSelectedExpense(updatedExpense);
    }
    setExpandedParticipantId(null);
  };

  const handleDelete = (id: string) => {
    Alert.alert('Confirm Delete', 'Are you sure you want to delete this expense?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteExpense(id) }
    ]);
  };

  const handleEditSubmit = async (updatedExpense: ExpenseLog) => {
    await updateExpense(updatedExpense);
    setEditingExpense(null);
    showToast('Expense updated successfully!', 'success');
  };

  const renderDebtorItem = ({ item }: { item: DebtorSummary }) => (
    <View style={styles.card}>
      <View style={styles.debtorRow}>
        <Text style={styles.debtorName}>{item.name}</Text>
        {item.creditBalance && item.creditBalance > 0 ? (
          <View style={styles.creditBadge}>
            <Text style={styles.creditBadgeText}>
              ₹{item.totalOwed.toFixed(2)} Owed (₹{item.creditBalance.toFixed(2)} Wallet Credit)
            </Text>
          </View>
        ) : (
          <Text style={styles.amountText}>₹{item.totalOwed.toFixed(2)}</Text>
        )}
      </View>
      <TouchableOpacity 
        style={[styles.recordPaymentBtn, item.totalOwed === 0 && { backgroundColor: theme.textMuted }]} 
        onPress={() => item.totalOwed > 0 && openDebtorSettlement(item)}
        disabled={item.totalOwed === 0}
      >
        <Text style={styles.recordPaymentText}>Record Payment</Text>
      </TouchableOpacity>
    </View>
  );

  const toggleRowExpanded = (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedRows(prev => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const renderItem = ({ item }: { item: ExpenseLog }) => {
    const isSplit = item.isSplit;
    const isSettled = item.splitDetails?.isSettled;

    if (layoutMode === 'short') {
      const isExpanded = !!expandedRows[item.id];
      const dateObj = parseISO(item.expenseDate);
      const formattedDateShort = format(dateObj, 'dd MMM');
      const hasTime = item.expenseDate.includes('T');
      const formattedDateFull = format(dateObj, hasTime ? 'EEE, dd MMM yyyy • hh:mm a' : 'EEEE, dd MMM yyyy');
      const eventObj = item.eventId ? events.find(e => e.id === item.eventId) : undefined;
      const statusColor = isSplit ? (isSettled ? '#10B981' : '#F59E0B') : theme.primary;

      return (
        <View style={[styles.shortCard, isExpanded && styles.shortCardExpanded]}>
          {/* Left Status Accent Indicator Strip */}
          <View style={[styles.shortCardAccentStrip, { backgroundColor: statusColor }]} />

          {/* Core Collapsible Header Row */}
          <TouchableOpacity
            style={[styles.shortCoreRow, isExpanded && styles.shortCoreRowExpanded]}
            onPress={() => toggleRowExpanded(item.id)}
            activeOpacity={0.75}
          >
            {/* Date Badge */}
            <View style={styles.shortDateContainer}>
              <Text style={styles.shortDateText}>{formattedDateShort}</Text>
            </View>

            {/* Description & Category Column */}
            <View style={styles.shortCenterContent}>
              <Text style={styles.shortTitleText} numberOfLines={1} ellipsizeMode="tail">
                {item.remark || item.category || 'Expense'}
              </Text>
              <View style={styles.shortSubRow}>
                <Text style={styles.shortCategorySubText} numberOfLines={1}>
                  {item.category}
                </Text>
                {eventObj && (
                  <Text style={styles.shortEventSubText} numberOfLines={1}>
                    {' '}&bull; {eventObj.name}
                  </Text>
                )}
              </View>
            </View>

            {/* Total Amount & Indicator Icons */}
            <View style={styles.shortRightContent}>
              <View style={styles.shortAmountWrapper}>
                {isSplit && (
                  <Ionicons
                    name="people"
                    size={13}
                    color={isSettled ? '#10B981' : '#F59E0B'}
                    style={{ marginRight: 4 }}
                  />
                )}
                <Text style={styles.shortAmountText}>₹{item.totalAmount.toFixed(2)}</Text>
              </View>
              <Ionicons
                name={isExpanded ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={isExpanded ? theme.primary : theme.textMuted}
                style={styles.shortChevron}
              />
            </View>
          </TouchableOpacity>

          {/* Expanded Content Section */}
          {isExpanded && (
            <View style={styles.shortExpandedDetails}>
              {/* Hairline Divider */}
              <View style={styles.expandedDivider} />

              {/* Metadata Badges Strip */}
              <View style={styles.expandedMetaStrip}>
                <View style={styles.metaBadge}>
                  <Ionicons name="calendar-outline" size={13} color={theme.textSecondary} style={{ marginRight: 4 }} />
                  <Text style={styles.metaBadgeText}>{formattedDateFull}</Text>
                </View>

                {item.paymentMode && (
                  <View style={styles.metaBadge}>
                    <Ionicons
                      name={item.paymentMode === 'Cash' ? 'cash-outline' : item.paymentMode === 'Card' ? 'card-outline' : 'phone-portrait-outline'}
                      size={13}
                      color={theme.textSecondary}
                      style={{ marginRight: 4 }}
                    />
                    <Text style={styles.metaBadgeText}>{item.paymentMode}</Text>
                  </View>
                )}

                {eventObj && (
                  <View style={[styles.metaBadge, styles.eventMetaBadge]}>
                    <Ionicons name="airplane-outline" size={13} color={theme.primary} style={{ marginRight: 4 }} />
                    <Text style={[styles.metaBadgeText, { color: theme.primary, fontWeight: '600' }]}>{eventObj.name}</Text>
                  </View>
                )}
              </View>

              {/* Full Remark Box (if exists) */}
              {item.remark ? (
                <View style={styles.remarkBox}>
                  <Ionicons name="document-text-outline" size={15} color={theme.textMuted} style={styles.remarkBoxIcon} />
                  <Text style={styles.remarkBoxText}>{item.remark}</Text>
                </View>
              ) : null}

              {/* Financial & Split Breakdown Card */}
              {isSplit && item.splitDetails ? (
                <View style={styles.splitBreakdownCard}>
                  <View style={styles.splitHeaderRow}>
                    <View style={styles.splitHeaderLeft}>
                      <Ionicons name="people-sharp" size={16} color={theme.primary} style={{ marginRight: 6 }} />
                      <Text style={styles.splitHeaderTitle}>Split Breakdown</Text>
                    </View>
                    <View style={[styles.splitStatusBadge, isSettled ? styles.settledStatusBadge : styles.unsettledStatusBadge]}>
                      <Ionicons
                        name={isSettled ? 'checkmark-circle' : 'time-outline'}
                        size={12}
                        color={isSettled ? '#059669' : '#D97706'}
                        style={{ marginRight: 4 }}
                      />
                      <Text style={[styles.splitStatusText, { color: isSettled ? '#059669' : '#D97706' }]}>
                        {isSettled ? 'Fully Settled' : 'Unsettled'}
                      </Text>
                    </View>
                  </View>

                  {/* Summary Metric Pills */}
                  <View style={styles.splitMetricsRow}>
                    <View style={styles.splitMetricItem}>
                      <Text style={styles.splitMetricLabel}>Total Bill</Text>
                      <Text style={styles.splitMetricValue}>₹{item.totalAmount.toFixed(2)}</Text>
                    </View>
                    <View style={styles.splitMetricDivider} />
                    <View style={styles.splitMetricItem}>
                      <Text style={styles.splitMetricLabel}>My Share</Text>
                      <Text style={[styles.splitMetricValue, { color: theme.primary }]}>₹{item.myShare.toFixed(2)}</Text>
                    </View>
                    <View style={styles.splitMetricDivider} />
                    <View style={styles.splitMetricItem}>
                      <Text style={styles.splitMetricLabel}>Others Owe</Text>
                      <Text style={[styles.splitMetricValue, { color: isSettled ? '#10B981' : '#F59E0B' }]}>
                        ₹{Math.max(0, item.totalAmount - item.myShare).toFixed(2)}
                      </Text>
                    </View>
                  </View>

                  {/* Participant Chips */}
                  {item.splitDetails.participants && item.splitDetails.participants.length > 0 && (
                    <View style={styles.participantsSection}>
                      <Text style={styles.participantsSectionTitle}>Participants:</Text>
                      <View style={styles.participantPillsWrap}>
                        {item.splitDetails.participants.map(p => (
                          <View
                            key={p.id}
                            style={[
                              styles.participantPill,
                              p.hasPaid ? styles.participantPillPaid : styles.participantPillUnpaid,
                            ]}
                          >
                            <Ionicons
                              name={p.hasPaid ? 'checkmark-circle' : 'ellipse-outline'}
                              size={12}
                              color={p.hasPaid ? '#10B981' : '#F59E0B'}
                              style={{ marginRight: 4 }}
                            />
                            <Text style={styles.participantPillName}>{p.name}</Text>
                            <Text style={styles.participantPillAmount}>: ₹{p.shareAmount.toFixed(2)}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  )}

                  {/* Quick Settle / Manage Split Button */}
                  <TouchableOpacity
                    style={styles.manageSplitButton}
                    onPress={() => openSettlementModal(item)}
                    activeOpacity={0.75}
                  >
                    <Ionicons name="options" size={14} color={theme.primary} style={{ marginRight: 6 }} />
                    <Text style={styles.manageSplitButtonText}>
                      {isSettled ? 'View Split Details' : 'Manage & Settle Split'}
                    </Text>
                    <Ionicons name="chevron-forward" size={14} color={theme.primary} style={{ marginLeft: 2 }} />
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.personalSummaryCard}>
                  <View style={styles.personalSummaryRow}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Ionicons name="person" size={14} color={theme.primary} style={{ marginRight: 6 }} />
                      <Text style={styles.personalSummaryLabel}>Personal Expense</Text>
                    </View>
                    <Text style={styles.personalSummaryValue}>₹{item.totalAmount.toFixed(2)}</Text>
                  </View>
                </View>
              )}

              {/* Action Buttons Row */}
              <View style={styles.shortActionsRow}>
                <TouchableOpacity
                  style={styles.shortActionEditBtn}
                  onPress={() => setEditingExpense(item)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="pencil" size={15} color={theme.textPrimary} style={{ marginRight: 6 }} />
                  <Text style={styles.shortActionEditText}>Edit</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.shortActionDeleteBtn}
                  onPress={() => handleDelete(item.id)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="trash-outline" size={15} color={theme.danger} style={{ marginRight: 6 }} />
                  <Text style={styles.shortActionDeleteText}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      );
    }

    // Detailed View
    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => item.isSplit && openSettlementModal(item)}
        activeOpacity={item.isSplit ? 0.7 : 1}
      >
        <View style={styles.headerRow}>
          <View style={styles.categoryBadge}>
            <Text style={styles.categoryText}>{item.category}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={styles.dateText}>{format(parseISO(item.expenseDate), 'MMM dd, yyyy')}</Text>
            <TouchableOpacity onPress={() => setEditingExpense(item)} style={{ marginLeft: 16 }}>
              <Ionicons name="pencil" size={18} color={theme.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleDelete(item.id)} style={{ marginLeft: 16 }}>
              <Ionicons name="trash" size={18} color={theme.danger} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.amountRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={styles.amountText}>₹{item.totalAmount.toFixed(2)}</Text>
            {item.paymentMode && (
              <View style={styles.paymentModeBadge}>
                <Text style={styles.paymentModeText}>{item.paymentMode}</Text>
              </View>
            )}
          </View>
          {isSplit && (
            <View style={[styles.splitBadge, isSettled ? styles.settledBadge : styles.unsettledBadge]}>
              <Text style={[styles.splitBadgeText, isSettled ? styles.settledText : styles.unsettledText]}>
                {isSettled ? 'Settled' : 'Unsettled Split'}
              </Text>
            </View>
          )}
        </View>

        {item.remark && (
          <Text style={styles.remarkText}>{item.remark}</Text>
        )}

        <View style={styles.shareRow}>
          <Text style={styles.myShareLabel}>My Share:</Text>
          <Text style={styles.myShareValue}>₹{item.myShare.toFixed(2)}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Sticky Header Section */}
      <View style={styles.stickyHeaderContainer}>
        {/* View Mode Tabs */}
        <View style={styles.viewModeContainer}>
          <TouchableOpacity 
            style={[styles.viewModeChip, viewMode === 'FULL_LOG' && styles.viewModeChipActive]}
            onPress={() => setViewMode('FULL_LOG')}
          >
            <Text style={[styles.viewModeText, viewMode === 'FULL_LOG' && styles.viewModeTextActive]}>Full Log</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.viewModeChip, viewMode === 'PENDING_RECEIVABLES' && styles.viewModeChipActive]}
            onPress={() => setViewMode('PENDING_RECEIVABLES')}
          >
            <Text style={[styles.viewModeText, viewMode === 'PENDING_RECEIVABLES' && styles.viewModeTextActive]}>Pending Receivables</Text>
          </TouchableOpacity>
        </View>

        {/* Global Search & Advanced Filter Toggle */}
        {viewMode === 'FULL_LOG' && (
          <View style={styles.searchFilterRow}>
            <View style={styles.searchBarWrapper}>
              <Ionicons name="search" size={18} color={theme.textMuted} style={styles.searchIcon} />
              <TextInput
                style={styles.searchBar}
                placeholder="Search remarks or amounts..."
                placeholderTextColor={theme.textMuted}
                value={activeFilters.searchQuery}
                onChangeText={(text) => setActiveFilters(prev => ({ ...prev, searchQuery: text }))}
              />
              {activeFilters.searchQuery.length > 0 && (
                <TouchableOpacity 
                  onPress={() => setActiveFilters(prev => ({ ...prev, searchQuery: '' }))}
                  style={styles.clearSearchBtn}
                >
                  <Ionicons name="close-circle" size={18} color={theme.textMuted} />
                </TouchableOpacity>
              )}
            </View>
            <TouchableOpacity 
              style={[styles.filterButton, isAnyFilterActive && styles.filterButtonActive]} 
              onPress={() => setFilterModalVisible(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="funnel" size={20} color={isAnyFilterActive ? '#FFFFFF' : theme.textSecondary} />
              {isAnyFilterActive && <View style={styles.filterActiveDot} />}
            </TouchableOpacity>
          </View>
        )}

        {/* Single Layout Toggle Button */}
        {viewMode === 'FULL_LOG' && (
          <View style={styles.layoutToggleContainer}>
            <TouchableOpacity 
              style={styles.singleToggleBtn}
              onPress={() => setLayoutMode(prev => prev === 'short' ? 'detailed' : 'short')}
              activeOpacity={0.7}
            >
              <View style={styles.singleToggleLeft}>
                <Ionicons 
                  name={layoutMode === 'short' ? "reorder-four" : "list"} 
                  size={18} 
                  color={theme.primary} 
                  style={{ marginRight: 8 }} 
                />
                <Text style={styles.singleToggleText}>
                  {layoutMode === 'short' ? 'Short View' : 'Detailed View'}
                </Text>
              </View>
              <View style={styles.toggleBadge}>
                <Text style={styles.toggleBadgeText}>
                  Switch to {layoutMode === 'short' ? 'Detailed' : 'Short'}
                </Text>
              </View>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Standalone/Session Filter Chips */}
      {viewMode === 'FULL_LOG' && expenses.length > 0 && (
        <View style={styles.filterSection}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
            <TouchableOpacity 
              style={[styles.filterChip, eventFilter === 'all' && styles.filterChipActive]}
              onPress={() => { setEventFilter('all'); setUserChangedFilter(true); }}
            >
              <Text style={[styles.filterChipText, eventFilter === 'all' && styles.filterChipTextActive]}>Overall</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.filterChip, eventFilter === 'none' && styles.filterChipActive]}
              onPress={() => { setEventFilter('none'); setUserChangedFilter(true); }}
            >
              <Text style={[styles.filterChipText, eventFilter === 'none' && styles.filterChipTextActive]}>Standalone Only</Text>
            </TouchableOpacity>
            {events.map(ev => (
              <TouchableOpacity 
                key={ev.id}
                style={[styles.filterChip, eventFilter === ev.id && styles.filterChipActive]}
                onPress={() => { setEventFilter(ev.id); setUserChangedFilter(true); }}
              >
                <Text style={[styles.filterChipText, eventFilter === ev.id && styles.filterChipTextActive]}>{ev.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {viewMode === 'FULL_LOG' ? (
        filteredExpenses.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No expenses match your filters.</Text>
          </View>
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={item => item.id}
            renderItem={renderItem}
            renderSectionHeader={({ section: { title } }) => (
              <View style={styles.sectionHeaderContainer}>
                <Text style={styles.sectionHeaderTitle}>{title}</Text>
              </View>
            )}
            stickySectionHeadersEnabled={true}
            contentContainerStyle={styles.listContent}
          />
        )
      ) : (
        pendingBalances.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No pending receivables.</Text>
          </View>
        ) : (
          <FlatList
            data={pendingBalances}
            keyExtractor={item => item.name}
            renderItem={renderDebtorItem}
            contentContainerStyle={styles.listContent}
          />
        )
      )}

      {/* Advanced Filter Modal */}
      <Modal
        visible={filterModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setFilterModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.bottomSheetContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Advanced Filters</Text>
              <TouchableOpacity onPress={() => setFilterModalVisible(false)} style={styles.closeButton}>
                <Ionicons name="close" size={24} color={theme.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView 
              style={styles.modalScrollView} 
              contentContainerStyle={styles.modalScrollContent}
              showsVerticalScrollIndicator={false}
            >
              {/* Category Grid Checkboxes */}
              <Text style={styles.filterSectionTitle}>Categories</Text>
              {categoryGroups.map(group => (
                <View key={group.id} style={{ marginBottom: 12 }}>
                  <Text style={[styles.filterSubSectionTitle, { color: theme.textSecondary }]}>{group.name}</Text>
                  <View style={styles.modalChipGrid}>
                    {group.subcategories.map(cat => {
                      const isSelected = tempCategories.includes(cat);
                      return (
                        <TouchableOpacity
                          key={cat}
                          style={[styles.modalChip, isSelected && styles.modalChipActive]}
                          onPress={() => {
                            setTempCategories(prev =>
                              prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
                            );
                          }}
                        >
                          <Ionicons 
                            name={isSelected ? "checkmark-circle" : "ellipse-outline"} 
                            size={16} 
                            color={isSelected ? "#FFFFFF" : theme.textMuted} 
                            style={{ marginRight: 4 }}
                          />
                          <Text style={[styles.modalChipText, isSelected && styles.modalChipTextActive]}>
                            {cat}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ))}

              {/* Payment Mode Checkboxes */}
              <Text style={styles.filterSectionTitle}>Payment Modes</Text>
              <View style={styles.modalChipGrid}>
                {['UPI', 'Cash', 'Card'].map(mode => {
                  const isSelected = tempPaymentModes.includes(mode);
                  return (
                    <TouchableOpacity
                      key={mode}
                      style={[styles.modalChip, isSelected && styles.modalChipActive]}
                      onPress={() => {
                        setTempPaymentModes(prev =>
                          prev.includes(mode) ? prev.filter(m => m !== mode) : [...prev, mode]
                        );
                      }}
                    >
                      <Ionicons 
                        name={isSelected ? "checkmark-circle" : "ellipse-outline"} 
                        size={16} 
                        color={isSelected ? "#FFFFFF" : theme.textMuted} 
                        style={{ marginRight: 4 }}
                      />
                      <Text style={[styles.modalChipText, isSelected && styles.modalChipTextActive]}>
                        {mode}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Date Pickers */}
              <Text style={styles.filterSectionTitle}>Date Range</Text>
              <View style={styles.dateRangeContainer}>
                <View style={styles.datePickerInputGroup}>
                  <Text style={styles.datePickerLabel}>Start Date</Text>
                  <View style={styles.dateRowWithClear}>
                    <TouchableOpacity 
                      style={styles.dateButton} 
                      onPress={() => setShowStartPicker(true)}
                    >
                      <Ionicons name="calendar-outline" size={18} color={theme.textSecondary} style={{ marginRight: 8 }} />
                      <Text style={styles.dateButtonText}>
                        {tempStartDate ? tempStartDate : 'Select Start Date'}
                      </Text>
                    </TouchableOpacity>
                    {tempStartDate && (
                      <TouchableOpacity 
                        style={styles.clearDateIcon} 
                        onPress={() => setTempStartDate(null)}
                      >
                        <Ionicons name="close-circle" size={18} color={theme.textMuted} />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>

                <View style={styles.datePickerInputGroup}>
                  <Text style={styles.datePickerLabel}>End Date</Text>
                  <View style={styles.dateRowWithClear}>
                    <TouchableOpacity 
                      style={styles.dateButton} 
                      onPress={() => setShowEndPicker(true)}
                    >
                      <Ionicons name="calendar-outline" size={18} color={theme.textSecondary} style={{ marginRight: 8 }} />
                      <Text style={styles.dateButtonText}>
                        {tempEndDate ? tempEndDate : 'Select End Date'}
                      </Text>
                    </TouchableOpacity>
                    {tempEndDate && (
                      <TouchableOpacity 
                        style={styles.clearDateIcon} 
                        onPress={() => setTempEndDate(null)}
                      >
                        <Ionicons name="close-circle" size={18} color={theme.textMuted} />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </View>

              {showStartPicker && (
                <DateTimePicker
                  value={getPickerDate(tempStartDate)}
                  mode="date"
                  display="default"
                  onChange={onChangeStartDate}
                  themeVariant={mode}
                />
              )}

              {showEndPicker && (
                <DateTimePicker
                  value={getPickerDate(tempEndDate)}
                  mode="date"
                  display="default"
                  onChange={onChangeEndDate}
                  themeVariant={mode}
                />
              )}
            </ScrollView>

            {/* Modal Sticky Footer Actions */}
            <View style={styles.modalStickyFooter}>
              <TouchableOpacity style={styles.clearAllFiltersBtn} onPress={handleClearAll}>
                <Text style={styles.clearAllFiltersText}>Clear All</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.applyFiltersBtn} onPress={handleApplyFilters}>
                <Text style={styles.applyFiltersText}>Apply Filters</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Edit Expense Modal */}
      <Modal
        visible={editingExpense !== null}
        animationType="slide"
        onRequestClose={() => setEditingExpense(null)}
      >
        <View style={{ flex: 1, backgroundColor: theme.background }}>
          <View style={styles.modalHeaderFullScreen}>
            <TouchableOpacity onPress={() => setEditingExpense(null)}>
              <Ionicons name="arrow-back" size={24} color={theme.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.modalTitleFullScreen}>Edit Expense</Text>
            <View style={{ width: 24 }} />
          </View>
          <KeyboardAwareScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 16, paddingBottom: 200 }}
            enableOnAndroid={true}
            extraScrollHeight={120}
            extraHeight={120}
            keyboardShouldPersistTaps="handled"
          >
            {editingExpense && (
              <ExpenseForm
                initialData={editingExpense}
                onSubmit={handleEditSubmit}
                submitButtonText="Update Expense"
              />
            )}
          </KeyboardAwareScrollView>
        </View>
      </Modal>

      {/* Legacy Settlement Modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Settlement Details</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)} style={styles.closeButton}>
                <Ionicons name="close" size={24} color={theme.textSecondary} />
              </TouchableOpacity>
            </View>

            {selectedExpense?.splitDetails?.participants.map(p => (
              <View key={p.id}>
                <TouchableOpacity
                  style={styles.participantRow}
                  onPress={() => toggleParticipantState(selectedExpense.id, p.id)}
                >
                  <View style={styles.participantInfo}>
                    <Ionicons
                      name={p.hasPaid ? 'checkmark-circle' : 'ellipse-outline'}
                      size={20}
                      color={p.hasPaid ? '#48BB78' : '#A0AEC0'}
                    />
                    <Text style={[styles.participantName, p.hasPaid && styles.paidText]}>{p.name}</Text>
                    {p.hasPaid && p.paymentMode && (
                      <View style={styles.participantPaymentBadge}>
                        <Text style={styles.participantPaymentText}>{p.paymentMode}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.participantShare, p.hasPaid && styles.paidText]}>
                    ₹{p.shareAmount.toFixed(2)}
                  </Text>
                </TouchableOpacity>

                {expandedParticipantId === p.id && p.hasPaid && (
                  <View style={styles.inlineModeSelector}>
                    <Text style={styles.inlineModeLabel}>Via:</Text>
                    {['Cash', 'UPI', 'Card'].map((mode) => (
                      <TouchableOpacity
                        key={mode}
                        style={[styles.inlineModeChip, p.paymentMode === mode && styles.inlineModeChipActive]}
                        onPress={() => updateParticipantMode(selectedExpense.id, p.id, mode as PaymentMode)}
                      >
                        <Text style={[styles.inlineModeChipText, p.paymentMode === mode && styles.inlineModeChipTextActive]}>{mode}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            ))}
          </View>
        </View>
      </Modal>

      {/* Debtor Settlement Modal */}
      <Modal
        visible={settlementModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setSettlementModalVisible(false)}
      >
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Record Payment from {selectedDebtor?.name}</Text>
              <TouchableOpacity onPress={() => setSettlementModalVisible(false)} style={styles.closeButton}>
                <Ionicons name="close" size={24} color={theme.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={{ marginBottom: 20 }}>
              <Text style={{ fontSize: 14, color: theme.textMuted, marginBottom: 8 }}>
                Amount Received
              </Text>
              <TextInput
                style={styles.amountInput}
                keyboardType="numeric"
                value={settlementAmount}
                onChangeText={setSettlementAmount}
                placeholder="Enter amount"
              />
              <Text style={{ fontSize: 12, color: theme.danger, marginTop: 8, fontStyle: 'italic' }}>
                Note: This payment will automatically settle their oldest debts first.
              </Text>
            </View>

            <TouchableOpacity style={styles.confirmSettlementBtn} onPress={handleConfirmSettlement}>
              <Text style={styles.confirmSettlementText}>Confirm Settlement</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

    </View>
  );
};

const getStyles = (theme: ThemeColors, mode: 'light' | 'dark') => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
  viewModeContainer: {
    flexDirection: 'row',
    padding: 16,
    backgroundColor: theme.card,
    borderBottomWidth: 1,
    borderBottomColor: theme.surface,
    gap: 8,
  },
  viewModeChip: {
    flex: 1,
    paddingVertical: 10,
    backgroundColor: theme.surface,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewModeChipActive: {
    backgroundColor: theme.textPrimary,
  },
  viewModeText: {
    fontSize: 14,
    color: theme.textSecondary,
    fontWeight: '600',
  },
  viewModeTextActive: {
    color: theme.card,
  },
  listContent: {
    paddingTop: 8,
    paddingBottom: 32,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyText: {
    fontSize: 16,
    color: theme.textMuted,
    textAlign: 'center',
  },
  card: {
    backgroundColor: theme.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    marginHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  debtorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  debtorName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.textPrimary,
  },
  recordPaymentBtn: {
    backgroundColor: theme.primary,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  recordPaymentText: {
    color: theme.card,
    fontWeight: '600',
    fontSize: 14,
  },
  amountInput: {
    backgroundColor: getSolidColor(theme.surface, mode === 'dark' ? '#242C3D' : '#F4F5F7'),
    padding: 12,
    borderRadius: 8,
    fontSize: 16,
    color: theme.textPrimary,
    borderWidth: 1,
    borderColor: theme.cardBorder,
  },
  confirmSettlementBtn: {
    backgroundColor: theme.success,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  confirmSettlementText: {
    color: theme.card,
    fontWeight: 'bold',
    fontSize: 16,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  categoryBadge: {
    backgroundColor: theme.surface,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 16,
  },
  categoryText: {
    color: theme.textSecondary,
    fontSize: 12,
    fontWeight: 'bold',
  },
  dateText: {
    fontSize: 12,
    color: theme.textMuted,
  },
  amountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  amountText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: theme.textPrimary,
  },
  splitBadge: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  unsettledBadge: {
    backgroundColor: theme.surface,
  },
  settledBadge: {
    backgroundColor: theme.surface,
  },
  splitBadgeText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  unsettledText: {
    color: theme.textSecondary,
  },
  settledText: {
    color: theme.textSecondary,
  },
  remarkText: {
    fontSize: 14,
    color: theme.textMuted,
    marginBottom: 12,
    fontStyle: 'italic',
  },
  shareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: theme.surface,
    paddingTop: 12,
  },
  myShareLabel: {
    fontSize: 14,
    color: theme.textSecondary,
    marginRight: 8,
  },
  myShareValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: theme.primary,
  },
  participantsContainer: {
    marginTop: 16,
    backgroundColor: theme.surface,
    padding: 12,
    borderRadius: 8,
  },
  participantsTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: theme.textSecondary,
    marginBottom: 8,
  },
  participantRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  participantInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  participantName: {
    fontSize: 14,
    color: theme.textPrimary,
    marginLeft: 8,
  },
  participantShare: {
    fontSize: 14,
    fontWeight: '500',
    color: theme.textPrimary,
  },
  paidText: {
    color: theme.textMuted,
    textDecorationLine: 'line-through',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: getSolidColor(theme.card, mode === 'dark' ? '#1A202C' : '#FFFFFF'),
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '80%',
    borderWidth: 1,
    borderColor: theme.cardBorder,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.surface,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.textPrimary,
  },
  closeButton: {
    padding: 4,
  },
  modalHeaderFullScreen: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    paddingTop: 48,
    backgroundColor: theme.card,
    borderBottomWidth: 1,
    borderBottomColor: theme.cardBorder,
  },
  modalTitleFullScreen: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.textPrimary,
  },
  filterSection: {
    backgroundColor: theme.card,
    borderBottomWidth: 1,
    borderBottomColor: theme.cardBorder,
    paddingVertical: 12,
  },
  filterScroll: {
    paddingHorizontal: 16,
    gap: 8,
  },
  filterChip: {
    backgroundColor: theme.surface,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    marginRight: 8,
    borderWidth: 1,
    borderColor: theme.cardBorder,
  },
  filterChipActive: {
    backgroundColor: theme.primary,
    borderColor: theme.primary,
  },
  filterChipText: {
    color: theme.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  filterChipTextActive: {
    color: '#FFF',
    fontWeight: 'bold',
  },
  paymentModeBadge: {
    backgroundColor: theme.surface,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 8,
  },
  paymentModeText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: theme.textSecondary,
  },
  participantPaymentBadge: {
    backgroundColor: theme.cardBorder,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 8,
  },
  participantPaymentText: {
    fontSize: 10,
    fontWeight: '600',
    color: theme.textSecondary,
  },
  inlineModeSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 36,
    paddingBottom: 8,
    marginTop: -4,
  },
  inlineModeLabel: {
    fontSize: 12,
    color: theme.textMuted,
    marginRight: 8,
  },
  inlineModeChip: {
    backgroundColor: theme.surface,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginRight: 6,
  },
  inlineModeChipActive: {
    backgroundColor: theme.primary,
  },
  inlineModeChipText: {
    fontSize: 10,
    color: theme.textSecondary,
    fontWeight: 'bold',
  },
  inlineModeChipTextActive: {
    color: theme.card,
  },
  creditBadge: {
    backgroundColor: theme.success,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  creditBadgeText: {
    fontSize: 12,
    color: theme.textPrimary,
    fontWeight: 'bold',
  },
  stickyHeaderContainer: {
    backgroundColor: theme.card,
    borderBottomWidth: 1,
    borderBottomColor: theme.surface,
  },
  searchFilterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 10,
  },
  searchBarWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.surface,
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 42,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchBar: {
    flex: 1,
    color: theme.textPrimary,
    fontSize: 14,
    height: '100%',
  },
  clearSearchBtn: {
    padding: 4,
  },
  filterButton: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  filterButtonActive: {
    backgroundColor: theme.primary,
  },
  filterActiveDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.danger,
  },
  layoutToggleContainer: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  singleToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: theme.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.cardBorder,
  },
  singleToggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  singleToggleText: {
    fontSize: 13,
    color: theme.textPrimary,
    fontWeight: '600',
  },
  toggleBadge: {
    backgroundColor: theme.primaryLight || theme.card,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  toggleBadgeText: {
    fontSize: 11,
    color: theme.primary,
    fontWeight: '700',
  },
  sectionHeaderContainer: {
    backgroundColor: theme.primaryLight,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.primaryLight,
    borderTopWidth: 1,
    borderTopColor: theme.cardBorder,
  },
  sectionHeaderTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: theme.primary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  shortCard: {
    backgroundColor: theme.card,
    borderRadius: 14,
    marginHorizontal: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: theme.cardBorder,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  shortCardExpanded: {
    borderColor: theme.primaryLight || theme.cardBorder,
    shadowColor: theme.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 5,
  },
  shortCardAccentStrip: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    zIndex: 2,
  },
  shortCoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    paddingLeft: 16,
    justifyContent: 'space-between',
  },
  shortCoreRowExpanded: {
    backgroundColor: theme.surface,
  },
  shortDateContainer: {
    backgroundColor: theme.surface,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  shortDateText: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.textSecondary,
    textTransform: 'uppercase',
  },
  shortCenterContent: {
    flex: 1,
    marginRight: 8,
    justifyContent: 'center',
  },
  shortTitleText: {
    fontSize: 15,
    fontWeight: '600',
    color: theme.textPrimary,
    lineHeight: 20,
  },
  shortSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  shortCategorySubText: {
    fontSize: 12,
    color: theme.textMuted,
    fontWeight: '500',
  },
  shortEventSubText: {
    fontSize: 12,
    color: theme.primary,
    fontWeight: '600',
  },
  shortRightContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  shortAmountWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 6,
  },
  shortAmountText: {
    fontSize: 15,
    fontWeight: '700',
    color: theme.textPrimary,
  },
  shortChevron: {
    paddingLeft: 2,
  },
  shortExpandedDetails: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    paddingTop: 4,
    backgroundColor: theme.card,
  },
  expandedDivider: {
    height: 1,
    backgroundColor: theme.cardBorder,
    marginBottom: 12,
    opacity: 0.7,
  },
  expandedMetaStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  metaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.surface,
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.cardBorder,
  },
  eventMetaBadge: {
    backgroundColor: theme.primaryLight || theme.surface,
    borderColor: theme.primaryLight || theme.cardBorder,
  },
  metaBadgeText: {
    fontSize: 12,
    color: theme.textSecondary,
    fontWeight: '500',
  },
  remarkBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: theme.surface,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.cardBorder,
    marginBottom: 12,
  },
  remarkBoxIcon: {
    marginRight: 8,
    marginTop: 1,
  },
  remarkBoxText: {
    flex: 1,
    fontSize: 13,
    color: theme.textPrimary,
    lineHeight: 18,
  },
  splitBreakdownCard: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.cardBorder,
    padding: 12,
    marginBottom: 12,
  },
  splitHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  splitHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  splitHeaderTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.textPrimary,
  },
  splitStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  settledStatusBadge: {
    backgroundColor: '#DCFCE7',
  },
  unsettledStatusBadge: {
    backgroundColor: '#FEF3C7',
  },
  splitStatusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  splitMetricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: theme.card,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 4,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: theme.cardBorder,
  },
  splitMetricItem: {
    alignItems: 'center',
    flex: 1,
  },
  splitMetricLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: theme.textMuted,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  splitMetricValue: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.textPrimary,
  },
  splitMetricDivider: {
    width: 1,
    height: 24,
    backgroundColor: theme.cardBorder,
  },
  participantsSection: {
    marginBottom: 10,
  },
  participantsSectionTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: theme.textMuted,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  participantPillsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  participantPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  participantPillPaid: {
    backgroundColor: theme.card,
    borderColor: '#10B98140',
  },
  participantPillUnpaid: {
    backgroundColor: theme.card,
    borderColor: '#F59E0B40',
  },
  participantPillName: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.textPrimary,
  },
  participantPillAmount: {
    fontSize: 12,
    fontWeight: '500',
    color: theme.textSecondary,
  },
  manageSplitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: theme.primaryLight || theme.card,
    borderWidth: 1,
    borderColor: theme.primaryLight || theme.cardBorder,
    marginTop: 2,
  },
  manageSplitButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.primary,
  },
  personalSummaryCard: {
    backgroundColor: theme.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.cardBorder,
    padding: 10,
    marginBottom: 12,
  },
  personalSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  personalSummaryLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.textPrimary,
  },
  personalSummaryValue: {
    fontSize: 14,
    fontWeight: '700',
    color: theme.primary,
  },
  shortActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    paddingTop: 4,
  },
  shortActionEditBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.cardBorder,
  },
  shortActionEditText: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.textPrimary,
  },
  shortActionDeleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: theme.dangerSurface,
    borderWidth: 1,
    borderColor: theme.danger + '30',
  },
  shortActionDeleteText: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.danger,
  },
  bottomSheetContent: {
    backgroundColor: getSolidColor(theme.card, mode === 'dark' ? '#1A202C' : '#FFFFFF'),
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
    paddingBottom: 20,
    borderWidth: 1,
    borderColor: theme.cardBorder,
  },
  modalScrollView: {
    flexGrow: 1,
  },
  modalScrollContent: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 40,
  },
  filterSectionTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: theme.textSecondary,
    marginTop: 16,
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  modalChipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  filterSubSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  modalChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.cardBorder,
    backgroundColor: getSolidColor(theme.surface, mode === 'dark' ? '#242C3D' : '#F4F5F7'),
  },
  modalChipActive: {
    backgroundColor: theme.primary,
    borderColor: theme.primary,
  },
  modalChipText: {
    fontSize: 12,
    color: theme.textSecondary,
    fontWeight: '500',
  },
  modalChipTextActive: {
    color: theme.card,
    fontWeight: 'bold',
  },
  dateRangeContainer: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
    marginBottom: 8,
  },
  datePickerInputGroup: {
    flex: 1,
  },
  datePickerLabel: {
    fontSize: 11,
    fontWeight: 'bold',
    color: theme.textMuted,
    marginBottom: 4,
  },
  dateRowWithClear: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dateButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: getSolidColor(theme.surface, mode === 'dark' ? '#242C3D' : '#F4F5F7'),
    borderWidth: 1,
    borderColor: theme.cardBorder,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  dateButtonText: {
    fontSize: 13,
    color: theme.textPrimary,
  },
  clearDateIcon: {
    padding: 4,
  },
  modalStickyFooter: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: theme.surface,
    backgroundColor: getSolidColor(theme.card, mode === 'dark' ? '#1A202C' : '#FFFFFF'),
  },
  clearAllFiltersBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearAllFiltersText: {
    fontSize: 14,
    color: theme.textSecondary,
    fontWeight: '600',
  },
  applyFiltersBtn: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: theme.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  applyFiltersText: {
    fontSize: 14,
    color: theme.card,
    fontWeight: 'bold',
  },
});
