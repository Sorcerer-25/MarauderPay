export type PaymentMode = 'Cash' | 'UPI' | 'Card';

export interface SplitParticipant {
  id: string;
  name: string;
  shareAmount: number;
  hasPaid: boolean;
  isCustomShare?: boolean;
  paymentMode?: PaymentMode;
}

export type ExpenseCategory = string;

export interface TravelEvent {
  id: string;          // Unique ID
  name: string;        // e.g., "6-Month Training"
  startDate: string;   // ISO String YYYY-MM-DD
  isActive: boolean;   // Tracks if this is the currently active tracking period
}

export interface ExpenseLog {
  id: string;              // Unique UUID
  expenseDate: string;     // ISO String YYYY-MM-DD
  createdAt: string;       // Timestamp of when the data was entered
  category: ExpenseCategory;
  totalAmount: number;     // Gross value of the transaction
  myShare: number;         // The amount the user actually spent personally
  remark?: string;         // Optional comment
  paymentMode?: PaymentMode; // Mode of payment
  isSplit: boolean;        // Split flag toggled by UI checkbox
  splitDetails?: {
    isSettled: boolean;    // Automatically true if all participants have paid
    participants: SplitParticipant[];
  };
  eventId?: string;        // Tag to associate with a specific event/session
}

export interface UserWallet {
  name: string;          // Unique key (stored lowercase for matching)
  creditBalance: number; // The pre-paid amount available
}

export interface FullAppBackup {
  backupVersion: string;
  exportedAt: string;
  expenses: ExpenseLog[];
  events: TravelEvent[];
  wallets: UserWallet[];
  categories?: string[];
  regularMembers?: string[];
}

