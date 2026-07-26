import { useState, useEffect } from "react";
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from "react-native";

interface Plan {
  id: string;
  goalText: string;
  status: string;
  stepsCount: number;
  completedSteps: number;
}

export default function TaskListScreen({ navigation }: any) {
  const [plans, setPlans] = useState<Plan[]>([]);

  useEffect(() => {
    fetchPlans();
  }, []);

  const fetchPlans = async () => {
    try {
      // TODO: Replace with actual cloud relay URL
      // const response = await fetch("https://your-cloud-relay.com/api/plans");
      // const data = await response.json();
      // setPlans(data.plans);

      // Placeholder for development
      setPlans([
        {
          id: "1",
          goalText: "Research local-first architecture patterns",
          status: "executing",
          stepsCount: 5,
          completedSteps: 3,
        },
        {
          id: "2",
          goalText: "Create project documentation",
          status: "completed",
          stepsCount: 3,
          completedSteps: 3,
        },
      ]);
    } catch (e) {
      console.error("Failed to fetch plans:", e);
    }
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={plans}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.planCard}
            onPress={() => navigation.navigate("TaskDetail", { planId: item.id })}
          >
            <Text style={styles.goalText}>{item.goalText}</Text>
            <Text style={styles.statusText}>
              {item.completedSteps}/{item.stepsCount} steps • {item.status}
            </Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  planCard: {
    backgroundColor: "white",
    padding: 16,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  goalText: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 4,
  },
  statusText: {
    fontSize: 14,
    color: "#666",
  },
});
