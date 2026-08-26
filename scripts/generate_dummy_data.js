const fs = require('fs');
const crypto = require('crypto');

function uuid() {
  return crypto.randomUUID();
}

// Custom Categories
const categories = [
  "Breakfast", "Lunch", "Dinner", "Grocery", "Metro", 
  "Fruits", "Snacks", "Stay", "Activity", "Shopping", 
  "Entertainment", "Beverages", "Fuel", "Others"
];

// Regular Members
const regularMembers = ["Alice", "Bob", "Charlie", "David", "Eva", "Frank"];

// Pre-Paid Wallets
const wallets = [
  { name: "alice", creditBalance: 750.0 }, // Has decent credit
  { name: "bob", creditBalance: 150.0 },   // Has some credit
  { name: "charlie", creditBalance: 0.0 }, // No credit
  { name: "david", creditBalance: 300.0 }  // Some credit
];

// Custom Travel Events
const events = [
  {
    id: "event-goa-2025",
    name: "Goa Trip 2025",
    startDate: "2025-05-10",
    isActive: false
  },
  {
    id: "event-office-retreat",
    name: "Office Retreat 2025",
    startDate: "2025-10-15",
    isActive: false
  },
  {
    id: "event-himalayas-trek",
    name: "Himalayas Trek 2026",
    startDate: "2026-04-12",
    isActive: true
  }
];

const expenses = [];

// Helper to format ISO dates
function makeISODate(year, month, day, hour = 12, minute = 0) {
  const mStr = String(month).padStart(2, '0');
  const dStr = String(day).padStart(2, '0');
  const hStr = String(hour).padStart(2, '0');
  const minStr = String(minute).padStart(2, '0');
  return `${year}-${mStr}-${dStr}T${hStr}:${minStr}:00.000Z`;
}

// Generate data from Jan 2025 to June 2026 (18 months)
const startYear = 2025;
const endYear = 2026;

// We will build a list of dates & transaction patterns.
// For standard months, we generate:
// - 3-4 regular expenses
// - 1-2 split expenses (some settled, some unsettled)

