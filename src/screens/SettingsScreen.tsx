import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, TextInput, Switch, Modal, ScrollView, Platform } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { useExpenses } from '../contexts/ExpenseContext';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons } from '@expo/vector-icons';
import { v4 as uuidv4 } from 'uuid';
import { format } from 'date-fns';
import { StorageService } from '../services/StorageService';
import { FullAppBackup } from '../types';

interface SettingsRowProps {
  icon: string;
  title: string;
  subtitle: string;
  onPress: () => void;
  isDanger?: boolean;
}

const SettingsRow: React.FC<SettingsRowProps> = ({ icon, title, subtitle, onPress, isDanger }) => {
  return (
    <TouchableOpacity style={styles.rowItem} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.rowLeft}>
        <Ionicons name={icon as any} size={22} color={isDanger ? '#E53E3E' : '#4A5568'} style={styles.rowIcon} />
        <View style={styles.rowTextContainer}>
          <Text style={[styles.rowTitle, isDanger && styles.rowTitleDanger]}>{title}</Text>
          <Text style={styles.rowSubtitle}>{subtitle}</Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={isDanger ? '#E53E3E' : '#A0AEC0'} />
    </TouchableOpacity>
  );
};

export const SettingsScreen = () => {
  const {
    expenses, importBackup, categories, addCategory, deleteCategory,
    regularMembers, addRegularMember, deleteRegularMember,
    events, addEvent, updateEvent, deleteEvent, clearAllData
  } = useExpenses();
  const [newCategory, setNewCategory] = useState('');
  const [newMember, setNewMember] = useState('');
  const [newEventName, setNewEventName] = useState('');
  const [activeModal, setActiveModal] = useState<'BACKUP' | 'EVENTS' | 'CATEGORIES' | 'MEMBERS' | null>(null);

  const handleExport = async () => {
    try {
      const [allExpenses, allEvents, allWallets, allCategories, allMembers] = await Promise.all([
        StorageService.getAllExpenses(),
        StorageService.getAllEvents(),
        StorageService.loadWallets(),
        StorageService.getAllCategories(),
        StorageService.getAllRegularMembers(),
      ]);

      const backupData: FullAppBackup = {
        backupVersion: '1.0.0',
        exportedAt: new Date().toISOString(),
        expenses: allExpenses,
        events: allEvents,
        wallets: allWallets,
        categories: allCategories,
        regularMembers: allMembers,
      };

      const dataStr = JSON.stringify(backupData, null, 2);
      const fileUri = `${FileSystem.documentDirectory}expense_backup.json`;

      await FileSystem.writeAsStringAsync(fileUri, dataStr, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'application/json',
          dialogTitle: 'Export Expense Data',
        });
      } else {
        Alert.alert('Error', 'Sharing is not available on this device');
      }
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'Failed to export data.');
    }
  };

  const handleImport = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      const file = result.assets[0];
      const contents = await FileSystem.readAsStringAsync(file.uri);

      const parsedData = JSON.parse(contents);

      const isValidLegacy = Array.isArray(parsedData);
      const isValidNew = parsedData && typeof parsedData === 'object' && 'expenses' in parsedData;

      if (!isValidLegacy && !isValidNew) {
        throw new Error('Invalid backup format');
      }

      Alert.alert(
        'Confirm Import',
        'Importing data will merge new entries and update matching historical records. Do you want to proceed?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Import',
            onPress: async () => {
              await importBackup(parsedData);
              Alert.alert('Success', 'Data imported successfully!');
            }
          }
        ]
      );
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'Failed to import data. Please ensure it is a valid JSON backup file.');
    }
  };

  const handlePurgeData = () => {
    Alert.alert(
      'Delete Everything?',
      'Are you sure you want to delete all application data?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Final Warning',
              'Final Warning: This will permanently wipe your Expenses, Travel Events, and Wallets. If you haven\'t exported a backup, your data is gone forever. Proceed?',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Proceed',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await clearAllData();
                      Alert.alert('Success', 'App database successfully reset.');
                    } catch (err) {
                      console.error(err);
                      Alert.alert('Error', 'Failed to reset database.');
                    }
                  }
                }
              ]
            );
          }
        }
      ]
    );
  };

  const handleAddCategory = async () => {
    const cat = newCategory.trim();
    if (!cat) return;
    if (categories.includes(cat)) {
      Alert.alert('Error', 'Category already exists.');
      return;
    }
    await addCategory(cat);
    setNewCategory('');
  };

  const handleDeleteCategory = (cat: string) => {
    if (categories.length <= 1) {
      Alert.alert('Error', 'You must have at least one category.');
      return;
    }
    Alert.alert('Confirm Delete', `Delete category "${cat}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteCategory(cat) }
    ]);
  };

  const handleAddMember = async () => {
    const member = newMember.trim();
    if (!member) return;
    if (regularMembers.includes(member)) {
      Alert.alert('Error', 'Member already exists.');
      return;
    }
    await addRegularMember(member);
    setNewMember('');
  };

  const handleDeleteMember = (member: string) => {
    Alert.alert('Confirm Delete', `Delete regular member "${member}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteRegularMember(member) }
    ]);
  };

  const handleAddEvent = async () => {
    const name = newEventName.trim();
    if (!name) return;
    if (events.some(e => e.name.toLowerCase() === name.toLowerCase())) {
      Alert.alert('Error', 'An event with this name already exists.');
      return;
    }

    await addEvent({
      id: uuidv4(),
      name,
      startDate: format(new Date(), 'yyyy-MM-dd'),
      isActive: false
    });
    setNewEventName('');
  };

  const handleDeleteEvent = (id: string, name: string) => {
    Alert.alert('Confirm Delete', `Delete event "${name}"? Expenses tied to it will lose their tag.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteEvent(id) }
    ]);
  };

  const handleToggleActiveEvent = async (id: string) => {
    const ev = events.find(e => e.id === id);
    if (ev) {
      await updateEvent({ ...ev, isActive: !ev.isActive });
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
    >
      <Text style={styles.sectionHeader}>Data Management</Text>
      <View style={styles.card}>
        <SettingsRow
          icon="cloud-upload-outline"
          title="Backup & Restore"
          subtitle="Export to JSON or restore from backup file"
          onPress={() => setActiveModal('BACKUP')}
        />
      </View>

      <Text style={styles.sectionHeader}>Customization & Lists</Text>
      <View style={styles.card}>
        <SettingsRow
          icon="calendar-outline"
          title="Manage Events & Sessions"
          subtitle="Configure tracking groups or active travel trips"
          onPress={() => setActiveModal('EVENTS')}
        />
        <View style={styles.rowDivider} />
        <SettingsRow
          icon="pricetag-outline"
          title="Customize Categories"
          subtitle="Add or remove transaction category tags"
          onPress={() => setActiveModal('CATEGORIES')}
        />
        <View style={styles.rowDivider} />
        <SettingsRow
          icon="people-outline"
          title="Regular Members"
          subtitle="Manage default participants for split tracking"
          onPress={() => setActiveModal('MEMBERS')}
        />
      </View>

      <Text style={styles.sectionHeader}>System Settings</Text>
      <View style={styles.card}>
        <SettingsRow
          icon="trash-bin-outline"
          title="Purge All Data"
          subtitle="Permanently wipe all application states"
          onPress={handlePurgeData}
          isDanger={true}
        />
      </View>

      {/* Modal A: Backup & Restore */}
      <Modal
        visible={activeModal === 'BACKUP'}
        animationType="slide"
        onRequestClose={() => setActiveModal(null)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setActiveModal(null)} style={styles.modalCloseButton}>
              <Ionicons name="arrow-back" size={24} color="#2D3748" />
            </TouchableOpacity>
            <Text style={styles.modalHeaderTitle}>Backup & Restore</Text>
            <View style={{ width: 24 }} />
          </View>
          <ScrollView contentContainerStyle={styles.modalContent}>
            <Text style={styles.description}>
              Backup your expenses to a local JSON file or restore from an existing backup. Since this app works entirely offline, please keep your backups safe!
            </Text>

            <TouchableOpacity style={styles.button} onPress={handleExport}>
              <Ionicons name="download-outline" size={24} color="#FFF" style={styles.icon} />
              <Text style={styles.buttonText}>Export Data</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.button, styles.importButton]} onPress={handleImport}>
              <Ionicons name="folder-open-outline" size={24} color="#FFF" style={styles.icon} />
              <Text style={styles.buttonText}>Import Data</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      {/* Modal B: Events & Sessions */}
      <Modal
        visible={activeModal === 'EVENTS'}
        animationType="slide"
        onRequestClose={() => setActiveModal(null)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setActiveModal(null)} style={styles.modalCloseButton}>
              <Ionicons name="arrow-back" size={24} color="#2D3748" />
            </TouchableOpacity>
            <Text style={styles.modalHeaderTitle}>Events & Sessions</Text>
            <View style={{ width: 24 }} />
          </View>
          <KeyboardAwareScrollView
            contentContainerStyle={styles.modalContent}
            enableOnAndroid={true}
            extraScrollHeight={120}
            extraHeight={120}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.description}>
              Create tracking sessions for specific trips or events. Only ONE event can be active at a time. The active event will be selected by default when adding new expenses.
            </Text>

            <View style={styles.addCategoryContainer}>
              <TextInput
                style={styles.categoryInput}
                placeholder="e.g. Goa Trip 2026"
                value={newEventName}
                onChangeText={setNewEventName}
              />
              <TouchableOpacity style={styles.addCategoryBtn} onPress={handleAddEvent}>
                <Text style={styles.addCategoryBtnText}>Add</Text>
              </TouchableOpacity>
            </View>

            {events.length > 0 && (
              <View style={styles.categoryList}>
                {events.map(ev => (
                  <View key={ev.id} style={styles.eventRow}>
                    <View style={styles.eventInfo}>
                      <Text style={styles.categoryRowText}>{ev.name}</Text>
                      <Text style={styles.eventDateText}>Created: {ev.startDate}</Text>
                    </View>
                    <View style={styles.eventActions}>
                      <View style={styles.switchContainer}>
                        <Text style={styles.switchLabel}>{ev.isActive ? 'Active' : 'Inactive'}</Text>
                        <Switch
                          value={ev.isActive}
                          onValueChange={() => handleToggleActiveEvent(ev.id)}
                        />
                      </View>
                      <TouchableOpacity onPress={() => handleDeleteEvent(ev.id, ev.name)} style={styles.deleteCategoryBtn}>
                        <Ionicons name="trash-outline" size={20} color="#E53E3E" />
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </KeyboardAwareScrollView>
        </View>
      </Modal>

      {/* Modal C: Customize Categories */}
      <Modal
        visible={activeModal === 'CATEGORIES'}
        animationType="slide"
        onRequestClose={() => setActiveModal(null)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setActiveModal(null)} style={styles.modalCloseButton}>
              <Ionicons name="arrow-back" size={24} color="#2D3748" />
            </TouchableOpacity>
            <Text style={styles.modalHeaderTitle}>Customize Categories</Text>
            <View style={{ width: 24 }} />
          </View>
          <KeyboardAwareScrollView
            contentContainerStyle={styles.modalContent}
            enableOnAndroid={true}
            extraScrollHeight={120}
            extraHeight={120}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.description}>
              Add or remove categories for your expenses. You must keep at least one category.
            </Text>

            <View style={styles.addCategoryContainer}>
              <TextInput
                style={styles.categoryInput}
                placeholder="New category name"
                value={newCategory}
                onChangeText={setNewCategory}
              />
              <TouchableOpacity style={styles.addCategoryBtn} onPress={handleAddCategory}>
                <Text style={styles.addCategoryBtnText}>Add</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.categoryList}>
              {categories.map(c => (
                <View key={c} style={styles.categoryRow}>
                  <Text style={styles.categoryRowText}>{c}</Text>
                  <TouchableOpacity onPress={() => handleDeleteCategory(c)} style={styles.deleteCategoryBtn}>
                    <Ionicons name="trash-outline" size={20} color="#E53E3E" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </KeyboardAwareScrollView>
        </View>
      </Modal>

      {/* Modal D: Regular Members */}
      <Modal
        visible={activeModal === 'MEMBERS'}
        animationType="slide"
        onRequestClose={() => setActiveModal(null)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setActiveModal(null)} style={styles.modalCloseButton}>
              <Ionicons name="arrow-back" size={24} color="#2D3748" />
            </TouchableOpacity>
            <Text style={styles.modalHeaderTitle}>Regular Members</Text>
            <View style={{ width: 24 }} />
          </View>
          <KeyboardAwareScrollView
            contentContainerStyle={styles.modalContent}
            enableOnAndroid={true}
            extraScrollHeight={120}
            extraHeight={120}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.description}>
              Add regular members to quickly auto-populate split transactions.
            </Text>

            <View style={styles.addCategoryContainer}>
              <TextInput
                style={styles.categoryInput}
                placeholder="New member name"
                value={newMember}
                onChangeText={setNewMember}
              />
              <TouchableOpacity style={styles.addCategoryBtn} onPress={handleAddMember}>
                <Text style={styles.addCategoryBtnText}>Add</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.categoryList}>
              {regularMembers.map(m => (
                <View key={m} style={styles.categoryRow}>
                  <Text style={styles.categoryRowText}>{m}</Text>
                  <TouchableOpacity onPress={() => handleDeleteMember(m)} style={styles.deleteCategoryBtn}>
                    <Ionicons name="trash-outline" size={20} color="#E53E3E" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </KeyboardAwareScrollView>
        </View>
      </Modal>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 60,
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: '#718096',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
    marginTop: 16,
    marginLeft: 4,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  rowItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#FFFFFF',
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 16,
  },
  rowIcon: {
    marginRight: 12,
    width: 24,
    textAlign: 'center',
  },
  rowTextContainer: {
    flex: 1,
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2D3748',
  },
  rowTitleDanger: {
    color: '#E53E3E',
  },
  rowSubtitle: {
    fontSize: 12,
    color: '#718096',
    marginTop: 2,
  },
  rowDivider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginLeft: 52,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    ...Platform.select({
      ios: { paddingTop: 50 },
      android: { paddingTop: 16 },
    }),
  },
  modalHeaderTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2D3748',
  },
  modalCloseButton: {
    padding: 4,
  },
  modalContent: {
    padding: 16,
    paddingBottom: 80,
  },
  section: {
    marginBottom: 8,
  },
  divider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2D3748',
    marginBottom: 8,
  },
  description: {
    fontSize: 14,
    color: '#718096',
    marginBottom: 20,
    lineHeight: 20,
  },
  button: {
    flexDirection: 'row',
    backgroundColor: '#3182CE',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  importButton: {
    backgroundColor: '#4A5568',
  },
  icon: {
    marginRight: 8,
  },
  buttonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  addCategoryContainer: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  categoryInput: {
    flex: 1,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    padding: 12,
    marginRight: 12,
    fontSize: 16,
  },
  addCategoryBtn: {
    backgroundColor: '#48BB78',
    paddingHorizontal: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  addCategoryBtnText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 16,
  },
  categoryList: {
    backgroundColor: '#FFF',
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  categoryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  categoryRowText: {
    fontSize: 16,
    color: '#2D3748',
  },
  deleteCategoryBtn: {
    padding: 4,
    marginLeft: 12,
  },
  eventRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  eventInfo: {
    flex: 1,
  },
  eventDateText: {
    fontSize: 12,
    color: '#A0AEC0',
    marginTop: 2,
  },
  eventActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  switchContainer: {
    alignItems: 'center',
    marginRight: 8,
  },
  switchLabel: {
    fontSize: 10,
    color: '#718096',
    marginBottom: 2,
  },
  purgeButton: {
    flexDirection: 'row',
    backgroundColor: '#FFF5F5',
    borderWidth: 1,
    borderColor: '#FEB2B2',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  purgeButtonText: {
    color: '#E53E3E',
    fontSize: 16,
    fontWeight: 'bold',
  }
});