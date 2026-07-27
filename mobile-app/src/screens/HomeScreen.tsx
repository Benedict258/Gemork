import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { RootStackParamList } from "../../App";
import { relayClient } from "../services/relay-client";
import { ConnectionState, Plan, SessionInfo } from "../types";
import ConnectionBanner from "../components/ConnectionBanner";
import storage from "../storage";
import { CONFIG } from "../config";

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, "Home">;
};

export default function HomeScreen({ navigation }: Props) {
  const [connState, setConnState] = useState<ConnectionState>(relayClient.state);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [recentPlans, setRecentPlans] = useState<Plan[]>([]);

  useEffect(() => {
    const unsub = relayClient.subscribe((msg) => {
      if ((msg as any).state) setConnState((msg as any).state);
      if (msg.type === "plan:update") {
        setRecentPlans((prev) => {
          const idx = prev.findIndex((p) => p.id === msg.plan.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = msg.plan;
            return next;
          }
          return [msg.plan, ...prev].slice(0, 10);
        });
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    storage.getSession().then(setSession);
  }, []);

  const handleRetry = () => {
    if (session) {
      relayClient.connect(session.relayUrl, session.sessionId);
    }
  };

  return (
    <View style={styles.container}>
      <ConnectionBanner state={connState} relayUrl={relayClient.relayUrl} onRetry={handleRetry} />

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Session</Text>
        {session ? (
          <View style={styles.infoBox}>
            <Text style={styles.infoLabel}>Session ID</Text>
            <Text style={styles.infoValue} numberOfLines={1}>{session.sessionId}</Text>
            <Text style={styles.infoLabel}>Connected at</Text>
            <Text style={styles.infoValue}>{new Date(session.connectedAt).toLocaleString()}</Text>
          </View>
        ) : (
          <Text style={styles.empty}>No active session</Text>
        )}
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => navigation.navigate("NewTask")}
        >
          <Text style={styles.actionText}>+ New Task</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, styles.actionSecondary]}
          onPress={() => navigation.navigate("TaskList")}
        >
          <Text style={[styles.actionText, styles.actionSecondaryText]}>Active Tasks</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Recent</Text>
        {recentPlans.length === 0 ? (
          <Text style={styles.empty}>No recent tasks</Text>
        ) : (
          <FlatList
            data={recentPlans}
            keyExtractor={(p) => p.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.recentItem}
                onPress={() => navigation.navigate("TaskDetail", { planId: item.id })}
              >
                <Text style={styles.recentGoal} numberOfLines={1}>{item.goal}</Text>
                <Text style={styles.recentMeta}>{item.steps.length} steps · {item.status}</Text>
              </TouchableOpacity>
            )}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  section: { padding: 16 },
  sectionTitle: { fontSize: 16, fontWeight: "700", marginBottom: 8, color: "#333" },
  infoBox: { backgroundColor: "#f5f5f5", borderRadius: 8, padding: 12 },
  infoLabel: { fontSize: 12, color: "#888", marginTop: 4 },
  infoValue: { fontSize: 14, color: "#222" },
  actions: { flexDirection: "row", paddingHorizontal: 16, gap: 12 },
  actionBtn: {
    flex: 1,
    backgroundColor: "#1a73e8",
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
  },
  actionSecondary: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#1a73e8" },
  actionText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  actionSecondaryText: { color: "#1a73e8" },
  recentItem: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e0e0e0",
  },
  recentGoal: { fontSize: 15, color: "#222" },
  recentMeta: { fontSize: 12, color: "#888", marginTop: 2 },
  empty: { color: "#aaa", fontSize: 14 },
});
