import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { PlanStep } from "../types";

const STATUS_ICON: Record<string, string> = {
  pending: "○",
  running: "●",
  done: "✓",
  failed: "✗",
  skipped: "—",
};

const TIER_COLORS: Record<number, string> = {
  1: "#4CAF50",
  2: "#FF9800",
  3: "#F44336",
};

interface StepItemProps {
  step: PlanStep;
  isCurrent?: boolean;
  compact?: boolean;
}

export default function StepItem({ step, isCurrent, compact }: StepItemProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <TouchableOpacity
      style={[
        styles.container,
        isCurrent && styles.current,
        compact && styles.compact,
      ]}
      onPress={() => !compact && setExpanded(!expanded)}
      activeOpacity={0.7}
    >
      <View style={styles.row}>
        <Text style={styles.icon}>{STATUS_ICON[step.status] || "○"}</Text>
        <Text style={styles.number}>#{step.number}</Text>
        <View style={[styles.tierBadge, { backgroundColor: TIER_COLORS[step.tier] }]}>
          <Text style={styles.tierText}>{step.tier}</Text>
        </View>
        <Text style={[styles.description, isCurrent && styles.currentText]} numberOfLines={compact ? 1 : undefined}>
          {step.description}
        </Text>
      </View>

      {expanded && !compact && (
        <View style={styles.details}>
          {step.rationale ? (
            <Text style={styles.detailText}>Why: {step.rationale}</Text>
          ) : null}
          {step.connector ? (
            <Text style={styles.detailText}>Via: {step.connector}</Text>
          ) : null}
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e0e0e0",
  },
  compact: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  current: {
    backgroundColor: "#e3f2fd",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  icon: {
    fontSize: 18,
    width: 24,
    textAlign: "center",
  },
  number: {
    fontSize: 13,
    color: "#888",
    width: 36,
  },
  tierBadge: {
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: 8,
  },
  tierText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },
  description: {
    flex: 1,
    fontSize: 15,
    color: "#222",
  },
  currentText: {
    fontWeight: "600",
  },
  details: {
    marginTop: 8,
    paddingLeft: 74,
  },
  detailText: {
    fontSize: 13,
    color: "#666",
    marginBottom: 2,
  },
});
