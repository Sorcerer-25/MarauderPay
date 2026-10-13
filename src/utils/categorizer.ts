export const KEYWORD_CATEGORY_MAP: Record<string, string[]> = {
  'Breakfast': ['breakfast', 'idli', 'dosa', 'poha', 'paratha'],
  'Lunch': ['swiggy', 'zomato', 'canteen', 'restaurant', 'mcdonalds', 'kfc', 'subway', 'thali', 'lunch'],
  'Dinner': ['barbeque', 'dine', 'hotel', 'biryani', 'pizza', 'dinner'],
  'Snacks': ['starbucks', 'cafe', 'coffee', 'chai', 'bakery', 'tea', 'juice', 'chaat', 'snack'],
  'Fruits': ['fruits', 'fruit', 'apple', 'banana'],
  'Groceries': ['blinkit', 'zepto', 'instamart', 'dmart', 'supermarket', 'fresh', 'milk', 'grocery', 'groceries'],
  'Metro': ['metro', 'dmrc', 'bmrc', 'smart card'],
  'Bus': ['bus', 'redbus', 'ksrtc', 'dtc', 'chalo'],
  'Train': ['irctc', 'rail', 'railway', 'train'],
  'Cab/Auto': ['uber', 'ola', 'rapido', 'auto', 'cab'],
  'Fuel': ['petrol', 'fuel', 'hpcl', 'iocl', 'bpcl', 'shell', 'cng', 'diesel'],
  'Shopping': ['amazon', 'flipkart', 'myntra', 'zara', 'h&m', 'shopping', 'clothing'],
  'Entertainment': ['bookmyshow', 'pvr', 'inox', 'netflix', 'spotify', 'cinema', 'movie'],
  'Bills & Utilities': ['electricity', 'bescom', 'airtel', 'jio', 'broadband', 'water', 'gas', 'recharge', 'rent'],
};

/**
 * Automatically suggests a category for a given merchant name and remark.
 * 
 * @param merchant The cleaned merchant or beneficiary name.
 * @param remark The transaction narration or remark.
 * @returns The suggested category, or 'Others' if no keywords match.
 */
export function suggestCategory(merchant: string, remark?: string): string {
  const textToSearch = `${merchant} ${remark || ''}`.toLowerCase();
  
  for (const [category, keywords] of Object.entries(KEYWORD_CATEGORY_MAP)) {
    for (const keyword of keywords) {
      if (textToSearch.includes(keyword.toLowerCase())) {
        return category;
      }
    }
  }
  
  return 'Others';
}
