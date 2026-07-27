import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { RootStackParamList } from "../../App";
import { relayClient } from "../services/relay-client";

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, "NewTask">;
};

export default function NewTaskScreen({ navigation }: Props) {
  const [goal, setGoal] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = () => {
    const trimmed = goal.trim();
    if (!trimmed) {
      setError("Please enter a goal");
      return;
    }
    setSubmitting(true);
    setError("");
    relayClient.submitGoal(trimmed);

    const unsub = relayClient.subscribe((msg) => {
      if (msg.type === "plan:update") {
        setSubmitting(false);
        unsub();
        navigation.goBack();
      }
    });

    setTimeout(() => {
      setSubmitting(false);
      unsub();
      setError("Timed out waiting for response");
    }, 15000);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.inner}>
        <Text style={styles.label}>What do you want to do?</Text>
        <TextInput
          style={styles.input}
          value={goal}
          onChangeText={(t) => { setGoal(t); setError(""); }}
          placeholder="e.g. Build a REST API for user management"
          multiline
          numberOfLines={4}
          textAlignVertical="top"
          editable={!submitting}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitText}>Submit Goal</Text>
          )}
        </TouchableOpacity>

        {submitting && (
          <Text style={styles.hint}>Generating plan via Cloud Bridge...</Text>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  inner: { flex: 1, padding: 16 },
  label: { fontSize: 16, fontWeight: "700", marginBottom: 12, color: "#333" },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    minHeight: 120,
    backgroundColor: "#fafafa",
  },
  error: { color: "#F44336", fontSize: 13, marginTop: 6 },
  submitBtn: {
    marginTop: 16,
    backgroundColor: "#1a73e8",
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
  },
  submitBtnDisabled: { opacity: 0.7 },
  submitText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  hint: { textAlign: "center", color: "#888", fontSize: 13, marginTop: 12 },
});
