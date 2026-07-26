import { useState, useEffect } from "react";
import { View, Text, FlatList, StyleSheet } from "react-native";

interface PlanStep {
  id: string;
  description: string;
  status: string;
  tier: number;
}

export default function TaskDetailScreen({ route }: any) {
  const { planId } = route.params;
  const [steps, setSteps] = useState<PlanStep[]>([]);

  useEffect(() => {
    fetchPlanDetail();
  }, [planId]);

  const fetchPlanDetail = async () => {
    try {
      // TODO: Replace with actual cloud relay URL
      // const response = await fetch(`https://your-cloud-relay.com/api/plans/${planId}`);
      // const data = await response.json();
      // setSteps(data.plan.steps);

      // Placeholder for development
      setSteps([
        { id: "1", description: "Analyze goal and gather context", status: "completed", tier: 1 },
        { id: "2", description: "Research existing patterns", status: "completed", tier: 1 },
        { id: "3", description: "Draft deliverable document", status: "running", tier: 2 },
        { id: "4", description: "Review and finalize", status: "pending", tier: 2 },
      ]);
    } catch (e) {
      console.error("Failed to fetch plan detail:", e);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Plan Steps</Text>
      <FlatList
        data={steps}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.stepCard}>
            <Text style={styles.stepDescription}>{item.description}</Text>
            <Text style={styles.stepMeta}>
              Tier {item.tier} • {item.status}
            </Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
    padding: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 16,
  },
  stepCard: {
    backgroundColor: "white",
    padding: 14,
    marginBottom: 8,
    borderRadius: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  stepDescription: {
    fontSize: 15,
    fontWeight: "500",
    marginBottom: 4,
  },
  stepMeta: {
    fontSize: 13,
    color: "#888",
  },
});
