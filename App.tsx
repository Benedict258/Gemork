import { useEffect } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import HomeScreen from "./src/screens/HomeScreen";
import TaskListScreen from "./src/screens/TaskListScreen";
import TaskDetailScreen from "./src/screens/TaskDetailScreen";
import NewTaskScreen from "./src/screens/NewTaskScreen";
import { relayClient } from "./src/services/relay-client";
import { CONFIG } from "./src/config";

export type RootStackParamList = {
  Home: undefined;
  TaskList: undefined;
  TaskDetail: { planId: string };
  NewTask: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  useEffect(() => {
    relayClient.connect(CONFIG.defaultRelayUrl, "demo-token");
    return () => relayClient.disconnect();
  }, []);

  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Home">
        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={{ title: "Gemork" }}
        />
        <Stack.Screen
          name="TaskList"
          component={TaskListScreen}
          options={{ title: "Active Tasks" }}
        />
        <Stack.Screen
          name="TaskDetail"
          component={TaskDetailScreen}
          options={{ title: "Task Details" }}
        />
        <Stack.Screen
          name="NewTask"
          component={NewTaskScreen}
          options={{ title: "New Task" }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