for (let y = startYear; y <= endYear; y++) {
  const maxMonth = (y === 2026) ? 6 : 12;
  for (let m = 1; m <= maxMonth; m++) {
    // 1. Regular Personal Expenses (Groceries, Fuel, Coffee, Metro etc.)
    
    // Coffee/Snacks
    expenses.push({
      id: uuid(),
      expenseDate: makeISODate(y, m, 3, 9, 30),
      createdAt: makeISODate(y, m, 3, 9, 35),
      category: "Snacks",
      totalAmount: 180,
      myShare: 180,
      remark: "Starbucks coffee and cookie",
      paymentMode: "UPI",
      isSplit: false
    });

    // Grocery
    expenses.push({
      id: uuid(),
      expenseDate: makeISODate(y, m, 10, 18, 15),
      createdAt: makeISODate(y, m, 10, 18, 30),
      category: "Grocery",
      totalAmount: 1250,
      myShare: 1250,
      remark: "Weekly essentials & milk",
      paymentMode: "Card",
      isSplit: false
    });

    // Metro / Transport / Fuel
    const isOdd = m % 2 === 0;
    expenses.push({
      id: uuid(),
      expenseDate: makeISODate(y, m, 15, 8, 45),
      createdAt: makeISODate(y, m, 15, 8, 50),
      category: isOdd ? "Metro" : "Fuel",
      totalAmount: isOdd ? 150 : 800,
      myShare: isOdd ? 150 : 800,
      remark: isOdd ? "Metro smart card recharge" : "Petrol auto-refuel",
      paymentMode: isOdd ? "Cash" : "Card",
      isSplit: false
    });

    // Lunch / Dinner (Personal)
    expenses.push({
      id: uuid(),
      expenseDate: makeISODate(y, m, 22, 13, 20),
      createdAt: makeISODate(y, m, 22, 13, 30),
      category: "Lunch",
      totalAmount: 320,
      myShare: 320,
      remark: "Subway meal combo",
      paymentMode: "UPI",
      isSplit: false
    });

    // 2. Split Expenses
    
    // Scenario A: Equal Split, Settled (UPI)
    // E.g. User pays 600, splits equally with Alice & Bob (3 people total, 200 each). Both have paid.
    expenses.push({
      id: uuid(),
      expenseDate: makeISODate(y, m, 5, 20, 0),
      createdAt: makeISODate(y, m, 5, 20, 10),
      category: "Dinner",
      totalAmount: 600,
      myShare: 200,
      remark: "Burger joint dinner with Alice and Bob",
      paymentMode: "UPI",
      isSplit: true,
      splitDetails: {
        isSettled: true,
        participants: [
          { id: uuid(), name: "Alice", shareAmount: 200, hasPaid: true },
          { id: uuid(), name: "Bob", shareAmount: 200, hasPaid: true }
        ]
      }
    });

    // Scenario B: Equal Split, Unsettled (Card)
    // E.g. User pays 1200, splits with Alice, Bob, Charlie (4 people total, 300 each). Charlie hasn't paid.
    expenses.push({
      id: uuid(),
      expenseDate: makeISODate(y, m, 12, 19, 30),
      createdAt: makeISODate(y, m, 12, 20, 0),
      category: "Entertainment",
      totalAmount: 1200,
      myShare: 300,
      remark: "Movie tickets booking",
      paymentMode: "Card",
      isSplit: true,
      splitDetails: {
        isSettled: false,
        participants: [
          { id: uuid(), name: "Alice", shareAmount: 300, hasPaid: true },
          { id: uuid(), name: "Bob", shareAmount: 300, hasPaid: true },
          { id: uuid(), name: "Charlie", shareAmount: 300, hasPaid: false } // Unsettled
        ]
      }
    });

    // Scenario C: Custom Split, Settled
    // User pays 1000, user share is 400, David owes 600 (custom share).
    expenses.push({
      id: uuid(),
      expenseDate: makeISODate(y, m, 18, 14, 0),
      createdAt: makeISODate(y, m, 18, 14, 15),
      category: "Shopping",
      totalAmount: 1000,
      myShare: 400,
      remark: "Department store shared purchases",
      paymentMode: "Card",
      isSplit: true,
      splitDetails: {
        isSettled: true,
        participants: [
          { id: uuid(), name: "David", shareAmount: 600, hasPaid: true, isCustomShare: true }
        ]
      }
    });

    // Scenario D: Custom Split, Unsettled
    // User pays 1500, User share 500, Eva owes 400 (custom), Frank owes 600 (custom). Frank has not paid.
    expenses.push({
      id: uuid(),
      expenseDate: makeISODate(y, m, 25, 17, 45),
      createdAt: makeISODate(y, m, 25, 18, 0),
      category: "Others",
      totalAmount: 1500,
      myShare: 500,
      remark: "Group gift for friend",
      paymentMode: "UPI",
      isSplit: true,
      splitDetails: {
        isSettled: false,
        participants: [
          { id: uuid(), name: "Eva", shareAmount: 400, hasPaid: true, isCustomShare: true },
          { id: uuid(), name: "Frank", shareAmount: 600, hasPaid: false, isCustomShare: true } // Unsettled
        ]
      }
    });

    // Scenario E: Wallet scenarios (pre-entered records representing wallet transactions)
    // - E1: Auto-deduction where participant's wallet fully covered their share.
    // Let's say user adds an expense of 300, split with Alice (150 each). Since Alice has 750 credit, it was auto-paid.
    if (m % 3 === 0) {
      expenses.push({
        id: uuid(),
        expenseDate: makeISODate(y, m, 28, 16, 0),
        createdAt: makeISODate(y, m, 28, 16, 5),
        category: "Beverages",
        totalAmount: 300,
        myShare: 150,
        remark: "Evening drinks [₹150 auto-deducted from Alice's wallet]",
        paymentMode: "Cash",
        isSplit: true,
        splitDetails: {
          isSettled: true,
          participants: [
            { id: uuid(), name: "Alice", shareAmount: 150, hasPaid: true } // Already settled via wallet
          ]
        }
      });
      
      // - E2: Partial wallet deduction (used remaining wallet credit, but some remains unsettled).
      // Let's say Bob owed 300, but his wallet only had 150. So 150 was deducted, leaving Bob with a share of 150 that is unsettled.
      expenses.push({
        id: uuid(),
        expenseDate: makeISODate(y, m, 29, 21, 10),
        createdAt: makeISODate(y, m, 29, 21, 20),
        category: "Dinner",
        totalAmount: 600,
        myShare: 300,
        remark: "Takeout meal [Used remaining ₹150 wallet credit for Bob]",
        paymentMode: "UPI",
        isSplit: true,
        splitDetails: {
          isSettled: false,
          participants: [
            { id: uuid(), name: "Bob", shareAmount: 150, hasPaid: false } // Bob still owes 150 (unsettled)
          ]
        }
      });
    }

    // 3. Inject Events / Sessions
    // A: Goa Trip 2025 (May 2025)
    if (y === 2025 && m === 5) {
      // Stay
      expenses.push({
        id: uuid(),
        expenseDate: makeISODate(2025, 5, 10, 14, 0),
        createdAt: makeISODate(2025, 5, 10, 14, 15),
        category: "Stay",
        totalAmount: 12000,
        myShare: 3000,
        remark: "Goa Beach Resort Booking - 4 nights",
        paymentMode: "Card",
        isSplit: true,
        eventId: "event-goa-2025",
        splitDetails: {
          isSettled: true,
          participants: [
            { id: uuid(), name: "Alice", shareAmount: 3000, hasPaid: true },
            { id: uuid(), name: "Bob", shareAmount: 3000, hasPaid: true },
            { id: uuid(), name: "Charlie", shareAmount: 3000, hasPaid: true }
          ]
        }
      });

      // Activity
      expenses.push({
        id: uuid(),
        expenseDate: makeISODate(2025, 5, 11, 10, 30),
        createdAt: makeISODate(2025, 5, 11, 10, 45),
        category: "Activity",
        totalAmount: 4500,
        myShare: 1125,
        remark: "Scuba Diving & Water sports package",
        paymentMode: "UPI",
        isSplit: true,
        eventId: "event-goa-2025",
        splitDetails: {
          isSettled: false,
          participants: [
            { id: uuid(), name: "Alice", shareAmount: 1125, hasPaid: true },
            { id: uuid(), name: "Bob", shareAmount: 1125, hasPaid: true },
            { id: uuid(), name: "Charlie", shareAmount: 1125, hasPaid: false } // Charlie owes diving money
          ]
        }
      });

      // Dinner
      expenses.push({
        id: uuid(),
        expenseDate: makeISODate(2025, 5, 12, 21, 0),
        createdAt: makeISODate(2025, 5, 12, 21, 30),
        category: "Dinner",
        totalAmount: 2400,
        myShare: 600,
        remark: "Seafood dinner shacks at beach",
        paymentMode: "Cash",
        isSplit: true,
        eventId: "event-goa-2025",
        splitDetails: {
          isSettled: true,
          participants: [
            { id: uuid(), name: "Alice", shareAmount: 600, hasPaid: true },
            { id: uuid(), name: "Bob", shareAmount: 600, hasPaid: true },
            { id: uuid(), name: "Charlie", shareAmount: 600, hasPaid: true }
          ]
        }
      });
    }

    // B: Office Retreat 2025 (October 2025)
    if (y === 2025 && m === 10) {
      expenses.push({
        id: uuid(),
        expenseDate: makeISODate(2025, 10, 15, 9, 0),
        createdAt: makeISODate(2025, 10, 15, 9, 10),
        category: "Activity",
        totalAmount: 8000,
        myShare: 2000,
        remark: "Office retreat team building games & arena rent",
        paymentMode: "Card",
        isSplit: true,
        eventId: "event-office-retreat",
        splitDetails: {
          isSettled: true,
          participants: [
            { id: uuid(), name: "David", shareAmount: 2000, hasPaid: true },
            { id: uuid(), name: "Eva", shareAmount: 2000, hasPaid: true },
            { id: uuid(), name: "Frank", shareAmount: 2000, hasPaid: true }
          ]
        }
      });

      expenses.push({
        id: uuid(),
        expenseDate: makeISODate(2025, 10, 16, 13, 0),
        createdAt: makeISODate(2025, 10, 16, 13, 10),
        category: "Lunch",
        totalAmount: 3600,
        myShare: 900,
        remark: "Retreat catering lunch",
        paymentMode: "UPI",
        isSplit: true,
        eventId: "event-office-retreat",
        splitDetails: {
          isSettled: false,
          participants: [
            { id: uuid(), name: "David", shareAmount: 900, hasPaid: true },
            { id: uuid(), name: "Eva", shareAmount: 900, hasPaid: false }, // Eva owes lunch
            { id: uuid(), name: "Frank", shareAmount: 900, hasPaid: true }
          ]
        }
      });
    }

    // C: Himalayas Trek 2026 (April & May 2026)
    if (y === 2026 && (m === 4 || m === 5)) {
      if (m === 4) {
        expenses.push({
          id: uuid(),
          expenseDate: makeISODate(2026, 4, 12, 10, 0),
          createdAt: makeISODate(2026, 4, 12, 10, 15),
          category: "Shopping",
          totalAmount: 4500,
          myShare: 4500,
          remark: "Trekking gear, thermal layers, and boots",
          paymentMode: "Card",
          isSplit: false,
          eventId: "event-himalayas-trek"
        });

        expenses.push({
          id: uuid(),
          expenseDate: makeISODate(2026, 4, 20, 14, 0),
          createdAt: makeISODate(2026, 4, 20, 14, 10),
          category: "Activity",
          totalAmount: 15000,
          myShare: 5000,
          remark: "Himalayas Basecamp registration & guide fees",
          paymentMode: "UPI",
          isSplit: true,
          eventId: "event-himalayas-trek",
          splitDetails: {
            isSettled: true,
            participants: [
              { id: uuid(), name: "David", shareAmount: 5000, hasPaid: true },
              { id: uuid(), name: "Frank", shareAmount: 5000, hasPaid: true }
            ]
          }
        });
      }

      if (m === 5) {
        expenses.push({
          id: uuid(),
          expenseDate: makeISODate(2026, 5, 2, 8, 30),
          createdAt: makeISODate(2026, 5, 2, 8, 45),
          category: "Stay",
          totalAmount: 6000,
          myShare: 2000,
          remark: "Basecamp tents & sleeping bag rentals",
          paymentMode: "Cash",
          isSplit: true,
          eventId: "event-himalayas-trek",
          splitDetails: {
            isSettled: false,
            participants: [
              { id: uuid(), name: "David", shareAmount: 2000, hasPaid: true },
              { id: uuid(), name: "Frank", shareAmount: 2000, hasPaid: false } // Frank unsettled
            ]
          }
        });

        expenses.push({
          id: uuid(),
          expenseDate: makeISODate(2026, 5, 6, 19, 0),
          createdAt: makeISODate(2026, 5, 6, 19, 10),
          category: "Dinner",
          totalAmount: 1800,
          myShare: 600,
          remark: "Hot mountain dinner at summit lodge",
          paymentMode: "Cash",
          isSplit: true,
          eventId: "event-himalayas-trek",
          splitDetails: {
            isSettled: true,
            participants: [
              { id: uuid(), name: "David", shareAmount: 600, hasPaid: true },
              { id: uuid(), name: "Frank", shareAmount: 600, hasPaid: true }
            ]
          }
        });
      }
    }
  }
}

