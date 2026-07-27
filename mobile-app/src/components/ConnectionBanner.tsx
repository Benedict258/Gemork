import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { ConnectionState } from "../types";

interface ConnectionBannerProps {
  state: ConnectionState;
  relayUrl: string;
  onRetry?: () => void;
}

const BANNER_CONFIG: Record<ConnectionState, { bg: string; text: string }> = {
  connected: { bg: "#4CAF50", text: "Connected" },
  connecting: { bg: "#FFC107", text: "Connecting..." },
  reconnecting: { bg: "#FFC107", text: "Reconnecting..." },
  disconnected: { bg: "#F44336", text: "Disconnected — tap to retry" },
};

export default function ConnectionBanner({ state, relayUrl, onRetry }: ConnectionBannerProps) {
  const config = BANNER_CONFIG[state];

  const content = (
    <View style={[styles.banner, { backgroundColor: config.bg }]}>
      <Text style={styles.text}>{config.text}</Text>
      <Text style={styles.url} numberOfLines={1}>{relayUrl}</Text>
    </View>
  );

  if (state === "disconnected" && onRetry) {
    return <TouchableOpacity onPress={onRetry}>{content}</TouchableOpacity>;
  }

  return content;
}

const styles = StyleSheet.create({
  banner: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  text: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
  url: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 11,
    maxWidth: 180,
  },
});
