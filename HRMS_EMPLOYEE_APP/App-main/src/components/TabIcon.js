// src/components/TabIcon.js
import React from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';

const ICON_MAP = {
  home: { active: 'home', inactive: 'home-outline' },
  tasks: { active: 'checkmark-circle', inactive: 'checkmark-circle-outline' },
  calendar: { active: 'calendar', inactive: 'calendar-outline' },
  salary: { active: 'wallet', inactive: 'wallet-outline' },
  profile: { active: 'person', inactive: 'person-outline' },
};

export function TabIcon({ name, color, size = 24, focused }) {
  const mapping = ICON_MAP[name] || ICON_MAP.home;
  const iconName = focused ? mapping.active : mapping.inactive;
  return <Ionicons name={iconName} size={size} color={color} />;
}