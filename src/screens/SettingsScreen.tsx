import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, TextInput, Switch, Modal, ScrollView, Platform } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { useExpenses } from '../contexts/ExpenseContext';
import { useToast } from '../contexts/ToastContext';
import { useTheme } from '../theme/ThemeContext';
import { lightThemes, darkThemes, getSolidColor } from '../theme/palettes';
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
  const { mode } = useTheme();
  const styles = getStyles(theme, mode);
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
  const { showToast } = useToast();
  const styles = getStyles(theme, mode);

  const {
    expenses, importBackup, categoryGroups, addParentCategory, renameParentCategory, deleteParentCategory, addSubcategory, renameSubcategory, deleteSubcategory,
    regularMembers, addRegularMember, deleteRegularMember,
    events, addEvent, updateEvent, deleteEvent, clearAllData
  } = useExpenses();
  const [newParentCategory, setNewParentCategory] = useState('');
  const [addingSubcatForId, setAddingSubcatForId] = useState<string | null>(null);
  const [newSubcategory, setNewSubcategory] = useState('');
  const [newMember, setNewMember] = useState('');
  const [newEventName, setNewEventName] = useState('');
  const [activeModal, setActiveModal] = useState<'BACKUP' | 'EVENTS' | 'CATEGORIES' | 'MEMBERS' | 'THEMES' | null>(null);
  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{
    type: 'PARENT' | 'CHILD';
    parentId: string;
    parentName: string;
    currentName: string;
  } | null>(null);
  const [renameValue, setRenameValue] = useState('');

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
        backupVersion: '2.0.0',
        exportedAt: new Date().toISOString(),
        expenses: allExpenses,
        events: allEvents,
        wallets: allWallets,
        categoryGroups: allCategories,
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
        showToast('Sharing is not available on this device', 'error');
      }
    } catch (e) {
      console.error(e);
      showToast('Failed to export data.', 'error');
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
              showToast('Data imported successfully!', 'success');
            }
          }
        ]
      );
    } catch (e) {
      console.error(e);
      showToast('Failed to import data. Please ensure it is a valid JSON backup file.', 'error');
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
                      showToast('App database successfully reset.', 'success');
                    } catch (err) {
                      console.error(err);
                      showToast('Failed to reset database.', 'error');
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

  const handleAddParentCategory = async () => {
    const name = newParentCategory.trim();
    if (!name) return;
    if (categoryGroups.some(g => g.name.toLowerCase() === name.toLowerCase())) {
      showToast('Parent category already exists.', 'error');
      return;
    }
    await addParentCategory(name);
    setNewParentCategory('');
  };

  const handleDeleteParentCategory = (group: { id: string; name: string }) => {
    if (categoryGroups.length <= 1) {
      showToast('You must have at least one parent category.', 'error');
      return;
    }
    Alert.alert('Confirm Delete', `Delete parent category "${group.name}" and all its subcategories?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteParentCategory(group.id) }
    ]);
  };

  const handleAddSubcategory = async (parentId: string) => {
    const subName = newSubcategory.trim();
    if (!subName) {
      setAddingSubcatForId(null);
      return;
    }
    const group = categoryGroups.find(g => g.id === parentId);
    if (group && group.subcategories.some(s => s.toLowerCase() === subName.toLowerCase())) {
      showToast('Subcategory already exists in this group.', 'error');
      return;
    }
    await addSubcategory(parentId, subName);
    setNewSubcategory('');
    setAddingSubcatForId(null);
  };

  const handleDeleteSubcategory = (parentId: string, parentName: string, subName: string) => {
    const group = categoryGroups.find(g => g.id === parentId);
    if (group && group.subcategories.length <= 1) {
      showToast(`"${parentName}" must have at least one child category.`, 'error');
      return;
    }
    Alert.alert('Confirm Delete', `Delete subcategory "${subName}" from ${parentName}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteSubcategory(parentId, subName) }
    ]);
  };

  const handleOpenRenameParent = (group: { id: string; name: string }) => {
    setRenameTarget({
      type: 'PARENT',
      parentId: group.id,
      parentName: group.name,
      currentName: group.name,
    });
    setRenameValue(group.name);
    setRenameModalVisible(true);
  };

  const handleOpenRenameChild = (group: { id: string; name: string }, subName: string) => {
    setRenameTarget({
      type: 'CHILD',
      parentId: group.id,
      parentName: group.name,
      currentName: subName,
    });
    setRenameValue(subName);
    setRenameModalVisible(true);
  };

  const handleSaveRename = async () => {
    if (!renameTarget) return;
    const trimmed = renameValue.trim();
    if (!trimmed) {
      showToast('Category name cannot be empty.', 'error');
      return;
    }
    if (trimmed === renameTarget.currentName) {
      setRenameModalVisible(false);
      return;
    }

    try {
      if (renameTarget.type === 'PARENT') {
        await renameParentCategory(renameTarget.parentId, trimmed);
        showToast(`Parent category renamed to "${trimmed}"`, 'success');
      } else {
        await renameSubcategory(renameTarget.parentId, renameTarget.currentName, trimmed);
        showToast(`Child category renamed to "${trimmed}"`, 'success');
      }
      setRenameModalVisible(false);
    } catch (err: any) {
      showToast(err?.message || 'Failed to rename category.', 'error');
    }
  };

  const handleAddMember = async () => {
    const member = newMember.trim();
    if (!member) return;
    if (regularMembers.includes(member)) {
      showToast('Member already exists.', 'error');
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
      showToast('An event with this name already exists.', 'error');
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
        onRequestClose={() => {
          setActiveModal(null);
          setAddingSubcatForId(null);
        }}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => { setActiveModal(null); setAddingSubcatForId(null); }} style={styles.modalCloseButton}>
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
              Organize categories into Parent and Child categories. Child categories appear when logging expenses and roll up under their Parent category in Analytics.
            </Text>

            {/* Add New Parent Category Input Row */}
            <Text style={styles.categorySectionTitle}>Add Parent Category</Text>
            <View style={styles.addCategoryContainer}>
              <TextInput
                style={styles.categoryInput}
                placeholder="e.g., Food, Transport, Health"
                placeholderTextColor={theme.textMuted}
                value={newParentCategory}
                onChangeText={setNewParentCategory}
              />
              <TouchableOpacity style={styles.addCategoryBtn} onPress={handleAddParentCategory}>
                <Text style={styles.addCategoryBtnText}>Add</Text>
              </TouchableOpacity>
            </View>

            {/* Parent & Child Categories Cards */}
            <Text style={[styles.categorySectionTitle, { marginTop: 8 }]}>Category Groups</Text>
            <View style={styles.categoryGroupList}>
              {categoryGroups.map(group => (
                <View key={group.id} style={styles.groupCard}>
                  {/* Card Header: Parent Category */}
                  <View style={styles.groupCardHeader}>
                    <TouchableOpacity 
                      style={styles.groupHeaderLeft}
                      onPress={() => handleOpenRenameParent(group)}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="folder-open-outline" size={18} color={theme.primary} style={{ marginRight: 6 }} />
                      <Text style={styles.groupParentName}>{group.name}</Text>
                      <View style={styles.subcatCountBadge}>
                        <Text style={styles.subcatCountText}>{group.subcategories.length}</Text>
                      </View>
                    </TouchableOpacity>
                    
                    <View style={styles.groupHeaderActions}>
                      <TouchableOpacity 
                        onPress={() => handleOpenRenameParent(group)} 
                        style={styles.actionIconBtn}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name="pencil-outline" size={18} color={theme.textSecondary} />
                      </TouchableOpacity>
                      <TouchableOpacity 
                        onPress={() => handleDeleteParentCategory(group)} 
                        style={styles.actionIconBtn}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name="trash-outline" size={18} color={theme.danger} />
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* Child Categories Chips */}
                  <View style={styles.subcategoriesWrap}>
                    {group.subcategories.map(sub => (
                      <View key={sub} style={styles.subcategoryChip}>
                        <TouchableOpacity 
                          style={styles.subcategoryChipContent}
                          onPress={() => handleOpenRenameChild(group, sub)}
                          activeOpacity={0.7}
                        >
                          <Text style={styles.subcategoryChipText}>{sub}</Text>
                          <Ionicons name="pencil" size={11} color={theme.textMuted} style={styles.subcatEditIcon} />
                        </TouchableOpacity>
                        <TouchableOpacity 
                          onPress={() => handleDeleteSubcategory(group.id, group.name, sub)}
                          style={styles.deleteSubcatIconBtn}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        >
                          <Ionicons name="close-circle" size={15} color={theme.textMuted} />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>

                  {/* Add Child Category Inline Row / Trigger */}
                  {addingSubcatForId === group.id ? (
                    <View style={styles.addSubcatInputRow}>
                      <TextInput
                        style={styles.subcatInput}
                        placeholder={`New child in ${group.name}`}
                        placeholderTextColor={theme.textMuted}
                        value={newSubcategory}
                        onChangeText={setNewSubcategory}
                        autoFocus
                      />
                      <TouchableOpacity 
                        style={styles.saveSubcatBtn}
                        onPress={() => handleAddSubcategory(group.id)}
                      >
                        <Ionicons name="checkmark-circle" size={24} color={theme.success} />
                      </TouchableOpacity>
                      <TouchableOpacity 
                        style={styles.cancelSubcatBtn}
                        onPress={() => {
                          setAddingSubcatForId(null);
                          setNewSubcategory('');
                        }}
                      >
                        <Ionicons name="close-circle" size={24} color={theme.danger} />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity 
                      style={styles.addSubcatTriggerBtn}
                      onPress={() => {
                        setAddingSubcatForId(group.id);
                        setNewSubcategory('');
                      }}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="add" size={16} color={theme.primary} />
                      <Text style={styles.addSubcatTriggerText}>Add Child Category</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </View>
          </KeyboardAwareScrollView>

          {/* Rename Dialog Modal */}
          <Modal
            visible={renameModalVisible}
            transparent={true}
            animationType="fade"
            onRequestClose={() => setRenameModalVisible(false)}
          >
            <View style={styles.renameDialogOverlay}>
              <View style={styles.renameDialogCard}>
                <View style={styles.renameDialogHeader}>
                  <Ionicons 
                    name={renameTarget?.type === 'PARENT' ? 'folder-open-outline' : 'pricetag-outline'} 
                    size={22} 
                    color={theme.primary} 
                    style={{ marginRight: 8 }}
                  />
                  <Text style={styles.renameDialogTitle}>
                    {renameTarget?.type === 'PARENT' ? 'Rename Parent Category' : 'Rename Child Category'}
                  </Text>
                </View>
                
                {renameTarget?.type === 'CHILD' && (
                  <Text style={styles.renameDialogSubtitle}>
                    Parent Group: <Text style={{ fontWeight: '700', color: theme.textPrimary }}>{renameTarget.parentName}</Text>
                  </Text>
                )}

                <TextInput
                  style={styles.renameInput}
                  value={renameValue}
                  onChangeText={setRenameValue}
                  placeholder="Enter category name"
                  placeholderTextColor={theme.textMuted}
                  autoFocus={true}
                  selectTextOnFocus={true}
                />

                <View style={styles.renameDialogActions}>
                  <TouchableOpacity
                    style={styles.renameCancelBtn}
                    onPress={() => setRenameModalVisible(false)}
                  >
                    <Text style={styles.renameCancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.renameSaveBtn}
                    onPress={handleSaveRename}
                  >
                    <Text style={styles.renameSaveBtnText}>Save</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>
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

const getStyles = (theme: ThemeColors, mode: 'light' | 'dark') => StyleSheet.create({
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
    backgroundColor: getSolidColor(theme.card, mode === 'dark' ? '#1A202C' : '#FFFFFF'),
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
    backgroundColor: getSolidColor(theme.card, mode === 'dark' ? '#1A202C' : '#FFFFFF'),
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
    backgroundColor: getSolidColor(theme.surface, mode === 'dark' ? '#242C3D' : '#F4F5F7'),
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
  categorySectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.textSecondary,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  categoryGroupList: {
    marginBottom: 20,
  },
  groupCard: {
    backgroundColor: getSolidColor(theme.card, mode === 'dark' ? '#1A202C' : '#FFFFFF'),
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.cardBorder,
    padding: 14,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  groupCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.cardBorder,
    paddingBottom: 8,
  },
  groupHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  groupParentName: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.textPrimary,
  },
  subcatCountBadge: {
    backgroundColor: getSolidColor(theme.surface, mode === 'dark' ? '#242C3D' : '#F4F5F7'),
    borderWidth: 1,
    borderColor: theme.cardBorder,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
    marginLeft: 8,
  },
  subcatCountText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: theme.primary,
  },
  groupHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionIconBtn: {
    padding: 4,
  },
  deleteGroupBtn: {
    padding: 4,
  },
  subcategoriesWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  subcategoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: getSolidColor(theme.surface, mode === 'dark' ? '#242C3D' : '#F4F5F7'),
    borderWidth: 1,
    borderColor: theme.cardBorder,
    borderRadius: 16,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  subcategoryChipContent: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 6,
  },
  subcategoryChipText: {
    fontSize: 13,
    color: theme.textPrimary,
  },
  subcatEditIcon: {
    marginLeft: 4,
    opacity: 0.6,
  },
  deleteSubcatIconBtn: {
    padding: 2,
  },
  renameDialogOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  renameDialogCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: getSolidColor(theme.card, mode === 'dark' ? '#1A202C' : '#FFFFFF'),
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.cardBorder,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
  },
  renameDialogHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  renameDialogTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: theme.textPrimary,
  },
  renameDialogSubtitle: {
    fontSize: 13,
    color: theme.textSecondary,
    marginBottom: 14,
  },
  renameInput: {
    backgroundColor: getSolidColor(theme.surface, mode === 'dark' ? '#242C3D' : '#F4F5F7'),
    borderWidth: 1,
    borderColor: theme.cardBorder,
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    color: theme.textPrimary,
    marginBottom: 18,
  },
  renameDialogActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  renameCancelBtn: {
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.cardBorder,
    justifyContent: 'center',
    alignItems: 'center',
  },
  renameCancelBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.textSecondary,
  },
  renameSaveBtn: {
    backgroundColor: theme.primary,
    paddingVertical: 9,
    paddingHorizontal: 20,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  renameSaveBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  addSubcatTriggerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: getSolidColor(theme.surface, mode === 'dark' ? '#242C3D' : '#F4F5F7'),
    borderWidth: 1,
    borderColor: theme.primary + '50',
    marginTop: 2,
  },
  addSubcatTriggerText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.primary,
    marginLeft: 4,
  },
  addSubcatInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 8,
  },
  subcatInput: {
    flex: 1,
    backgroundColor: getSolidColor(theme.surface, mode === 'dark' ? '#242C3D' : '#F4F5F7'),
    borderWidth: 1,
    borderColor: theme.cardBorder,
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 10,
    fontSize: 13,
    color: theme.textPrimary,
  },
  saveSubcatBtn: {
    padding: 2,
  },
  cancelSubcatBtn: {
    padding: 2,
  },
  categoryList: {
    backgroundColor: getSolidColor(theme.card, mode === 'dark' ? '#1A202C' : '#FFFFFF'),
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
    backgroundColor: getSolidColor(theme.card, mode === 'dark' ? '#1A202C' : '#FFFFFF'),
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