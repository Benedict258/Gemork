import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
} from "react-native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { RootStackParamList } from "../../App";
import { relayClient } from "../services/relay-client";
import { Plan } from "../types";

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, "TaskList">;
};

export default function TaskListScreen({ navigation }: Props) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const unsub = relayClient.subscribe((msg) => {
      if (msg.type === "plan:update") {
        setPlans((prev) => {
          const idx = prev.findIndex((p) => p.id === msg.plan.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = msg.plan;
            return next;
          }
          return [msg.plan, ...prev];
        });
      }
      if (msg.type === "step:update") {
        setPlans((prev) =>
          prev.map((p) =>
            p.id === msg.planId
              ? {
                  ...p,
                  steps: p.steps.map((s) =>
                    s.id === msg.step.id ? msg.step : s
                  ),
                }
              : p
          )
        );
      }
    });
    return unsub;
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 800);
  }, []);

  const completedSteps = (p: Plan) =>
    p.steps.filter((s) => s.status === "done").length;

  return (
    <View style={styles.container}>
      <FlatList
        data={plans}
        keyExtractor={(p) => p.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No active tasks</Text>
            <Text style={styles.emptySubtext}>Tap + to submit a new goal</Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.item}
            onPress={() => navigation.navigate("TaskDetail", { planId: item.id })}
          >
            <View style={styles.itemHeader}>
              <Text style={styles.goal} numberOfLines={2}>{item.goal}</Text>
              <View style={[styles.statusBadge, statusColor(item.status)]}>
                <Text style={styles.statusText}>{item.status}</Text>
              </View>
            </View>
            <View style={styles.itemMeta}>
              <Text style={styles.meta}>
                {completedSteps(item)}/{item.steps.length} steps
              </Text>
              <View style={styles.progressBar}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${item.steps.length ? (completedSteps(item) / item.steps.length) * 100 : 0}%` },
                  ]}
                />
              </View>
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

function statusColor(status: string) {
  switch (status) {
    case "running": return { backgroundColor: "#e3f2fd" };
    case "done": return { backgroundColor: "#e8f5e9" };
    case "failed": return { backgroundColor: "#ffebee" };
    case "paused": return { backgroundColor: "#fff3e0" };
    default: return { backgroundColor: "#f5f5f5" };
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  item: {
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e0e0e0",
  },
  itemHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  goal: { flex: 1, fontSize: 15, color: "#222", marginRight: 8 },
  statusBadge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 12, fontWeight: "600", color: "#555" },
  itemMeta: { flexDirection: "row", alignItems: "center", marginTop: 8, gap: 10 },
  meta: { fontSize: 12, color: "#888" },
  progressBar: {
    flex: 1, height: 4, backgroundColor: "#e0e0e0", borderRadius: 2,
  },
  progressFill: { height: 4, backgroundColor: "#4CAF50", borderRadius: 2 },
  empty: { alignItems: "center", marginTop: 80 },
  emptyText: { fontSize: 16, color: "#888" },
  emptySubtext: { fontSize: 13, color: "#aaa", marginTop: 4 },
});
