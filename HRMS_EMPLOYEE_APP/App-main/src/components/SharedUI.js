// src/components/SharedUI.js
import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, Modal, ScrollView, Dimensions } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Colors, STATUS_MAP, DAY_LABELS } from '../constants/colors';

const { height: SH } = Dimensions.get('window');

export function StatusBadge({ status }) {
  const m = STATUS_MAP[status] || STATUS_MAP.pending;
  return (
    <View style={[s.badge, { backgroundColor: m.bg }]}>
      <View style={[s.badgeDot, { backgroundColor: m.dot }]} />
      <Text style={[s.badgeText, { color: m.text }]}>{m.label}</Text>
    </View>
  );
}

export function LoadingView({ message = 'Loading...' }) {
  return <View style={s.loadingView}><ActivityIndicator size="large" color={Colors.primary} /><Text style={s.loadingText}>{message}</Text></View>;
}

export function EmptyState({ icon = '📋', title, message, action, actionLabel }) {
  return (
    <View style={s.emptyState}>
      <Text style={s.emptyIcon}>{icon}</Text>
      <Text style={s.emptyTitle}>{title}</Text>
      <Text style={s.emptyMessage}>{message}</Text>
      {action && <TouchableOpacity style={s.emptyButton} onPress={action}><Text style={s.emptyButtonText}>{actionLabel || 'Try again'}</Text></TouchableOpacity>}
    </View>
  );
}

export function BottomSheet({ visible, onClose, title, subtitle, icon, children, maxHeight = 0.92 }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.sheetOverlay}>
        <TouchableOpacity style={s.sheetBackdrop} activeOpacity={1} onPress={onClose} />
        <View style={[s.sheetContainer, { maxHeight: SH * maxHeight }]}>
          <View style={s.sheetHandle} />
          {(title || subtitle) && (
            <View style={s.sheetHeader}>
              {icon && <View style={s.sheetIconBox}>{icon}</View>}
              <View style={{ flex: 1 }}>
                {title && <Text style={s.sheetTitle}>{title}</Text>}
                {subtitle && <Text style={s.sheetSubtitle}>{subtitle}</Text>}
              </View>
              <TouchableOpacity style={s.sheetClose} onPress={onClose}><Ionicons name="close" size={16} color="#6B7280" /></TouchableOpacity>
            </View>
          )}
          <ScrollView style={s.sheetBody} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function Toast({ message, visible }) {
  if (!visible || !message) return null;
  return <View style={s.toast}><Ionicons name="checkmark-circle" size={18} color="#fff" /><Text style={s.toastText}>{message}</Text></View>;
}

export function Card({ children, style, onPress }) {
  const Comp = onPress ? TouchableOpacity : View;
  return <Comp style={[s.card, style]} onPress={onPress} activeOpacity={0.7}>{children}</Comp>;
}

