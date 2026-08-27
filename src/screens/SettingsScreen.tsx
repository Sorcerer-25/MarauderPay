import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, TextInput, Switch, Modal, ScrollView, Platform } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { useExpenses } from '../contexts/ExpenseContext';
import { useTheme } from '../theme/ThemeContext';
import { lightThemes, darkThemes } from '../theme/palettes';
import { ThemeColors } from '../theme/types';
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
  theme: ThemeColors;
}

const SettingsRow: React.FC<SettingsRowProps> = ({ icon, title, subtitle, onPress, isDanger, theme }) => {
  const styles = getStyles(theme);
  return (
    <TouchableOpacity style={styles.rowItem} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.rowLeft}>
        <Ionicons name={icon as any} size={22} color={isDanger ? theme.danger : theme.textSecondary} style={styles.rowIcon} />
        <View style={styles.rowTextContainer}>
          <Text style={[styles.rowTitle, isDanger && { color: theme.danger }]}>{title}</Text>
          <Text style={styles.rowSubtitle}>{subtitle}</Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={isDanger ? theme.danger : theme.textMuted} />
    </TouchableOpacity>
  );
};

export const SettingsScreen = () => {
  const { theme, mode, selectedLightThemeId, selectedDarkThemeId, setLightTheme, setDarkTheme } = useTheme();
  const styles = getStyles(theme);

  const {
    expenses, importBackup, categories, addCategory, deleteCategory,
    regularMembers, addRegularMember, deleteRegularMember,
    events, addEvent, updateEvent, deleteEvent, clearAllData
  } = useExpenses();
  const [newCategory, setNewCategory] = useState('');
  const [newMember, setNewMember] = useState('');
  const [newEventName, setNewEventName] = useState('');
  const [activeModal, setActiveModal] = useState<'BACKUP' | 'EVENTS' | 'CATEGORIES' | 'MEMBERS' | 'THEMES' | null>(null);

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
          theme={theme}
          icon="cloud-upload-outline"
          title="Backup & Restore"
          subtitle="Export to JSON or restore from backup file"
          onPress={() => setActiveModal('BACKUP')}
        />
      </View>

      <Text style={styles.sectionHeader}>Customization & Lists</Text>
      <View style={styles.card}>
        <SettingsRow
          theme={theme}
          icon="color-palette-outline"
          title="Themes & Appearance"
          subtitle="Customize your light and dark mode color palettes"
          onPress={() => setActiveModal('THEMES')}
        />
        <View style={styles.rowDivider} />
        <SettingsRow
          theme={theme}
          icon="calendar-outline"
          title="Manage Events & Sessions"
          subtitle="Configure tracking groups or active travel trips"
          onPress={() => setActiveModal('EVENTS')}
        />
        <View style={styles.rowDivider} />
        <SettingsRow
          theme={theme}
          icon="pricetag-outline"
          title="Customize Categories"
          subtitle="Add or remove transaction category tags"
          onPress={() => setActiveModal('CATEGORIES')}
        />
        <View style={styles.rowDivider} />
        <SettingsRow
          theme={theme}
          icon="people-outline"
          title="Regular Members"
          subtitle="Manage default participants for split tracking"
          onPress={() => setActiveModal('MEMBERS')}
        />
      </View>

      <Text style={styles.sectionHeader}>System Settings</Text>
      <View style={styles.card}>
        <SettingsRow
          theme={theme}
          icon="trash-bin-outline"
          title="Purge All Data"
          subtitle="Permanently wipe all application states"
          onPress={handlePurgeData}
          isDanger={true}
        />
      </View>

      {/* Modal: Themes & Appearance */}
      <Modal
        visible={activeModal === 'THEMES'}
        animationType="slide"
        onRequestClose={() => setActiveModal(null)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setActiveModal(null)} style={styles.modalCloseButton}>
              <Ionicons name="arrow-back" size={24} color={theme.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.modalHeaderTitle}>Themes & Appearance</Text>
            <View style={{ width: 24 }} />
          </View>
          <ScrollView contentContainerStyle={styles.modalContent}>
            
            <Text style={styles.sectionHeader}>Light Themes</Text>
            {lightThemes.map((t) => (
              <TouchableOpacity
                key={t.id}
                style={[styles.themeCard, selectedLightThemeId === t.id && styles.themeCardSelected]}
                onPress={() => setLightTheme(t.id)}
              >
                <View style={styles.themeInfo}>
                  <Text style={styles.themeName}>{t.name}</Text>
                  <View style={styles.swatchRow}>
                    <View style={[styles.swatch, { backgroundColor: t.colors.background, borderColor: t.colors.cardBorder, borderWidth: 1 }]} />
                    <View style={[styles.swatch, { backgroundColor: t.colors.card, borderColor: t.colors.cardBorder, borderWidth: 1 }]} />
                    <View style={[styles.swatch, { backgroundColor: t.colors.primary, borderColor: t.colors.primary, borderWidth: 1 }]} />
                    <View style={[styles.swatch, { backgroundColor: t.colors.accent, borderColor: t.colors.accent, borderWidth: 1 }]} />
                  </View>
                </View>
                {selectedLightThemeId === t.id && (
                  <Ionicons name="checkmark-circle" size={24} color={theme.primary} />
                )}
              </TouchableOpacity>
            ))}

            <Text style={styles.sectionHeader}>Dark Themes</Text>
            {darkThemes.map((t) => (
              <TouchableOpacity
                key={t.id}
                style={[styles.themeCard, selectedDarkThemeId === t.id && styles.themeCardSelected]}
                onPress={() => setDarkTheme(t.id)}
              >
                <View style={styles.themeInfo}>
                  <Text style={styles.themeName}>{t.name}</Text>
                  <View style={styles.swatchRow}>
                    <View style={[styles.swatch, { backgroundColor: t.colors.background, borderColor: t.colors.cardBorder, borderWidth: 1 }]} />
                    <View style={[styles.swatch, { backgroundColor: t.colors.card, borderColor: t.colors.cardBorder, borderWidth: 1 }]} />
                    <View style={[styles.swatch, { backgroundColor: t.colors.primary, borderColor: t.colors.primary, borderWidth: 1 }]} />
                    <View style={[styles.swatch, { backgroundColor: t.colors.accent, borderColor: t.colors.accent, borderWidth: 1 }]} />
                  </View>
                </View>
                {selectedDarkThemeId === t.id && (
                  <Ionicons name="checkmark-circle" size={24} color={theme.primary} />
                )}
              </TouchableOpacity>
            ))}

          </ScrollView>
        </View>
      </Modal>

      {/* Modal A: Backup & Restore */}
      <Modal
        visible={activeModal === 'BACKUP'}
        animationType="slide"
        onRequestClose={() => setActiveModal(null)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setActiveModal(null)} style={styles.modalCloseButton}>
              <Ionicons name="arrow-back" size={24} color={theme.textPrimary} />
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
              <Ionicons name="arrow-back" size={24} color={theme.textPrimary} />
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
                placeholderTextColor={theme.textMuted}
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
                        <Ionicons name="trash-outline" size={20} color={theme.danger} />
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
              <Ionicons name="arrow-back" size={24} color={theme.textPrimary} />
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
                placeholderTextColor={theme.textMuted}
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
                    <Ionicons name="trash-outline" size={20} color={theme.danger} />
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
              <Ionicons name="arrow-back" size={24} color={theme.textPrimary} />
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
                placeholderTextColor={theme.textMuted}
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
                    <Ionicons name="trash-outline" size={20} color={theme.danger} />
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

const getStyles = (theme: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 60,
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
    marginTop: 16,
    marginLeft: 4,
  },
  card: {
    backgroundColor: theme.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.cardBorder,
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
    backgroundColor: theme.card,
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
    color: theme.textPrimary,
  },
  rowSubtitle: {
    fontSize: 12,
    color: theme.textSecondary,
    marginTop: 2,
  },
  rowDivider: {
    height: 1,
    backgroundColor: theme.cardBorder,
    marginLeft: 52,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: theme.background,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: theme.card,
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
  modalContent: {
    padding: 16,
    paddingBottom: 80,
  },
  description: {
    fontSize: 14,
    color: theme.textSecondary,
    marginBottom: 20,
    lineHeight: 20,
  },
  button: {
    flexDirection: 'row',
    backgroundColor: theme.primary,
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  importButton: {
    backgroundColor: theme.textSecondary,
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
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.cardBorder,
    borderRadius: 8,
    padding: 12,
    marginRight: 12,
    fontSize: 16,
    color: theme.textPrimary,
  },
  addCategoryBtn: {
    backgroundColor: theme.success,
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
    backgroundColor: theme.card,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.cardBorder,
  },
  categoryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.cardBorder,
  },
  categoryRowText: {
    fontSize: 16,
    color: theme.textPrimary,
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
    borderBottomColor: theme.cardBorder,
  },
  eventInfo: {
    flex: 1,
  },
  eventDateText: {
    fontSize: 12,
    color: theme.textMuted,
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
    color: theme.textMuted,
    marginBottom: 2,
  },
  themeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.cardBorder,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  themeCardSelected: {
    borderColor: theme.primary,
    borderWidth: 2,
  },
  themeInfo: {
    flex: 1,
  },
  themeName: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.textPrimary,
    marginBottom: 8,
  },
  swatchRow: {
    flexDirection: 'row',
  },
  swatch: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginRight: 8,
  }
});