// 4. Current Week/Month Expenses (June 2026)
// To ensure the dashboard graphs are filled for "This Week" and "This Month"
// Current local time: 2026-06-24. 
// "This Week" starts on Sunday, June 21, 2026.

// Expenses earlier in June (will show in This Month, but not This Week)
expenses.push({
  id: uuid(),
  expenseDate: makeISODate(2026, 6, 5, 12, 10),
  createdAt: makeISODate(2026, 6, 5, 12, 15),
  category: "Lunch",
  totalAmount: 280,
  myShare: 280,
  remark: "Lunch at office canteen",
  paymentMode: "UPI",
  isSplit: false
});

expenses.push({
  id: uuid(),
  expenseDate: makeISODate(2026, 6, 12, 19, 0),
  createdAt: makeISODate(2026, 6, 12, 19, 10),
  category: "Grocery",
  totalAmount: 980,
  myShare: 980,
  remark: "Weekend grocery store trip",
  paymentMode: "Card",
  isSplit: false
});

expenses.push({
  id: uuid(),
  expenseDate: makeISODate(2026, 6, 15, 16, 0),
  createdAt: makeISODate(2026, 6, 15, 16, 10),
  category: "Snacks",
  totalAmount: 450,
  myShare: 150,
  remark: "Evening cafe team snacks",
  paymentMode: "UPI",
  isSplit: true,
  splitDetails: {
    isSettled: false,
    participants: [
      { id: uuid(), name: "Alice", shareAmount: 150, hasPaid: true },
      { id: uuid(), name: "Charlie", shareAmount: 150, hasPaid: false } // Unsettled
    ]
  }
});

