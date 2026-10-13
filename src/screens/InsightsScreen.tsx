import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Dimensions, TouchableOpacity, Modal, Alert, Platform, TextInput } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PieChart } from 'react-native-chart-kit';
import { InteractiveBarChart, BarGroupData, BarDataPoint } from '../components/InteractiveBarChart';
import { useExpenses } from '../contexts/ExpenseContext';
import { useToast } from '../contexts/ToastContext';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/types';
import { getSolidColor } from '../theme/palettes';
import { parseISO, format, getYear, getMonth, startOfMonth, endOfMonth, eachWeekOfInterval, isWithinInterval, startOfDay, endOfDay } from 'date-fns';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheetSelector } from '../components/BottomSheetSelector';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import DateTimePicker from '@react-native-community/datetimepicker';

const screenWidth = Dimensions.get('window').width;

const getChartConfig = (theme: ThemeColors) => ({
  backgroundGradientFrom: theme.card,
  backgroundGradientTo: theme.card,
  color: (opacity = 1) => theme.primary,
  labelColor: (opacity = 1) => theme.textSecondary,
  strokeWidth: 2,
  barPercentage: 0.5,
  useShadowColorFromDataset: false,
  decimalPlaces: 0,
});

export const InsightsScreen = () => {
  const { theme, mode } = useTheme();
  const { showToast } = useToast();
  const styles = getStyles(theme, mode);
  const { expenses, events, categoryGroups, getParentCategoryName } = useExpenses();
  const [fullScreenChart, setFullScreenChart] = useState<string | null>(null);

  // --- Threshold Limits State & Persistence ---
  const [thresholdYoY, setThresholdYoY] = useState<number>(0);
  const [thresholdWeekly, setThresholdWeekly] = useState<number>(0);
  const [ignoredWeeklyLimitCategories, setIgnoredWeeklyLimitCategories] = useState<string[]>([]);
  const [expandedParentCategories, setExpandedParentCategories] = useState<string[]>(['Bills & Utilities']);
  const [thresholdModalTarget, setThresholdModalTarget] = useState<'A' | 'B' | null>(null);
  const [tempThresholdInput, setTempThresholdInput] = useState<string>('');

  useEffect(() => {
    const loadThresholds = async () => {
      try {
        const storedYoY = await AsyncStorage.getItem('@insights_threshold_yoy');
        const storedWeekly = await AsyncStorage.getItem('@insights_threshold_weekly');
        const storedWeeklyIgnored = await AsyncStorage.getItem('@insights_weekly_ignored_categories') || await AsyncStorage.getItem('@insights_ignored_limit_categories');
        if (storedYoY !== null) {
          setThresholdYoY(parseFloat(storedYoY) || 0);
        }
        if (storedWeekly !== null) {
          setThresholdWeekly(parseFloat(storedWeekly) || 0);
        }
        if (storedWeeklyIgnored) {
          try {
            const parsed = JSON.parse(storedWeeklyIgnored);
            if (Array.isArray(parsed)) {
              setIgnoredWeeklyLimitCategories(parsed);
            }
          } catch (e) {
            console.error('Failed to parse ignored weekly limit categories', e);
          }
        }
      } catch (err) {
        console.error('Failed to load chart thresholds', err);
      }
    };
    loadThresholds();
  }, []);

  const openThresholdModal = (target: 'A' | 'B') => {
    setThresholdModalTarget(target);
    const currentVal = target === 'A' ? thresholdYoY : thresholdWeekly;
    setTempThresholdInput(currentVal > 0 ? currentVal.toString() : '');
  };

  const saveThreshold = async (val: number) => {
    if (thresholdModalTarget === 'A') {
      setThresholdYoY(val);
      await AsyncStorage.setItem('@insights_threshold_yoy', val.toString());
      showToast(val > 0 ? `Monthly limit set to ₹${val.toLocaleString('en-IN')}` : 'Monthly limit set to Auto (Fit to Expenses)', 'info');
    } else if (thresholdModalTarget === 'B') {
      setThresholdWeekly(val);
      await AsyncStorage.setItem('@insights_threshold_weekly', val.toString());
      showToast(val > 0 ? `Weekly limit set to ₹${val.toLocaleString('en-IN')}` : 'Weekly limit set to Auto (Fit to Expenses)', 'info');
    }
    setThresholdModalTarget(null);
  };

  // Build full hierarchy of parent categories and their subcategories
  const categoryHierarchy = useMemo(() => {
    const groups: { id: string; name: string; subcategories: string[] }[] = categoryGroups.map(g => ({
      id: g.id,
      name: g.name,
      subcategories: Array.isArray(g.subcategories) ? [...g.subcategories] : [],
    }));

    // Ensure Bills & Utilities exists and includes Rent
    const billsGroup = groups.find(g => g.name.toLowerCase() === 'bills & utilities' || g.id === 'bills');
    if (billsGroup) {
      if (!billsGroup.subcategories.includes('Rent')) {
        billsGroup.subcategories.unshift('Rent');
      }
    } else {
      groups.unshift({
        id: 'bills',
        name: 'Bills & Utilities',
        subcategories: ['Rent', 'Electricity', 'Internet', 'Recharge'],
      });
    }

    // Include any custom categories from expenses under appropriate parent
    expenses.forEach(e => {
      if (!e.category) return;
      const parentName = getParentCategoryName(e.category);
      const targetGroup = groups.find(g => g.name.toLowerCase() === parentName.toLowerCase());
      if (targetGroup) {
        if (!targetGroup.subcategories.includes(e.category)) {
          targetGroup.subcategories.push(e.category);
        }
      } else {
        const othersGroup = groups.find(g => g.name.toLowerCase() === 'others');
        if (othersGroup && !othersGroup.subcategories.includes(e.category)) {
          othersGroup.subcategories.push(e.category);
        }
      }
    });

    return groups;
  }, [categoryGroups, expenses, getParentCategoryName]);

  const toggleParentExpanded = (parentName: string) => {
    setExpandedParentCategories(prev =>
      prev.includes(parentName) ? prev.filter(p => p !== parentName) : [...prev, parentName]
    );
  };

  const toggleIgnoredWeeklyCategory = async (cat: string) => {
    let updated: string[];
    if (ignoredWeeklyLimitCategories.includes(cat)) {
      updated = ignoredWeeklyLimitCategories.filter(c => c !== cat);
    } else {
      updated = [...ignoredWeeklyLimitCategories, cat];
    }
    setIgnoredWeeklyLimitCategories(updated);
    try {
      await AsyncStorage.setItem('@insights_weekly_ignored_categories', JSON.stringify(updated));
    } catch (err) {
      console.error('Failed to persist weekly ignored categories', err);
    }
  };

  const toggleAllSubcategoriesInGroup = async (group: { name: string; subcategories: string[] }) => {
    const subcats = group.subcategories;
    const allSelected = subcats.length > 0 && subcats.every(s => ignoredWeeklyLimitCategories.includes(s));
    let updated: string[];
    if (allSelected) {
      updated = ignoredWeeklyLimitCategories.filter(c => !subcats.includes(c) && c !== group.name);
    } else {
      const set = new Set([...ignoredWeeklyLimitCategories, ...subcats]);
      updated = Array.from(set);
    }
    setIgnoredWeeklyLimitCategories(updated);
    try {
      await AsyncStorage.setItem('@insights_weekly_ignored_categories', JSON.stringify(updated));
    } catch (err) {
      console.error('Failed to persist weekly ignored categories', err);
    }
  };

  const clearWeeklyIgnoredCategories = async () => {
    setIgnoredWeeklyLimitCategories([]);
    try {
      await AsyncStorage.setItem('@insights_weekly_ignored_categories', JSON.stringify([]));
    } catch (err) {
      console.error('Failed to clear weekly ignored categories', err);
    }
  };

  const isWeeklyCategoryIgnored = (expenseCat: string) => {
    if (!ignoredWeeklyLimitCategories || ignoredWeeklyLimitCategories.length === 0) return false;
    const catLower = (expenseCat || '').trim().toLowerCase();
    const parentLower = (getParentCategoryName(expenseCat) || '').trim().toLowerCase();

    return ignoredWeeklyLimitCategories.some(item => {
      const itemLower = item.trim().toLowerCase();
      return itemLower === catLower || itemLower === parentLower;
    });
  };

  const formatCompact = (val: number) => {
    if (val === 0) return '0';
    if (val >= 10000000) return `${(val / 10000000).toFixed(1)}Cr`;
    if (val >= 100000) return `${(val / 100000).toFixed(val % 100000 === 0 ? 0 : 1)}L`;
    if (val >= 1000) {
      const k = val / 1000;
      return `${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}K`;
    }
    return `${val}`;
  };

  const yoyPresets = [2000, 5000, 10000, 15000, 20000, 30000, 50000, 100000];
  const weeklyPresets = [500, 1000, 2500, 5000, 7500, 10000, 15000, 20000, 25000];

  // --- Chart A State (Year-Over-Year Monthly: No category ignoring) ---
  const [selectedYears, setSelectedYears] = useState<number[]>([new Date().getFullYear()]);
  const [showYearSelector, setShowYearSelector] = useState(false);

  const availableYears = useMemo(() => {
    const years = new Set<number>();
    expenses.forEach(e => years.add(getYear(parseISO(e.expenseDate))));
    const currentYear = new Date().getFullYear();
    years.add(currentYear);
    return Array.from(years).sort((a, b) => b - a);
  }, [expenses]);

  const toggleYear = (year: number) => {
    if (selectedYears.includes(year)) {
      if (selectedYears.length > 1) {
        setSelectedYears(selectedYears.filter(y => y !== year));
      }
    } else {
      if (selectedYears.length < 3) {
        setSelectedYears([...selectedYears, year].sort());
      }
    }
  };

  const yearColors = [
    '#3182CE', // Blue
    '#38A169', // Green
    '#DD6B20', // Orange
  ];

  const chartALegendItems = useMemo(() => {
    return selectedYears.map((year, idx) => ({
      label: `${year}`,
      color: yearColors[idx % yearColors.length],
    }));
  }, [selectedYears]);

  const interactiveChartAData: BarGroupData[] = useMemo(() => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const fullMonths = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];

    return months.map((month, mIndex) => {
      const bars: BarDataPoint[] = selectedYears.map((year, yIndex) => {
        let sum = 0;
        expenses.forEach(e => {
          const d = parseISO(e.expenseDate);
          if (getYear(d) === year && getMonth(d) === mIndex) {
            sum += (e.isSplit && e.splitDetails?.isSettled) ? e.myShare : e.totalAmount;
          }
        });

        const isOver = thresholdYoY > 0 && sum > thresholdYoY;

        return {
          id: `yoy-${month}-${year}`,
          value: sum,
          isOverThreshold: isOver,
          color: yearColors[yIndex % yearColors.length],
          label: `${year}`,
          tooltipTitle: `${fullMonths[mIndex]} ${year}`,
        };
      });

      return {
        groupKey: month,
        groupLabel: month,
        bars,
      };
    });
  }, [expenses, selectedYears, thresholdYoY]);


  // --- Chart B State (Week-Wise Breakdown: Supports category ignoring) ---
  const [chartBMonthYear, setChartBMonthYear] = useState(format(new Date(), 'yyyy-MM'));
  const [showChartBSelector, setShowChartBSelector] = useState(false);

  const availableMonths = useMemo(() => {
    const months = new Set<string>();
    expenses.forEach(e => months.add(format(parseISO(e.expenseDate), 'yyyy-MM')));
    months.add(format(new Date(), 'yyyy-MM'));
    return Array.from(months).sort((a, b) => b.localeCompare(a));
  }, [expenses]);

  const chartBMonthOptions = availableMonths.map(m => ({
    label: format(parseISO(`${m}-01`), 'MMMM yyyy'),
    value: m
  }));

  const interactiveChartBData: BarGroupData[] = useMemo(() => {
    const targetDate = parseISO(`${chartBMonthYear}-01`);
    const monthStart = startOfMonth(targetDate);
    const monthEnd = endOfMonth(targetDate);
    
    const weeks = eachWeekOfInterval({ start: monthStart, end: monthEnd }, { weekStartsOn: 1 });

    return weeks.map((weekStart, index) => {
      const rawWeekEnd = new Date(weekStart);
      rawWeekEnd.setDate(rawWeekEnd.getDate() + 6);
      
      // Strictly clamp within the target month boundaries
      const clampedStart = weekStart < monthStart ? monthStart : weekStart;
      const clampedEnd = rawWeekEnd > monthEnd ? monthEnd : rawWeekEnd;

      const startDay = startOfDay(clampedStart);
      const endDay = endOfDay(clampedEnd);

      const formattedStart = format(clampedStart, 'MMM dd');
      const formattedEnd = format(clampedEnd, 'MMM dd');
      const dateRange = formattedStart === formattedEnd 
        ? formattedStart 
        : `${formattedStart} - ${formattedEnd}`;

      let totalSum = 0;
      let ignoredSum = 0;
      const ignoredCatNames: string[] = [];

      expenses.forEach(e => {
        const d = parseISO(e.expenseDate);
        if (isWithinInterval(d, { start: startDay, end: endDay })) {
          const amt = (e.isSplit && e.splitDetails?.isSettled) ? e.myShare : e.totalAmount;
          totalSum += amt;
          if (isWeeklyCategoryIgnored(e.category)) {
            ignoredSum += amt;
            const catName = e.category || 'Other';
            if (!ignoredCatNames.includes(catName)) {
              ignoredCatNames.push(catName);
            }
          }
        }
      });

      const trackedSum = Math.max(0, totalSum - ignoredSum);
      const displayValue = ignoredWeeklyLimitCategories.length > 0 ? trackedSum : totalSum;
      const isOver = thresholdWeekly > 0 && trackedSum > thresholdWeekly;

      let subtitle = dateRange;
      if (ignoredSum > 0) {
        subtitle = `${dateRange} • Excluded: ₹${ignoredSum.toLocaleString('en-IN')} (${ignoredCatNames.slice(0, 2).join(', ')}) • Total: ₹${totalSum.toLocaleString('en-IN')}`;
      }

      return {
        groupKey: `W${index + 1}`,
        groupLabel: `W${index + 1}`,
        groupSubLabel: dateRange,
        bars: [
          {
            id: `week-${index + 1}`,
            value: displayValue,
            totalValue: totalSum,
            ignoredValue: ignoredSum,
            ignoredCategoriesText: ignoredCatNames.join(', '),
            isOverThreshold: isOver,
            color: '#48BB78',
            tooltipTitle: `Week ${index + 1} (${dateRange})`,
            tooltipSubtitle: subtitle,
          }
        ]
      };
    });
  }, [expenses, chartBMonthYear, ignoredWeeklyLimitCategories, thresholdWeekly, getParentCategoryName]);


  // --- Chart C State ---
  const [chartCFilter, setChartCFilter] = useState('all');
  const [showChartCSelector, setShowChartCSelector] = useState(false);

  const chartCFilterOptions = [
    { label: 'All Time (Overall)', value: 'all' },
    ...events.map(e => ({ label: e.name, value: e.id }))
  ];

  const chartCData = useMemo(() => {
    const categoryTotals: Record<string, number> = {};
    
    expenses.forEach(e => {
      if (chartCFilter !== 'all' && e.eventId !== chartCFilter) return;
      
      const amt = (e.isSplit && e.splitDetails?.isSettled) ? e.myShare : e.totalAmount;
      const parentCat = getParentCategoryName(e.category);
      categoryTotals[parentCat] = (categoryTotals[parentCat] || 0) + amt;
    });

    const colors = ['#3182CE', '#48BB78', '#ED8936', '#E53E3E', '#805AD5', '#38B2AC', '#D69E2E', '#F687B3', '#4FD1C5', '#F6AD55'];
    
    return Object.entries(categoryTotals)
      .filter(([_, value]) => value > 0)
      .map(([name, population], index) => ({
        name,
        population,
        color: colors[index % colors.length],
        legendFontColor: theme.textPrimary,
        legendFontSize: 12
      }))
      .sort((a, b) => b.population - a.population);
  }, [expenses, chartCFilter, getParentCategoryName, theme]);


  // --- All Parent Categories Available ---
  const allParentCategories = useMemo(() => {
    const catSet = new Set<string>();
    if (categoryGroups && categoryGroups.length > 0) {
      categoryGroups.forEach(g => {
        if (g.name) catSet.add(g.name);
      });
    }
    expenses.forEach(e => {
      const p = getParentCategoryName(e.category);
      if (p) catSet.add(p);
    });
    return Array.from(catSet).sort((a, b) => a.localeCompare(b));
  }, [categoryGroups, expenses, getParentCategoryName]);

  // --- Custom Pie Chart State ---
  const [isCustomizePieModalOpen, setIsCustomizePieModalOpen] = useState(false);
  const [pieFilterMode, setPieFilterMode] = useState<'month' | 'range' | 'event' | 'all'>('month');
  const [pieSelectedMonth, setPieSelectedMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [pieStartDate, setPieStartDate] = useState(startOfMonth(new Date()));
  const [pieEndDate, setPieEndDate] = useState(endOfMonth(new Date()));
  const [pieSelectedEvent, setPieSelectedEvent] = useState('all');
  const [pieSelectedCategories, setPieSelectedCategories] = useState<string[]>([]);
  const [showPieMonthSelector, setShowPieMonthSelector] = useState(false);
  const [showPieEventSelector, setShowPieEventSelector] = useState(false);
  const [showPieStartDatePicker, setShowPieStartDatePicker] = useState(false);
  const [showPieEndDatePicker, setShowPieEndDatePicker] = useState(false);

  // Sync initial categories when categories are loaded
  useEffect(() => {
    if (allParentCategories.length > 0 && pieSelectedCategories.length === 0) {
      setPieSelectedCategories(allParentCategories);
    }
  }, [allParentCategories]);

  const togglePieCategory = (cat: string) => {
    if (pieSelectedCategories.includes(cat)) {
      setPieSelectedCategories(prev => prev.filter(c => c !== cat));
    } else {
      setPieSelectedCategories(prev => [...prev, cat]);
    }
  };

  const selectAllPieCategories = () => {
    setPieSelectedCategories(allParentCategories);
  };

  const deselectAllPieCategories = () => {
    setPieSelectedCategories([]);
  };

  const resetPieFilters = () => {
    setPieFilterMode('month');
    setPieSelectedMonth(format(new Date(), 'yyyy-MM'));
    setPieStartDate(startOfMonth(new Date()));
    setPieEndDate(endOfMonth(new Date()));
    setPieSelectedEvent('all');
    setPieSelectedCategories(allParentCategories);
    showToast('Filters reset to default', 'info');
  };

  const customPieData = useMemo(() => {
    // If no categories are selected, return blank
    if (pieSelectedCategories.length === 0) {
      return { chartData: [], totalSpend: 0, items: [] };
    }

    let filtered = expenses;

    // Filter by mode
    if (pieFilterMode === 'month') {
      filtered = filtered.filter(e => format(parseISO(e.expenseDate), 'yyyy-MM') === pieSelectedMonth);
    } else if (pieFilterMode === 'range') {
      const startDay = startOfDay(pieStartDate);
      const endDay = endOfDay(pieEndDate);
      filtered = filtered.filter(e => {
        const d = parseISO(e.expenseDate);
        return isWithinInterval(d, { start: startDay, end: endDay });
      });
    } else if (pieFilterMode === 'event') {
      if (pieSelectedEvent !== 'all') {
        filtered = filtered.filter(e => e.eventId === pieSelectedEvent);
      }
    }

    // Filter by selected categories
    filtered = filtered.filter(e => {
      const parentCat = getParentCategoryName(e.category);
      return pieSelectedCategories.includes(parentCat);
    });

    const categoryTotals: Record<string, number> = {};
    let totalSpend = 0;

    filtered.forEach(e => {
      const amt = (e.isSplit && e.splitDetails?.isSettled) ? e.myShare : e.totalAmount;
      totalSpend += amt;
      const parentCat = getParentCategoryName(e.category);
      categoryTotals[parentCat] = (categoryTotals[parentCat] || 0) + amt;
    });

    const colors = [
      '#3182CE', '#48BB78', '#ED8936', '#E53E3E', '#805AD5', 
      '#38B2AC', '#D69E2E', '#F687B3', '#4FD1C5', '#F6AD55',
      '#9F7AEA', '#38A169', '#ECC94B', '#F56565', '#667EEA'
    ];

    const sorted = Object.entries(categoryTotals)
      .filter(([_, value]) => value > 0)
      .sort((a, b) => b[1] - a[1]);

    const chartData = sorted.map(([name, population], index) => ({
      name,
      population,
      color: colors[index % colors.length],
      legendFontColor: theme.textPrimary,
      legendFontSize: 12,
    }));

    const items = sorted.map(([name, amount], index) => ({
      name,
      amount,
      percentage: totalSpend > 0 ? (amount / totalSpend) * 100 : 0,
      color: colors[index % colors.length],
    }));

    return { chartData, totalSpend, items };
  }, [
    expenses,
    pieFilterMode,
    pieSelectedMonth,
    pieStartDate,
    pieEndDate,
    pieSelectedEvent,
    pieSelectedCategories,
    getParentCategoryName,
    theme,
  ]);


  // --- PDF Report Generation ---
  const [reportMonth, setReportMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [showReportMonthSelector, setShowReportMonthSelector] = useState(false);
  const [reportType, setReportType] = useState<'monthly' | 'custom'>('monthly');
  const [customStartDate, setCustomStartDate] = useState(new Date());
  const [customEndDate, setCustomEndDate] = useState(new Date());
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const [showEndDatePicker, setShowEndDatePicker] = useState(false);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);


  const generatePDF = async () => {
    setIsGeneratingPDF(true);
    try {
      let filteredExpenses: typeof expenses = [];
      let displayTitle = '';
      let targetDate = new Date();
      let startDateForWeekCalc = new Date();
      let endDateForWeekCalc = new Date();
      let days = 1;

      if (reportType === 'monthly') {
        filteredExpenses = expenses.filter(e => format(parseISO(e.expenseDate), 'yyyy-MM') === reportMonth);
        targetDate = parseISO(`${reportMonth}-01`);
        displayTitle = format(targetDate, 'MMMM yyyy');
        startDateForWeekCalc = startOfMonth(targetDate);
        endDateForWeekCalc = endOfMonth(targetDate);
        days = endOfMonth(targetDate).getDate();
      } else {
        let sDate = customStartDate;
        let eDate = customEndDate;
        if (sDate > eDate) {
          [sDate, eDate] = [eDate, sDate];
        }
        const startStr = sDate.toISOString().split('T')[0];
        const endStr = eDate.toISOString().split('T')[0];
        
        filteredExpenses = expenses.filter(e => {
          const d = e.expenseDate.split('T')[0];
          return d >= startStr && d <= endStr;
        });
        displayTitle = format(sDate, 'yyyy-MM-dd') === format(eDate, 'yyyy-MM-dd')
          ? format(sDate, 'MMM dd, yyyy')
          : `${format(sDate, 'MMM dd, yyyy')} - ${format(eDate, 'MMM dd, yyyy')}`;
        startDateForWeekCalc = startOfDay(sDate);
        endDateForWeekCalc = endOfDay(eDate);
        const diffTime = Math.abs(eDate.getTime() - sDate.getTime());
        days = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
      }

      if (filteredExpenses.length === 0) {
        showToast('There are no expenses for the selected period.', 'info');
        setIsGeneratingPDF(false);
        return;
      }

      let totalSpend = 0;
      const catTotals: Record<string, number> = {};
      const parentDataMap: Record<string, { total: number; children: Record<string, number> }> = {};
      
      filteredExpenses.forEach(e => {
        const amt = (e.isSplit && e.splitDetails?.isSettled) ? e.myShare : e.totalAmount;
        totalSpend += amt;
        const parentCat = getParentCategoryName(e.category);
        const childCat = (e.category || 'Other').trim();
        catTotals[parentCat] = (catTotals[parentCat] || 0) + amt;

        if (!parentDataMap[parentCat]) {
          parentDataMap[parentCat] = { total: 0, children: {} };
        }
        parentDataMap[parentCat].total += amt;
        parentDataMap[parentCat].children[childCat] = (parentDataMap[parentCat].children[childCat] || 0) + amt;
      });

      const sortedCats = Object.entries(catTotals).sort((a, b) => b[1] - a[1]);
      const hotCategories = sortedCats.slice(0, 2).map(c => c[0]).join(', ') || 'N/A';
      const dailyAverage = totalSpend / Math.max(days, 1);

      // --- SVG Color Palette ---
      const colorPalette = [
        '#3182CE', '#38A169', '#DD6B20', '#E53E3E', '#805AD5',
        '#319795', '#D69E2E', '#D53F8C', '#4FD1C5', '#667EEA',
        '#ED8936', '#9F7AEA', '#48BB78', '#F56565', '#2B6CB0',
        '#2C7A7B', '#C53030', '#6B46C1', '#B7791F', '#702459'
      ];

      const catWithData = sortedCats.map(([category, amount], index) => {
        const percentage = totalSpend > 0 ? amount / totalSpend : 0;
        return {
          category,
          amount,
          percentage,
          color: colorPalette[index % colorPalette.length],
        };
      });

      // --- Reusable SVG Donut/Pie Chart Generator ---
      const generateSvgPieChart = (
        data: { category: string; amount: number; percentage: number; color: string }[],
        size = 190
      ) => {
        const cx = size / 2;
        const cy = size / 2;
        const r = size * 0.42;
        const innerR = size * 0.22;
        let cumulativePercentage = 0;
        
        const activeData = data.filter(d => d.percentage > 0);
        if (activeData.length === 0) return '';

        if (activeData.length === 1 || activeData.some(d => d.percentage >= 0.999)) {
          const activeItem = activeData.find(d => d.percentage >= 0.999) || activeData[0];
          return `
            <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
              <circle cx="${cx}" cy="${cy}" r="${r}" fill="${activeItem.color}" />
              <circle cx="${cx}" cy="${cy}" r="${innerR}" fill="#FFFFFF" />
            </svg>
          `;
        }

        const paths = activeData.map(item => {
          const startAngle = 2 * Math.PI * cumulativePercentage - Math.PI / 2;
          cumulativePercentage += item.percentage;
          const endAngle = 2 * Math.PI * cumulativePercentage - Math.PI / 2;
          
          const x1 = cx + r * Math.cos(startAngle);
          const y1 = cy + r * Math.sin(startAngle);
          const x2 = cx + r * Math.cos(endAngle);
          const y2 = cy + r * Math.sin(endAngle);
          
          const largeArcFlag = item.percentage > 0.5 ? 1 : 0;
          
          return `<path d="M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArcFlag} 1 ${x2} ${y2} Z" fill="${item.color}" stroke="#FFFFFF" stroke-width="1.5" />`;
        }).join('\n');

        return `
          <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
            ${paths}
            <circle cx="${cx}" cy="${cy}" r="${innerR}" fill="#FFFFFF" />
          </svg>
        `;
      };

      // --- Weekly Calculations for Bar Chart & Breakdown Table ---
      const weeks = eachWeekOfInterval({ start: startDateForWeekCalc, end: endDateForWeekCalc }, { weekStartsOn: 1 });
      const weeksList = weeks.map((weekStart, index) => {
        const rawWeekEnd = new Date(weekStart);
        rawWeekEnd.setDate(rawWeekEnd.getDate() + 6);
        
        // Strictly clamp within the selected period boundaries
        const clampedStart = weekStart < startDateForWeekCalc ? startDateForWeekCalc : weekStart;
        const clampedEnd = rawWeekEnd > endDateForWeekCalc ? endDateForWeekCalc : rawWeekEnd;

        const startDay = startOfDay(clampedStart);
        const endDay = endOfDay(clampedEnd);

        const formattedStart = format(clampedStart, 'MMM dd');
        const formattedEnd = format(clampedEnd, 'MMM dd');
        const dateRange = formattedStart === formattedEnd 
          ? formattedStart 
          : `${formattedStart} - ${formattedEnd}`;
        
        let weekdaySpend = 0;
        let weekendSpend = 0;
        
        filteredExpenses.forEach(e => {
          const d = parseISO(e.expenseDate);
          if (d >= startDay && d <= endDay) {
            const amt = (e.isSplit && e.splitDetails?.isSettled) ? e.myShare : e.totalAmount;
            const day = d.getDay(); // 0 = Sunday, 6 = Saturday
            if (day === 0 || day === 6) {
              weekendSpend += amt;
            } else {
              weekdaySpend += amt;
            }
          }
        });
        
        return {
          label: `W${index + 1}`,
          dateRange,
          weekdaySpend,
          weekendSpend,
          total: weekdaySpend + weekendSpend
        };
      });

      // --- SVG Weekly Stacked Bar Chart Generator ---
      const generateSvgBarChart = (wList: typeof weeksList) => {
        const width = 640;
        const height = 220;
        const paddingLeft = 55;
        const paddingRight = 20;
        const paddingTop = 25;
        const paddingBottom = 40;
        
        const chartWidth = width - paddingLeft - paddingRight;
        const chartHeight = height - paddingTop - paddingBottom;
        
        const maxVal = Math.max(...wList.map(w => w.weekdaySpend + w.weekendSpend), 100);
        
        const digits = Math.floor(Math.log10(maxVal));
        const scaleUnit = Math.pow(10, Math.max(digits, 1));
        const divider = scaleUnit / 2 > 0 ? scaleUnit / 2 : 50;
        const yMax = Math.ceil(maxVal / divider) * divider;
        
        const ticks = [0, yMax * 0.25, yMax * 0.5, yMax * 0.75, yMax];
        
        const yAxisTicksHtml = ticks.map(tick => {
          const y = paddingTop + chartHeight - (tick / yMax) * chartHeight;
          return `
            <line x1="${paddingLeft}" y1="${y}" x2="${width - paddingRight}" y2="${y}" stroke="#E2E8F0" stroke-width="1" stroke-dasharray="4" />
            <text x="${paddingLeft - 10}" y="${y + 4}" fill="#718096" font-size="10" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" text-anchor="end">₹${tick.toFixed(0)}</text>
          `;
        }).join('\n');
        
        const xAxisHtml = `
          <line x1="${paddingLeft}" y1="${paddingTop + chartHeight}" x2="${width - paddingRight}" y2="${paddingTop + chartHeight}" stroke="#CBD5E0" stroke-width="1.5" />
        `;

        const numBars = wList.length;
        const barGap = numBars > 12 ? 8 : (numBars > 6 ? 14 : 24);
        const totalGapWidth = barGap * (numBars + 1);
        const barWidth = (chartWidth - totalGapWidth) / numBars;
        
        const barsHtml = wList.map((week, index) => {
          const x = paddingLeft + barGap + index * (barWidth + barGap);
          const weekdayHeight = (week.weekdaySpend / yMax) * chartHeight;
          const weekendHeight = (week.weekendSpend / yMax) * chartHeight;
          const totalHeight = weekdayHeight + weekendHeight;
          
          const yWeekday = paddingTop + chartHeight - weekdayHeight;
          const yWeekend = paddingTop + chartHeight - totalHeight;
          
          let html = '';
          
          if (week.weekdaySpend > 0) {
            html += `
              <rect x="${x}" y="${yWeekday}" width="${barWidth}" height="${weekdayHeight}" fill="#3182CE" />
            `;
          }
          
          if (week.weekendSpend > 0) {
            html += `
              <rect x="${x}" y="${yWeekend}" width="${barWidth}" height="${weekendHeight}" fill="#E53E3E" />
            `;
          }
          
          if (totalHeight > 0) {
            const labelY = yWeekend - 6;
            html += `
              <text x="${x + barWidth / 2}" y="${labelY}" fill="#2D3748" font-size="9" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" font-weight="bold" text-anchor="middle">₹${(week.weekdaySpend + week.weekendSpend).toFixed(0)}</text>
            `;
          }
          
          html += `
            <text x="${x + barWidth / 2}" y="${paddingTop + chartHeight + 16}" fill="#4A5568" font-size="10" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" font-weight="600" text-anchor="middle">${week.label}</text>
          `;
          
          return html;
        }).join('\n');

        return `
          <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
            ${yAxisTicksHtml}
            ${xAxisHtml}
            ${barsHtml}
          </svg>
        `;
      };

      const pieChartSvg = generateSvgPieChart(catWithData, 190);
      const barChartSvg = generateSvgBarChart(weeksList);

      // --- Sort Statements chronologically descending (latest first) ---
      const sortedExpenses = [...filteredExpenses].sort((a, b) => b.expenseDate.localeCompare(a.expenseDate));

      // --- Individual Parent Category Breakdown HTML ---
      const individualParentCardsHtml = sortedCats.map(([parentName, parentAmount]) => {
        const parentData = parentDataMap[parentName];
        const sortedChildren = Object.entries(parentData.children).sort((a, b) => b[1] - a[1]);
        
        const childrenWithData = sortedChildren.map(([childName, childAmt], cIdx) => {
          const percentage = parentAmount > 0 ? childAmt / parentAmount : 0;
          return {
            category: childName,
            amount: childAmt,
            percentage,
            color: colorPalette[cIdx % colorPalette.length],
          };
        });

        const parentPieSvg = generateSvgPieChart(childrenWithData, 170);
        const parentPercentOfTotal = totalSpend > 0 ? ((parentAmount / totalSpend) * 100).toFixed(1) : '0';

        return `
          <div class="parent-breakdown-card">
            <div class="parent-card-header">
              <div class="parent-title">${parentName}</div>
              <div class="parent-stats">
                <span class="parent-amount">₹${parentAmount.toFixed(2)}</span>
                <span class="parent-share">(${parentPercentOfTotal}% of total spend)</span>
              </div>
            </div>
            <div class="chart-flex">
              <div class="chart-svg-box">
                ${parentPieSvg}
              </div>
              <div class="chart-legend-box">
                <ul class="legend-list">
                  ${childrenWithData.map(item => `
                    <li class="legend-item">
                      <span class="legend-color-box" style="background-color: ${item.color};"></span>
                      <span class="legend-name">${item.category}</span>
                      <span class="legend-value">₹${item.amount.toFixed(2)} <span class="legend-pct">(${(item.percentage * 100).toFixed(1)}%)</span></span>
                    </li>
                  `).join('')}
                </ul>
              </div>
            </div>
          </div>
        `;
      }).join('\n');

      const htmlContent = `
        <html>
          <head>
            <style>
              body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 32px; color: #2D3748; background-color: #FFFFFF; }
              h1 { text-align: center; color: #1A365D; border-bottom: 2px solid #E2E8F0; padding-bottom: 8px; margin-bottom: 4px; font-size: 22px; }
              .subtitle { text-align: center; color: #718096; margin-top: 0; margin-bottom: 22px; font-size: 13px; font-weight: 500; }
              
              .summary-container { display: flex; flex-direction: row; justify-content: space-between; gap: 14px; margin-bottom: 24px; }
              .summary-card { flex: 1; background: #F7FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 12px 14px; text-align: center; }
              .summary-card .label { font-size: 11px; color: #718096; text-transform: uppercase; letter-spacing: 0.5px; font-weight: bold; margin-bottom: 4px; }
              .summary-card .value { font-size: 17px; color: #2D3748; font-weight: bold; }
              
              h2.section-title { color: #2B6CB0; border-bottom: 2px solid #E2E8F0; padding-bottom: 6px; margin-top: 26px; margin-bottom: 14px; font-size: 16px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
              .section-subtitle { font-size: 12px; color: #718096; margin-top: -8px; margin-bottom: 14px; }
              
              .chart-card { background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 8px; padding: 18px; margin-bottom: 18px; page-break-inside: avoid; break-inside: avoid; }
              .chart-card-title { font-size: 13px; color: #4A5568; margin-top: 0; margin-bottom: 14px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: bold; border-left: 3px solid #3182CE; padding-left: 8px; }
              
              .chart-flex { display: flex; flex-direction: row; align-items: center; justify-content: space-around; gap: 20px; }
              .chart-svg-box { flex: 1; display: flex; justify-content: center; align-items: center; }
              .chart-legend-box { flex: 1.4; }
              
              .legend-list { list-style: none; padding: 0; margin: 0; }
              .legend-item { display: flex; align-items: center; margin-bottom: 8px; font-size: 12px; }
              .legend-color-box { width: 10px; height: 10px; border-radius: 50%; margin-right: 10px; display: inline-block; flex-shrink: 0; }
              .legend-name { font-weight: 600; color: #4A5568; flex: 1; }
              .legend-value { font-weight: bold; color: #2D3748; text-align: right; margin-left: 10px; white-space: nowrap; }
              .legend-pct { color: #718096; font-weight: normal; font-size: 11px; }
              
              .bar-chart-container { display: flex; flex-direction: column; align-items: center; width: 100%; }
              .bar-chart-legend { display: flex; flex-direction: row; justify-content: center; margin-top: 10px; margin-bottom: 10px; font-size: 11px; }
              .week-ranges-footer { font-size: 11px; color: #718096; text-align: center; border-top: 1px solid #EDF2F7; padding-top: 8px; width: 100%; }
              
              .weekly-table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 11px; }
              .weekly-table th, .weekly-table td { border: 1px solid #E2E8F0; padding: 6px 10px; }
              .weekly-table th { background-color: #EDF2F7; color: #4A5568; font-weight: 600; text-align: left; }
              
              table.statement-table { width: 100%; border-collapse: collapse; margin-top: 14px; font-size: 12px; }
              table.statement-table th, table.statement-table td { border: 1px solid #E2E8F0; padding: 8px 10px; text-align: left; }
              table.statement-table th { background-color: #EDF2F7; color: #4A5568; font-weight: bold; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
              thead { display: table-header-group; }
              tr { page-break-inside: avoid; break-inside: avoid; }
              .total-row td { background-color: #F7FAFC; font-weight: bold; border-top: 2px solid #CBD5E0; }
              
              .parent-breakdown-card { background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px 20px; margin-bottom: 18px; page-break-inside: avoid; break-inside: avoid; }
              .parent-card-header { display: flex; flex-direction: row; justify-content: space-between; align-items: center; border-bottom: 1px solid #EDF2F7; padding-bottom: 8px; margin-bottom: 12px; }
              .parent-title { font-size: 15px; font-weight: bold; color: #2B6CB0; }
              .parent-stats { text-align: right; }
              .parent-amount { font-size: 14px; font-weight: bold; color: #2D3748; margin-right: 6px; }
              .parent-share { font-size: 12px; color: #718096; }
              
              .text-right { text-align: right; }
              .page-break { page-break-before: always; }
            </style>
          </head>
          <body>
            <h1>Personal Expense Analytics Statement</h1>
            <div class="subtitle">${displayTitle}</div>
            
            <div class="summary-container">
              <div class="summary-card">
                <div class="label">Total Spend</div>
                <div class="value">₹${totalSpend.toFixed(2)}</div>
              </div>
              <div class="summary-card">
                <div class="label">Daily Average</div>
                <div class="value">₹${dailyAverage.toFixed(2)}</div>
              </div>
              <div class="summary-card">
                <div class="label">Hot Categories</div>
                <div class="value" style="font-size: 14px; padding-top: 2px;">${hotCategories}</div>
              </div>
            </div>

            <!-- 1. Parent Category Distribution (Pie Chart First) -->
            <h2 class="section-title">1. Parent Category Distribution</h2>
            <div class="chart-card">
              <div class="chart-card-title">Overall Parent Category Spend Split</div>
              <div class="chart-flex">
                <div class="chart-svg-box">
                  ${pieChartSvg}
                </div>
                <div class="chart-legend-box">
                  <ul class="legend-list">
                    ${catWithData.map(item => `
                      <li class="legend-item">
                        <span class="legend-color-box" style="background-color: ${item.color};"></span>
                        <span class="legend-name">${item.category}</span>
                        <span class="legend-value">₹${item.amount.toFixed(2)} <span class="legend-pct">(${(item.percentage * 100).toFixed(1)}%)</span></span>
                      </li>
                    `).join('')}
                  </ul>
                </div>
              </div>
            </div>

            <!-- 2. Weekly Breakdown for Selected Date Range -->
            <h2 class="section-title">2. Weekly Breakdown</h2>
            <div class="chart-card">
              <div class="chart-card-title">Weekly Expenditure (Weekdays vs Weekends)</div>
              <div class="bar-chart-container">
                ${barChartSvg}
                <div class="bar-chart-legend">
                  <div class="legend-item" style="display: flex; align-items: center;"><span class="legend-color-box" style="background-color: #3182CE;"></span>Weekdays (Mon-Fri)</div>
                  <div class="legend-item" style="display: flex; align-items: center; margin-left: 20px;"><span class="legend-color-box" style="background-color: #E53E3E;"></span>Weekends (Sat-Sun)</div>
                </div>
                <div class="week-ranges-footer">
                  ${weeksList.map(w => `<strong>${w.label}:</strong> ${w.dateRange}`).join(' &nbsp;|&nbsp; ')}
                </div>
              </div>

              <table class="weekly-table">
                <thead>
                  <tr>
                    <th>Week</th>
                    <th>Date Range</th>
                    <th class="text-right">Weekdays (₹)</th>
                    <th class="text-right">Weekends (₹)</th>
                    <th class="text-right">Total (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  ${weeksList.map(w => `
                    <tr>
                      <td><strong>${w.label}</strong></td>
                      <td>${w.dateRange}</td>
                      <td class="text-right">${w.weekdaySpend.toFixed(2)}</td>
                      <td class="text-right">${w.weekendSpend.toFixed(2)}</td>
                      <td class="text-right"><strong>${w.total.toFixed(2)}</strong></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>

            <!-- Page Break before Statements Table -->
            <div class="page-break"></div>

            <!-- 3. Actual Statements (Date, Category, Remark, Amount) -->
            <h2 class="section-title" style="margin-top: 0;">3. Actual Statements</h2>
            <div class="section-subtitle">Itemized transaction statement for the selected period</div>
            <table class="statement-table">
              <thead>
                <tr>
                  <th style="width: 18%;">Date</th>
                  <th style="width: 27%;">Category</th>
                  <th style="width: 37%;">Remark</th>
                  <th style="width: 18%;" class="text-right">Amount (₹)</th>
                </tr>
              </thead>
              <tbody>
                ${sortedExpenses.map(e => {
                  const amt = (e.isSplit && e.splitDetails?.isSettled) ? e.myShare : e.totalAmount;
                  return `
                  <tr>
                    <td>${format(parseISO(e.expenseDate), 'MMM dd, yyyy')}</td>
                    <td><strong>${e.category}</strong></td>
                    <td>${e.remark || '-'}</td>
                    <td class="text-right">${amt.toFixed(2)}</td>
                  </tr>
                `}).join('')}
              </tbody>
              <tfoot>
                <tr class="total-row">
                  <td colspan="3" style="text-align: right; font-weight: bold;">Total Expenditure:</td>
                  <td class="text-right" style="font-weight: bold; color: #1A365D;">₹${totalSpend.toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>

            <!-- Page Break before Individual Parent Category Pie Charts -->
            <div class="page-break"></div>

            <!-- 4. Individual Parent Category Pie Charts at Last -->
            <h2 class="section-title" style="margin-top: 0;">4. Individual Parent Category Breakdown</h2>
            <div class="section-subtitle">Subcategory split and pie chart for each individual parent category</div>
            
            ${individualParentCardsHtml}
          </body>
        </html>
      `;

      await Print.printAsync({ html: htmlContent });
    } catch (error) {
      console.error(error);
      showToast('Failed to generate PDF.', 'error');
    } finally {
      setIsGeneratingPDF(false);
    }
  };


  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.screenTitle}>Insights & Analytics</Text>

      {/* Chart A: YoY */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Year-Over-Year Monthly</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TouchableOpacity
              style={[styles.thresholdChip, thresholdYoY > 0 && styles.thresholdChipActive]}
              onPress={() => openThresholdModal('A')}
              activeOpacity={0.7}
            >
              <Ionicons
                name={thresholdYoY > 0 ? "speedometer" : "speedometer-outline"}
                size={13}
                color={thresholdYoY > 0 ? theme.danger : theme.textSecondary}
                style={{ marginRight: 4 }}
              />
              <Text style={[styles.thresholdChipText, thresholdYoY > 0 && { color: theme.danger, fontWeight: '700' }]}>
                {thresholdYoY > 0 ? `Limit: ₹${formatCompact(thresholdYoY)}` : 'Set Limit'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setFullScreenChart('A')} style={{ marginLeft: 8 }}>
              <Ionicons name="expand" size={20} color={theme.textMuted} />
            </TouchableOpacity>
          </View>
        </View>
        
        <View style={styles.yearFilters}>
          {availableYears.map(year => {
            const isSelected = selectedYears.includes(year);
            return (
              <TouchableOpacity 
                key={year} 
                style={[styles.yearChip, isSelected && styles.yearChipActive]}
                onPress={() => toggleYear(year)}
              >
                <Text style={[styles.yearChipText, isSelected && styles.yearChipTextActive]}>{year}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <InteractiveBarChart
          data={interactiveChartAData}
          height={230}
          scrollable={true}
          theme={theme}
          legendItems={chartALegendItems}
          threshold={thresholdYoY > 0 ? thresholdYoY : undefined}
        />
      </View>

      {/* Chart B: Week-Wise */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Week-Wise Breakdown</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TouchableOpacity onPress={() => setShowChartBSelector(true)} style={styles.monthSelectorBtn}>
              <Text style={styles.monthSelectorText}>{format(parseISO(`${chartBMonthYear}-01`), 'MMM yyyy')}</Text>
              <Ionicons name="chevron-down" size={16} color={theme.primary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setFullScreenChart('B')} style={{ marginLeft: 8 }}>
              <Ionicons name="expand" size={20} color={theme.textMuted} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Dedicated controls row for Limit chip and Ignored categories badge */}
        <View style={styles.chartBControlsRow}>
          <TouchableOpacity
            style={[styles.thresholdChip, thresholdWeekly > 0 && styles.thresholdChipActive]}
            onPress={() => openThresholdModal('B')}
            activeOpacity={0.7}
          >
            <Ionicons
              name={thresholdWeekly > 0 ? "speedometer" : "speedometer-outline"}
              size={13}
              color={thresholdWeekly > 0 ? theme.danger : theme.textSecondary}
              style={{ marginRight: 4 }}
            />
            <Text style={[styles.thresholdChipText, thresholdWeekly > 0 && { color: theme.danger, fontWeight: '700' }]}>
              {thresholdWeekly > 0 ? `Limit: ₹${formatCompact(thresholdWeekly)}` : 'Set Limit'}
            </Text>
          </TouchableOpacity>

          {ignoredWeeklyLimitCategories.length > 0 && (
            <TouchableOpacity
              style={styles.ignoredBadgeChip}
              onPress={() => openThresholdModal('B')}
              activeOpacity={0.7}
            >
              <Ionicons name="shield-checkmark" size={12} color={theme.primary} style={{ marginRight: 4 }} />
              <Text style={styles.ignoredBadgeText} numberOfLines={1}>
                {ignoredWeeklyLimitCategories.length === 1 ? `Ignored: ${ignoredWeeklyLimitCategories[0]}` : `${ignoredWeeklyLimitCategories.length} Categories Ignored`}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        <InteractiveBarChart
          data={interactiveChartBData}
          height={220}
          scrollable={false}
          theme={theme}
          threshold={thresholdWeekly > 0 ? thresholdWeekly : undefined}
        />
      </View>

      {/* Chart C: Category Distribution (Default Overall Chart) */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Category Distribution</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TouchableOpacity
              style={styles.customizeBtn}
              onPress={() => setIsCustomizePieModalOpen(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="options-outline" size={13} color={theme.primary} style={{ marginRight: 4 }} />
              <Text style={styles.customizeBtnText}>Customize</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setShowChartCSelector(true)} style={[styles.monthSelectorBtn, { marginLeft: 8 }]}>
              <Text style={styles.monthSelectorText}>
                {chartCFilter === 'all' ? 'Overall' : events.find(e => e.id === chartCFilter)?.name?.substring(0, 10) + '...'}
              </Text>
              <Ionicons name="chevron-down" size={16} color={theme.primary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setFullScreenChart('C')} style={{ marginLeft: 10 }}>
              <Ionicons name="expand" size={20} color={theme.textMuted} />
            </TouchableOpacity>
          </View>
        </View>

        {chartCData.length > 0 ? (
          <PieChart
            data={chartCData}
            width={screenWidth - 64}
            height={200}
            chartConfig={getChartConfig(theme)}
            accessor={"population"}
            backgroundColor={"transparent"}
            paddingLeft={"0"}
            center={[10, 0]}
            absolute
          />
        ) : (
          <View style={styles.emptyChart}>
            <Text style={styles.emptyChartText}>No data for this filter.</Text>
          </View>
        )}
      </View>

      {/* PDF Generation Section */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Export Statement</Text>
        </View>
        <Text style={styles.pdfDescription}>
          Generate a detailed PDF report containing an executive summary, category breakdown, and itemized transaction history.
        </Text>

        <View style={styles.reportTypeToggleRow}>
          <TouchableOpacity 
            style={[styles.reportTypeBtn, reportType === 'monthly' && styles.reportTypeBtnActive]}
            onPress={() => setReportType('monthly')}
          >
            <Text style={[styles.reportTypeText, reportType === 'monthly' && styles.reportTypeTextActive]}>Monthly</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.reportTypeBtn, reportType === 'custom' && styles.reportTypeBtnActive]}
            onPress={() => setReportType('custom')}
          >
            <Text style={[styles.reportTypeText, reportType === 'custom' && styles.reportTypeTextActive]}>Custom Range</Text>
          </TouchableOpacity>
        </View>

        {reportType === 'monthly' ? (
          <View style={styles.pdfActionRow}>
            <TouchableOpacity onPress={() => setShowReportMonthSelector(true)} style={styles.monthSelectorBtnLarge}>
              <Text style={styles.monthSelectorTextLarge}>{format(parseISO(`${reportMonth}-01`), 'MMMM yyyy')}</Text>
              <Ionicons name="chevron-down" size={18} color={theme.primary} />
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.pdfBtn, isGeneratingPDF && styles.pdfBtnDisabled]} 
              onPress={generatePDF}
              disabled={isGeneratingPDF}
            >
              <Ionicons name="document-text" size={20} color="#FFF" style={{ marginRight: 8 }} />
              <Text style={styles.pdfBtnText}>{isGeneratingPDF ? 'Compiling...' : 'Generate PDF'}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View>
            <View style={styles.datePickerRow}>
              <View style={styles.datePickerContainer}>
                <Text style={styles.datePickerLabel}>Start Date</Text>
                <TouchableOpacity onPress={() => setShowStartDatePicker(true)} style={styles.datePickerBtn}>
                  <Text style={styles.datePickerText}>{format(customStartDate, 'MMM dd, yyyy')}</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.datePickerContainer}>
                <Text style={styles.datePickerLabel}>End Date</Text>
                <TouchableOpacity onPress={() => setShowEndDatePicker(true)} style={styles.datePickerBtn}>
                  <Text style={styles.datePickerText}>{format(customEndDate, 'MMM dd, yyyy')}</Text>
                </TouchableOpacity>
              </View>
            </View>
            <TouchableOpacity 
              style={[styles.pdfBtn, isGeneratingPDF && styles.pdfBtnDisabled, { marginTop: 12 }]} 
              onPress={generatePDF}
              disabled={isGeneratingPDF}
            >
              <Ionicons name="document-text" size={20} color="#FFF" style={{ marginRight: 8 }} />
              <Text style={styles.pdfBtnText}>{isGeneratingPDF ? 'Compiling...' : 'Generate PDF'}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <BottomSheetSelector
        visible={showChartBSelector}
        onClose={() => setShowChartBSelector(false)}
        title="Select Month"
        data={chartBMonthOptions}
        selectedValue={chartBMonthYear}
        onSelect={setChartBMonthYear}
      />

      <BottomSheetSelector
        visible={showChartCSelector}
        onClose={() => setShowChartCSelector(false)}
        title="Select Event/Filter"
        data={chartCFilterOptions}
        selectedValue={chartCFilter}
        onSelect={setChartCFilter}
      />

      <BottomSheetSelector
        visible={showReportMonthSelector}
        onClose={() => setShowReportMonthSelector(false)}
        title="Select Month for Report"
        data={chartBMonthOptions}
        selectedValue={reportMonth}
        onSelect={setReportMonth}
      />

      {showStartDatePicker && (
        <DateTimePicker
          value={customStartDate}
          mode="date"
          display="default"
          onChange={(e, d) => {
            setShowStartDatePicker(Platform.OS === 'ios');
            if (d) setCustomStartDate(d);
          }}
          themeVariant={mode}
        />
      )}

      {showEndDatePicker && (
        <DateTimePicker
          value={customEndDate}
          mode="date"
          display="default"
          onChange={(e, d) => {
            setShowEndDatePicker(Platform.OS === 'ios');
            if (d) setCustomEndDate(d);
          }}
          themeVariant={mode}
        />
      )}

      {/* Customize Category Pie Chart Selectors & Pickers */}
      <BottomSheetSelector
        visible={showPieMonthSelector}
        onClose={() => setShowPieMonthSelector(false)}
        title="Select Month"
        data={chartBMonthOptions}
        selectedValue={pieSelectedMonth}
        onSelect={setPieSelectedMonth}
      />

      <BottomSheetSelector
        visible={showPieEventSelector}
        onClose={() => setShowPieEventSelector(false)}
        title="Select Session / Event"
        data={chartCFilterOptions}
        selectedValue={pieSelectedEvent}
        onSelect={setPieSelectedEvent}
      />

      {showPieStartDatePicker && (
        <DateTimePicker
          value={pieStartDate}
          mode="date"
          display="default"
          onChange={(e, d) => {
            setShowPieStartDatePicker(Platform.OS === 'ios');
            if (d) setPieStartDate(d);
          }}
          themeVariant={mode}
        />
      )}

      {showPieEndDatePicker && (
        <DateTimePicker
          value={pieEndDate}
          mode="date"
          display="default"
          onChange={(e, d) => {
            setShowPieEndDatePicker(Platform.OS === 'ios');
            if (d) setPieEndDate(d);
          }}
          themeVariant={mode}
        />
      )}

      {/* Customize Category Pie Chart Modal */}
      <Modal
        visible={isCustomizePieModalOpen}
        animationType="slide"
        onRequestClose={() => setIsCustomizePieModalOpen(false)}
      >
        <View style={styles.fullScreenContainer}>
          <View style={styles.fullScreenHeader}>
            <TouchableOpacity onPress={() => setIsCustomizePieModalOpen(false)} style={{ padding: 4 }}>
              <Ionicons name="close" size={26} color={theme.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.fullScreenTitle}>Customize Pie Chart</Text>
            <TouchableOpacity onPress={resetPieFilters} style={{ padding: 4 }}>
              <Text style={styles.resetBtnText}>Reset</Text>
            </TouchableOpacity>
          </View>

          <ScrollView 
            style={styles.customModalScroll}
            contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
            showsVerticalScrollIndicator={false}
          >
            {/* Filter Card */}
            <View style={styles.customFilterCard}>
              <View style={styles.customFilterHeader}>
                <Ionicons name="options" size={18} color={theme.primary} style={{ marginRight: 8 }} />
                <Text style={styles.customFilterTitle}>Filter Options</Text>
              </View>

              {/* Scope Selector Tabs */}
              <Text style={styles.filterSectionLabel}>Scope / Period:</Text>
              <View style={styles.scopeTabsRow}>
                <TouchableOpacity 
                  style={[styles.scopeTab, pieFilterMode === 'month' && styles.scopeTabActive]}
                  onPress={() => setPieFilterMode('month')}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.scopeTabText, pieFilterMode === 'month' && styles.scopeTabTextActive]}>Monthly</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.scopeTab, pieFilterMode === 'range' && styles.scopeTabActive]}
                  onPress={() => setPieFilterMode('range')}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.scopeTabText, pieFilterMode === 'range' && styles.scopeTabTextActive]}>Date Range</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.scopeTab, pieFilterMode === 'event' && styles.scopeTabActive]}
                  onPress={() => setPieFilterMode('event')}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.scopeTabText, pieFilterMode === 'event' && styles.scopeTabTextActive]}>Session</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.scopeTab, pieFilterMode === 'all' && styles.scopeTabActive]}
                  onPress={() => setPieFilterMode('all')}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.scopeTabText, pieFilterMode === 'all' && styles.scopeTabTextActive]}>All Time</Text>
                </TouchableOpacity>
              </View>

              {/* Dynamic Scope Controls */}
              {pieFilterMode === 'month' && (
                <View style={styles.scopeControlContainer}>
                  <Text style={styles.controlSublabel}>Select Target Month:</Text>
                  <TouchableOpacity 
                    onPress={() => setShowPieMonthSelector(true)} 
                    style={styles.scopeSelectorButton}
                    activeOpacity={0.7}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Ionicons name="calendar-outline" size={18} color={theme.primary} style={{ marginRight: 8 }} />
                      <Text style={styles.scopeSelectorButtonText}>
                        {format(parseISO(`${pieSelectedMonth}-01`), 'MMMM yyyy')}
                      </Text>
                    </View>
                    <Ionicons name="chevron-down" size={18} color={theme.primary} />
                  </TouchableOpacity>
                </View>
              )}

              {pieFilterMode === 'range' && (
                <View style={styles.scopeControlContainer}>
                  <View style={styles.datePickerRow}>
                    <View style={styles.datePickerContainer}>
                      <Text style={styles.datePickerLabel}>Start Date</Text>
                      <TouchableOpacity onPress={() => setShowPieStartDatePicker(true)} style={styles.datePickerBtn} activeOpacity={0.7}>
                        <Text style={styles.datePickerText}>{format(pieStartDate, 'MMM dd, yyyy')}</Text>
                      </TouchableOpacity>
                    </View>
                    <View style={styles.datePickerContainer}>
                      <Text style={styles.datePickerLabel}>End Date</Text>
                      <TouchableOpacity onPress={() => setShowPieEndDatePicker(true)} style={styles.datePickerBtn} activeOpacity={0.7}>
                        <Text style={styles.datePickerText}>{format(pieEndDate, 'MMM dd, yyyy')}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              )}

              {pieFilterMode === 'event' && (
                <View style={styles.scopeControlContainer}>
                  <Text style={styles.controlSublabel}>Select Session / Event:</Text>
                  <TouchableOpacity 
                    onPress={() => setShowPieEventSelector(true)} 
                    style={styles.scopeSelectorButton}
                    activeOpacity={0.7}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Ionicons name="airplane-outline" size={18} color={theme.primary} style={{ marginRight: 8 }} />
                      <Text style={styles.scopeSelectorButtonText}>
                        {pieSelectedEvent === 'all' 
                          ? 'All Sessions (Overall)' 
                          : events.find(e => e.id === pieSelectedEvent)?.name || 'Select Session'}
                      </Text>
                    </View>
                    <Ionicons name="chevron-down" size={18} color={theme.primary} />
                  </TouchableOpacity>
                </View>
              )}

              {pieFilterMode === 'all' && (
                <View style={styles.allTimeBanner}>
                  <Ionicons name="globe-outline" size={16} color={theme.primary} style={{ marginRight: 8 }} />
                  <Text style={styles.allTimeBannerText}>Analyzing expenses across all sessions and dates.</Text>
                </View>
              )}

              {/* Categories Multi-Select & Deselect Section */}
              <View style={styles.categorySectionHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={styles.filterSectionLabel}>Categories</Text>
                  <View style={styles.categoryCountBadge}>
                    <Text style={styles.categoryCountText}>
                      {pieSelectedCategories.length}/{allParentCategories.length} Selected
                    </Text>
                  </View>
                </View>
                <View style={styles.categoryActionBtns}>
                  <TouchableOpacity onPress={selectAllPieCategories} style={styles.catActionBtn} activeOpacity={0.7}>
                    <Text style={styles.catActionBtnText}>Select All</Text>
                  </TouchableOpacity>
                  <View style={{ width: 8 }} />
                  <TouchableOpacity onPress={deselectAllPieCategories} style={styles.catActionBtn} activeOpacity={0.7}>
                    <Text style={[styles.catActionBtnText, { color: theme.danger }]}>Deselect All</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.categoriesWrap}>
                {allParentCategories.map(cat => {
                  const isSelected = pieSelectedCategories.includes(cat);
                  return (
                    <TouchableOpacity
                      key={cat}
                      style={[styles.categoryChip, isSelected && styles.categoryChipActive]}
                      onPress={() => togglePieCategory(cat)}
                      activeOpacity={0.7}
                    >
                      <Ionicons 
                        name={isSelected ? "checkmark-circle" : "ellipse-outline"} 
                        size={15} 
                        color={isSelected ? theme.primary : theme.textMuted} 
                        style={{ marginRight: 6 }} 
                      />
                      <Text style={[styles.categoryChipText, isSelected && styles.categoryChipTextActive]}>
                        {cat}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Custom Pie Chart Display Card (Below the filter) */}
            <View style={styles.customChartCard}>
              <View style={styles.customFilterHeader}>
                <Ionicons name="pie-chart" size={18} color={theme.primary} style={{ marginRight: 8 }} />
                <Text style={styles.customFilterTitle}>Custom Distribution</Text>
              </View>

              {pieSelectedCategories.length === 0 ? (
                /* Blank Pie Chart State when all categories are deselected */
                <View style={styles.blankPieContainer}>
                  <View style={styles.blankPieCircle}>
                    <View style={styles.blankPieInner}>
                      <Ionicons name="pie-chart-outline" size={38} color={theme.textMuted} />
                    </View>
                  </View>
                  <Text style={styles.blankPieTitle}>Blank Pie Chart</Text>
                  <Text style={styles.blankPieSubtitle}>
                    All categories are currently deselected. Select categories above to generate and fill your customized chart.
                  </Text>
                </View>
              ) : customPieData.chartData.length === 0 ? (
                /* Blank Pie Chart State when no expenses match the active filters */
                <View style={styles.blankPieContainer}>
                  <View style={styles.blankPieCircle}>
                    <View style={styles.blankPieInner}>
                      <Ionicons name="search-outline" size={38} color={theme.textMuted} />
                    </View>
                  </View>
                  <Text style={styles.blankPieTitle}>No Matching Expenses</Text>
                  <Text style={styles.blankPieSubtitle}>
                    No expenses found for the selected {pieFilterMode === 'month' ? 'month' : pieFilterMode === 'range' ? 'date range' : pieFilterMode === 'event' ? 'session' : 'period'} and active categories.
                  </Text>
                </View>
              ) : (
                /* Populated Pie Chart State */
                <View style={styles.customChartContent}>
                  <View style={styles.chartTotalSpendRow}>
                    <View>
                      <Text style={styles.chartTotalSpendLabel}>Total Filtered Spend</Text>
                      <Text style={styles.chartTotalSpendValue}>₹{customPieData.totalSpend.toLocaleString('en-IN')}</Text>
                    </View>
                    <View style={styles.activeFilterBadge}>
                      <Ionicons name="funnel" size={12} color={theme.primary} style={{ marginRight: 4 }} />
                      <Text style={styles.activeFilterBadgeText}>
                        {customPieData.chartData.length} {customPieData.chartData.length === 1 ? 'Category' : 'Categories'}
                      </Text>
                    </View>
                  </View>

                  <PieChart
                    data={customPieData.chartData}
                    width={screenWidth - 64}
                    height={210}
                    chartConfig={getChartConfig(theme)}
                    accessor={"population"}
                    backgroundColor={"transparent"}
                    paddingLeft={"0"}
                    center={[10, 0]}
                    absolute
                  />

                  {/* Itemized Category Breakdown List */}
                  <View style={styles.breakdownList}>
                    <Text style={styles.breakdownListTitle}>Category Breakdown</Text>
                    {customPieData.items.map((item) => (
                      <View key={item.name} style={styles.breakdownItem}>
                        <View style={styles.breakdownItemHeader}>
                          <View style={styles.breakdownItemLeft}>
                            <View style={[styles.colorDot, { backgroundColor: item.color }]} />
                            <Text style={styles.breakdownItemName}>{item.name}</Text>
                          </View>
                          <View style={styles.breakdownItemRight}>
                            <Text style={styles.breakdownItemAmount}>₹{item.amount.toLocaleString('en-IN')}</Text>
                            <Text style={styles.breakdownItemPercent}>({item.percentage.toFixed(1)}%)</Text>
                          </View>
                        </View>
                        <View style={styles.progressBarBackground}>
                          <View style={[styles.progressBarFill, { width: `${item.percentage}%`, backgroundColor: item.color }]} />
                        </View>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Full Screen Modal */}
      <Modal visible={fullScreenChart !== null} animationType="slide">
        <View style={styles.fullScreenContainer}>
          <View style={styles.fullScreenHeader}>
            <TouchableOpacity onPress={() => setFullScreenChart(null)}>
              <Ionicons name="close" size={28} color={theme.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.fullScreenTitle}>
              {fullScreenChart === 'A' ? 'Year-Over-Year Monthly' : fullScreenChart === 'B' ? 'Week-Wise Breakdown' : 'Category Distribution'}
            </Text>
            <View style={{ width: 28 }} />
          </View>
          
          <View style={styles.fullScreenContent}>
            {fullScreenChart === 'A' && (
              <InteractiveBarChart
                data={interactiveChartAData}
                height={Dimensions.get('window').height - 240}
                width={screenWidth - 32}
                scrollable={true}
                theme={theme}
                legendItems={chartALegendItems}
                threshold={thresholdYoY > 0 ? thresholdYoY : undefined}
              />
            )}
            {fullScreenChart === 'B' && (
              <InteractiveBarChart
                data={interactiveChartBData}
                height={Dimensions.get('window').height - 240}
                width={screenWidth - 32}
                scrollable={false}
                theme={theme}
                threshold={thresholdWeekly > 0 ? thresholdWeekly : undefined}
              />
            )}
            {fullScreenChart === 'C' && chartCData.length > 0 && (
              <PieChart
                data={chartCData}
                width={screenWidth - 16}
                height={300}
                chartConfig={getChartConfig(theme)}
                accessor={"population"}
                backgroundColor={"transparent"}
                paddingLeft={"0"}
                center={[0, 0]}
                absolute
              />
            )}
          </View>
        </View>
      </Modal>

      {/* Threshold Setting Modal */}
      <Modal
        visible={thresholdModalTarget !== null}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setThresholdModalTarget(null)}
      >
        <TouchableOpacity 
          style={styles.modalOverlay} 
          activeOpacity={1} 
          onPress={() => setThresholdModalTarget(null)}
        >
          <TouchableOpacity activeOpacity={1} style={styles.thresholdModalCard}>
            <View style={styles.thresholdModalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="speedometer" size={20} color={theme.danger} style={{ marginRight: 8 }} />
                <Text style={styles.thresholdModalTitle}>
                  {thresholdModalTarget === 'A' ? 'Monthly Max Limit / Threshold' : 'Weekly Max Limit / Threshold'}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setThresholdModalTarget(null)}>
                <Ionicons name="close" size={22} color={theme.textMuted} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: Dimensions.get('window').height * 0.65 }}>
              <Text style={styles.thresholdModalDesc}>
                Set the maximum Y-axis limit for this chart. Bars will scale up to this limit as the ceiling. If any expense crosses this limit, it turns alert red and the chart automatically expands with 20% headroom.
              </Text>

              {/* Quick Presets */}
              <Text style={styles.thresholdSectionLabel}>Quick Presets:</Text>
              <View style={styles.presetsWrap}>
                {(thresholdModalTarget === 'A' ? yoyPresets : weeklyPresets).map(preset => {
                  const isCurrent = (thresholdModalTarget === 'A' ? thresholdYoY : thresholdWeekly) === preset;
                  return (
                    <TouchableOpacity
                      key={preset}
                      style={[styles.presetChip, isCurrent && styles.presetChipActive]}
                      onPress={() => setTempThresholdInput(preset.toString())}
                    >
                      <Text style={[styles.presetChipText, isCurrent && styles.presetChipTextActive]}>
                        ₹{formatCompact(preset)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Custom Input */}
              <Text style={[styles.thresholdSectionLabel, { marginTop: 14 }]}>Custom Amount (₹):</Text>
              <View style={styles.thresholdInputWrapper}>
                <Text style={styles.thresholdCurrencyPrefix}>₹</Text>
                <TextInput
                  style={styles.thresholdInput}
                  placeholder="e.g. 5000"
                  placeholderTextColor={theme.textMuted}
                  keyboardType="numeric"
                  value={tempThresholdInput}
                  onChangeText={setTempThresholdInput}
                />
                {tempThresholdInput.length > 0 && (
                  <TouchableOpacity onPress={() => setTempThresholdInput('')}>
                    <Ionicons name="close-circle" size={18} color={theme.textMuted} />
                  </TouchableOpacity>
                )}
              </View>

              {/* Ignore Categories from Weekly Limit Breach Section (Only for Weekly Target 'B') */}
              {thresholdModalTarget === 'B' && (
                <View style={styles.ignoreSectionContainer}>
                  <View style={styles.ignoreSectionHeaderRow}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Ionicons name="shield-checkmark" size={16} color={theme.primary} style={{ marginRight: 6 }} />
                      <Text style={styles.ignoreSectionTitle}>Ignore Categories for Weekly Limit</Text>
                    </View>
                    {ignoredWeeklyLimitCategories.length > 0 && (
                      <TouchableOpacity onPress={clearWeeklyIgnoredCategories}>
                        <Text style={[styles.ignoreClearText, { color: theme.danger }]}>Clear All</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  <Text style={styles.ignoreSectionDesc}>
                    Tap a parent category to view and select its subcategories (e.g. Rent under Bills & Utilities) to ignore from weekly limit calculations.
                  </Text>

                  <View style={styles.parentCategoriesList}>
                    {categoryHierarchy.map(group => {
                      const isExpanded = expandedParentCategories.includes(group.name);
                      const subcats = group.subcategories;
                      const selectedCount = subcats.filter(s => ignoredWeeklyLimitCategories.includes(s)).length;
                      const isAllSelected = subcats.length > 0 && selectedCount === subcats.length;

                      return (
                        <View key={group.id || group.name} style={styles.parentCategoryCard}>
                          <TouchableOpacity
                            style={styles.parentCategoryHeader}
                            onPress={() => toggleParentExpanded(group.name)}
                            activeOpacity={0.7}
                          >
                            <View style={styles.parentHeaderLeft}>
                              <Ionicons
                                name={isExpanded ? "chevron-down" : "chevron-forward"}
                                size={15}
                                color={selectedCount > 0 ? theme.primary : theme.textSecondary}
                                style={{ marginRight: 8 }}
                              />
                              <Text style={[styles.parentCategoryTitle, selectedCount > 0 && { color: theme.primary, fontWeight: '700' }]}>
                                {group.name}
                              </Text>
                              {selectedCount > 0 && (
                                <View style={styles.parentSelectedCountBadge}>
                                  <Text style={styles.parentSelectedCountText}>
                                    {isAllSelected ? 'All' : selectedCount} selected
                                  </Text>
                                </View>
                              )}
                            </View>

                            <TouchableOpacity
                              style={styles.toggleAllGroupBtn}
                              onPress={() => toggleAllSubcategoriesInGroup(group)}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            >
                              <Text style={styles.toggleAllGroupText}>
                                {isAllSelected ? 'Deselect All' : 'Select All'}
                              </Text>
                            </TouchableOpacity>
                          </TouchableOpacity>

                          {/* Subcategories (revealed when parent is expanded) */}
                          {isExpanded && (
                            <View style={styles.subcategoriesWrap}>
                              {subcats.map(sub => {
                                const isSelected = ignoredWeeklyLimitCategories.includes(sub);
                                return (
                                  <TouchableOpacity
                                    key={sub}
                                    style={[styles.subcategoryChip, isSelected && styles.subcategoryChipActive]}
                                    onPress={() => toggleIgnoredWeeklyCategory(sub)}
                                    activeOpacity={0.7}
                                  >
                                    <Ionicons
                                      name={isSelected ? "checkbox" : "square-outline"}
                                      size={15}
                                      color={isSelected ? theme.primary : theme.textMuted}
                                      style={{ marginRight: 5 }}
                                    />
                                    <Text style={[styles.subcategoryChipText, isSelected && styles.subcategoryChipTextActive]}>
                                      {sub}
                                    </Text>
                                  </TouchableOpacity>
                                );
                              })}
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>
                </View>
              )}
            </ScrollView>

            {/* Actions */}
            <View style={styles.thresholdActionsRow}>
              <TouchableOpacity
                style={styles.disableThresholdBtn}
                onPress={() => saveThreshold(0)}
              >
                <Text style={styles.disableThresholdText}>Auto Fit (No Limit)</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.saveThresholdBtn}
                onPress={() => {
                  const val = parseFloat(tempThresholdInput);
                  if (isNaN(val) || val <= 0) {
                    saveThreshold(0);
                  } else {
                    saveThreshold(val);
                  }
                }}
              >
                <Text style={styles.saveThresholdText}>Apply Limit</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>


    </ScrollView>
  );
};

const getStyles = (theme: ThemeColors, mode: 'light' | 'dark') => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  screenTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: theme.textPrimary,
    marginBottom: 20,
  },
  card: {
    backgroundColor: theme.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: theme.textPrimary,
  },
  chartBControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
    marginTop: -4,
  },
  chartStyle: {
    marginVertical: 8,
    borderRadius: 16,
  },
  yearFilters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 12,
    gap: 8,
  },
  yearChip: {
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  yearChipActive: {
    backgroundColor: theme.primaryLight,
    borderColor: theme.primary,
  },
  yearChipText: {
    fontSize: 12,
    color: theme.textSecondary,
    fontWeight: '600',
  },
  yearChipTextActive: {
    color: theme.primary,
  },
  monthSelectorBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  monthSelectorText: {
    fontSize: 12,
    color: theme.primary,
    fontWeight: 'bold',
    marginRight: 4,
  },
  emptyChart: {
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyChartText: {
    color: theme.textMuted,
    fontSize: 14,
  },
  fullScreenContainer: {
    flex: 1,
    backgroundColor: theme.background,
  },
  fullScreenHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    paddingTop: 64,
    borderBottomWidth: 1,
    borderBottomColor: theme.surface,
  },
  fullScreenTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.textPrimary,
  },
  fullScreenContent: {
    flex: 1,
    padding: 16,
    justifyContent: 'center',
  },
  pdfDescription: {
    fontSize: 14,
    color: theme.textMuted,
    marginBottom: 16,
    lineHeight: 20,
  },
  pdfActionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  monthSelectorBtnLarge: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: theme.surface,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
  },
  monthSelectorTextLarge: {
    fontSize: 14,
    color: theme.textPrimary,
    fontWeight: '600',
  },
  pdfBtn: {
    flex: 1.5,
    flexDirection: 'row',
    backgroundColor: theme.primary,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
    paddingVertical: 12,
  },
  pdfBtnDisabled: {
    backgroundColor: theme.textMuted,
  },
  pdfBtnText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  reportTypeToggleRow: {
    flexDirection: 'row',
    marginBottom: 16,
    backgroundColor: theme.surface,
    borderRadius: 8,
    padding: 4,
    borderWidth: 1,
    borderColor: theme.cardBorder,
  },
  reportTypeBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 6,
  },
  reportTypeBtnActive: {
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.cardBorder,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  reportTypeText: {
    fontSize: 14,
    color: theme.textMuted,
    fontWeight: '600',
  },
  reportTypeTextActive: {
    color: theme.primary,
    fontWeight: 'bold',
  },
  datePickerRow: {
    flexDirection: 'row',
    gap: 12,
  },
  datePickerContainer: {
    flex: 1,
  },
  datePickerLabel: {
    fontSize: 12,
    color: theme.textMuted,
    marginBottom: 4,
  },
  datePickerBtn: {
    backgroundColor: theme.surface,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
  },
  datePickerText: {
    fontSize: 14,
    color: theme.textPrimary,
    fontWeight: '600',
    textAlign: 'center',
  },
  thresholdChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.cardBorder,
  },
  thresholdChipActive: {
    backgroundColor: `${theme.danger}15`,
    borderColor: `${theme.danger}40`,
  },
  thresholdChipText: {
    fontSize: 11,
    color: theme.textSecondary,
    fontWeight: '600',
  },
  ignoredBadgeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: `${theme.primary}18`,
    borderWidth: 1,
    borderColor: `${theme.primary}40`,
    borderRadius: 14,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  ignoredBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: theme.primary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  thresholdModalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: getSolidColor(theme.card, mode === 'dark' ? '#1A202C' : '#FFFFFF'),
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: theme.cardBorder,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 10,
  },
  thresholdModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  thresholdModalTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: theme.textPrimary,
  },
  thresholdModalDesc: {
    fontSize: 13,
    color: theme.textSecondary,
    lineHeight: 18,
    marginBottom: 16,
  },
  thresholdSectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.textSecondary,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  presetsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  presetChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: getSolidColor(theme.surface, mode === 'dark' ? '#242C3D' : '#F4F5F7'),
    borderWidth: 1,
    borderColor: theme.cardBorder,
  },
  presetChipActive: {
    backgroundColor: theme.primaryLight || theme.surface,
    borderColor: theme.primary,
  },
  presetChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.textPrimary,
  },
  presetChipTextActive: {
    color: theme.primary,
    fontWeight: 'bold',
  },
  thresholdInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: getSolidColor(theme.surface, mode === 'dark' ? '#242C3D' : '#F4F5F7'),
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.cardBorder,
    paddingHorizontal: 12,
    height: 46,
    marginTop: 4,
  },
  thresholdCurrencyPrefix: {
    fontSize: 16,
    fontWeight: 'bold',
    color: theme.textSecondary,
    marginRight: 6,
  },
  thresholdInput: {
    flex: 1,
    fontSize: 15,
    color: theme.textPrimary,
    fontWeight: '600',
  },
  thresholdActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 20,
  },
  disableThresholdBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.cardBorder,
  },
  disableThresholdText: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.textSecondary,
  },
  saveThresholdBtn: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 8,
    backgroundColor: theme.primary,
  },
  saveThresholdText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  ignoreSectionContainer: {
    marginTop: 18,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: theme.cardBorder,
  },
  ignoreSectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  ignoreSectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.textPrimary,
  },
  ignoreClearText: {
    fontSize: 12,
    fontWeight: '600',
  },
  ignoreSectionDesc: {
    fontSize: 11,
    color: theme.textMuted,
    lineHeight: 16,
    marginBottom: 10,
  },
  parentCategoriesList: {
    gap: 8,
  },
  parentCategoryCard: {
    borderRadius: 10,
    backgroundColor: getSolidColor(theme.surface, mode === 'dark' ? '#242C3D' : '#F4F5F7'),
    borderWidth: 1,
    borderColor: theme.cardBorder,
    overflow: 'hidden',
  },
  parentCategoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  parentHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  parentCategoryTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.textPrimary,
  },
  parentSelectedCountBadge: {
    backgroundColor: `${theme.primary}20`,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 8,
  },
  parentSelectedCountText: {
    fontSize: 10,
    fontWeight: '700',
    color: theme.primary,
  },
  toggleAllGroupBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: theme.background,
    borderWidth: 1,
    borderColor: theme.cardBorder,
  },
  toggleAllGroupText: {
    fontSize: 10,
    fontWeight: '700',
    color: theme.primary,
  },
  subcategoriesWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 12,
    paddingBottom: 10,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: `${theme.cardBorder}60`,
    backgroundColor: `${theme.background}60`,
  },
  subcategoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.cardBorder,
    backgroundColor: theme.surface,
  },
  subcategoryChipActive: {
    borderColor: theme.primary,
    backgroundColor: `${theme.primary}18`,
  },
  subcategoryChipText: {
    fontSize: 11,
    color: theme.textSecondary,
    fontWeight: '500',
  },
  subcategoryChipTextActive: {
    color: theme.primary,
    fontWeight: '700',
  },
  customizeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.primaryLight,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: `${theme.primary}30`,
  },
  customizeBtnText: {
    fontSize: 12,
    color: theme.primary,
    fontWeight: '700',
  },
  customModalScroll: {
    flex: 1,
  },
  customFilterCard: {
    backgroundColor: getSolidColor(theme.card, mode === 'dark' ? '#1A202C' : '#FFFFFF'),
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: theme.cardBorder,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 3,
  },
  customFilterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  customFilterTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: theme.textPrimary,
  },
  filterSectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.textSecondary,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  scopeTabsRow: {
    flexDirection: 'row',
    backgroundColor: getSolidColor(theme.surface, mode === 'dark' ? '#242C3D' : '#F4F5F7'),
    borderRadius: 8,
    padding: 3,
    borderWidth: 1,
    borderColor: theme.cardBorder,
    marginBottom: 14,
  },
  scopeTab: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
    borderRadius: 6,
  },
  scopeTabActive: {
    backgroundColor: getSolidColor(theme.card, mode === 'dark' ? '#1A202C' : '#FFFFFF'),
    borderWidth: 1,
    borderColor: theme.cardBorder,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  scopeTabText: {
    fontSize: 12,
    color: theme.textMuted,
    fontWeight: '600',
  },
  scopeTabTextActive: {
    color: theme.primary,
    fontWeight: 'bold',
  },
  scopeControlContainer: {
    marginBottom: 14,
  },
  controlSublabel: {
    fontSize: 12,
    color: theme.textMuted,
    marginBottom: 6,
  },
  scopeSelectorButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: getSolidColor(theme.surface, mode === 'dark' ? '#242C3D' : '#F4F5F7'),
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.cardBorder,
  },
  scopeSelectorButtonText: {
    fontSize: 14,
    color: theme.textPrimary,
    fontWeight: '600',
  },
  allTimeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.primaryLight,
    padding: 10,
    borderRadius: 8,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: `${theme.primary}20`,
  },
  allTimeBannerText: {
    fontSize: 13,
    color: theme.primary,
    fontWeight: '600',
    flex: 1,
  },
  categorySectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 10,
  },
  categoryCountBadge: {
    backgroundColor: theme.surface,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 8,
    borderWidth: 1,
    borderColor: theme.cardBorder,
  },
  categoryCountText: {
    fontSize: 11,
    color: theme.textSecondary,
    fontWeight: '700',
  },
  categoryActionBtns: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  catActionBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.cardBorder,
  },
  catActionBtnText: {
    fontSize: 11,
    color: theme.primary,
    fontWeight: '700',
  },
  categoriesWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.cardBorder,
  },
  categoryChipActive: {
    backgroundColor: theme.primaryLight,
    borderColor: theme.primary,
  },
  categoryChipText: {
    fontSize: 12,
    color: theme.textSecondary,
    fontWeight: '600',
  },
  categoryChipTextActive: {
    color: theme.primary,
    fontWeight: '700',
  },
  customChartCard: {
    backgroundColor: getSolidColor(theme.card, mode === 'dark' ? '#1A202C' : '#FFFFFF'),
    borderRadius: 16,
    padding: 16,
    marginBottom: 30,
    borderWidth: 1,
    borderColor: theme.cardBorder,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 3,
  },
  blankPieContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 28,
    paddingHorizontal: 16,
  },
  blankPieCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 3,
    borderColor: `${theme.primary}40`,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: `${theme.primary}06`,
    marginBottom: 16,
  },
  blankPieInner: {
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: theme.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.cardBorder,
  },
  blankPieTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: theme.textPrimary,
    marginBottom: 6,
  },
  blankPieSubtitle: {
    fontSize: 13,
    color: theme.textMuted,
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: 280,
  },
  customChartContent: {
    marginTop: 4,
  },
  chartTotalSpendRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.surface,
    marginBottom: 8,
  },
  chartTotalSpendLabel: {
    fontSize: 11,
    color: theme.textMuted,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  chartTotalSpendValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.textPrimary,
    marginTop: 2,
  },
  activeFilterBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.primaryLight,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  activeFilterBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.primary,
  },
  breakdownList: {
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: theme.surface,
    paddingTop: 14,
  },
  breakdownListTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: theme.textPrimary,
    marginBottom: 10,
  },
  breakdownItem: {
    marginBottom: 12,
  },
  breakdownItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  breakdownItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  colorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  breakdownItemName: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.textPrimary,
  },
  breakdownItemRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  breakdownItemAmount: {
    fontSize: 13,
    fontWeight: 'bold',
    color: theme.textPrimary,
  },
  breakdownItemPercent: {
    fontSize: 12,
    color: theme.textMuted,
    fontWeight: '600',
  },
  progressBarBackground: {
    height: 5,
    backgroundColor: theme.surface,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  resetBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: theme.primary,
  },
});
