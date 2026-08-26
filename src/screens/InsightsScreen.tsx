import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Dimensions, TouchableOpacity, Modal, Alert, Platform } from 'react-native';
import { BarChart, PieChart } from 'react-native-chart-kit';
import { useExpenses } from '../contexts/ExpenseContext';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/types';
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
  const styles = getStyles(theme);
  const { expenses, events } = useExpenses();
  const [fullScreenChart, setFullScreenChart] = useState<string | null>(null);

  // --- Chart A State ---
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

  const chartAData = useMemo(() => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    // Create interleaved data if multiple years selected
    const labels: string[] = [];
    const data: number[] = [];
    const colors: ((opacity: number) => string)[] = [];

    const yearColors = [
      (opacity = 1) => `rgba(49, 130, 206, ${opacity})`, // Blue
      (opacity = 1) => `rgba(72, 187, 120, ${opacity})`, // Green
      (opacity = 1) => `rgba(237, 137, 54, ${opacity})`, // Orange
    ];

    months.forEach((month, mIndex) => {
      selectedYears.forEach((year, yIndex) => {
        let sum = 0;
        expenses.forEach(e => {
          const d = parseISO(e.expenseDate);
          if (getYear(d) === year && getMonth(d) === mIndex) {
            sum += (e.isSplit && e.splitDetails?.isSettled) ? e.myShare : e.totalAmount;
          }
        });
        
        // Only show label for the first year of the month to avoid clutter
        labels.push(yIndex === 0 ? month : '');
        data.push(sum);
        colors.push(yearColors[yIndex % yearColors.length]);
      });
    });

    return {
      labels,
      datasets: [
        {
          data,
          colors
        }
      ]
    };
  }, [expenses, selectedYears]);


  // --- Chart B State ---
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

  const chartBData = useMemo(() => {
    const targetDate = parseISO(`${chartBMonthYear}-01`);
    const start = startOfMonth(targetDate);
    const end = endOfMonth(targetDate);
    
    const weeks = eachWeekOfInterval({ start, end }, { weekStartsOn: 1 });
    const labels: string[] = [];
    const data: number[] = [];

    weeks.forEach((weekStart, index) => {
      labels.push(`W${index + 1}`);
      let sum = 0;
      // Approximate end of week
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      
      expenses.forEach(e => {
        const d = parseISO(e.expenseDate);
        if (isWithinInterval(d, { start: weekStart, end: weekEnd }) && getMonth(d) === getMonth(start)) {
          sum += (e.isSplit && e.splitDetails?.isSettled) ? e.myShare : e.totalAmount;
        }
      });
      data.push(sum);
    });

    return {
      labels: labels.length > 0 ? labels : ['W1'],
      datasets: [{ data: data.length > 0 ? data : [0] }]
    };
  }, [expenses, chartBMonthYear]);


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
      categoryTotals[e.category] = (categoryTotals[e.category] || 0) + amt;
    });

    const colors = ['#3182CE', '#48BB78', '#ED8936', '#E53E3E', '#805AD5', '#38B2AC', '#D69E2E', '#F687B3'];
    
    return Object.entries(categoryTotals)
      .filter(([_, value]) => value > 0)
      .map(([name, population], index) => ({
        name,
        population,
        color: colors[index % colors.length],
        legendFontcolor: theme.textSecondary,
        legendFontSize: 12
      }))
      .sort((a, b) => b.population - a.population);
  }, [expenses, chartCFilter]);


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

      if (reportType === 'monthly') {
        filteredExpenses = expenses.filter(e => format(parseISO(e.expenseDate), 'yyyy-MM') === reportMonth);
        targetDate = parseISO(`${reportMonth}-01`);
        displayTitle = format(targetDate, 'MMMM yyyy');
        startDateForWeekCalc = startOfMonth(targetDate);
        endDateForWeekCalc = endOfMonth(targetDate);
      } else {
        const startStr = customStartDate.toISOString().split('T')[0];
        const endStr = customEndDate.toISOString().split('T')[0];
        
        filteredExpenses = expenses.filter(e => {
          const d = e.expenseDate.split('T')[0];
          return d >= startStr && d <= endStr;
        });
        displayTitle = `${format(customStartDate, 'MMM dd, yyyy')} - ${format(customEndDate, 'MMM dd, yyyy')}`;
        startDateForWeekCalc = startOfDay(customStartDate);
        endDateForWeekCalc = endOfDay(customEndDate);
      }

      if (filteredExpenses.length === 0) {
        Alert.alert('No Data', 'There are no expenses for the selected period.');
        setIsGeneratingPDF(false);
        return;
      }

      let totalSpend = 0;
      const catTotals: Record<string, number> = {};
      
      filteredExpenses.forEach(e => {
        const amt = (e.isSplit && e.splitDetails?.isSettled) ? e.myShare : e.totalAmount;
        totalSpend += amt;
        catTotals[e.category] = (catTotals[e.category] || 0) + amt;
      });

      const sortedCats = Object.entries(catTotals).sort((a, b) => b[1] - a[1]);
      const hotCategories = sortedCats.slice(0, 2).map(c => c[0]).join(', ') || 'N/A';
      
      let days = 1;
      if (reportType === 'monthly') {
        days = endOfMonth(targetDate).getDate();
      } else {
        const diffTime = Math.abs(customEndDate.getTime() - customStartDate.getTime());
        days = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
      }
      const dailyAverage = totalSpend / days;

      // --- SVG Color System ---
      const catColors = ['#3182CE', '#48BB78', '#ED8936', '#E53E3E', '#805AD5', '#38B2AC', '#D69E2E', '#F687B3'];
      const catWithData = sortedCats.map(([category, amount], index) => {
        const percentage = totalSpend > 0 ? amount / totalSpend : 0;
        return {
          category,
          amount,
          percentage,
          color: catColors[index % catColors.length],
        };
      });

      // --- SVG Pie/Donut Chart Generator ---
      const generateSvgPieChart = (data: typeof catWithData) => {
        const cx = 100;
        const cy = 100;
        const r = 80;
        let cumulativePercentage = 0;
        
        const activeData = data.filter(d => d.percentage > 0);
        if (activeData.length === 0) return '';

        if (activeData.length === 1 || activeData.some(d => d.percentage >= 0.999)) {
          const activeItem = activeData.find(d => d.percentage >= 0.999) || activeData[0];
          return `
            <svg width="200" height="200" viewBox="0 0 200 200">
              <circle cx="${cx}" cy="${cy}" r="${r}" fill="${activeItem.color}" />
              <circle cx="${cx}" cy="${cy}" r="${r * 0.55}" fill="#FFFFFF" />
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
          <svg width="200" height="200" viewBox="0 0 200 200">
            ${paths}
            <circle cx="${cx}" cy="${cy}" r="${r * 0.55}" fill="#FFFFFF" />
          </svg>
        `;
      };

      // --- Weekly Calculations for Bar Chart ---
      const weeks = eachWeekOfInterval({ start: startDateForWeekCalc, end: endDateForWeekCalc }, { weekStartsOn: 1 });
      const weeksList = weeks.map((weekStart, index) => {
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        
        const formattedStart = format(weekStart, 'MMM dd');
        const formattedEnd = format(weekEnd, 'MMM dd');
        const dateRange = `${formattedStart} - ${formattedEnd}`;
        
        let weekdaySpend = 0;
        let weekendSpend = 0;
        
        filteredExpenses.forEach(e => {
          const d = parseISO(e.expenseDate);
          const wStart = startOfDay(weekStart);
          const wEnd = endOfDay(weekEnd);
          if (d >= wStart && d <= wEnd) {
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

      const pieChartSvg = generateSvgPieChart(catWithData);
      const barChartSvg = generateSvgBarChart(weeksList);

      const htmlContent = `
        <html>
          <head>
            <style>
              body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 40px; color: #2D3748; background-color: #FFFFFF; }
              h1 { text-align: center; color: #1A365D; border-bottom: 2px solid #E2E8F0; padding-bottom: 10px; margin-bottom: 5px; }
              h2.section-title { color: #2B6CB0; border-bottom: 1px solid #E2E8F0; padding-bottom: 6px; margin-top: 30px; font-size: 18px; }
              .subtitle { text-align: center; color: #4A5568; margin-top: 0; margin-bottom: 25px; font-size: 14px; }
              
              .summary-container { display: flex; flex-direction: row; justify-content: space-between; gap: 15px; margin-bottom: 25px; }
              .summary-card { flex: 1; background: #F7FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 15px; text-align: center; }
              .summary-card .label { font-size: 12px; color: #718096; text-transform: uppercase; letter-spacing: 0.5px; font-weight: bold; margin-bottom: 5px; }
              .summary-card .value { font-size: 18px; color: #2D3748; font-weight: bold; }
              
              .visuals-section { display: flex; flex-direction: column; gap: 20px; margin-bottom: 30px; }
              .chart-card { background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 8px; padding: 20px; }
              .chart-card-title { font-size: 14px; color: #4A5568; margin-top: 0; margin-bottom: 15px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: bold; border-left: 3px solid #3182CE; padding-left: 8px; }
              
              .chart-flex { display: flex; flex-direction: row; align-items: center; justify-content: space-around; gap: 20px; }
              .chart-svg-box { flex: 1; display: flex; justify-content: center; align-items: center; }
              .chart-legend-box { flex: 1.5; }
              
              .legend-list { list-style: none; padding: 0; margin: 0; }
              .legend-item { display: flex; align-items: center; margin-bottom: 8px; font-size: 13px; }
              .legend-color-box { width: 10px; height: 10px; border-radius: 50%; margin-right: 10px; display: inline-block; flex-shrink: 0; }
              .legend-name { font-weight: 500; color: #4A5568; flex: 1; }
              .legend-value { font-weight: bold; color: #2D3748; text-align: right; margin-left: 10px; }
              
              .bar-chart-container { display: flex; flex-direction: column; align-items: center; width: 100%; }
              .bar-chart-legend { display: flex; flex-direction: row; justify-content: center; margin-top: 10px; margin-bottom: 12px; font-size: 12px; }
              .week-ranges-footer { font-size: 11px; color: #718096; text-align: center; border-top: 1px solid #EDF2F7; padding-top: 10px; width: 100%; }
              
              table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 13px; }
              th, td { border: 1px solid #E2E8F0; padding: 10px 12px; text-align: left; }
              th { background-color: #EDF2F7; color: #4A5568; font-weight: bold; }
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
                <div class="value" style="font-size: 14px; padding-top: 3px;">${hotCategories}</div>
              </div>
            </div>

            <h2 class="section-title">Visual Analytics</h2>
            <div class="visuals-section">
              <!-- Donut Chart Card -->
              <div class="chart-card">
                <div class="chart-card-title">Category Distribution</div>
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
                          <span class="legend-value">₹${item.amount.toFixed(2)} (${(item.percentage * 100).toFixed(1)}%)</span>
                        </li>
                      `).join('')}
                    </ul>
                  </div>
                </div>
              </div>

              <!-- Weekly Bar Chart Card -->
              <div class="chart-card">
                <div class="chart-card-title">Weekly Expenditure (Highlighting Weekends)</div>
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
              </div>
            </div>

            <div class="page-break"></div>

            <h2 class="section-title" style="margin-top: 0;">Category Breakdown</h2>
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th class="text-right">Total Amount (₹)</th>
                </tr>
              </thead>
              <tbody>
                ${sortedCats.map(([cat, amt]) => `
                  <tr>
                    <td>${cat}</td>
                    <td class="text-right">${amt.toFixed(2)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>

            <h2 class="section-title">Itemized Transaction History</h2>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Category</th>
                  <th>Remark</th>
                  <th class="text-right">Amount (₹)</th>
                </tr>
              </thead>
              <tbody>
                ${filteredExpenses.sort((a,b) => b.expenseDate.localeCompare(a.expenseDate)).map(e => {
                  const amt = (e.isSplit && e.splitDetails?.isSettled) ? e.myShare : e.totalAmount;
                  return `
                  <tr>
                    <td>${format(parseISO(e.expenseDate), 'MMM dd')}</td>
                    <td>${e.category}</td>
                    <td>${e.remark || '-'}</td>
                    <td class="text-right">${amt.toFixed(2)}</td>
                  </tr>
                `}).join('')}
              </tbody>
            </table>
          </body>
        </html>
      `;

      await Print.printAsync({ html: htmlContent });
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'Failed to generate PDF.');
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
          <TouchableOpacity onPress={() => setFullScreenChart('A')}>
            <Ionicons name="expand" size={20} color={theme.textMuted} />
          </TouchableOpacity>
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

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <BarChart
            data={chartAData}
            width={Math.max(screenWidth - 64, chartAData.labels.length * 25)}
            height={220}
            yAxisLabel="₹"
            yAxisSuffix=""
            chartConfig={getChartConfig(theme)}
            withCustomBarColorFromData={true}
            flatColor={true}
            showBarTops={false}
            showValuesOnTopOfBars={false}
            fromZero
            style={styles.chartStyle}
          />
        </ScrollView>
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
            <TouchableOpacity onPress={() => setFullScreenChart('B')} style={{ marginLeft: 12 }}>
              <Ionicons name="expand" size={20} color={theme.textMuted} />
            </TouchableOpacity>
          </View>
        </View>

        <BarChart
          data={chartBData}
          width={screenWidth - 64}
          height={220}
          yAxisLabel="₹"
          yAxisSuffix=""
          chartConfig={{
            ...getChartConfig(theme),
            color: (opacity = 1) => `rgba(72, 187, 120, ${opacity})`,
          }}
          fromZero
          style={styles.chartStyle}
        />
      </View>

      {/* Chart C: Category Distribution */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Category Distribution</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TouchableOpacity onPress={() => setShowChartCSelector(true)} style={styles.monthSelectorBtn}>
              <Text style={styles.monthSelectorText}>
                {chartCFilter === 'all' ? 'Overall' : events.find(e => e.id === chartCFilter)?.name?.substring(0, 10) + '...'}
              </Text>
              <Ionicons name="chevron-down" size={16} color={theme.primary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setFullScreenChart('C')} style={{ marginLeft: 12 }}>
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
              <ScrollView horizontal>
                <BarChart
                  data={chartAData}
                  width={Math.max(screenWidth, chartAData.labels.length * 30)}
                  height={Dimensions.get('window').height - 200}
                  yAxisLabel="₹"
                  yAxisSuffix=""
                  chartConfig={getChartConfig(theme)}
                  withCustomBarColorFromData={true}
                  flatColor={true}
                  fromZero
                />
              </ScrollView>
            )}
            {fullScreenChart === 'B' && (
              <BarChart
                data={chartBData}
                width={screenWidth - 32}
                height={Dimensions.get('window').height - 200}
                yAxisLabel="₹"
                yAxisSuffix=""
                chartConfig={{
                  ...getChartConfig(theme),
                  color: (opacity = 1) => `rgba(72, 187, 120, ${opacity})`,
                }}
                fromZero
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


    </ScrollView>
  );
};

const getStyles = (theme: ThemeColors) => StyleSheet.create({
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
    color: '#1A202C',
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
    backgroundColor: '#FFF',
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
  },
  reportTypeBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 6,
  },
  reportTypeBtnActive: {
    backgroundColor: '#FFF',
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
    color: theme.textPrimary,
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
  }
});
