import AsyncStorage from "@react-native-async-storage/async-storage";
import { CONFIG } from "../config";
import { SessionInfo } from "../types";

const storage = {
  async getSession(): Promise<SessionInfo | null> {
    const raw = await AsyncStorage.getItem(CONFIG.sessionStorageKey);
    return raw ? JSON.parse(raw) : null;
  },

  async saveSession(info: SessionInfo): Promise<void> {
    await AsyncStorage.setItem(CONFIG.sessionStorageKey, JSON.stringify(info));
  },

  async clearSession(): Promise<void> {
    await AsyncStorage.removeItem(CONFIG.sessionStorageKey);
  },
};

export default storage;
