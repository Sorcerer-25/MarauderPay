import React, { createContext, useState, useEffect, ReactNode, useContext, useMemo } from 'react';
import { ExpenseLog, TravelEvent, UserWallet, CategoryGroup } from '../types';
import { StorageService } from '../services/StorageService';
import { DEFAULT_CATEGORY_GROUPS, getAllSubcategories, getParentCategory, migrateCategories } from '../utils/categoryUtils';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface ExpenseContextType {
  expenses: ExpenseLog[];
  isLoading: boolean;
  addExpense: (expense: ExpenseLog) => Promise<void>;
  updateExpense: (updatedExpense: ExpenseLog) => Promise<void>;
  deleteExpense: (id: string) => Promise<void>;
  importBackup: (backupData: any) => Promise<void>;
  categoryGroups: CategoryGroup[];
  categories: string[];
  addParentCategory: (name: string) => Promise<void>;
  renameParentCategory: (parentId: string, newName: string) => Promise<void>;
  deleteParentCategory: (parentId: string) => Promise<void>;
  addSubcategory: (parentId: string, subcategoryName: string) => Promise<void>;
  renameSubcategory: (parentId: string, oldSubName: string, newSubName: string) => Promise<void>;
  deleteSubcategory: (parentId: string, subcategoryName: string) => Promise<void>;
  getParentCategoryName: (categoryName: string) => string;
  addCategory: (category: string) => Promise<void>;
  deleteCategory: (category: string) => Promise<void>;
  regularMembers: string[];
  addRegularMember: (member: string) => Promise<void>;
  deleteRegularMember: (member: string) => Promise<void>;
  events: TravelEvent[];
  addEvent: (event: TravelEvent) => Promise<void>;
  updateEvent: (updatedEvent: TravelEvent) => Promise<void>;
  deleteEvent: (id: string) => Promise<void>;
  activeEvent: TravelEvent | undefined;
  setAllExpenses: (newExpenses: ExpenseLog[]) => Promise<void>;
  clearAllData: () => Promise<void>;
}

const ExpenseContext = createContext<ExpenseContextType | undefined>(undefined);

