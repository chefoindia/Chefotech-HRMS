import { useEffect } from "react";
import { Tabs, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Platform, View } from "react-native";
import { useSession } from "../../src/auth/session";
import { useColors } from "../../src/theme/ThemeProvider";
import { useUnreadCount } from "../../src/api/hooks";

/**
 * The signed-in shell.
 *
 * Five tabs, which is the practical ceiling before labels start truncating on
 * a small phone. Everything else lives under "More" rather than being crammed
 * into a sixth slot nobody can read.
 */
export default function AppLayout() {
  const { session, ready } = useSession();
  const router = useRouter();
  const colors = useColors();
  const { data: unread } = useUnreadCount();

  // A session that ends while the app is open — token revoked, membership
  // removed — has to eject rather than leaving empty screens behind.
  useEffect(() => {
    if (ready && !session) router.replace("/(auth)/login");
  }, [ready, session, router]);

  if (!session) return null;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand[600],
        tabBarInactiveTintColor: colors.textSubtle,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          // Android's default tab bar is cramped once the gesture bar is
          // accounted for.
          height: Platform.OS === "ios" ? 84 : 62,
          paddingTop: 6,
          paddingBottom: Platform.OS === "ios" ? 28 : 8,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "500" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size - 2} color={color} />,
        }}
      />
      <Tabs.Screen
        name="attendance"
        options={{
          title: "Attendance",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="calendar" size={size - 2} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="leave"
        options={{
          title: "Leave",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="airplane" size={size - 2} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="payslips"
        options={{
          title: "Payslips",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="wallet" size={size - 2} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: "More",
          tabBarIcon: ({ color, size }) => (
            <View>
              <Ionicons name="ellipsis-horizontal-circle" size={size - 2} color={color} />
              {Boolean(unread) && (
                <View
                  style={{
                    position: "absolute",
                    top: -2,
                    right: -3,
                    minWidth: 9,
                    height: 9,
                    borderRadius: 5,
                    backgroundColor: colors.danger,
                  }}
                />
              )}
            </View>
          ),
        }}
      />

      {/* Reachable by push, but not tabs in their own right. */}
      <Tabs.Screen name="apply-leave" options={{ href: null }} />
      <Tabs.Screen name="correction" options={{ href: null }} />
      <Tabs.Screen name="profile" options={{ href: null }} />
      <Tabs.Screen name="documents" options={{ href: null }} />
      <Tabs.Screen name="notifications" options={{ href: null }} />
      <Tabs.Screen name="help" options={{ href: null }} />
      <Tabs.Screen name="settings" options={{ href: null }} />
      <Tabs.Screen name="holidays" options={{ href: null }} />
    </Tabs>
  );
}
