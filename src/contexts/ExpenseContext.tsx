import React, { createContext, useState, useEffect, ReactNode, useContext } from 'react';
import { ExpenseLog, TravelEvent, UserWallet } from '../types';
import { StorageService } from '../services/StorageService';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface ExpenseContextType {
  expenses: ExpenseLog[];
  isLoading: boolean;
  addExpense: (expense: ExpenseLog) => Promise<void>;
  updateExpense: (updatedExpense: ExpenseLog) => Promise<void>;
  deleteExpense: (id: string) => Promise<void>;
  importBackup: (backupData: any) => Promise<void>;
  categories: string[];
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

const DEFAULT_CATEGORIES = ['Breakfast', 'Lunch', 'Dinner', 'Grocery', 'Metro', 'Fruits', 'Snacks', 'Others'];

const ExpenseContext = createContext<ExpenseContextType | undefined>(undefined);

export const ExpenseProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [expenses, setExpenses] = useState<ExpenseLog[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [regularMembers, setRegularMembers] = useState<string[]>([]);
  const [events, setEvents] = useState<TravelEvent[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Load initial data
  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      const data = await StorageService.getAllExpenses();
      setExpenses(data);
      
      let cats = await StorageService.getAllCategories();
      if (cats.length === 0) {
        cats = DEFAULT_CATEGORIES;
        await StorageService.saveAllCategories(cats);
      }
      setCategories(cats);
      
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

    // Resolve active event conflict (at most one isActive: true, prioritizing local active event)
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
          name: existing.name, // Keep local casing
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
    const localCategories = await StorageService.getAllCategories();
    const backupCats = (backupData && typeof backupData === 'object' && Array.isArray(backupData.categories)) 
      ? backupData.categories 
      : [];
    const importedItemCats = expensesToMerge
      .map(e => e.category)
      .filter((c): c is string => typeof c === 'string' && c.trim().length > 0);
    const mergedCategories = Array.from(new Set([...localCategories, ...backupCats, ...importedItemCats]));
    await StorageService.saveAllCategories(mergedCategories);
    setCategories(mergedCategories);

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

  const addCategory = async (category: string) => {
    if (!categories.includes(category)) {
      const newCats = [...categories, category];
      await StorageService.saveAllCategories(newCats);
      setCategories(newCats);
    }
  };

  const deleteCategory = async (category: string) => {
    if (categories.length > 1) {
      const newCats = categories.filter(c => c !== category);
      await StorageService.saveAllCategories(newCats);
      setCategories(newCats);
    }
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
    await AsyncStorage.setItem('@category_store', JSON.stringify(DEFAULT_CATEGORIES));
    setExpenses([]);
    setEvents([]);
    setRegularMembers([]);
    setCategories(DEFAULT_CATEGORIES);
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
        categories,
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
