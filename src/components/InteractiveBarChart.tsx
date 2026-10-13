import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Dimensions } from 'react-native';
import Svg, { Rect, Line, Text as SvgText, G } from 'react-native-svg';
import { ThemeColors } from '../theme/types';
import { Ionicons } from '@expo/vector-icons';

export interface BarDataPoint {
  id: string;
  value: number;
  color: string;
  label?: string; // e.g., "2025" or year
  tooltipTitle?: string; // e.g., "Jan 2025"
  tooltipSubtitle?: string; // e.g., "₹12,450"
  totalValue?: number;
  ignoredValue?: number;
  ignoredCategoriesText?: string;
  isOverThreshold?: boolean;
}

export interface BarGroupData {
  groupKey: string;
  groupLabel: string; // e.g., "Jan", "W1"
  groupSubLabel?: string; // e.g., "Sep 01 - 07"
  bars: BarDataPoint[];
}

interface InteractiveBarChartProps {
  data: BarGroupData[];
  height?: number;
  width?: number;
  scrollable?: boolean;
  theme: ThemeColors;
  legendItems?: { label: string; color: string }[];
  emptyMessage?: string;
  yAxisWidth?: number;
  threshold?: number;
  alertColor?: string;
}

export const InteractiveBarChart: React.FC<InteractiveBarChartProps> = ({
  data,
  height = 220,
  width: customWidth,
  scrollable = false,
  theme,
  legendItems,
  emptyMessage = 'No data available',
  yAxisWidth = 52,
  threshold,
  alertColor,
}) => {
  const [selectedBarId, setSelectedBarId] = useState<string | null>(null);
  const screenWidth = Dimensions.get('window').width;
  const containerWidth = customWidth || screenWidth - 64;

  const resolvedAlertColor = alertColor || theme.danger || '#EF4444';

  // Flatten all bar values to calculate max
  const allValues = useMemo(() => {
    return data.flatMap(g => g.bars.map(b => b.value));
  }, [data]);

  const maxVal = useMemo(() => {
    return Math.max(...allValues, 0);
  }, [allValues]);

  // Calculate clean dynamic Y-axis ticks with threshold ceiling and headroom when crossed
  const { yMax, ticks } = useMemo(() => {
    // 1. If Threshold / Limit is set by user:
    if (threshold && threshold > 0) {
      if (maxVal <= threshold) {
        // Limit is the ceiling. Use threshold as the exact top of the Y-axis.
        const numSegments = 4;
        const rawStep = threshold / numSegments;
        const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
        const residual = rawStep / magnitude;

        let step: number;
        if (residual <= 1.0) step = 1 * magnitude;
        else if (residual <= 2.0) step = 2 * magnitude;
        else if (residual <= 2.5) step = 2.5 * magnitude;
        else if (residual <= 5.0) step = 5 * magnitude;
        else step = 10 * magnitude;

        // If threshold divides neatly by 4 or 5, use exact integer steps
        if (threshold % 4 === 0) {
          const exactStep = threshold / 4;
          return { yMax: threshold, ticks: [0, exactStep, exactStep * 2, exactStep * 3, threshold] };
        } else if (threshold % 5 === 0) {
          const exactStep = threshold / 5;
          return { yMax: threshold, ticks: [0, exactStep, exactStep * 2, exactStep * 3, exactStep * 4, threshold] };
        } else {
          const calculatedTicks: number[] = [0];
          let current = step;
          while (current < threshold) {
            calculatedTicks.push(Math.round(current));
            current += step;
          }
          calculatedTicks.push(threshold);
          return { yMax: threshold, ticks: calculatedTicks };
        }
      } else {
        // Red bar crossed the threshold!
        // Increase Y-limit to maximum bar length with a little space above it
        const targetMax = maxVal * 1.18;
        const numSegments = 4;
        const rawStep = targetMax / numSegments;
        const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
        const residual = rawStep / magnitude;

        let step: number;
        if (residual <= 1.0) step = 1 * magnitude;
        else if (residual <= 2.0) step = 2 * magnitude;
        else if (residual <= 2.5) step = 2.5 * magnitude;
        else if (residual <= 5.0) step = 5 * magnitude;
        else step = 10 * magnitude;

        let computedMax = 0;
        const calculatedTicks: number[] = [0];
        while (computedMax < targetMax || computedMax < maxVal * 1.05) {
          computedMax += step;
          calculatedTicks.push(Math.round(computedMax));
        }

        return { yMax: computedMax, ticks: calculatedTicks };
      }
    }

    // 2. Auto Mode (No threshold set / limit disabled) -> Fit Y-axis directly to actual expenses
    if (maxVal <= 0) {
      return { yMax: 1000, ticks: [0, 250, 500, 750, 1000] };
    }

    const targetMax = maxVal * 1.15;
    const numSegments = 4;
    const rawStep = targetMax / numSegments;
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const residual = rawStep / magnitude;

    let step: number;
    if (residual <= 1.0) step = 1 * magnitude;
    else if (residual <= 2.0) step = 2 * magnitude;
    else if (residual <= 2.5) step = 2.5 * magnitude;
    else if (residual <= 5.0) step = 5 * magnitude;
    else step = 10 * magnitude;

    let computedMax = 0;
    const calculatedTicks: number[] = [0];
    while (computedMax < targetMax || computedMax < maxVal * 1.04) {
      computedMax += step;
      calculatedTicks.push(Math.round(computedMax));
    }

    return { yMax: computedMax, ticks: calculatedTicks };
  }, [maxVal, threshold]);

  const formatYAxisLabel = (val: number) => {
    if (val === 0) return '₹0';
    if (val >= 10000000) return `₹${(val / 10000000).toFixed(1)}Cr`;
    if (val >= 100000) return `₹${(val / 100000).toFixed(val % 100000 === 0 ? 0 : 1)}L`;
    if (val >= 1000) {
      const k = val / 1000;
      return `₹${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}K`;
    }
    return `₹${Math.round(val)}`;
  };

  const formatTooltipAmount = (val: number) => {
    return `₹${val.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  };

  // Chart layout dimensions
  const paddingTop = 32;
  const paddingBottom = 26;
  const chartPlotHeight = height - paddingTop - paddingBottom;

  // Selected bar details for the banner & tooltip
  const selectedDetails = useMemo(() => {
    if (!selectedBarId) return null;
    for (const group of data) {
      for (const bar of group.bars) {
        if (bar.id === selectedBarId) {
          const isOver = bar.isOverThreshold !== undefined
            ? bar.isOverThreshold
            : (threshold && threshold > 0 && bar.value > threshold);
          return {
            bar,
            group,
            title: bar.tooltipTitle || (bar.label ? `${group.groupLabel} (${bar.label})` : group.groupLabel),
            subtitle: bar.tooltipSubtitle || group.groupSubLabel,
            formattedAmount: formatTooltipAmount(bar.value),
            totalAmount: bar.totalValue !== undefined ? formatTooltipAmount(bar.totalValue) : undefined,
            ignoredAmount: bar.ignoredValue ? formatTooltipAmount(bar.ignoredValue) : undefined,
            ignoredText: bar.ignoredCategoriesText,
            color: isOver ? resolvedAlertColor : bar.color,
            isOverThreshold: isOver,
            overAmount: isOver && threshold ? bar.value - threshold : 0,
          };
        }
      }
    }
    return null;
  }, [selectedBarId, data, threshold, resolvedAlertColor]);

  // Determine dynamic sizing for bars & plot
  const numGroups = data.length;
  const maxBarsInGroup = Math.max(...data.map(g => g.bars.length), 1);

  // Layout sizing calculations
  const plotLayout = useMemo(() => {
    if (scrollable) {
      // In scrollable mode (e.g. Chart A with up to 36 bars across 12 months)
      const barWidth = maxBarsInGroup === 1 ? 22 : (maxBarsInGroup === 2 ? 16 : 12);
      const barSpacing = 3;
      const groupWidth = maxBarsInGroup * barWidth + (maxBarsInGroup - 1) * barSpacing;
      const groupSpacing = maxBarsInGroup === 1 ? 16 : 20;
      const totalPlotWidth = Math.max(
        containerWidth - yAxisWidth,
        numGroups * (groupWidth + groupSpacing) + 24
      );
      return { barWidth, barSpacing, groupWidth, groupSpacing, totalPlotWidth };
    } else {
      // Non-scrollable mode (e.g. Chart B with 4-5 weeks)
      const availablePlotWidth = containerWidth - yAxisWidth;
      const groupSpacing = numGroups <= 5 ? 24 : 14;
      const totalGroupSpacing = groupSpacing * (numGroups + 1);
      const groupWidth = Math.max(16, (availablePlotWidth - totalGroupSpacing) / Math.max(numGroups, 1));
      const barSpacing = 2;
      const barWidth = (groupWidth - (maxBarsInGroup - 1) * barSpacing) / maxBarsInGroup;
      return { barWidth, barSpacing, groupWidth, groupSpacing, totalPlotWidth: availablePlotWidth };
    }
  }, [scrollable, containerWidth, yAxisWidth, numGroups, maxBarsInGroup]);

  if (data.length === 0 || allValues.length === 0) {
    return (
      <View style={[styles.emptyContainer, { height }]}>
        <Text style={[styles.emptyText, { color: theme.textMuted }]}>{emptyMessage}</Text>
      </View>
    );
  }

  // Render SVG bars & X-axis labels
  const renderPlotContent = () => {
    const { barWidth, barSpacing, groupWidth, groupSpacing, totalPlotWidth } = plotLayout;

    return (
      <Svg width={totalPlotWidth} height={height}>
        {/* Horizontal Dashed Grid Lines (strictly within the plot area, no overlapping Y-axis) */}
        {ticks.map((tick, i) => {
          const y = paddingTop + chartPlotHeight - (tick / yMax) * chartPlotHeight;
          const isZero = tick === 0;
          return (
            <Line
              key={`grid-line-${i}`}
              x1={0}
              y1={y}
              x2={totalPlotWidth}
              y2={y}
              stroke={theme.cardBorder}
              strokeOpacity={isZero ? 0.7 : 0.4}
              strokeDasharray={isZero ? undefined : '4, 4'}
              strokeWidth={isZero ? 1.2 : 0.8}
            />
          );
        })}

        {/* Horizontal Threshold Alert Line */}
        {threshold && threshold > 0 && yMax > 0 && (
          <G key="threshold-line-layer">
            {(() => {
              const thresholdY = paddingTop + chartPlotHeight - (threshold / yMax) * chartPlotHeight;
              if (thresholdY >= paddingTop - 12 && thresholdY <= paddingTop + chartPlotHeight + 2) {
                const labelText = `Limit ${formatYAxisLabel(threshold)}`;
                const pillWidth = Math.max(labelText.length * 6.8 + 14, 66);
                const pillX = Math.max(6, totalPlotWidth - pillWidth - 10);
                const pillY = thresholdY - 10;

                return (
                  <G>
                    {/* Glowing dashed line */}
                    <Line
                      x1={0}
                      y1={thresholdY}
                      x2={totalPlotWidth}
                      y2={thresholdY}
                      stroke={resolvedAlertColor}
                      strokeWidth={1.8}
                      strokeDasharray="6, 4"
                      strokeOpacity={0.9}
                    />

                    {/* Threshold label pill */}
                    <Rect
                      x={pillX}
                      y={pillY}
                      width={pillWidth}
                      height={20}
                      rx={6}
                      ry={6}
                      fill={resolvedAlertColor}
                    />

                    <SvgText
                      x={pillX + pillWidth / 2}
                      y={pillY + 14}
                      textAnchor="middle"
                      fill="#FFFFFF"
                      fontSize={10}
                      fontWeight="bold"
                    >
                      {labelText}
                    </SvgText>
                  </G>
                );
              }
              return null;
            })()}
          </G>
        )}

        {/* Bar Groups */}
        {data.map((group, gIndex) => {
          const groupStartX = scrollable
            ? 12 + gIndex * (groupWidth + groupSpacing)
            : groupSpacing + gIndex * (groupWidth + groupSpacing);
          const groupCenterX = groupStartX + groupWidth / 2;
          const isGroupSelected = group.bars.some(b => b.id === selectedBarId);

          return (
            <G key={`group-${group.groupKey}-${gIndex}`}>
              {/* Bars inside group */}
              {group.bars.map((bar, bIndex) => {
                const barX = groupStartX + bIndex * (barWidth + barSpacing);
                const rawHeight = yMax > 0 ? (bar.value / yMax) * chartPlotHeight : 0;
                const barHeight = Math.min(chartPlotHeight, rawHeight);
                const barY = paddingTop + chartPlotHeight - barHeight;
                const isSelected = selectedBarId === bar.id;
                const hasSelection = selectedBarId !== null;
                const opacity = hasSelection ? (isSelected ? 1.0 : 0.45) : 1.0;
                const isOverThreshold = bar.isOverThreshold !== undefined
                  ? bar.isOverThreshold
                  : (threshold && threshold > 0 && bar.value > threshold);
                const activeColor = isOverThreshold ? resolvedAlertColor : bar.color;

                return (
                  <G key={`bar-${bar.id}`}>
                    {/* Actual visible Bar */}
                    <Rect
                      x={barX}
                      y={barHeight > 0 ? barY : paddingTop + chartPlotHeight - 2}
                      width={Math.max(barWidth, 4)}
                      height={barHeight > 0 ? barHeight : 2}
                      rx={3}
                      ry={3}
                      fill={activeColor}
                      fillOpacity={opacity}
                      stroke={isSelected ? theme.textPrimary : isOverThreshold ? resolvedAlertColor : 'transparent'}
                      strokeWidth={isSelected ? 2 : isOverThreshold ? 1 : 0}
                    />

                    {/* Floating Tooltip directly above selected bar */}
                    {isSelected && barHeight > 0 && (
                      <G>
                        {/* Tooltip background pill */}
                        <Rect
                          x={Math.max(2, Math.min(barX + barWidth / 2 - 44, totalPlotWidth - 92))}
                          y={Math.max(2, barY - 26)}
                          width={88}
                          height={22}
                          rx={6}
                          ry={6}
                          fill={isOverThreshold ? resolvedAlertColor : theme.surface}
                          stroke={isOverThreshold ? resolvedAlertColor : theme.cardBorder}
                          strokeWidth={1}
                        />
                        {/* Tooltip text */}
                        <SvgText
                          x={Math.max(2, Math.min(barX + barWidth / 2 - 44, totalPlotWidth - 92)) + 44}
                          y={Math.max(2, barY - 26) + 15}
                          textAnchor="middle"
                          fill={isOverThreshold ? '#FFFFFF' : theme.textPrimary}
                          fontSize={10}
                          fontWeight="bold"
                        >
                          {isOverThreshold ? `⚠️ ${formatTooltipAmount(bar.value)}` : formatTooltipAmount(bar.value)}
                        </SvgText>
                      </G>
                    )}

                    {/* Generous transparent Touch Target for smooth tapping */}
                    <Rect
                      x={barX - 4}
                      y={0}
                      width={barWidth + 8}
                      height={height}
                      fill="transparent"
                      onPress={() => {
                        if (selectedBarId === bar.id) {
                          setSelectedBarId(null);
                        } else {
                          setSelectedBarId(bar.id);
                        }
                      }}
                    />
                  </G>
                );
              })}

              {/* X-Axis Group Label */}
              <SvgText
                x={groupCenterX}
                y={paddingTop + chartPlotHeight + 16}
                textAnchor="middle"
                fill={isGroupSelected ? theme.primary : theme.textSecondary}
                fontSize={11}
                fontWeight={isGroupSelected ? 'bold' : '500'}
              >
                {group.groupLabel}
              </SvgText>
            </G>
          );
        })}
      </Svg>
    );
  };

  return (
    <View style={styles.wrapper}>
      {/* Optional Top Legend / Year Indicators */}
      {legendItems && legendItems.length > 0 && (
        <View style={styles.legendRow}>
          {legendItems.map((item, idx) => (
            <View key={`legend-${idx}`} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: item.color }]} />
              <Text style={[styles.legendText, { color: theme.textSecondary }]}>{item.label}</Text>
            </View>
          ))}
          {threshold && threshold > 0 && (
            <View style={styles.legendItem}>
              <View style={[styles.legendDash, { backgroundColor: resolvedAlertColor }]} />
              <Text style={[styles.legendText, { color: resolvedAlertColor, fontWeight: '700' }]}>
                Limit ({formatYAxisLabel(threshold)})
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Selected Bar Inspection Banner */}
      {selectedDetails ? (
        <View style={[
          styles.selectedBanner, 
          { backgroundColor: theme.surface, borderColor: selectedDetails.isOverThreshold ? resolvedAlertColor : theme.cardBorder }
        ]}>
          <View style={styles.selectedBannerLeft}>
            <View style={[styles.selectedDot, { backgroundColor: selectedDetails.color }]} />
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={[styles.selectedTitle, { color: theme.textPrimary }]}>
                  {selectedDetails.title}
                </Text>
                {selectedDetails.isOverThreshold && (
                  <View style={[styles.alertTag, { backgroundColor: `${resolvedAlertColor}20`, borderColor: resolvedAlertColor }]}>
                    <Text style={[styles.alertTagText, { color: resolvedAlertColor }]}>Exceeded Limit</Text>
                  </View>
                )}
              </View>
              {selectedDetails.subtitle && (
                <Text style={[styles.selectedSubtitle, { color: theme.textMuted }]}>
                  {selectedDetails.subtitle}
                </Text>
              )}
            </View>
          </View>
          <View style={styles.selectedBannerRight}>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[
                styles.selectedAmount, 
                { color: selectedDetails.isOverThreshold ? resolvedAlertColor : theme.primary }
              ]}>
                {selectedDetails.formattedAmount}
              </Text>
              {selectedDetails.totalAmount && selectedDetails.totalAmount !== selectedDetails.formattedAmount && (
                <Text style={[styles.selectedTotalText, { color: theme.textMuted }]}>
                  Total: {selectedDetails.totalAmount}
                </Text>
              )}
            </View>
            <TouchableOpacity
              onPress={() => setSelectedBarId(null)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={styles.closeBtn}
            >
              <Ionicons name="close-circle" size={18} color={theme.textMuted} />
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={styles.hintContainer}>
          <Ionicons name="hand-left-outline" size={13} color={theme.textMuted} style={{ marginRight: 4 }} />
          <Text style={[styles.hintText, { color: theme.textMuted }]}>
            Tap any bar to inspect amount {threshold && threshold > 0 ? '• Red bars exceed threshold' : ''}
          </Text>
        </View>
      )}

      {/* Main Chart Container with Dynamic Y-Axis and (Optional) Scrollable Plot */}
      <View style={[styles.chartContainer, { height }]}>
        {/* Dynamic Y-Axis Column */}
        <View style={[styles.yAxisContainer, { width: yAxisWidth, height }]}>
          <Svg width={yAxisWidth} height={height}>
            {ticks.map((tick, i) => {
              const y = paddingTop + chartPlotHeight - (tick / yMax) * chartPlotHeight;
              return (
                <SvgText
                  key={`y-label-${i}`}
                  x={yAxisWidth - 8}
                  y={y + 4}
                  textAnchor="end"
                  fill={theme.textSecondary}
                  fontSize={10}
                  fontWeight="500"
                >
                  {formatYAxisLabel(tick)}
                </SvgText>
              );
            })}
          </Svg>
        </View>

        {/* Chart Plot Area (Scrollable or Static) */}
        {scrollable ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingRight: 16 }}
            style={styles.scrollablePlot}
          >
            {renderPlotContent()}
          </ScrollView>
        ) : (
          <View style={styles.staticPlot}>
            {renderPlotContent()}
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    marginVertical: 4,
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  legendDash: {
    width: 12,
    height: 3,
    borderRadius: 2,
    marginRight: 6,
  },
  legendText: {
    fontSize: 12,
    fontWeight: '600',
  },
  selectedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 8,
  },
  selectedBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  selectedDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  selectedTitle: {
    fontSize: 13,
    fontWeight: 'bold',
  },
  selectedSubtitle: {
    fontSize: 11,
    marginTop: 1,
  },
  alertTag: {
    marginLeft: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 0.8,
  },
  alertTagText: {
    fontSize: 10,
    fontWeight: '700',
  },
  selectedBannerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  selectedAmount: {
    fontSize: 15,
    fontWeight: 'bold',
  },
  selectedTotalText: {
    fontSize: 10,
    fontWeight: '500',
    marginTop: 1,
  },
  closeBtn: {
    marginLeft: 8,
  },
  hintContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 4,
    marginBottom: 6,
  },
  hintText: {
    fontSize: 11,
  },
  chartContainer: {
    flexDirection: 'row',
  },
  yAxisContainer: {
    justifyContent: 'flex-start',
  },
  scrollablePlot: {
    flex: 1,
  },
  staticPlot: {
    flex: 1,
  },
  emptyContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
  },
});