// Expenses in "This Week" (June 21 - June 24, 2026)
expenses.push({
  id: uuid(),
  expenseDate: makeISODate(2026, 6, 21, 10, 30), // Sunday
  createdAt: makeISODate(2026, 6, 21, 10, 35),
  category: "Breakfast",
  totalAmount: 160,
  myShare: 160,
  remark: "Sunday brunch tea & toast",
  paymentMode: "Cash",
  isSplit: false
});

expenses.push({
  id: uuid(),
  expenseDate: makeISODate(2026, 6, 22, 14, 0), // Monday
  createdAt: makeISODate(2026, 6, 22, 14, 5),
  category: "Lunch",
  totalAmount: 350,
  myShare: 350,
  remark: "Executive lunch thali",
  paymentMode: "UPI",
  isSplit: false
});

expenses.push({
  id: uuid(),
  expenseDate: makeISODate(2026, 6, 23, 20, 15), // Tuesday
  createdAt: makeISODate(2026, 6, 23, 20, 20),
  category: "Dinner",
  totalAmount: 1500,
  myShare: 500,
  remark: "Pre-birthday celebration dinner with Alice and Charlie",
  paymentMode: "Card",
  isSplit: true,
  splitDetails: {
    isSettled: false,
    participants: [
      { id: uuid(), name: "Alice", shareAmount: 500, hasPaid: true },
      { id: uuid(), name: "Charlie", shareAmount: 500, hasPaid: false } // Charlie owes 500
    ]
  }
});

expenses.push({
  id: uuid(),
  expenseDate: makeISODate(2026, 6, 24, 9, 0), // Wednesday (Today!)
  createdAt: makeISODate(2026, 6, 24, 9, 5),
  category: "Metro",
  totalAmount: 80,
  myShare: 80,
  remark: "Commute to work",
  paymentMode: "UPI",
  isSplit: false
});

const backup = {
  backupVersion: "1.0.0",
  exportedAt: new Date().toISOString(),
  expenses,
  events,
  wallets,
  categories,
  regularMembers
};

fs.writeFileSync('../sample_data.json', JSON.stringify(backup, null, 2), 'utf-8');
console.log(`Generated ${expenses.length} expenses successfully! Saved to sample_data.json`);