export const ExpenseProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [expenses, setExpenses] = useState<ExpenseLog[]>([]);
  const [categoryGroups, setCategoryGroups] = useState<CategoryGroup[]>(DEFAULT_CATEGORY_GROUPS);
  const [regularMembers, setRegularMembers] = useState<string[]>([]);
  const [events, setEvents] = useState<TravelEvent[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Derived flat list of all subcategories
  const categories = useMemo(() => {
    return getAllSubcategories(categoryGroups);
  }, [categoryGroups]);

  // Load initial data
  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      const data = await StorageService.getAllExpenses();
      setExpenses(data);
      
      const groups = await StorageService.getAllCategories();
      setCategoryGroups(groups);
      
      const members = await StorageService.getAllRegularMembers();
      setRegularMembers(members);

      const evs = await StorageService.getAllEvents();
      setEvents(evs);

      setIsLoading(false);
    };
    loadData();
  }, []);

  const addExpense = async (expense: ExpenseLog) => {
    const newExpenses = [...expenses, expense];
    await StorageService.saveAllExpenses(newExpenses);
    setExpenses(newExpenses);
  };

  const updateExpense = async (updatedExpense: ExpenseLog) => {
    const newExpenses = expenses.map(exp => 
      exp.id === updatedExpense.id ? updatedExpense : exp
    );
    await StorageService.saveAllExpenses(newExpenses);
    setExpenses(newExpenses);
  };

  const deleteExpense = async (id: string) => {
    const newExpenses = expenses.filter(exp => exp.id !== id);
    await StorageService.saveAllExpenses(newExpenses);
    setExpenses(newExpenses);
  };

  const setAllExpenses = async (newExpenses: ExpenseLog[]) => {
    await StorageService.saveAllExpenses(newExpenses);
    setExpenses(newExpenses);
  };

  const importBackup = async (backupData: any) => {
    let expensesToMerge: ExpenseLog[] = [];
    let eventsToMerge: TravelEvent[] = [];
    let walletsToMerge: UserWallet[] = [];

    if (Array.isArray(backupData)) {
      // Legacy backup format (only expenses)
      expensesToMerge = backupData;
    } else if (backupData && typeof backupData === 'object') {
      expensesToMerge = backupData.expenses || [];
      eventsToMerge = backupData.events || [];
      walletsToMerge = backupData.wallets || [];
    } else {
      throw new Error('Invalid backup data format');
    }

    // 1. Merge Expenses
    const localExpenses = await StorageService.getAllExpenses();
    const expenseMap = new Map(localExpenses.map(item => [item.id, item]));
    expensesToMerge.forEach(item => {
      expenseMap.set(item.id, item);
    });
    const mergedExpenses = Array.from(expenseMap.values());
    await StorageService.saveAllExpenses(mergedExpenses);

    // 2. Merge Events
    const localEvents = await StorageService.getAllEvents();
    const eventMap = new Map(localEvents.map(item => [item.id, item]));
    eventsToMerge.forEach(item => {
      const existing = eventMap.get(item.id);
      if (existing) {
        eventMap.set(item.id, {
          ...item,
          isActive: existing.isActive || item.isActive
        });
      } else {
        eventMap.set(item.id, item);
      }
    });
    const mergedEvents = Array.from(eventMap.values());

    // Resolve active event conflict
    const localActiveEvent = localEvents.find(e => e.isActive);
    if (localActiveEvent) {
      mergedEvents.forEach(e => {
        if (e.id !== localActiveEvent.id) {
          e.isActive = false;
        }
      });
    } else {
      let foundActive = false;
      mergedEvents.forEach(e => {
        if (e.isActive) {
          if (foundActive) {
            e.isActive = false;
          } else {
            foundActive = true;
          }
        }
      });
    }
    await StorageService.saveAllEvents(mergedEvents);

    // 3. Merge Wallets
    const localWallets = await StorageService.loadWallets();
    const walletMap = new Map(localWallets.map(w => [w.name.toLowerCase(), w]));
    walletsToMerge.forEach(item => {
      const key = item.name.toLowerCase();
      const existing = walletMap.get(key);
      if (existing) {
        const higherBalance = Math.max(existing.creditBalance, item.creditBalance);
        walletMap.set(key, {
          name: existing.name,
          creditBalance: higherBalance
        });
      } else {
        walletMap.set(key, {
          name: item.name.toLowerCase(),
          creditBalance: item.creditBalance
        });
      }
    });
    const mergedWallets = Array.from(walletMap.values());
    await StorageService.saveWallets(mergedWallets);

    // 4. Merge Categories
    const localGroups = await StorageService.getAllCategories();
    let incomingRaw: any = null;
    if (backupData && typeof backupData === 'object') {
      incomingRaw = backupData.categoryGroups || backupData.categories || null;
    }
    const incomingGroups = migrateCategories(incomingRaw);
    
    // Also include any categories present on imported expenses
    const importedItemCats = expensesToMerge
      .map(e => e.category)
      .filter((c): c is string => typeof c === 'string' && c.trim().length > 0);

    const mergedGroupsMap = new Map<string, CategoryGroup>();
    localGroups.forEach(g => {
      mergedGroupsMap.set(g.name.toLowerCase(), {
        id: g.id,
        name: g.name,
        subcategories: [...g.subcategories]
      });
    });

    incomingGroups.forEach(g => {
      const key = g.name.toLowerCase();
      const existing = mergedGroupsMap.get(key);
      if (existing) {
        const set = new Set([...existing.subcategories, ...g.subcategories]);
        existing.subcategories = Array.from(set);
      } else {
        mergedGroupsMap.set(key, {
          id: g.id || `group_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          name: g.name,
          subcategories: [...g.subcategories]
        });
      }
    });

    // Ensure all expense categories exist in at least one group
    const allKnownSubcats = new Set<string>();
    mergedGroupsMap.forEach(g => g.subcategories.forEach(s => allKnownSubcats.add(s.toLowerCase())));

    importedItemCats.forEach(cat => {
      const trimmed = cat.trim();
      if (!allKnownSubcats.has(trimmed.toLowerCase())) {
        const others = mergedGroupsMap.get('others');
        if (others) {
          others.subcategories.push(trimmed);
        } else {
          mergedGroupsMap.set(trimmed.toLowerCase(), {
            id: `group_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            name: trimmed,
            subcategories: [trimmed]
          });
        }
        allKnownSubcats.add(trimmed.toLowerCase());
      }
    });

    const mergedGroups = Array.from(mergedGroupsMap.values());
    await StorageService.saveAllCategories(mergedGroups);
    setCategoryGroups(mergedGroups);

    // 5. Merge Regular Members
    const localMembers = await StorageService.getAllRegularMembers();
    let incomingMembers: string[] = [];
    if (backupData && typeof backupData === 'object') {
      if (Array.isArray(backupData.members)) {
        incomingMembers = backupData.members;
      } else if (Array.isArray(backupData.regularMembers)) {
        incomingMembers = backupData.regularMembers;
      }
    }
    const memberMap = new Map<string, string>();
    localMembers.forEach(m => {
      if (typeof m === 'string' && m.trim().length > 0) {
        memberMap.set(m.trim().toLowerCase(), m.trim());
      }
    });
    incomingMembers.forEach(m => {
      if (typeof m === 'string' && m.trim().length > 0) {
        const lower = m.trim().toLowerCase();
        if (!memberMap.has(lower)) {
          memberMap.set(lower, m.trim());
        }
      }
    });
    const mergedMembers = Array.from(memberMap.values());
    await StorageService.saveAllRegularMembers(mergedMembers);
    setRegularMembers(mergedMembers);

    // 6. Update React Context State to trigger UI refresh
    setExpenses(mergedExpenses);
    setEvents(mergedEvents);
  };

  const addParentCategory = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (categoryGroups.some(g => g.name.toLowerCase() === trimmed.toLowerCase())) {
      return;
    }
    const newGroup: CategoryGroup = {
      id: `group_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: trimmed,
      subcategories: [trimmed]
    };
    const newGroups = [...categoryGroups, newGroup];
    await StorageService.saveAllCategories(newGroups);
    setCategoryGroups(newGroups);
  };

  const renameParentCategory = async (parentId: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) return;

    const targetGroup = categoryGroups.find(g => g.id === parentId || g.name.toLowerCase() === parentId.toLowerCase());
    if (!targetGroup) return;

    const oldName = targetGroup.name;
    if (oldName.toLowerCase() !== trimmed.toLowerCase()) {
      if (categoryGroups.some(g => g.id !== targetGroup.id && g.name.toLowerCase() === trimmed.toLowerCase())) {
        throw new Error('A parent category with this name already exists.');
      }
    }

    const newGroups = categoryGroups.map(g => {
      if (g.id === targetGroup.id) {
        return {
          ...g,
          name: trimmed,
        };
      }
      return g;
    });

    let expensesUpdated = false;
    const newExpenses = expenses.map(exp => {
      if (exp.category && exp.category.toLowerCase() === oldName.toLowerCase()) {
        expensesUpdated = true;
        return { ...exp, category: trimmed };
      }
      return exp;
    });

    await StorageService.saveAllCategories(newGroups);
    setCategoryGroups(newGroups);

    if (expensesUpdated) {
      await StorageService.saveAllExpenses(newExpenses);
      setExpenses(newExpenses);
    }
  };

  const deleteParentCategory = async (parentId: string) => {
    if (categoryGroups.length <= 1) return;
    const newGroups = categoryGroups.filter(g => g.id !== parentId && g.name !== parentId);
    await StorageService.saveAllCategories(newGroups);
    setCategoryGroups(newGroups);
  };

  const addSubcategory = async (parentId: string, subcategoryName: string) => {
    const trimmed = subcategoryName.trim();
    if (!trimmed) return;

    const newGroups = categoryGroups.map(g => {
      if (g.id === parentId || g.name.toLowerCase() === parentId.toLowerCase()) {
        const exists = g.subcategories.some(s => s.toLowerCase() === trimmed.toLowerCase());
        if (!exists) {
          return {
            ...g,
            subcategories: [...g.subcategories, trimmed]
          };
        }
      }
      return g;
    });

    await StorageService.saveAllCategories(newGroups);
    setCategoryGroups(newGroups);
  };

  const renameSubcategory = async (parentId: string, oldSubName: string, newSubName: string) => {
    const trimmed = newSubName.trim();
    if (!trimmed) return;

    const targetGroup = categoryGroups.find(g => g.id === parentId || g.name.toLowerCase() === parentId.toLowerCase());
    if (!targetGroup) return;

    if (oldSubName.toLowerCase() !== trimmed.toLowerCase()) {
      if (targetGroup.subcategories.some(s => s.toLowerCase() === trimmed.toLowerCase())) {
        throw new Error('A child category with this name already exists in this group.');
      }
    }

    const newGroups = categoryGroups.map(g => {
      if (g.id === targetGroup.id) {
        return {
          ...g,
          subcategories: g.subcategories.map(s => s.toLowerCase() === oldSubName.toLowerCase() ? trimmed : s)
        };
      }
      return g;
    });

    let expensesUpdated = false;
    const newExpenses = expenses.map(exp => {
      if (exp.category && exp.category.toLowerCase() === oldSubName.toLowerCase()) {
        expensesUpdated = true;
        return { ...exp, category: trimmed };
      }
      return exp;
    });

    await StorageService.saveAllCategories(newGroups);
    setCategoryGroups(newGroups);

    if (expensesUpdated) {
      await StorageService.saveAllExpenses(newExpenses);
      setExpenses(newExpenses);
    }
  };

  const deleteSubcategory = async (parentId: string, subcategoryName: string) => {
    const newGroups = categoryGroups.map(g => {
      if (g.id === parentId || g.name.toLowerCase() === parentId.toLowerCase()) {
        return {
          ...g,
          subcategories: g.subcategories.filter(s => s.toLowerCase() !== subcategoryName.toLowerCase())
        };
      }
      return g;
    });

    await StorageService.saveAllCategories(newGroups);
    setCategoryGroups(newGroups);
  };

  const getParentCategoryName = (categoryName: string): string => {
    return getParentCategory(categoryName, categoryGroups);
  };

  const addCategory = async (category: string) => {
    const trimmed = category.trim();
    if (!trimmed) return;
    if (categories.some(c => c.toLowerCase() === trimmed.toLowerCase())) {
      return;
    }
    // Add to 'Others' group or create one
    const othersIndex = categoryGroups.findIndex(g => g.name.toLowerCase() === 'others');
    if (othersIndex >= 0) {
      await addSubcategory(categoryGroups[othersIndex].id, trimmed);
    } else {
      await addParentCategory(trimmed);
    }
  };

  const deleteCategory = async (category: string) => {
    const trimmed = category.trim();
    const newGroups = categoryGroups.map(g => ({
      ...g,
      subcategories: g.subcategories.filter(s => s.toLowerCase() !== trimmed.toLowerCase())
    }));
    await StorageService.saveAllCategories(newGroups);
    setCategoryGroups(newGroups);
  };

  const addRegularMember = async (member: string) => {
    if (!regularMembers.includes(member)) {
      const newMembers = [...regularMembers, member];
      await StorageService.saveAllRegularMembers(newMembers);
      setRegularMembers(newMembers);
    }
  };

  const deleteRegularMember = async (member: string) => {
    const newMembers = regularMembers.filter(m => m !== member);
    await StorageService.saveAllRegularMembers(newMembers);
    setRegularMembers(newMembers);
  };

  const addEvent = async (event: TravelEvent) => {
    let newEvents = [...events];
    if (event.isActive) {
      newEvents = newEvents.map(e => ({ ...e, isActive: false }));
    }
    newEvents.push(event);
    await StorageService.saveAllEvents(newEvents);
    setEvents(newEvents);
  };

  const updateEvent = async (updatedEvent: TravelEvent) => {
    let newEvents = [...events];
    if (updatedEvent.isActive) {
      newEvents = newEvents.map(e => ({ ...e, isActive: false }));
    }
    newEvents = newEvents.map(e => e.id === updatedEvent.id ? updatedEvent : e);
    await StorageService.saveAllEvents(newEvents);
    setEvents(newEvents);
  };

  const deleteEvent = async (id: string) => {
    const newEvents = events.filter(e => e.id !== id);
    await StorageService.saveAllEvents(newEvents);
    setEvents(newEvents);
  };

  const clearAllData = async () => {
    await AsyncStorage.multiRemove(['@expense_store', '@event_store', '@member_store', '@pending_queue_store', '@wallet_store']);
    await AsyncStorage.setItem('@category_store', JSON.stringify(DEFAULT_CATEGORY_GROUPS));
    setExpenses([]);
    setEvents([]);
    setRegularMembers([]);
    setCategoryGroups(DEFAULT_CATEGORY_GROUPS);
  };

  const activeEvent = events.find(e => e.isActive);

  return (
    <ExpenseContext.Provider 
      value={{
        expenses,
        isLoading,
        addExpense,
        updateExpense,
        deleteExpense,
        importBackup,
        categoryGroups,
        categories,
        addParentCategory,
        renameParentCategory,
        deleteParentCategory,
        addSubcategory,
        renameSubcategory,
        deleteSubcategory,
        getParentCategoryName,
        addCategory,
        deleteCategory,
        regularMembers,
        addRegularMember,
        deleteRegularMember,
        events,
        addEvent,
        updateEvent,
        deleteEvent,
        activeEvent,
        setAllExpenses,
        clearAllData
      }}
    >
      {children}
    </ExpenseContext.Provider>
  );
};

export const useExpenses = () => {
  const context = useContext(ExpenseContext);
  if (context === undefined) {
    throw new Error('useExpenses must be used within an ExpenseProvider');
  }
  return context;
};
