import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { RouteProp } from "@react-navigation/native";
import { RootStackParamList } from "../../App";
import { relayClient } from "../services/relay-client";
import { Plan } from "../types";
import StepItem from "../components/StepItem";

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, "TaskDetail">;
  route: RouteProp<RootStackParamList, "TaskDetail">;
};

export default function TaskDetailScreen({ navigation, route }: Props) {
  const { planId } = route.params;
  const [plan, setPlan] = useState<Plan | null>(null);

  useEffect(() => {
    const unsub = relayClient.subscribe((msg) => {
      if (msg.type === "plan:update" && msg.plan.id === planId) {
        setPlan(msg.plan);
      }
      if (msg.type === "step:update" && msg.planId === planId) {
        setPlan((prev) =>
          prev
            ? {
                ...prev,
                steps: prev.steps.map((s) =>
                  s.id === msg.step.id ? msg.step : s
                ),
              }
            : prev
        );
      }
    });
    return unsub;
  }, [planId]);

  if (!plan) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1a73e8" />
      </View>
    );
  }

  const completed = plan.steps.filter((s) => s.status === "done").length;
  const progress = plan.steps.length ? completed / plan.steps.length : 0;
  const currentStep = plan.steps.find((s) => s.status === "running");

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.goal}>{plan.goal}</Text>
        <View style={styles.metaRow}>
          <Text style={styles.meta}>Created {new Date(plan.createdAt).toLocaleDateString()}</Text>
          <View style={[styles.statusBadge, { backgroundColor: plan.status === "running" ? "#e3f2fd" : "#f5f5f5" }]}>
            <Text style={styles.statusText}>{plan.status}</Text>
          </View>
        </View>
      </View>

      <View style={styles.progressSection}>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>
        <Text style={styles.progressText}>{completed}/{plan.steps.length} steps</Text>
      </View>

      <View style={styles.controls}>
        {plan.status === "running" && (
          <TouchableOpacity
            style={[styles.btn, styles.pauseBtn]}
            onPress={() => relayClient.pausePlan(plan.id)}
          >
            <Text style={styles.btnText}>Pause</Text>
          </TouchableOpacity>
        )}
        {plan.status === "paused" && (
          <TouchableOpacity
            style={[styles.btn, styles.resumeBtn]}
            onPress={() => relayClient.resumePlan(plan.id)}
          >
            <Text style={styles.btnText}>Resume</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.stepsSection}>
        <Text style={styles.sectionTitle}>Steps</Text>
        {plan.steps.map((step) => (
          <View key={step.id}>
            <StepItem step={step} isCurrent={step.id === currentStep?.id} />
            {step.tier === 3 && step.status === "pending" && (
              <View style={styles.approvalRow}>
                <TouchableOpacity
                  style={[styles.approveBtn]}
                  onPress={() => relayClient.respondApproval(plan.id, step.id, true)}
                >
                  <Text style={styles.approveText}>Approve</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.rejectBtn]}
                  onPress={() => relayClient.respondApproval(plan.id, step.id, false)}
                >
                  <Text style={styles.rejectText}>Reject</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: { padding: 16 },
  goal: { fontSize: 18, fontWeight: "700", color: "#222" },
  metaRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8 },
  meta: { fontSize: 13, color: "#888" },
  statusBadge: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3 },
  statusText: { fontSize: 12, fontWeight: "600", color: "#555" },
  progressSection: { padding: 16, paddingTop: 0 },
  progressBar: { height: 6, backgroundColor: "#e0e0e0", borderRadius: 3 },
  progressFill: { height: 6, backgroundColor: "#4CAF50", borderRadius: 3 },
  progressText: { fontSize: 12, color: "#888", marginTop: 4, textAlign: "right" },
  controls: { flexDirection: "row", paddingHorizontal: 16, gap: 12 },
  btn: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: "center" },
  pauseBtn: { backgroundColor: "#FF9800" },
  resumeBtn: { backgroundColor: "#4CAF50" },
  btnText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  stepsSection: { padding: 16 },
  sectionTitle: { fontSize: 16, fontWeight: "700", marginBottom: 8, color: "#333" },
  approvalRow: { flexDirection: "row", paddingHorizontal: 16, paddingBottom: 8, gap: 12 },
  approveBtn: { flex: 1, backgroundColor: "#4CAF50", borderRadius: 6, paddingVertical: 8, alignItems: "center" },
  rejectBtn: { flex: 1, backgroundColor: "#F44336", borderRadius: 6, paddingVertical: 8, alignItems: "center" },
  approveText: { color: "#fff", fontWeight: "600" },
  rejectText: { color: "#fff", fontWeight: "600" },
});