export function PillButton({ label, active, onPress, style }) {
  return (
    <TouchableOpacity onPress={onPress} style={[s.pill, active && s.pillActive, style]} activeOpacity={0.7}>
      <Text style={[s.pillText, active && s.pillTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── Helper: normalize a date string (handles "2025-04-15" or "2025-04-15T00:00:00.000Z") ──
function toDateStr(raw) {
  if (!raw) return null;
  return String(raw).split('T')[0]; // "2025-04-15T..." → "2025-04-15"
}

// ─── Leave Calendar Modal — shows which dates a leave type was used ─────
export function LeaveCalendarModal({ visible, onClose, leaveType, applications }) {
  if (!visible) return null;

  // ★ FIX: Accept ALL approved/pending statuses including legacy 'approved'
  const acceptedStatuses = ['hr_approved', 'manager_approved', 'pending', 'approved'];

  // ★ FIX: For PL, also match 'EL' leaveType (backward compatibility)
  const typeApps = (applications || []).filter(a => {
    const typeMatch = a.leaveType === leaveType || (leaveType === 'PL' && a.leaveType === 'EL');
    const statusMatch = acceptedStatuses.includes(a.status);
    return typeMatch && statusMatch;
  });

  // Collect all leave dates
  const leaveDates = new Set();
  typeApps.forEach(app => {
    const from = toDateStr(app.fromDate);
    const to = toDateStr(app.toDate) || from;
    if (!from) return;
    const [fy, fm, fd] = from.split('-').map(Number);
    const [ty, tm, td] = to.split('-').map(Number);
    const start = new Date(fy, fm - 1, fd);
    const end = new Date(ty, tm - 1, td);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      // ★ FIX: Use LOCAL date, not UTC — toISOString() shifts dates back in IST
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      leaveDates.add(ds);
    }
  });

  const year = new Date().getFullYear();
  const typeColors = { CL: '#6366F1', SL: '#F59E0B', PL: '#10B981' };
  const typeLabels = { CL: 'Casual Leave', SL: 'Sick Leave', PL: 'Privilege Leave' };
  const color = typeColors[leaveType] || '#6366F1';

  // Build 12-month mini calendar
  const months = [];
  for (let m = 0; m < 12; m++) {
    const firstDay = new Date(year, m, 1).getDay();
    const dim = new Date(year, m + 1, 0).getDate();
    const monthDates = [];
    for (let d = 1; d <= dim; d++) {
      const ds = `${year}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      monthDates.push({ day: d, isLeave: leaveDates.has(ds) });
    }
    months.push({ name: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m], firstDay, dates: monthDates });
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.calOverlay}>
        <TouchableOpacity style={s.calBackdrop} onPress={onClose} activeOpacity={1} />
        <View style={s.calContainer}>
          <View style={s.calHeader}>
            <View style={[s.calHeaderDot, { backgroundColor: color }]} />
            <Text style={s.calHeaderTitle}>{typeLabels[leaveType] || leaveType} — {year}</Text>
            <TouchableOpacity onPress={onClose} style={s.calCloseBtn}><Ionicons name="close" size={18} color="#6B7280" /></TouchableOpacity>
          </View>
          <Text style={s.calSubtitle}>{leaveDates.size} day{leaveDates.size !== 1 ? 's' : ''} used</Text>

          <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: SH * 0.65 }}>
            <View style={s.calMonthGrid}>
              {months.map((m, mi) => (
                <View key={mi} style={s.calMonthBox}>
                  <Text style={s.calMonthLabel}>{m.name}</Text>
                  <View style={s.calDayGrid}>
                    {Array.from({ length: m.firstDay }).map((_, i) => <View key={`e${i}`} style={s.calDayCell} />)}
                    {m.dates.map(d => (
                      <View key={d.day} style={[s.calDayCell, d.isLeave && { backgroundColor: color, borderRadius: 6 }]}>
                        <Text style={[s.calDayText, d.isLeave && { color: '#fff', fontWeight: '800' }]}>{d.day}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ))}
            </View>

            {typeApps.length > 0 && (
              <View style={{ paddingHorizontal: 16, paddingBottom: 20 }}>
                <Text style={s.calListTitle}>Leave Periods</Text>
                {typeApps.map((app, i) => (
                  <View key={i} style={[s.calListItem, { borderLeftColor: color }]}>
                    <Text style={s.calListDate}>{toDateStr(app.fromDate)} → {toDateStr(app.toDate) || toDateStr(app.fromDate)}</Text>
                    <Text style={s.calListDays}>{app.totalDays || 1} day{(app.totalDays || 1) !== 1 ? 's' : ''}{app.isHalfDay ? ' (½)' : ''}</Text>
                    {app.reason ? <Text style={s.calListReason} numberOfLines={1}>{app.reason}</Text> : null}
                  </View>
                ))}
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, gap: 5 },
  badgeDot: { width: 6, height: 6, borderRadius: 3 }, badgeText: { fontSize: 11, fontWeight: '600' },
  loadingView: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 60 },
  loadingText: { marginTop: 12, fontSize: 14, color: Colors.textSecondary },
  emptyState: { alignItems: 'center', paddingVertical: 50, paddingHorizontal: 30 },
  emptyIcon: { fontSize: 48, marginBottom: 12 }, emptyTitle: { fontSize: 16, fontWeight: '600', color: Colors.text, marginBottom: 6, textAlign: 'center' },
  emptyMessage: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  emptyButton: { marginTop: 16, paddingHorizontal: 24, paddingVertical: 10, backgroundColor: Colors.primary, borderRadius: 12 },
  emptyButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  sheetOverlay: { flex: 1, justifyContent: 'flex-end' },
  sheetBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheetContainer: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  sheetHandle: { width: 40, height: 4, backgroundColor: '#E5E7EB', borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 8 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  sheetIconBox: { width: 36, height: 36, borderRadius: 12, backgroundColor: '#111827', justifyContent: 'center', alignItems: 'center' },
  sheetTitle: { fontSize: 15, fontWeight: '700', color: Colors.text }, sheetSubtitle: { fontSize: 12, color: '#9CA3AF', marginTop: 2 },
  sheetClose: { width: 30, height: 30, borderRadius: 10, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center' },
  sheetBody: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40 },
  toast: { position: 'absolute', top: 50, left: 16, right: 16, backgroundColor: '#059669', paddingHorizontal: 20, paddingVertical: 14, borderRadius: 16, zIndex: 999, elevation: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  toastText: { color: '#fff', fontSize: 14, fontWeight: '600', flex: 1 },
  card: { backgroundColor: '#fff', borderRadius: 18, borderWidth: 1, borderColor: '#F0F0F3', overflow: 'hidden' },
  pill: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12, borderWidth: 1.5, borderColor: '#E5E7EB', backgroundColor: '#fff', marginRight: 8 },
  pillActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  pillText: { fontSize: 12, fontWeight: '600', color: '#6B7280' }, pillTextActive: { color: '#fff' },
  // Calendar modal
  calOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  calBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  calContainer: { backgroundColor: '#fff', borderRadius: 24, width: '100%', maxHeight: SH * 0.8, overflow: 'hidden' },
  calHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8 },
  calHeaderDot: { width: 12, height: 12, borderRadius: 6 },
  calHeaderTitle: { fontSize: 16, fontWeight: '700', color: '#111827', flex: 1 },
  calCloseBtn: { width: 32, height: 32, borderRadius: 10, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center' },
  calSubtitle: { fontSize: 13, color: '#9CA3AF', paddingHorizontal: 20, marginBottom: 12 },
  calMonthGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 8 },
  calMonthBox: { width: '50%', padding: 8 },
  calMonthLabel: { fontSize: 12, fontWeight: '700', color: '#374151', marginBottom: 4, textAlign: 'center' },
  calDayGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calDayCell: { width: `${100 / 7}%`, aspectRatio: 1, justifyContent: 'center', alignItems: 'center' },
  calDayText: { fontSize: 8, color: '#6B7280', fontWeight: '500' },
  calListTitle: { fontSize: 12, fontWeight: '700', color: '#374151', marginTop: 12, marginBottom: 8 },
  calListItem: { backgroundColor: '#F9FAFB', borderRadius: 12, padding: 12, marginBottom: 8, borderLeftWidth: 3 },
  calListDate: { fontSize: 13, fontWeight: '600', color: '#111827' },
  calListDays: { fontSize: 11, color: '#6B7280', marginTop: 2 },
  calListReason: { fontSize: 11, color: '#9CA3AF', marginTop: 2 },
});