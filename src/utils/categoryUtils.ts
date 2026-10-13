import { CategoryGroup } from '../types';

export const DEFAULT_CATEGORY_GROUPS: CategoryGroup[] = [
  {
    id: 'food',
    name: 'Food',
    subcategories: ['Breakfast', 'Lunch', 'Dinner', 'Snacks', 'Fruits'],
  },
  {
    id: 'transport',
    name: 'Transport',
    subcategories: ['Metro', 'Bus', 'Train', 'Fuel', 'Cab/Auto'],
  },
  {
    id: 'groceries',
    name: 'Groceries',
    subcategories: ['Groceries', 'Supermarket', 'Supplies'],
  },
  {
    id: 'shopping',
    name: 'Shopping',
    subcategories: ['Clothing', 'Electronics', 'Personal Care'],
  },
  {
    id: 'entertainment',
    name: 'Entertainment',
    subcategories: ['Movies', 'Outing', 'Subscriptions', 'Games'],
  },
  {
    id: 'bills',
    name: 'Bills & Utilities',
    subcategories: ['Rent', 'Electricity', 'Internet', 'Recharge'],
  },
  {
    id: 'others',
    name: 'Others',
    subcategories: ['Others', 'Miscellaneous'],
  },
];

/**
 * Returns a flat, unique list of all child categories across all groups.
 */
export function getAllSubcategories(groups: CategoryGroup[]): string[] {
  const list: string[] = [];
  groups.forEach(g => {
    if (Array.isArray(g.subcategories)) {
      g.subcategories.forEach(sub => {
        if (sub && !list.includes(sub)) {
          list.push(sub);
        }
      });
    }
  });
  return list;
}

/**
 * Resolves an expense category (which may be a child category like "Lunch" or a parent like "Food")
 * to its Parent Category Name.
 */
export function getParentCategory(categoryName: string, groups: CategoryGroup[]): string {
  if (!categoryName) return 'Others';
  const trimmed = categoryName.trim();
  const lower = trimmed.toLowerCase();

  // 1. Check if category matches any child category
  for (const group of groups) {
    if (Array.isArray(group.subcategories)) {
      for (const sub of group.subcategories) {
        if (sub.toLowerCase() === lower) {
          return group.name;
        }
      }
    }
  }

  // 2. Check if category matches a parent group name directly
  for (const group of groups) {
    if (group.name.toLowerCase() === lower) {
      return group.name;
    }
  }

  // 3. Fallback: if not found, check if an 'Others' group exists, otherwise return the trimmed name
  const othersGroup = groups.find(g => g.name.toLowerCase() === 'others');
  return othersGroup ? othersGroup.name : trimmed;
}

/**
 * Migrates legacy string[] or raw json data into a valid CategoryGroup[] structure.
 */
export function migrateCategories(storedData: any): CategoryGroup[] {
  if (!storedData) {
    return DEFAULT_CATEGORY_GROUPS;
  }

  // If already structured as CategoryGroup[]
  if (Array.isArray(storedData) && storedData.length > 0 && typeof storedData[0] === 'object' && storedData[0] !== null && 'name' in storedData[0]) {
    return storedData.map((item: any, idx: number) => ({
      id: item.id || `group_${idx}_${Date.now()}`,
      name: typeof item.name === 'string' ? item.name.trim() : `Group ${idx + 1}`,
      subcategories: Array.isArray(item.subcategories) 
        ? item.subcategories.filter((s: any): s is string => typeof s === 'string' && s.trim().length > 0).map((s: string) => s.trim())
        : []
    }));
  }

  // If legacy flat string array
  if (Array.isArray(storedData)) {
    const legacyStrings = storedData.filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
    
    // Deep clone defaults
    const result: CategoryGroup[] = DEFAULT_CATEGORY_GROUPS.map(g => ({
      id: g.id,
      name: g.name,
      subcategories: [...g.subcategories]
    }));

    // Find any custom strings not already present in default subcategories
    const allKnownSubcats = new Set<string>();
    result.forEach(g => g.subcategories.forEach(s => allKnownSubcats.add(s.toLowerCase())));

    legacyStrings.forEach(str => {
      const trimmed = str.trim();
      if (!allKnownSubcats.has(trimmed.toLowerCase())) {
        // Place in 'Others' group or create
        const others = result.find(g => g.name.toLowerCase() === 'others');
        if (others) {
          if (!others.subcategories.some(s => s.toLowerCase() === trimmed.toLowerCase())) {
            others.subcategories.push(trimmed);
          }
        } else {
          result.push({
            id: `cat_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            name: trimmed,
            subcategories: [trimmed]
          });
        }
      }
    });

    return result;
  }

  return DEFAULT_CATEGORY_GROUPS;
}
