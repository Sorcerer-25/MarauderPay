import AsyncStorage from '@react-native-async-storage/async-storage';
import { ExpenseLog, TravelEvent, UserWallet } from '../types';

const STORE_KEY = '@expense_store';
const CATEGORIES_KEY = '@category_store';
const MEMBERS_KEY = '@member_store';
const EVENTS_KEY = '@event_store';

export const StorageService = {
  /**
   * Retrieves all expense logs from AsyncStorage.
   */
  async getAllExpenses(): Promise<ExpenseLog[]> {
    try {
      const jsonValue = await AsyncStorage.getItem(STORE_KEY);
      return jsonValue != null ? JSON.parse(jsonValue) : [];
    } catch (e) {
      console.error('Error reading expenses from storage', e);
      return [];
    }
  },

  /**
   * Saves the entire array of expense logs to AsyncStorage.
   */
  async saveAllExpenses(expenses: ExpenseLog[]): Promise<void> {
    try {
      const jsonValue = JSON.stringify(expenses);
      await AsyncStorage.setItem(STORE_KEY, jsonValue);
    } catch (e) {
      console.error('Error saving expenses to storage', e);
      throw e;
    }
  },

  /**
   * Replaces the existing storage with imported backup data.
   */
  async restoreBackup(expenses: ExpenseLog[]): Promise<void> {
    await this.saveAllExpenses(expenses);
  },

  /**
   * Clears the database (useful for testing or full reset).
   */
  async clearAll(): Promise<void> {
    try {
      await AsyncStorage.removeItem(STORE_KEY);
      await AsyncStorage.removeItem(CATEGORIES_KEY);
      await AsyncStorage.removeItem(MEMBERS_KEY);
    } catch (e) {
      console.error('Error clearing expenses', e);
      throw e;
    }
  },

  /**
   * Retrieves all custom categories from AsyncStorage.
   */
  async getAllCategories(): Promise<string[]> {
    try {
      const jsonValue = await AsyncStorage.getItem(CATEGORIES_KEY);
      return jsonValue != null ? JSON.parse(jsonValue) : [];
    } catch (e) {
      console.error('Error reading categories from storage', e);
      return [];
    }
  },

  /**
   * Saves the entire array of custom categories to AsyncStorage.
   */
  async saveAllCategories(categories: string[]): Promise<void> {
    try {
      const jsonValue = JSON.stringify(categories);
      await AsyncStorage.setItem(CATEGORIES_KEY, jsonValue);
    } catch (e) {
      console.error('Error saving categories to storage', e);
      throw e;
    }
  },

  /**
   * Retrieves all regular members from AsyncStorage.
   */
  async getAllRegularMembers(): Promise<string[]> {
    try {
      const jsonValue = await AsyncStorage.getItem(MEMBERS_KEY);
      return jsonValue != null ? JSON.parse(jsonValue) : [];
    } catch (e) {
      console.error('Error reading members from storage', e);
      return [];
    }
  },

  /**
   * Saves the entire array of regular members to AsyncStorage.
   */
  async saveAllRegularMembers(members: string[]): Promise<void> {
    try {
      const jsonValue = JSON.stringify(members);
      await AsyncStorage.setItem(MEMBERS_KEY, jsonValue);
    } catch (e) {
      console.error('Error saving members to storage', e);
      throw e;
    }
  },

  /**
   * Retrieves all travel events from AsyncStorage.
   */
  async getAllEvents(): Promise<TravelEvent[]> {
    try {
      const jsonValue = await AsyncStorage.getItem(EVENTS_KEY);
      return jsonValue != null ? JSON.parse(jsonValue) : [];
    } catch (e) {
      console.error('Error reading events from storage', e);
      return [];
    }
  },

  /**
   * Saves the entire array of travel events to AsyncStorage.
   */
  async saveAllEvents(events: TravelEvent[]): Promise<void> {
    try {
      const jsonValue = JSON.stringify(events);
      await AsyncStorage.setItem(EVENTS_KEY, jsonValue);
    } catch (e) {
      console.error('Error saving events to storage', e);
      throw e;
    }
  },

  /**
   * Retrieves all user wallets from AsyncStorage.
   */
  async loadWallets(): Promise<UserWallet[]> {
    try {
      const jsonValue = await AsyncStorage.getItem('@wallet_store');
      return jsonValue != null ? JSON.parse(jsonValue) : [];
    } catch (e) {
      console.error('Error reading wallets from storage', e);
      return [];
    }
  },

  /**
   * Saves the entire array of user wallets to AsyncStorage.
   */
  async saveWallets(wallets: UserWallet[]): Promise<void> {
    try {
      const jsonValue = JSON.stringify(wallets);
      await AsyncStorage.setItem('@wallet_store', jsonValue);
    } catch (e) {
      console.error('Error saving wallets to storage', e);
      throw e;
    }
  }
};
