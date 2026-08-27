import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Switch, Alert, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useExpenses } from '../contexts/ExpenseContext';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/types';
import { ExpenseLog, SplitParticipant, PaymentMode } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { format } from 'date-fns';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheetSelector } from './BottomSheetSelector';

interface FormParticipant extends SplitParticipant {
  shareAmountText: string;
}

interface ExpenseFormProps {
  initialData?: ExpenseLog;
  onSubmit: (expense: ExpenseLog) => Promise<void>;
  submitButtonText?: string;
}

export const ExpenseForm: React.FC<ExpenseFormProps> = ({ initialData, onSubmit, submitButtonText = "Save Expense" }) => {
  const { theme, mode } = useTheme();
  const styles = getStyles(theme);

  const { categories, regularMembers, events, activeEvent } = useExpenses();
  
  const [amount, setAmount] = useState(initialData?.totalAmount ? initialData.totalAmount.toString() : '');
  const [paymentMode, setPaymentMode] = useState<PaymentMode | undefined>(initialData?.paymentMode);
  const [eventId, setEventId] = useState<string | undefined>(initialData?.eventId || activeEvent?.id);
  const [userChangedEvent, setUserChangedEvent] = useState(false);
  const [showEventSelector, setShowEventSelector] = useState(false);
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [newEventName, setNewEventName] = useState('');
  const { addEvent } = useExpenses();

  const eventOptions = [
    { label: 'None (Overall)', value: 'none' },
    ...events.map(e => ({ label: e.name, value: e.id }))
  ];
  const selectedEventLabel = eventId ? events.find(e => e.id === eventId)?.name || 'None (Overall)' : 'None (Overall)';

  const initialCat = initialData?.category;
  let startCat = categories.length > 0 ? categories[0] : '';
  let startCustom = '';

  if (initialCat) {
    if (categories.includes(initialCat)) {
      startCat = initialCat;
    } else {
      startCat = 'Others';
      startCustom = initialCat;
    }
  }

  const [category, setCategory] = useState<string>(startCat);
  const [customCategory, setCustomCategory] = useState<string>(startCustom);
  
  React.useEffect(() => {
    if (!category && categories.length > 0) {
      setCategory(categories[0]);
    }
  }, [categories, category]);

  React.useEffect(() => {
    if (!initialData && !userChangedEvent) {
      setEventId(activeEvent?.id);
    }
  }, [activeEvent, initialData, userChangedEvent]);

  const getRoundedTime = () => {
    const now = new Date();
    const minutes = now.getMinutes();
    const roundedMinutes = Math.round(minutes / 15) * 15;
    now.setMinutes(roundedMinutes);
    now.setSeconds(0);
    now.setMilliseconds(0);
    return now;
  };

  const initialDateObj = initialData ? new Date(initialData.expenseDate) : getRoundedTime();
  const initialHasTime = initialData ? initialData.expenseDate.includes('T') : true;

  const [remark, setRemark] = useState(initialData?.remark || '');
  const [dateObj, setDateObj] = useState(initialDateObj);
  const [hasTime, setHasTime] = useState(initialHasTime);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  const onChangeDate = (event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
    }
    if (event.type === 'set' && selectedDate) {
      const newDate = new Date(dateObj);
      newDate.setFullYear(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
      setDateObj(newDate);
    }
  };

  const onChangeTime = (event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowTimePicker(false);
    }
    if (event.type === 'set' && selectedDate) {
      const newDate = new Date(dateObj);
      newDate.setHours(selectedDate.getHours(), selectedDate.getMinutes());
      setDateObj(newDate);
      setHasTime(true);
    }
  };

  const [isSplit, setIsSplit] = useState(initialData?.isSplit || false);
  const [participants, setParticipants] = useState<FormParticipant[]>(
    (initialData?.splitDetails?.participants || []).map(p => ({
      ...p,
      shareAmountText: p.isCustomShare ? p.shareAmount.toString() : ''
    }))
  );

  const handleAddParticipant = () => {
    setParticipants([...participants, { id: uuidv4(), name: '', shareAmount: 0, hasPaid: false, shareAmountText: '' }]);
  };

  const updateParticipant = (id: string, field: keyof FormParticipant, value: any) => {
    setParticipants(participants.map(p => p.id === id ? { ...p, [field]: value } : p));
  };

  const removeParticipant = (id: string) => {
    setParticipants(participants.filter(p => p.id !== id));
  };

  const [isMembersExpanded, setIsMembersExpanded] = useState(false);
  const [membersSearchQuery, setMembersSearchQuery] = useState('');

  const maxVisibleCollapsed = 8;
  const showSeeMore = regularMembers.length > maxVisibleCollapsed;
  const displayedMembers = isMembersExpanded 
    ? regularMembers.filter(m => m.toLowerCase().includes(membersSearchQuery.toLowerCase()))
    : regularMembers.slice(0, maxVisibleCollapsed);

  const numAmount = parseFloat(amount) || 0;
  const customParticipants = participants.filter(p => p.shareAmountText.trim() !== '');
  const customTotal = customParticipants.reduce((sum, p) => sum + (parseFloat(p.shareAmountText) || 0), 0);
  const remainingTotal = numAmount - customTotal;
  const equalCount = participants.filter(p => p.shareAmountText.trim() === '').length + 1;
  const equalShare = remainingTotal > 0 ? remainingTotal / equalCount : 0;
  const isOverSplit = remainingTotal < 0;

  const handleSave = async () => {
    const numAmt = parseFloat(amount);
    if (isNaN(numAmt) || numAmt <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid amount.');
      return;
    }

    const parsedAmount = parseFloat(amount) || 0;
    let myShare = parsedAmount;
    let isSettled = true;
    let finalParticipants: SplitParticipant[] = [];

    if (isSplit) {
      const currentCustomTotal = participants.filter(p => p.shareAmountText.trim() !== '').reduce((sum, p) => sum + (parseFloat(p.shareAmountText) || 0), 0);
      if (parsedAmount - currentCustomTotal < 0) {
        Alert.alert('Invalid Split', 'Total custom shares exceed the transaction amount.');
        return;
      }
      
      const currentEqualCount = participants.filter(p => p.shareAmountText.trim() === '').length + 1;
      const eqShare = (parsedAmount - currentCustomTotal) / currentEqualCount;
      myShare = eqShare;

      finalParticipants = participants.map(p => {
        const isCustom = p.shareAmountText.trim() !== '';
        return {
          id: p.id,
          name: p.name,
          hasPaid: p.hasPaid,
          isCustomShare: isCustom,
          shareAmount: isCustom ? (parseFloat(p.shareAmountText) || 0) : eqShare
        };
      });
      isSettled = finalParticipants.every(p => p.hasPaid);
    }

    const finalDate = hasTime ? dateObj.toISOString() : dateObj.toISOString().split('T')[0];
    const finalCategory = category === 'Others' && customCategory.trim() !== '' ? customCategory.trim() : category;

    const newExpense: ExpenseLog = {
      id: initialData?.id || uuidv4(),
      expenseDate: finalDate,
      createdAt: initialData?.createdAt || new Date().toISOString(),
      category: finalCategory,
      totalAmount: parsedAmount,
      myShare,
      remark: remark.trim() || undefined,
      paymentMode,
      isSplit,
      eventId,
      ...(isSplit && {
        splitDetails: {
          isSettled,
          participants: finalParticipants
        }
      })
    };

    await onSubmit(newExpense);
    
    // Only reset if it's not an edit form
    if (!initialData) {
      setAmount('');
      setPaymentMode(undefined);
      setRemark('');
      setIsSplit(false);
      setParticipants([]);
      setDateObj(getRoundedTime());
      setHasTime(true);
      setEventId(activeEvent?.id);
      setUserChangedEvent(false);
    }
  };

  const handleCreateEvent = async () => {
    const name = newEventName.trim();
    if (!name) {
      setShowAddEvent(false);
      return;
    }
    if (events.some(e => e.name.toLowerCase() === name.toLowerCase())) {
      Alert.alert('Error', 'An event with this name already exists.');
      return;
    }
    const newEvId = uuidv4();
    await addEvent({
      id: newEvId,
      name,
      startDate: format(new Date(), 'yyyy-MM-dd'),
      isActive: true
    });
    setEventId(newEvId);
    setNewEventName('');
    setShowAddEvent(false);
  };

  return (
    <View style={styles.card}>
      {!initialData && <Text style={styles.cardTitle}>Quick Add</Text>}
      
      <TextInput
        style={styles.input}
        placeholder="Amount"
        placeholderTextColor={theme.textMuted}
        keyboardType="numeric"
        value={amount}
        onChangeText={setAmount}
      />

      <Text style={styles.label}>Session/Group</Text>
      
      {!showAddEvent ? (
        <View style={styles.eventSelectorRow}>
          <TouchableOpacity 
            style={[styles.input, styles.flex1, { marginBottom: 0 }]} 
            onPress={() => setShowEventSelector(true)}
            activeOpacity={0.7}
          >
            <Text style={{ color: theme.textPrimary }}>{selectedEventLabel}</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.addEventIconBtn} 
            onPress={() => setShowAddEvent(true)}
          >
            <Ionicons name="add-circle" size={28} color={theme.primary} />
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.eventSelectorRow}>
          <TextInput
            style={[styles.input, styles.flex1, { marginBottom: 0 }]}
            placeholder="New Session Name"
            placeholderTextColor={theme.textMuted}
            value={newEventName}
            onChangeText={setNewEventName}
            autoFocus
          />
          <TouchableOpacity 
            style={styles.addEventSaveBtn} 
            onPress={handleCreateEvent}
          >
            <Ionicons name="checkmark-circle" size={28} color={theme.success} />
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.addEventCancelBtn} 
            onPress={() => setShowAddEvent(false)}
          >
            <Ionicons name="close-circle" size={28} color={theme.danger} />
          </TouchableOpacity>
        </View>
      )}
      <View style={{ height: 12 }} />
      
      <BottomSheetSelector
        visible={showEventSelector}
        onClose={() => setShowEventSelector(false)}
        title="Select Session/Group"
        data={eventOptions}
        selectedValue={eventId || 'none'}
        onSelect={(val) => {
          setEventId(val === 'none' ? undefined : val);
          setUserChangedEvent(true);
        }}
      />

      <Text style={styles.label}>Payment Mode</Text>
      <View style={styles.chipContainer}>
        {['Cash', 'UPI', 'Card'].map((mode) => (
          <TouchableOpacity 
            key={mode} 
            style={[styles.chip, paymentMode === mode && styles.chipActive]}
            onPress={() => setPaymentMode(paymentMode === mode ? undefined : mode as PaymentMode)}
          >
            <Text style={[styles.chipText, paymentMode === mode && styles.chipTextActive]}>{mode}</Text>
          </TouchableOpacity>
        ))}
      </View>
      
      <View style={styles.dateTimeRow}>
        <TouchableOpacity 
          style={[styles.input, styles.dateInput]} 
          onPress={() => setShowDatePicker(true)}
          activeOpacity={0.7}
        >
          <Text style={{ color: theme.textPrimary }}>
            {format(dateObj, 'yyyy-MM-dd')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.input, styles.timeInput]} 
          onPress={() => setShowTimePicker(true)}
          activeOpacity={0.7}
        >
          <Text style={{ color: hasTime ? theme.textPrimary : theme.textMuted, flex: 1 }}>
            {hasTime ? format(dateObj, 'hh:mm a') : "Time (Opt)"}
          </Text>
          {hasTime && (
            <TouchableOpacity onPress={() => setHasTime(false)} style={styles.clearTimeBtn}>
              <Ionicons name="close-circle" size={18} color={theme.textMuted} />
            </TouchableOpacity>
          )}
        </TouchableOpacity>
      </View>

      {showDatePicker && (
        <DateTimePicker
          testID="dateTimePicker"
          value={dateObj}
          mode="date"
          is24Hour={true}
          display="default"
          onChange={onChangeDate}
          themeVariant={mode}
        />
      )}
      
      {showTimePicker && (
        <DateTimePicker
          testID="timePicker"
          value={dateObj}
          mode="time"
          is24Hour={false}
          minuteInterval={5}
          display="default"
          onChange={onChangeTime}
          themeVariant={mode}
        />
      )}

      <TextInput
        style={styles.input}
        placeholder="Remarks (Optional)"
        placeholderTextColor={theme.textMuted}
        value={remark}
        onChangeText={setRemark}
      />

      <Text style={styles.label}>Category</Text>
      <View style={styles.chipContainer}>
        {categories.map(c => (
          <TouchableOpacity 
            key={c} 
            style={[styles.chip, category === c && styles.chipActive]}
            onPress={() => setCategory(c)}
          >
            <Text style={[styles.chipText, category === c && styles.chipTextActive]}>{c}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {category === 'Others' && (
        <TextInput
          style={[styles.input, styles.customCategoryInput]}
          placeholder="Enter custom category"
          placeholderTextColor={theme.textMuted}
          value={customCategory}
          onChangeText={setCustomCategory}
        />
      )}

      <View style={styles.switchRow}>
        <Text style={styles.label}>Split Transaction?</Text>
        <Switch 
          value={isSplit} 
          onValueChange={setIsSplit} 
          trackColor={{ false: theme.cardBorder, true: theme.primaryLight }}
          thumbColor={isSplit ? theme.primary : theme.textMuted}
        />
      </View>

      {isSplit && (
        <View style={styles.splitContainer}>
          <Text style={[
            styles.computedShareText, 
            isOverSplit && { color: theme.danger }
          ]}>
            My Share: ₹{equalShare.toFixed(2)}
          </Text>

          {regularMembers.length > 0 && (
            <View>
              <Text style={styles.label}>Add from Regular Members:</Text>
              
              {isMembersExpanded && (
                <TextInput
                  style={[styles.input, styles.searchInput]}
                  placeholder="Search members..."
                  placeholderTextColor={theme.textMuted}
                  value={membersSearchQuery}
                  onChangeText={setMembersSearchQuery}
                />
              )}

              <View style={styles.chipContainer}>
                {displayedMembers.map(m => {
                  const isAdded = participants.some(p => p.name === m);
                  return (
                    <TouchableOpacity 
                      key={m} 
                      style={[styles.chip, isAdded && styles.chipActive]}
                      onPress={() => {
                        if (isAdded) {
                          setParticipants(participants.filter(p => p.name !== m));
                        } else {
                          setParticipants([...participants, { id: uuidv4(), name: m, shareAmount: 0, hasPaid: false, shareAmountText: '' }]);
                        }
                      }}
                    >
                      <Text style={[styles.chipText, isAdded && styles.chipTextActive]}>{m}</Text>
                    </TouchableOpacity>
                  );
                })}
                
                {!isMembersExpanded && showSeeMore && (
                  <TouchableOpacity 
                    style={[styles.chip, styles.seeMoreChip]}
                    onPress={() => setIsMembersExpanded(true)}
                  >
                    <Text style={styles.seeMoreChipText}>See More...</Text>
                  </TouchableOpacity>
                )}
              </View>
              
              {isMembersExpanded && (
                <TouchableOpacity 
                  style={styles.seeLessBtn}
                  onPress={() => {
                    setIsMembersExpanded(false);
                    setMembersSearchQuery('');
                  }}
                >
                  <Text style={styles.seeLessText}>Show Less</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {participants.map((p, index) => (
            <View key={p.id} style={styles.participantRow}>
              <TextInput
                style={[styles.input, styles.flex2]}
                placeholder="Name"
                placeholderTextColor={theme.textMuted}
                value={p.name}
                onChangeText={(val) => updateParticipant(p.id, 'name', val)}
              />
              <TextInput
                style={[styles.input, styles.flex1]}
                placeholder={`Equal: ₹${equalShare.toFixed(2)}`}
                placeholderTextColor={theme.textMuted}
                keyboardType="numeric"
                value={p.shareAmountText}
                onChangeText={(val) => updateParticipant(p.id, 'shareAmountText', val)}
              />
              <TouchableOpacity onPress={() => removeParticipant(p.id)} style={styles.deleteBtn}>
                <Text style={styles.deleteBtnText}>X</Text>
              </TouchableOpacity>
            </View>
          ))}
          <TouchableOpacity style={styles.addParticipantBtn} onPress={handleAddParticipant}>
            <Text style={styles.addParticipantText}>+ Add Person</Text>
          </TouchableOpacity>
        </View>
      )}

      <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
        <Text style={styles.saveBtnText}>{submitButtonText}</Text>
      </TouchableOpacity>
    </View>
  );
};

const getStyles = (theme: ThemeColors) => StyleSheet.create({
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
  cardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
    color: theme.textPrimary,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.cardBorder,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    backgroundColor: theme.background,
    color: theme.textPrimary,
  },
  dateTimeRow: {
    flexDirection: 'row',
    gap: 12,
  },
  dateInput: {
    flex: 1,
  },
  timeInput: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  clearTimeBtn: {
    padding: 2,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.textSecondary,
    marginBottom: 8,
    marginTop: 4,
  },
  chipContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 16,
  },
  chip: {
    backgroundColor: theme.surface,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    marginRight: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: theme.cardBorder,
  },
  chipActive: {
    backgroundColor: theme.primary,
    borderColor: theme.primary,
  },
  chipText: {
    color: theme.textSecondary,
    fontSize: 12,
  },
  chipTextActive: {
    color: '#FFF',
    fontWeight: 'bold',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  splitContainer: {
    backgroundColor: theme.surface,
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  participantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  flex1: {
    flex: 1,
    marginBottom: 0,
    marginRight: 8,
  },
  flex2: {
    flex: 2,
    marginBottom: 0,
    marginRight: 8,
  },
  customToggleContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  customToggleLabel: {
    fontSize: 10,
    color: theme.textMuted,
    marginBottom: 2,
  },
  disabledInput: {
    backgroundColor: theme.surface,
    justifyContent: 'center',
    marginBottom: 0,
  },
  disabledText: {
    color: theme.textMuted,
    fontSize: 14,
  },
  computedShareText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: theme.textPrimary,
    marginBottom: 12,
    textAlign: 'center',
  },
  deleteBtn: {
    backgroundColor: theme.dangerSurface,
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 16,
  },
  deleteBtnText: {
    color: theme.danger,
    fontWeight: 'bold',
  },
  addParticipantBtn: {
    alignItems: 'center',
    padding: 8,
  },
  addParticipantText: {
    color: theme.primary,
    fontWeight: 'bold',
  },
  customCategoryInput: {
    marginTop: -8,
    marginBottom: 16,
    backgroundColor: theme.surface,
  },
  searchInput: {
    marginBottom: 12,
    paddingVertical: 8,
    backgroundColor: theme.surface,
  },
  seeMoreChip: {
    backgroundColor: theme.surface,
  },
  seeMoreChipText: {
    color: theme.textSecondary,
    fontWeight: 'bold',
    fontSize: 12,
  },
  seeLessBtn: {
    alignItems: 'center',
    marginBottom: 16,
    marginTop: -8,
  },
  seeLessText: {
    color: theme.textSecondary,
    fontWeight: 'bold',
    fontSize: 12,
  },
  saveBtn: {
    backgroundColor: theme.success,
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  saveBtnText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 16,
  },
  eventSelectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  addEventIconBtn: {
    marginLeft: 12,
  },
  addEventSaveBtn: {
    marginLeft: 12,
  },
  addEventCancelBtn: {
    marginLeft: 8,
  }
});
